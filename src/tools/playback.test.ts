import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import { registerPlaybackTools } from "./playback.js";
import { SpotifyCliClient } from "../cli/client.js";

// Mock node:child_process's execFile (used via util.promisify inside
// SpotifyCliClient.run) so no real spotify_cli process is ever invoked.
// util.promisify(execFile) expects the callback-style signature
// (file, args, options, callback) -- the mock must support that shape.
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: (...a: unknown[]) => void) => {
    callback(null, { stdout: "{}", stderr: "" });
  }),
  spawn: vi.fn(),
}));

import { execFile } from "node:child_process";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal fake McpServer that captures each registered tool's handler and
 * config (as passed to `server.registerTool(...)`), so both behavior and
 * annotations can be checked without spinning up a real MCP transport.
 */
interface CapturedTool {
  description: string;
  shape: Record<string, ZodType>;
  annotations: Record<string, unknown>;
  handler: ToolHandler;
}

function createFakeServer(): {
  server: McpServer;
  handlers: Map<string, ToolHandler>;
  tools: Map<string, CapturedTool>;
} {
  const handlers = new Map<string, ToolHandler>();
  const tools = new Map<string, CapturedTool>();
  const server = {
    registerTool: (
      name: string,
      config: {
        description: string;
        inputSchema: Record<string, ZodType>;
        annotations?: Record<string, unknown>;
      },
      handler: ToolHandler
    ) => {
      handlers.set(name, handler);
      tools.set(name, {
        description: config.description,
        shape: config.inputSchema,
        annotations: config.annotations ?? {},
        handler,
      });
    },
  } as unknown as McpServer;
  return { server, handlers, tools };
}

function mockExecFileOnce(stdout: string): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
    (_file: string, _args: string[], _options: unknown, callback: (...a: unknown[]) => void) => {
      callback(null, { stdout, stderr: "" });
    }
  );
}

function mockExecFileRejectOnce(err: { code?: number; stderr?: string; stdout?: string; message?: string }): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
    (_file: string, _args: string[], _options: unknown, callback: (...a: unknown[]) => void) => {
      const error = Object.assign(new Error(err.message ?? "failed"), {
        code: err.code ?? 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      });
      callback(error, { stdout: err.stdout ?? "", stderr: err.stderr ?? "" });
    }
  );
}

function getHandlers(): Map<string, ToolHandler> {
  const { server, handlers } = createFakeServer();
  const client = new SpotifyCliClient({ cliPath: "/fake/spotify_cli", retry: { maxAttempts: 1, baseDelayMs: 0 } });
  registerPlaybackTools(server, client);
  return handlers;
}

function getHandler(handlers: Map<string, ToolHandler>, name: string): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

function lastCallArgs(): string[] {
  const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const lastCall = calls[calls.length - 1] as unknown[];
  return lastCall[1] as string[];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("play", () => {
  it("invokes bare 'play' with no args when called with no params", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "play");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["play", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("passes the uri positionally when given", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "play");

    await handler({ uri: "spotify:track:4iV5W9uYEdYUVa79Axb7Rh" });

    expect(lastCallArgs()).toEqual(["play", "spotify:track:4iV5W9uYEdYUVa79Axb7Rh", "--format", "json"]);
  });

  it("appends --device after the uri when both are given", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "play");

    await handler({ uri: "spotify:track:4iV5W9uYEdYUVa79Axb7Rh", device: "Kitchen Speaker" });

    expect(lastCallArgs()).toEqual([
      "play",
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
      "--device",
      "Kitchen Speaker",
      "--format",
      "json",
    ]);
  });

  it("supports --device with no uri (resume on a specific device)", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "play");

    await handler({ device: "Kitchen Speaker" });

    expect(lastCallArgs()).toEqual(["play", "--device", "Kitchen Speaker", "--format", "json"]);
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "no active device" });
    const handler = getHandler(getHandlers(), "play");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active device");
  });
});

describe("pause", () => {
  it("invokes 'pause' with no args", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "pause");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["pause", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("real-world shape: 'pause' prints nothing on success (confirmed live) -- reports {success:true, message:\"\"} rather than erroring", async () => {
    mockExecFileOnce("");
    const handler = getHandler(getHandlers(), "pause");

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ success: true, message: "" });
  });
});

