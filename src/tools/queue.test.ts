import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import { registerQueueTools } from "./queue.js";
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
  registerQueueTools(server, client);
  return handlers;
}

function lastCallArgs(): string[] {
  const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const lastCall = calls[calls.length - 1] as unknown[];
  return lastCall[1] as string[];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_queue", () => {
  it("invokes 'queue' with --format json and returns formatted JSON", async () => {
    mockExecFileOnce(JSON.stringify({ queue: [{ uri: "spotify:track:abc" }] }));
    const handlers = getHandlers();
    const handler = handlers.get("get_queue");
    if (!handler) throw new Error("get_queue not registered");

    const result = await handler({});

    expect(lastCallArgs()).toEqual(["queue", "--format", "json"]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("spotify:track:abc");
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "no active device" });
    const handlers = getHandlers();
    const handler = handlers.get("get_queue");
    if (!handler) throw new Error("get_queue not registered");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active device");
  });
});

describe("add_to_queue", () => {
  it("invokes 'queue add <uri>' with the given URI", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handlers = getHandlers();
    const handler = handlers.get("add_to_queue");
    if (!handler) throw new Error("add_to_queue not registered");

    const result = await handler({ uri: "spotify:track:4iV5W9uYEdYUVa79Axb7Rh" });

    expect(lastCallArgs()).toEqual([
      "queue",
      "add",
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
      "--format",
      "json",
    ]);
    expect(result.isError).toBeUndefined();
  });
});

describe("remove_from_queue", () => {
  it("invokes 'queue remove <position>' with a 0-based position", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handlers = getHandlers();
    const handler = handlers.get("remove_from_queue");
    if (!handler) throw new Error("remove_from_queue not registered");

    const result = await handler({ position: 0 });

    expect(lastCallArgs()).toEqual(["queue", "remove", "0", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("stringifies a non-zero position correctly", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handlers = getHandlers();
    const handler = handlers.get("remove_from_queue");
    if (!handler) throw new Error("remove_from_queue not registered");

    await handler({ position: 2 });

    expect(lastCallArgs()).toEqual(["queue", "remove", "2", "--format", "json"]);
  });
});

describe("move_in_queue", () => {
  it("invokes 'queue move <from> <to>' with 0-based positions", async () => {
    mockExecFileOnce(JSON.stringify({ success: true }));
    const handlers = getHandlers();
    const handler = handlers.get("move_in_queue");
    if (!handler) throw new Error("move_in_queue not registered");

    const result = await handler({ from: 3, to: 0 });

    expect(lastCallArgs()).toEqual(["queue", "move", "3", "0", "--format", "json"]);
    expect(result.isError).toBeUndefined();
  });

  it("maps a SpotifyCliError to isError content", async () => {
    mockExecFileRejectOnce({ code: 1, stderr: "position out of range" });
    const handlers = getHandlers();
    const handler = handlers.get("move_in_queue");
    if (!handler) throw new Error("move_in_queue not registered");

    const result = await handler({ from: 0, to: 2 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("position out of range");
  });
});
