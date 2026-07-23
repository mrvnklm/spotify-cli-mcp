import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import { registerDevicesTools } from "./devices.js";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";

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

function createFakeClient(response: unknown): { client: SpotifyCliClient; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue(response);
  const client = { run } as unknown as SpotifyCliClient;
  return { client, run };
}

function registerAndGetHandlers(client: SpotifyCliClient): Map<string, ToolHandler> {
  const { server, handlers } = createFakeServer();
  registerDevicesTools(server, client);
  return handlers;
}

function getHandler(handlers: Map<string, ToolHandler>, name: string): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

describe("list_devices", () => {
  it("calls 'devices' with no subcommand and formats the result", async () => {
    const { client, run } = createFakeClient({
      devices: [{ id: "abc", name: "Kitchen Speaker", is_active: true }],
    });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "list_devices");

    const result = await handler({});

    expect(run).toHaveBeenCalledWith(["devices"]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Kitchen Speaker");
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new SpotifyCliError(1, "no active device", "", undefined, ["devices"]));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "list_devices");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active device");
  });
});

describe("get_device_info", () => {
  it("passes the device argument positionally after 'info'", async () => {
    const { client, run } = createFakeClient({ id: "abc", name: "Kitchen Speaker" });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_device_info");

    const result = await handler({ device: "Kitchen Speaker" });

    expect(run).toHaveBeenCalledWith(["devices", "info", "Kitchen Speaker"]);
    expect(result.content[0].text).toContain("Kitchen Speaker");
  });
});

describe("transfer_playback", () => {
  it("passes the device argument positionally after 'transfer'", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "transfer_playback");

    await handler({ device: "Living Room" });

    expect(run).toHaveBeenCalledWith(["devices", "transfer", "Living Room"]);
  });

  it("propagates non-SpotifyCliError errors instead of swallowing them", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new Error("boom"));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "transfer_playback");

    await expect(handler({ device: "Living Room" })).rejects.toThrow("boom");
  });
});

describe("set_device_volume", () => {
  it("builds argv with level and device when both are given", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "set_device_volume");

    await handler({ level: 0.8, device: "Kitchen Speaker" });

    expect(run).toHaveBeenCalledWith(["devices", "volume", "0.8", "Kitchen Speaker"]);
  });

  it("omits the device argument entirely when not provided (applies to active device)", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "set_device_volume");

    await handler({ level: 0.5 });

    expect(run).toHaveBeenCalledWith(["devices", "volume", "0.5"]);
  });

  it("stringifies the numeric level rather than passing a number", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "set_device_volume");

    await handler({ level: 0 });

    const calledArgs = run.mock.calls[0][0] as string[];
    expect(calledArgs).toEqual(["devices", "volume", "0"]);
    expect(typeof calledArgs[2]).toBe("string");
  });
});
