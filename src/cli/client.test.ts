import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const execFileMock = vi.fn();
const spawnMock = vi.fn();

/**
 * node:child_process's execFile is promisified in client.ts via
 * `promisify(execFile)`. Node's real execFile carries a
 * `util.promisify.custom` implementation that resolves to `{stdout, stderr}`
 * (rather than the generic promisify behavior of only capturing the first
 * callback argument). Our mock must replicate that so promisify(execFileMock)
 * behaves the same way the real thing does.
 */
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = execFileMock;
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    path: string,
    args: string[],
    options: unknown
  ) =>
    new Promise((resolve, reject) => {
      execFile(path, args, options, (err: unknown, stdout: string, stderr: string) => {
        if (err) {
          (err as Record<string, unknown>).stdout = stdout;
          (err as Record<string, unknown>).stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  return { execFile, spawn: spawnMock };
});

const { SpotifyCliClient } = await import("./client.js");
const { SpotifyCliError } = await import("./errors.js");

function createFakeChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe("SpotifyCliClient.run", () => {
  it("appends --format json and calls execFile with the cli path and a real argv array", async () => {
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(null, "{}", ""));
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    await client.run(["play", "spotify:track:x"]);

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["play", "spotify:track:x", "--format", "json"],
      expect.objectContaining({ timeout: 15_000 }),
      expect.any(Function)
    );
  });

  it("parses stdout as JSON and returns it", async () => {
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) =>
      cb(null, JSON.stringify({ playing: true }), "")
    );
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    const result = await client.run(["play"]);

    expect(result).toEqual({ playing: true });
  });

  it("returns a raw-message fallback (not a throw) when a successful exit produces non-JSON stdout", async () => {
    // Confirmed via live testing: playlist/folder/library mutation commands
    // routinely succeed (exit 0) while printing plain text like
    // "Created: My Playlist  spotify:playlist:abc123" instead of JSON, even
    // with --format json. Only a non-zero exit is a real error.
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) =>
      cb(null, "Created: My Playlist  spotify:playlist:abc123", "")
    );
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    const result = await client.run(["playlist", "create", "My Playlist"]);

    expect(result).toEqual({ message: "Created: My Playlist  spotify:playlist:abc123" });
  });

  it("maps a non-zero exit into a SpotifyCliError carrying exitCode/stderr", async () => {
    const err = Object.assign(new Error("boom"), { code: 3 });
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(err, "", "invalid uri"));
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    await expect(client.run(["play", "not-a-uri"])).rejects.toMatchObject({
      exitCode: 3,
      stderr: "invalid uri",
    });
  });

  it("maps ENOENT to a clear 'not found' message referencing the configured path", async () => {
    const err = Object.assign(new Error("spawn /no/such/path ENOENT"), { code: "ENOENT" });
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(err, "", ""));
    const client = new SpotifyCliClient({ cliPath: "/no/such/path" });

    await expect(client.run(["play"])).rejects.toThrow(
      /Spotify CLI not found at \/no\/such\/path.*SPOTIFY_CLI_PATH/
    );
  });

  it("maps a timeout kill into a SpotifyCliError with a 'timed out' message", async () => {
    const err = Object.assign(new Error("Command failed"), {
      killed: true,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    });
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(err, "", ""));
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    await expect(client.run(["history", "top"])).rejects.toThrow(/timed out/);
  });

  it("retries once on a transient 'HTTP request failed' error and succeeds", async () => {
    const transientErr = Object.assign(new Error("HTTP request failed"), { code: 1 });
    execFileMock
      .mockImplementationOnce((_path, _args, _options, cb) =>
        cb(transientErr, "", "HTTP request failed: connection reset")
      )
      .mockImplementationOnce((_path, _args, _options, cb) => cb(null, JSON.stringify({ ok: true }), ""));

    const client = new SpotifyCliClient({
      cliPath: "/bin/spotify_cli",
      retry: { maxAttempts: 2, baseDelayMs: 1 },
    });

    const result = await client.run(["history", "top"]);

    expect(result).toEqual({ ok: true });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient error", async () => {
    const err = Object.assign(new Error("boom"), { code: 1 });
    execFileMock.mockImplementation((_path, _args, _options, cb) => cb(err, "", "invalid uri"));

    const client = new SpotifyCliClient({
      cliPath: "/bin/spotify_cli",
      retry: { maxAttempts: 3, baseDelayMs: 1 },
    });

    await expect(client.run(["play", "not-a-uri"])).rejects.toBeInstanceOf(SpotifyCliError);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("gives up once maxAttempts is exhausted against a persistently transient error", async () => {
    const err = Object.assign(new Error("HTTP request failed"), { code: 1 });
    execFileMock.mockImplementation((_path, _args, _options, cb) =>
      cb(err, "", "HTTP request failed: connection reset")
    );

    const client = new SpotifyCliClient({
      cliPath: "/bin/spotify_cli",
      retry: { maxAttempts: 2, baseDelayMs: 1 },
    });

    await expect(client.run(["history", "top"])).rejects.toBeInstanceOf(SpotifyCliError);
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});

describe("SpotifyCliClient.runBatch", () => {
  it("spawns 'library batch --format json', pipes the manifest JSON to stdin, and splits results from the summary", async () => {
    const child = createFakeChildProcess();
    spawnMock.mockReturnValue(child);
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });
    const manifest = { ops: [{ op: "library_add", uris: ["spotify:track:abc"] }] };

    const resultPromise = client.runBatch(manifest);

    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["library", "batch", "--format", "json"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
    );
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(manifest));
    expect(child.stdin.end).toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from('{"op":"library_add","success":true}\n'));
    child.stdout.emit("data", Buffer.from('{"total":1,"succeeded":1,"failed":0}\n'));
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.results).toEqual([{ op: "library_add", success: true }]);
    expect(result.summary).toEqual({ total: 1, succeeded: 1, failed: 0 });
  });

  it("throws a SpotifyCliError when the batch process exits non-zero", async () => {
    const child = createFakeChildProcess();
    spawnMock.mockReturnValue(child);
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    const resultPromise = client.runBatch({ ops: [] });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 1);

    await expect(resultPromise).rejects.toBeInstanceOf(SpotifyCliError);
  });

  it("throws a SpotifyCliError when stdout has no JSON lines at all", async () => {
    const child = createFakeChildProcess();
    spawnMock.mockReturnValue(child);
    const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });

    const resultPromise = client.runBatch({ ops: [] });
    child.emit("close", 0);

    await expect(resultPromise).rejects.toBeInstanceOf(SpotifyCliError);
  });

  it("maps ENOENT from spawn's error event to a clear 'not found' message", async () => {
    const child = createFakeChildProcess();
    spawnMock.mockReturnValue(child);
    const client = new SpotifyCliClient({ cliPath: "/no/such/path" });

    const resultPromise = client.runBatch({ ops: [] });
    const err = Object.assign(new Error("spawn /no/such/path ENOENT"), { code: "ENOENT" });
    child.emit("error", err);

    await expect(resultPromise).rejects.toThrow(/Spotify CLI not found at \/no\/such\/path/);
  });
});