describe("resume", () => {
  it("invokes 'resume' with no args", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "resume");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["resume", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("real-world shape: 'resume' prints nothing on success (confirmed live) -- reports {success:true, message:\"\"} rather than erroring", async () => {
    mockExecFileOnce("");
    const handler = getHandler(getHandlers(), "resume");

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ success: true, message: "" });
  });
});

describe("skip_to_next", () => {
  it("invokes 'next' with no args", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "skip_to_next");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["next", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "no active device" });
    const handler = getHandler(getHandlers(), "skip_to_next");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active device");
  });
});

describe("skip_to_previous", () => {
  it("invokes 'previous' with no args", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "skip_to_previous");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["previous", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });
});

describe("seek", () => {
  it("invokes 'seek <ms>' for an absolute, non-negative position", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "seek");

    const result = await handler({ ms: 90000 });

    expect(lastCallArgs()).toEqual(["seek", "90000", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("appends --relative when relative=true, forward", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "seek");

    await handler({ ms: 15000, relative: true });

    expect(lastCallArgs()).toEqual(["seek", "15000", "--relative", "--format", "json"]);
  });

  it("allows a negative ms value when relative=true, backward", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "seek");

    const result = await handler({ ms: -30000, relative: true });

    expect(lastCallArgs()).toEqual(["seek", "-30000", "--relative", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("rejects a negative ms value without relative=true, without invoking the CLI", async () => {
    const handler = getHandler(getHandlers(), "seek");

    const result = await handler({ ms: -30000 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/relative/i);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "no active device" });
    const handler = getHandler(getHandlers(), "seek");

    const result = await handler({ ms: 1000 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active device");
  });
});

describe("set_shuffle", () => {
  it("invokes 'shuffle on'", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "set_shuffle");

    await handler({ mode: "on" });

    expect(lastCallArgs()).toEqual(["shuffle", "on", "--format", "json"]);
  });

  it("invokes 'shuffle off'", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "set_shuffle");

    await handler({ mode: "off" });

    expect(lastCallArgs()).toEqual(["shuffle", "off", "--format", "json"]);
  });
});

describe("set_repeat", () => {
  it("invokes bare 'repeat' with no args when mode is omitted (cycles modes)", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "set_repeat");

    await handler({});

    expect(lastCallArgs()).toEqual(["repeat", "--format", "json"]);
  });

  it("invokes 'repeat <mode>' when a mode is given", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "set_repeat");

    await handler({ mode: "track" });

    expect(lastCallArgs()).toEqual(["repeat", "track", "--format", "json"]);
  });
});

describe("set_playback_speed", () => {
  it("invokes 'speed <rate>', stringifying the numeric rate", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "set_playback_speed");

    await handler({ rate: 1.5 });

    const args = lastCallArgs();
    expect(args).toEqual(["speed", "1.5", "--format", "json"]);
    expect(typeof args[1]).toBe("string");
  });
});

describe("set_volume", () => {
  it("invokes 'volume <level>', stringifying the numeric level", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handler = getHandler(getHandlers(), "set_volume");

    await handler({ level: 0.5 });

    const args = lastCallArgs();
    expect(args).toEqual(["volume", "0.5", "--format", "json"]);
    expect(typeof args[1]).toBe("string");
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "no active device" });
    const handler = getHandler(getHandlers(), "set_volume");

    const result = await handler({ level: 0.5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active device");
  });

  it("real-world shape: 'volume' ignores --format json and returns raw text (confirmed live: 'Volume: 0.60') -- reports success without erroring", async () => {
    mockExecFileOnce("Volume: 0.60");
    const handler = getHandler(getHandlers(), "set_volume");

    const result = await handler({ level: 0.6 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ success: true, message: "Volume: 0.60" });
  });
});

describe("get_now_playing", () => {
  it("invokes bare 'now-playing' with no args", async () => {
    mockExecFileOnce(JSON.stringify({ currently_playing: { name: "Track" } }));
    const handler = getHandler(getHandlers(), "get_now_playing");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["now-playing", "--format", "json"]);
    expect(result.content[0].text).toContain("Track");
    expect(result.isError).toBeUndefined();
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "not logged in" });
    const handler = getHandler(getHandlers(), "get_now_playing");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not logged in");
  });
});
