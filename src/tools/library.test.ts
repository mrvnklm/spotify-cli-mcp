import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import { registerLibraryTools } from "./library.js";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal fake McpServer that just captures each registered tool's handler
 * (the last argument passed to `server.registerTool(...)`) so it can be invoked
 * directly in tests without spinning up a real MCP transport or a real
 * spotify_cli process.
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

function createFakeClient(): SpotifyCliClient & {
  run: ReturnType<typeof vi.fn>;
  runBatch: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn(),
    runBatch: vi.fn(),
  } as unknown as SpotifyCliClient & { run: ReturnType<typeof vi.fn>; runBatch: ReturnType<typeof vi.fn> };
}

function setup() {
  const { server, handlers } = createFakeServer();
  const client = createFakeClient();
  registerLibraryTools(server, client);
  return { handlers, client };
}

function getHandler(handlers: Map<string, ToolHandler>, name: string): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_library", () => {
  it("calls 'library list' with no flags when no params given", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ items: [] });
    const handler = getHandler(handlers, "list_library");

    await handler({});

    expect(client.run).toHaveBeenCalledWith(["library", "list"]);
  });

  it("passes --type, --limit, --offset when provided", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ items: [] });
    const handler = getHandler(handlers, "list_library");

    await handler({ type: "album", limit: 20, offset: 10 });

    expect(client.run).toHaveBeenCalledWith([
      "library",
      "list",
      "--type",
      "album",
      "--limit",
      "20",
      "--offset",
      "10",
    ]);
  });

  it("formats the result as JSON text content", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ items: [{ uri: "spotify:album:x" }] });
    const handler = getHandler(handlers, "list_library");

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("spotify:album:x");
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { handlers, client } = setup();
    const error = new SpotifyCliError(1, "boom", "", "spotify_cli exited with code 1: boom", ["library", "list"]);
    client.run.mockRejectedValue(error);
    const handler = getHandler(handlers, "list_library");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });
});

describe("check_library_contains", () => {
  it("calls 'library contains' with the given uris as trailing argv", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue([{ uri: "spotify:track:abc", in_library: true }]);
    const handler = getHandler(handlers, "check_library_contains");

    await handler({ uris: ["spotify:track:abc", "spotify:album:xyz"] });

    expect(client.run).toHaveBeenCalledWith([
      "library",
      "contains",
      "spotify:track:abc",
      "spotify:album:xyz",
    ]);
  });
});

describe("add_to_library", () => {
  it("calls 'library add' with the given uris as trailing argv", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ added: 1 });
    const handler = getHandler(handlers, "add_to_library");

    await handler({ uris: ["spotify:track:abc"] });

    expect(client.run).toHaveBeenCalledWith(["library", "add", "spotify:track:abc"]);
  });

  it("real-world shape: 'library add' ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ message: "Added 1 item(s)" });
    const handler = getHandler(handlers, "add_to_library");

    const result = await handler({ uris: ["spotify:track:abc"] });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Added 1 item(s)");
  });
});

describe("remove_from_library", () => {
  it("calls 'library remove' with the given uris as trailing argv", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ removed: 1 });
    const handler = getHandler(handlers, "remove_from_library");

    await handler({ uris: ["spotify:track:abc"] });

    expect(client.run).toHaveBeenCalledWith(["library", "remove", "spotify:track:abc"]);
  });

  it("propagates a SpotifyCliError from the client as isError content", async () => {
    const { handlers, client } = setup();
    const error = new SpotifyCliError(2, "not found", "", undefined, ["library", "remove", "spotify:track:x"]);
    client.run.mockRejectedValue(error);
    const handler = getHandler(handlers, "remove_from_library");

    const result = await handler({ uris: ["spotify:track:x"] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });

  it("real-world shape: 'library remove' ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    const { handlers, client } = setup();
    client.run.mockResolvedValue({ message: "Removed 1 item(s)" });
    const handler = getHandler(handlers, "remove_from_library");

    const result = await handler({ uris: ["spotify:track:abc"] });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Removed 1 item(s)");
  });
});

describe("run_library_batch", () => {
  it("builds a manifest from ops (no stop_on_error) and calls client.runBatch with it", async () => {
    const { handlers, client } = setup();
    client.runBatch.mockResolvedValue({
      results: [{ op: "library_add", success: true }],
      summary: { total: 1, succeeded: 1, failed: 0 },
    });
    const handler = getHandler(handlers, "run_library_batch");

    const ops = [{ op: "library_add", uris: ["spotify:track:abc"] }];
    await handler({ ops });

    expect(client.runBatch).toHaveBeenCalledWith({ ops });
  });

  it("includes stop_on_error in the manifest when explicitly provided", async () => {
    const { handlers, client } = setup();
    client.runBatch.mockResolvedValue({ results: [], summary: { total: 0, succeeded: 0, failed: 0 } });
    const handler = getHandler(handlers, "run_library_batch");

    const ops = [{ op: "folder_remove", folder_uri: "spotify:user:me:folder:1", keep_contents: false }];
    await handler({ ops, stop_on_error: true });

    expect(client.runBatch).toHaveBeenCalledWith({ ops, stop_on_error: true });
  });

  it("formats results and summary as JSON text content", async () => {
    const { handlers, client } = setup();
    client.runBatch.mockResolvedValue({
      results: [{ op: "library_add", success: true }],
      summary: { total: 1, succeeded: 1, failed: 0 },
    });
    const handler = getHandler(handlers, "run_library_batch");

    const result = await handler({ ops: [{ op: "library_add", uris: ["spotify:track:abc"] }] });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("\"succeeded\": 1");
  });

  it("maps a SpotifyCliError from runBatch to isError content", async () => {
    const { handlers, client } = setup();
    const error = new SpotifyCliError(1, "boom", "", undefined, ["library", "batch", "--format", "json"]);
    client.runBatch.mockRejectedValue(error);
    const handler = getHandler(handlers, "run_library_batch");

    const result = await handler({ ops: [{ op: "library_remove", uris: ["spotify:track:x"] }] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });
});
