import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { SpotifyCliError } from "./errors.js";
import type { SpotifyCliConfig, RetryConfig } from "../utils/config.js";

const execFileAsync = promisify(execFileCb);

const DEFAULT_RUN_TIMEOUT_MS = 15_000;
const DEFAULT_BATCH_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY: RetryConfig = { maxAttempts: 2, baseDelayMs: 300 };

/**
 * execFile's own default maxBuffer is 1 MiB, and exceeding it kills the child
 * and rejects with ERR_CHILD_PROCESS_STDIO_MAXBUFFER -- i.e. a *successful*
 * command whose output is merely large fails, and fails confusingly. That
 * ceiling is well within reach here: 'folder list --recursive' already runs
 * to ~80 KB on a modest account, and 'playlist get' on a multi-thousand-track
 * playlist or 'history recent --limit <large>' (~380 bytes per item) go past
 * 1 MiB easily. 32 MiB is far above any plausible spotify_cli response while
 * still bounding memory if the CLI ever streams unexpectedly.
 */
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;

/** How long to wait after SIGTERM before escalating to SIGKILL on timeout. */
const KILL_GRACE_MS = 2_000;

/**
 * Shape of the error object node:child_process rejects with. execFile/spawn
 * attach `code`/`killed`/`signal`, and (for execFile via util.promisify)
 * `stdout`/`stderr` as captured so far.
 */
interface ChildProcessError extends Error {
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

export class SpotifyCliClient {
  private readonly cliPath: string;
  private readonly retry: RetryConfig;

  constructor(config: SpotifyCliConfig) {
    this.cliPath = config.cliPath;
    this.retry = config.retry ?? DEFAULT_RETRY;
  }

