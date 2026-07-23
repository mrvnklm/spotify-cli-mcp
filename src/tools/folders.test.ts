import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const execFileMock = vi.fn();
const spawnMock = vi.fn();

/**
 * Same mock shape as src/cli/client.test.ts: client.ts promisifies
 * node:child_process's execFile, and Node's real execFile carries a
 * util.promisify.custom implementation that resolves to {stdout, stderr} --
 * replicate that so promisify(execFileMock) behaves like the real thing.
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
const { registerFoldersTools } = await import("./folders.js");

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal fake McpServer that captures each registered tool's zod raw shape
 * and handler, so both argv/response behavior and the keep_contents
 * safe-default can be tested without a real MCP transport.
 */
function createFakeServer(): {
  server: McpServer;
  tools: Map<
    string,
    {
      shape: Record<string, z.ZodTypeAny>;
      handler: ToolHandler;
      annotations: Record<string, unknown>;
    }
  >;
} {
  const tools = new Map<
    string,
    {
      shape: Record<string, z.ZodTypeAny>;
      handler: ToolHandler;
      annotations: Record<string, unknown>;
    }
  >();
  const server = {
    registerTool: (
      name: string,
      config: {
        inputSchema: Record<string, z.ZodTypeAny>;
        annotations?: Record<string, unknown>;
      },
      handler: ToolHandler
    ) => {
      tools.set(name, {
        shape: config.inputSchema,
        handler,
        annotations: config.annotations ?? {},
      });
    },
  } as unknown as McpServer;
  return { server, tools };
}

/**
 * Returns the tool's raw shape plus a handler wrapped to parse params through
 * that shape first -- mirroring what the real McpServer SDK does before
 * invoking a tool's callback (in particular, applying zod .default() values
 * such as remove_folder's keep_contents, which our fake server would
 * otherwise bypass since it captures the callback directly).
 */
function getTool(name: string) {
  const client = new SpotifyCliClient({ cliPath: "/bin/spotify_cli" });
  const { server, tools } = createFakeServer();
  registerFoldersTools(server, client);
  const tool = tools.get(name);
  if (!tool) throw new Error(`${name} tool was not registered`);

  const schema = z.object(tool.shape);
  const handler: ToolHandler = (params) => tool.handler(schema.parse(params));

  return { shape: tool.shape, handler };
}

function mockCliSuccess(json: unknown) {
  execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(null, JSON.stringify(json), ""));
}

/**
 * Confirmed via live testing: folder create/rename/move/remove all ignore
 * --format json on success and print a short human-readable line instead
 * (exit code 0). Use this to mock the *real* response shape rather than an
 * idealized JSON blob.
 */
function mockCliRawText(text: string) {
  execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(null, text, ""));
}

beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe("list_folders", () => {
  it("with no params: calls 'folder list --format json' (bare 'folder' does NOT default to list -- confirmed live, see client comment)", async () => {
    mockCliSuccess({ folders: [] });
    const { handler } = getTool("list_folders");

    const result = await handler({});

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "list", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
    expect(result.content[0].text).toBe(JSON.stringify({ folders: [] }, null, 2));
    expect(result.isError).toBeUndefined();
  });

  it("with folder + recursive: builds 'list --folder <uri> --recursive'", async () => {
    mockCliSuccess({ folders: [] });
    const { handler } = getTool("list_folders");

    await handler({ folder: "spotify:user:name:folder:123", recursive: true });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "list", "--folder", "spotify:user:name:folder:123", "--recursive", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("maps a SpotifyCliError to isError content", async () => {
    const err = Object.assign(new Error("boom"), { code: 1 });
    execFileMock.mockImplementationOnce((_path, _args, _options, cb) => cb(err, "", "not logged in"));
    const { handler } = getTool("list_folders");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not logged in");
  });
});

describe("create_folder", () => {
  it("with only name: calls 'folder create <name>'", async () => {
    mockCliSuccess({ uri: "spotify:folder:new" });
    const { handler } = getTool("create_folder");

    await handler({ name: "My Folder" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "create", "My Folder", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("with 'in': appends '--in <folder_uri>'", async () => {
    mockCliSuccess({ uri: "spotify:folder:new" });
    const { handler } = getTool("create_folder");

    await handler({ name: "Sub Folder", in: "spotify:folder:abc" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "create", "Sub Folder", "--in", "spotify:folder:abc", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("real-world shape: ignores --format json and returns raw text -- extracts the new folder's (user-scoped) uri instead of erroring (confirmed live)", async () => {
    mockCliRawText("Created: My Folder  spotify:user:marvin.kelm:folder:dde96d417b2c5cf0");
    const { handler } = getTool("create_folder");

    const result = await handler({ name: "My Folder" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.uri).toBe("spotify:user:marvin.kelm:folder:dde96d417b2c5cf0");
  });
});

describe("rename_folder", () => {
  it("calls 'folder rename <folder_uri> <new_name>'", async () => {
    mockCliSuccess({ success: true });
    const { handler } = getTool("rename_folder");

    const result = await handler({ folder_uri: "spotify:folder:abc", new_name: "New Name" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "rename", "spotify:folder:abc", "New Name", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
    expect(result.content[0].text).toBe(JSON.stringify({ success: true }, null, 2));
  });

  it("real-world shape: ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    mockCliRawText("Renamed to: New Name  spotify:user:marvin.kelm:folder:abc");
    const { handler } = getTool("rename_folder");

    const result = await handler({ folder_uri: "spotify:folder:abc", new_name: "New Name" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.uri).toBe("spotify:user:marvin.kelm:folder:abc");
  });
});

describe("move_to_folder", () => {
  it("with multiple uris and a folder destination: builds '<uri...> --to <folder_uri>'", async () => {
    mockCliSuccess({ success: true });
    const { handler } = getTool("move_to_folder");

    await handler({
      uris: ["spotify:playlist:p1", "spotify:playlist:p2"],
      to: "spotify:folder:xyz",
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "move", "spotify:playlist:p1", "spotify:playlist:p2", "--to", "spotify:folder:xyz", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("accepts the literal 'root' as a destination", async () => {
    mockCliSuccess({ success: true });
    const { handler } = getTool("move_to_folder");

    await handler({ uris: ["spotify:folder:abc"], to: "root" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "move", "spotify:folder:abc", "--to", "root", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("real-world shape: ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    mockCliRawText("Moved 1 item(s)");
    const { handler } = getTool("move_to_folder");

    const result = await handler({ uris: ["spotify:playlist:p1"], to: "root" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Moved 1 item(s)");
  });
});

describe("remove_folder safe-default behavior", () => {
  it("schema defaults keep_contents to true when omitted", () => {
    const { shape } = getTool("remove_folder");
    const parsed = shape.keep_contents.parse(undefined);
    expect(parsed).toBe(true);
  });

  it("when keep_contents is omitted (defaults true): passes '--keep-contents' so contents are preserved", async () => {
    mockCliSuccess({ success: true });
    const { handler } = getTool("remove_folder");

    await handler({ folder_uri: "spotify:folder:abc" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "remove", "spotify:folder:abc", "--keep-contents", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("when keep_contents is explicitly true: still passes '--keep-contents'", async () => {
    mockCliSuccess({ success: true });
    const { handler } = getTool("remove_folder");

    await handler({ folder_uri: "spotify:folder:abc", keep_contents: true });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "remove", "spotify:folder:abc", "--keep-contents", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("when keep_contents is explicitly false: omits '--keep-contents' (destructive path, matches the underlying CLI's own default)", async () => {
    mockCliSuccess({ success: true });
    const { handler } = getTool("remove_folder");

    await handler({ folder_uri: "spotify:folder:abc", keep_contents: false });

    expect(execFileMock).toHaveBeenCalledWith(
      "/bin/spotify_cli",
      ["folder", "remove", "spotify:folder:abc", "--format", "json"],
      expect.anything(),
      expect.any(Function)
    );
  });

  it("real-world shape: ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    mockCliRawText("Removed 1 item(s)");
    const { handler } = getTool("remove_folder");

    const result = await handler({ folder_uri: "spotify:folder:abc" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Removed 1 item(s)");
  });
});
