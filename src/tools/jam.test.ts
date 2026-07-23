import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";

const execFileMock = vi.fn();
const spawnMock = vi.fn();

/**
 * jam.ts never invokes node:child_process directly -- it only calls through
 * SpotifyCliClient -- but SpotifyCliClient itself uses execFile/spawn under
 * the hood, so those are mocked here the same way client.test.ts does it,
 * ensuring no real process is ever spawned even transitively.
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

const { SpotifyCliClient } = await import("../cli/client.js");
const { registerJamTools } = await import("./jam.js");

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

function mockExecFileOnce(stdout: string, stderr = "") {
  execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(null, stdout, stderr));
}

function mockExecFileErrorOnce(err: Record<string, unknown>) {
  execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(err, "", ""));
}

function setup() {
  const { server, handlers } = createFakeServer();
  const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli", retry: { maxAttempts: 1, baseDelayMs: 0 } });
  registerJamTools(server, client);
  return { handlers };
}

function getHandler(handlers: Map<string, ToolHandler>, name: string): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe("get_jam_status", () => {
  it("calls spotify_cli jam with no subcommand and formats JSON output", async () => {
    mockExecFileOnce(JSON.stringify({ active: true, join_token: "abc123" }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "get_jam_status");

    const result = await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("join_token");
    expect(result.content[0].text).toContain("abc123");
  });

  it("maps a SpotifyCliError to an isError text response", async () => {
    mockExecFileErrorOnce({ code: 1, message: "boom" });
    const { handlers } = setup();
    const handler = getHandler(handlers, "get_jam_status");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Command: spotify_cli jam");
  });
});

describe("list_jam_members", () => {
  it("calls spotify_cli jam members", async () => {
    mockExecFileOnce(JSON.stringify([{ username: "alice" }]));
    const { handlers } = setup();
    const handler = getHandler(handlers, "list_jam_members");

    const result = await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "members", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
    expect(result.content[0].text).toContain("alice");
  });
});

describe("create_jam", () => {
  it("calls spotify_cli jam create", async () => {
    mockExecFileOnce(JSON.stringify({ created: true }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "create_jam");

    await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "create", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });
});

describe("leave_jam", () => {
  it("calls spotify_cli jam leave", async () => {
    mockExecFileOnce(JSON.stringify({ left: true }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "leave_jam");

    await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "leave", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });
});

describe("end_jam", () => {
  it("calls spotify_cli jam end", async () => {
    mockExecFileOnce(JSON.stringify({ ended: true }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "end_jam");

    await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "end", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });
});

describe("kick_from_jam", () => {
  it("passes the username as a positional argv entry", async () => {
    mockExecFileOnce(JSON.stringify({ kicked: "username123" }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "kick_from_jam");

    const result = await handler({ username: "username123" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "kick", "username123", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
    expect(result.content[0].text).toContain("username123");
  });

  it("maps a SpotifyCliError to an isError text response", async () => {
    mockExecFileErrorOnce({ code: 1, message: "not host" });
    const { handlers } = setup();
    const handler = getHandler(handlers, "kick_from_jam");

    const result = await handler({ username: "someone" });

    expect(result.isError).toBe(true);
  });
});

describe("set_jam_permissions", () => {
  it("with neither flag, just views current permissions (no --queue-only/--volume-control in argv)", async () => {
    mockExecFileOnce(JSON.stringify({ queue_only: false, volume_control: true }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "set_jam_permissions");

    await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "permissions", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("passes --queue-only when queue_only is set", async () => {
    mockExecFileOnce(JSON.stringify({ queue_only: true }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "set_jam_permissions");

    await handler({ queue_only: "on" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "permissions", "--queue-only", "on", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("passes --volume-control when volume_control is set", async () => {
    mockExecFileOnce(JSON.stringify({ volume_control: false }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "set_jam_permissions");

    await handler({ volume_control: "off" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "permissions", "--volume-control", "off", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("passes both flags together when both are set", async () => {
    mockExecFileOnce(JSON.stringify({ queue_only: true, volume_control: false }));
    const { handlers } = setup();
    const handler = getHandler(handlers, "set_jam_permissions");

    await handler({ queue_only: "on", volume_control: "off" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["jam", "permissions", "--queue-only", "on", "--volume-control", "off", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });
});
