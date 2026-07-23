import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlaylistsTools } from "./playlists.js";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal fake McpServer that just captures each registered tool's handler
 * (the last argument passed to `server.tool(...)`) so it can be invoked
 * directly in tests without spinning up a real MCP transport or a real
 * child process.
 */
function createFakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1] as ToolHandler;
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function createFakeClient(response: unknown): { client: SpotifyCliClient; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue(response);
  const client = { run } as unknown as SpotifyCliClient;
  return { client, run };
}

function getHandler(client: SpotifyCliClient, name: string): ToolHandler {
  const { server, handlers } = createFakeServer();
  registerPlaylistsTools(server, client);
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

describe("get_playlist", () => {
  it("builds argv with just the uri when no options given", async () => {
    const { client, run } = createFakeClient({ uri: "spotify:playlist:p", name: "Test" });
    const handler = getHandler(client, "get_playlist");

    await handler({ uri: "spotify:playlist:p" });

    expect(run).toHaveBeenCalledWith(["playlist", "get", "spotify:playlist:p"]);
  });

  it("passes --no-tracks, --limit, and --offset when provided", async () => {
    const { client, run } = createFakeClient({ uri: "spotify:playlist:p" });
    const handler = getHandler(client, "get_playlist");

    await handler({ uri: "spotify:playlist:p", no_tracks: true, limit: 10, offset: 5 });

    expect(run).toHaveBeenCalledWith([
      "playlist",
      "get",
      "spotify:playlist:p",
      "--no-tracks",
      "--limit",
      "10",
      "--offset",
      "5",
    ]);
  });

  it("omits --no-tracks when explicitly false", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "get_playlist");

    await handler({ uri: "spotify:playlist:p", no_tracks: false });

    expect(run).toHaveBeenCalledWith(["playlist", "get", "spotify:playlist:p"]);
  });

  it("formats the response as pretty JSON text", async () => {
    const { client } = createFakeClient({ uri: "spotify:playlist:p", name: "Test" });
    const handler = getHandler(client, "get_playlist");

    const result = await handler({ uri: "spotify:playlist:p" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(JSON.stringify({ uri: "spotify:playlist:p", name: "Test" }, null, 2));
  });

  it("maps a SpotifyCliError to isError text content", async () => {
    const client = {
      run: vi.fn().mockRejectedValue(
        new SpotifyCliError(1, "playlist not found", "", "playlist not found", ["playlist", "get", "spotify:playlist:bad"])
      ),
    } as unknown as SpotifyCliClient;
    const handler = getHandler(client, "get_playlist");

    const result = await handler({ uri: "spotify:playlist:bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("playlist not found");
  });
});

describe("create_playlist", () => {
  it("builds argv with just the name when no options given", async () => {
    const { client, run } = createFakeClient({ uri: "spotify:playlist:new" });
    const handler = getHandler(client, "create_playlist");

    await handler({ name: "My Playlist" });

    expect(run).toHaveBeenCalledWith(["playlist", "create", "My Playlist"]);
  });

  it("passes --description, --image-file, and --public when provided", async () => {
    const { client, run } = createFakeClient({ uri: "spotify:playlist:new" });
    const handler = getHandler(client, "create_playlist");

    await handler({
      name: "Party Mix",
      description: "Weekend vibes",
      image_file: "/tmp/cover.jpg",
      public: true,
    });

    expect(run).toHaveBeenCalledWith([
      "playlist",
      "create",
      "Party Mix",
      "--description",
      "Weekend vibes",
      "--image-file",
      "/tmp/cover.jpg",
      "--public",
    ]);
  });

  it("omits --public when explicitly false", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "create_playlist");

    await handler({ name: "Quiet Playlist", public: false });

    expect(run).toHaveBeenCalledWith(["playlist", "create", "Quiet Playlist"]);
  });

  it("maps a SpotifyCliError to isError text content", async () => {
    const client = {
      run: vi.fn().mockRejectedValue(new SpotifyCliError(1, "boom", "", "boom", ["playlist", "create", "x"])),
    } as unknown as SpotifyCliClient;
    const handler = getHandler(client, "create_playlist");

    const result = await handler({ name: "x" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("real-world shape: 'playlist create' ignores --format json and returns raw text -- extracts the new playlist's uri instead of erroring (confirmed live)", async () => {
    const { client } = createFakeClient({
      message: "Created: My Playlist  spotify:playlist:4vG0IzcmfdPzicErkGqCPT",
    });
    const handler = getHandler(client, "create_playlist");

    const result = await handler({ name: "My Playlist" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.uri).toBe("spotify:playlist:4vG0IzcmfdPzicErkGqCPT");
  });
});

describe("update_playlist", () => {
  it("builds argv with just the uri when no options given", async () => {
    const { client, run } = createFakeClient({ uri: "spotify:playlist:p" });
    const handler = getHandler(client, "update_playlist");

    await handler({ uri: "spotify:playlist:p" });

    expect(run).toHaveBeenCalledWith(["playlist", "update", "spotify:playlist:p"]);
  });

  it("passes --name, --description, --image-file", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "update_playlist");

    await handler({
      uri: "spotify:playlist:p",
      name: "New Name",
      description: "Updated",
      image_file: "/tmp/cover.jpg",
    });

    expect(run).toHaveBeenCalledWith([
      "playlist",
      "update",
      "spotify:playlist:p",
      "--name",
      "New Name",
      "--description",
      "Updated",
      "--image-file",
      "/tmp/cover.jpg",
    ]);
  });

  it("maps visibility: 'public' to --public", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "update_playlist");

    await handler({ uri: "spotify:playlist:p", visibility: "public" });

    expect(run).toHaveBeenCalledWith(["playlist", "update", "spotify:playlist:p", "--public"]);
  });

  it("maps visibility: 'private' to --private", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "update_playlist");

    await handler({ uri: "spotify:playlist:p", visibility: "private" });

    expect(run).toHaveBeenCalledWith(["playlist", "update", "spotify:playlist:p", "--private"]);
  });

  it("never emits both --public and --private (mutually exclusive by construction)", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "update_playlist");

    await handler({ uri: "spotify:playlist:p", visibility: "public" });

    const calledArgs = run.mock.calls[0][0] as string[];
    expect(calledArgs).not.toContain("--private");
  });

  it("maps a SpotifyCliError to isError text content", async () => {
    const client = {
      run: vi.fn().mockRejectedValue(new SpotifyCliError(1, "not found", "", "not found", ["playlist", "update", "x"])),
    } as unknown as SpotifyCliClient;
    const handler = getHandler(client, "update_playlist");

    const result = await handler({ uri: "spotify:playlist:x" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("real-world shape: 'playlist update' ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    const { client } = createFakeClient({ message: "Updated:   spotify:playlist:p" });
    const handler = getHandler(client, "update_playlist");

    const result = await handler({ uri: "spotify:playlist:p", description: "test" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.uri).toBe("spotify:playlist:p");
  });
});

describe("add_tracks_to_playlist", () => {
  it("builds argv with playlist uri and track uris, no position", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "add_tracks_to_playlist");

    await handler({
      playlist_uri: "spotify:playlist:p",
      track_uris: ["spotify:track:t1", "spotify:track:t2"],
    });

    expect(run).toHaveBeenCalledWith([
      "playlist",
      "add",
      "spotify:playlist:p",
      "spotify:track:t1",
      "spotify:track:t2",
    ]);
  });

  it("passes --position when provided", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "add_tracks_to_playlist");

    await handler({
      playlist_uri: "spotify:playlist:p",
      track_uris: ["spotify:track:t1"],
      position: 0,
    });

    expect(run).toHaveBeenCalledWith([
      "playlist",
      "add",
      "spotify:playlist:p",
      "spotify:track:t1",
      "--position",
      "0",
    ]);
  });

  it("maps a SpotifyCliError to isError text content", async () => {
    const client = {
      run: vi.fn().mockRejectedValue(new SpotifyCliError(1, "boom", "", "boom", ["playlist", "add"])),
    } as unknown as SpotifyCliClient;
    const handler = getHandler(client, "add_tracks_to_playlist");

    const result = await handler({ playlist_uri: "spotify:playlist:p", track_uris: ["spotify:track:t1"] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("real-world shape: 'playlist add' ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    const { client } = createFakeClient({ message: "Added 1 track(s)" });
    const handler = getHandler(client, "add_tracks_to_playlist");

    const result = await handler({ playlist_uri: "spotify:playlist:p", track_uris: ["spotify:track:t1"] });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Added 1 track(s)");
  });
});

describe("remove_tracks_from_playlist", () => {
  it("builds argv joining positions with commas", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "remove_tracks_from_playlist");

    await handler({ playlist_uri: "spotify:playlist:p", positions: [0, 1, 5] });

    expect(run).toHaveBeenCalledWith([
      "playlist",
      "remove",
      "spotify:playlist:p",
      "--positions",
      "0,1,5",
    ]);
  });

  it("handles a single position", async () => {
    const { client, run } = createFakeClient({});
    const handler = getHandler(client, "remove_tracks_from_playlist");

    await handler({ playlist_uri: "spotify:playlist:p", positions: [3] });

    expect(run).toHaveBeenCalledWith(["playlist", "remove", "spotify:playlist:p", "--positions", "3"]);
  });

  it("maps a SpotifyCliError to isError text content", async () => {
    const client = {
      run: vi.fn().mockRejectedValue(new SpotifyCliError(1, "bad position", "", "bad position", ["playlist", "remove"])),
    } as unknown as SpotifyCliClient;
    const handler = getHandler(client, "remove_tracks_from_playlist");

    const result = await handler({ playlist_uri: "spotify:playlist:p", positions: [0] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("bad position");
  });

  it("real-world shape: 'playlist remove' ignores --format json and returns raw text -- reports success without erroring (confirmed live)", async () => {
    const { client } = createFakeClient({ message: "Removed 1 track(s)" });
    const handler = getHandler(client, "remove_tracks_from_playlist");

    const result = await handler({ playlist_uri: "spotify:playlist:p", positions: [0] });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("Removed 1 track(s)");
  });

  it("tool description warns that positions can shift and there is no undo", () => {
    const handlers = new Map<string, unknown>();
    const descriptions = new Map<string, string>();
    const server = {
      tool: (name: string, description: string) => {
        descriptions.set(name, description);
        handlers.set(name, description);
      },
    } as unknown as McpServer;
    const { client } = createFakeClient({});
    registerPlaylistsTools(server, client);

    const description = descriptions.get("remove_tracks_from_playlist") ?? "";
    expect(description.toLowerCase()).toContain("destructive");
    expect(description.toLowerCase()).toContain("undo");
    expect(description.toLowerCase()).toContain("shift");
  });
});