  /**
   * Runs a spotify_cli command, appending --format json automatically, and
   * parses stdout as JSON. Retries on SpotifyCliError.isTransientError per
   * the configured retry settings, using a small fixed delay between
   * attempts (this is a local process, not a shared rate-limited API, so
   * exponential backoff isn't needed).
   */
  async run<T = unknown>(args: string[]): Promise<T> {
    const fullArgs = [...args, "--format", "json"];
    const maxAttempts = Math.max(1, this.retry.maxAttempts);

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.execOnce<T>(fullArgs);
      } catch (error) {
        lastError = error;
        const isLast = attempt >= maxAttempts - 1;
        if (isLast || !SpotifyCliError.isTransientError(error)) {
          throw error;
        }
        await this.delay(this.retry.baseDelayMs);
      }
    }
    // Unreachable, but satisfies TypeScript.
    throw lastError;
  }

  private async execOnce<T>(fullArgs: string[]): Promise<T> {
    let stdout: string;
    let stderr: string;
    try {
      const result = await execFileAsync(this.cliPath, fullArgs, {
        timeout: DEFAULT_RUN_TIMEOUT_MS,
        maxBuffer: MAX_STDOUT_BYTES,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      throw this.toSpotifyCliError(error, fullArgs);
    }

    try {
      return JSON.parse(stdout) as T;
    } catch {
      // A number of spotify_cli mutation commands (playlist create/update/
      // add/remove, folder create/rename/move/remove, library add/remove)
      // ignore --format json on success and print a short human-readable
      // line instead (e.g. "Created: My Playlist  spotify:playlist:abc123"),
      // confirmed via live testing against a real account. We only reach
      // this branch after execFileAsync already resolved (i.e. exit code
      // 0) -- a real failure is a non-zero exit, thrown above, before this
      // parse is attempted -- so non-JSON stdout here means the command
      // actually succeeded, just without structured output. Return it as a
      // raw-message fallback rather than throwing; utils/formatters.ts's
      // formatMutationResult() turns this into a structured response and
      // extracts a URI when the message contains one.
      return { message: stdout.trim() } as T;
    }
  }

  private toSpotifyCliError(error: unknown, command: string[]): SpotifyCliError {
    const err = error as ChildProcessError;

    if (err.code === "ENOENT") {
      return new SpotifyCliError(
        -1,
        "",
        "",
        `Spotify CLI not found at ${this.cliPath} -- set SPOTIFY_CLI_PATH or install Spotify.app`,
        command
      );
    }

    // Checked before the killed/signal branch below: a maxBuffer overflow
    // also kills the child with a signal, so without this it would be
    // misreported as a timeout and send the user chasing the wrong problem.
    if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return new SpotifyCliError(
        -1,
        err.stderr ?? "",
        err.stdout ?? "",
        `spotify_cli produced more than ${MAX_STDOUT_BYTES} bytes of output (command: ${command.join(" ")}) -- narrow the request with --limit/--offset`,
        command
      );
    }

    if (err.killed && err.signal) {
      return new SpotifyCliError(
        -1,
        err.stderr ?? "",
        err.stdout ?? "",
        `spotify_cli timed out after ${DEFAULT_RUN_TIMEOUT_MS}ms (command: ${command.join(" ")})`,
        command
      );
    }

    const exitCode = typeof err.code === "number" ? err.code : -1;
    const stderr = err.stderr ?? "";
    const stdout = err.stdout ?? "";
    // execFile's own err.message is just "Command failed: <argv>" with the
    // reason appended only when the CLI wrote to stderr. spotify_cli reports
    // some failures on *stdout* instead (e.g. a malformed subcommand prints
    // usage text to stdout and exits 1), and in that case err.message carries
    // no reason at all -- the tool would surface a bare "Command failed" with
    // the actual explanation sitting unused in stdout. Passing undefined lets
    // SpotifyCliError.summarize() pick whichever stream actually has detail.
    const hasDetail = stderr.trim().length > 0 || stdout.trim().length > 0;
    return new SpotifyCliError(exitCode, stderr, stdout, hasDetail ? undefined : err.message, command);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Runs 'library batch', piping the manifest as JSON to the child's stdin
   * (spawn, not execFile, since we need to write to stdin). 'library batch'
   * emits JSON-lines regardless of --format: one JSON object per completed
   * op, followed by a final JSON summary line. --format json is still
   * appended so that summary line itself is guaranteed to be JSON.
   *
   * Per docs/spotify-cli-reference.txt, the CLI continues past failed ops by
   * default and its exit code is simply non-zero *if any op failed* -- so a
   * non-zero exit is the expected, common outcome for a mixed-result batch,
   * not proof the whole run is unusable. Throwing immediately on
   * `exitCode !== 0` would silently discard the already-parsed per-op
   * results (including which destructive ops -- library_remove/
   * folder_remove/playlist_remove -- already succeeded), which is exactly
   * the information a caller needs most in that scenario. So a non-zero
   * exit code only becomes a thrown SpotifyCliError when stdout does NOT
   * contain a parseable batch result (i.e. a hard/early failure with no
   * structured output) -- otherwise the parsed {results, summary} is
   * returned normally, and the summary itself reports the failed-op count.
   */
  async runBatch(manifest: unknown): Promise<{ results: unknown[]; summary: unknown }> {
    const args = ["library", "batch", "--format", "json"];
    const input = JSON.stringify(manifest);

    const { stdout, stderr, exitCode } = await this.spawnWithStdin(args, input, DEFAULT_BATCH_TIMEOUT_MS);

    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new SpotifyCliError(
        exitCode,
        stderr,
        stdout,
        exitCode === 0 ? "spotify_cli library batch produced no output" : undefined,
        args
      );
    }

    let parsedLines: unknown[];
    try {
      parsedLines = lines.map((line) => JSON.parse(line));
    } catch {
      throw new SpotifyCliError(
        exitCode,
        stderr,
        stdout,
        `Failed to parse spotify_cli library batch output as JSON lines: ${stdout.slice(0, 200)}`,
        args
      );
    }

    const summary = parsedLines[parsedLines.length - 1];
    const results = parsedLines.slice(0, -1);
    return { results, summary };
  }

  private spawnWithStdin(
    args: string[],
    input: string,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        // 'close' only fires once the child actually exits, so a child that
        // ignores SIGTERM would leave this promise pending forever and hang
        // the tool call. Escalate to SIGKILL after a short grace period.
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        killTimer.unref?.();
      }, timeoutMs);

      const clearTimers = (): void => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error: ChildProcessError) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (error.code === "ENOENT") {
          reject(
            new SpotifyCliError(
              -1,
              "",
              "",
              `Spotify CLI not found at ${this.cliPath} -- set SPOTIFY_CLI_PATH or install Spotify.app`,
              args
            )
          );
          return;
        }
        reject(new SpotifyCliError(-1, stderr, stdout, error.message, args));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (timedOut) {
          reject(
            new SpotifyCliError(
              -1,
              stderr,
              stdout,
              `spotify_cli library batch timed out after ${timeoutMs}ms`,
              args
            )
          );
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      // A manifest larger than the OS pipe buffer (~64 KiB) cannot be written
      // in one go, so if spotify_cli exits early -- a rejected manifest, the
      // desktop app not running -- the rest of the write hits a closed pipe
      // and stdin emits EPIPE. An unhandled 'error' event on a stream is an
      // uncaught exception, which would take down the whole MCP server
      // process, not just this call. Swallow it deliberately: the child's own
      // 'close'/'error' handler above is what settles this promise, and its
      // exit code plus stderr describe the real failure far better than the
      // EPIPE would.
      child.stdin.on("error", () => {});
      child.stdin.write(input);
      child.stdin.end();
    });
  }
}
