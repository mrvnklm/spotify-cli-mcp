import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContentTools } from "./content.js";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";

/**
 * Tests here mock SpotifyCliClient directly (never node:child_process) --
 * client.ts's own test suite already covers execFile/spawn argv construction
 * against the real child_process API. What matters for a tools file is that
 * each tool builds the right spotify_cli argv from its params and formats
 * the client's response/errors correctly, so mocking at the client boundary
 * is the right level and keeps these tests from ever touching a real
 * process.
 */

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

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

function createFakeClient(runImpl?: (...args: unknown[]) => unknown): {
  client: SpotifyCliClient;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(runImpl ?? (() => Promise.resolve({})));
  return { client: { run } as unknown as SpotifyCliClient, run };
}

function getHandlers(client: SpotifyCliClient): Map<string, ToolHandler> {
  const { server, handlers } = createFakeServer();
  registerContentTools(server, client);
  return handlers;
}

function getHandler(client: SpotifyCliClient, name: string): ToolHandler {
  const handler = getHandlers(client).get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

describe("search", () => {
  it("builds argv with just the query when type/limit are omitted", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({ results: [] }));
    const handler = getHandler(client, "search");

    await handler({ query: "boards of canada" });

    expect(run).toHaveBeenCalledWith(["search", "boards of canada"]);
  });

  it("appends --type and --limit when provided", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({ results: [] }));
    const handler = getHandler(client, "search");

    await handler({ query: "aphex twin", type: "artist", limit: 5 });

    expect(run).toHaveBeenCalledWith(["search", "aphex twin", "--type", "artist", "--limit", "5"]);
  });

  it("formats the client's response as JSON text", async () => {
    const { client } = createFakeClient(() => Promise.resolve({ results: [{ name: "Windowlicker" }] }));
    const handler = getHandler(client, "search");

    const result = await handler({ query: "aphex twin" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Windowlicker");
  });

  it("maps a SpotifyCliError to isError text output", async () => {
    const error = new SpotifyCliError(1, "boom", "", "search failed", ["search", "x"]);
    const { client } = createFakeClient(() => Promise.reject(error));
    const handler = getHandler(client, "search");

    const result = await handler({ query: "x" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });

  it("rejects an invalid type via the registered zod schema", () => {
    const { client } = createFakeClient();
    const { server } = createFakeServer();
    const shapes = new Map<string, Record<string, import("zod").ZodType>>();
    const captureServer = {
      tool: (name: string, _desc: string, shape: Record<string, import("zod").ZodType>) => {
        shapes.set(name, shape);
      },
    } as unknown as McpServer;
    registerContentTools(captureServer, client);
    const shape = shapes.get("search");
    if (!shape) throw new Error("search not registered");
    const parsed = shape.type.safeParse("not-a-real-type");
    expect(parsed.success).toBe(false);
    void server;
  });
});

describe("lookup_metadata", () => {
  it("builds argv with multiple uris and no --fields when fields omitted", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({}));
    const handler = getHandler(client, "lookup_metadata");

    await handler({
      uris: ["spotify:track:aaa", "spotify:artist:bbb"],
    });

    expect(run).toHaveBeenCalledWith(["lookup", "spotify:track:aaa", "spotify:artist:bbb"]);
  });

  it("joins multiple fields with commas into a single --fields flag", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({}));
    const handler = getHandler(client, "lookup_metadata");

    await handler({
      uris: ["spotify:track:aaa"],
      fields: ["bpm", "camelot_key", "monthly_listeners"],
    });

    expect(run).toHaveBeenCalledWith([
      "lookup",
      "spotify:track:aaa",
      "--fields",
      "bpm,camelot_key,monthly_listeners",
    ]);
  });

  it("returns the client response formatted as JSON", async () => {
    const { client } = createFakeClient(() =>
      Promise.resolve({ bpm: 130, key: "A", camelot_key: "11B" })
    );
    const handler = getHandler(client, "lookup_metadata");

    const result = await handler({ uris: ["spotify:track:aaa"] });

    expect(result.content[0].text).toContain("11B");
  });

  it("maps a SpotifyCliError to isError text output", async () => {
    const error = new SpotifyCliError(2, "not found", "", undefined, ["lookup", "spotify:track:bad"]);
    const { client } = createFakeClient(() => Promise.reject(error));
    const handler = getHandler(client, "lookup_metadata");

    const result = await handler({ uris: ["spotify:track:bad"] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });

  it("rejects more than 50 uris via the registered zod schema", () => {
    const { client } = createFakeClient();
    const shapes = new Map<string, Record<string, import("zod").ZodType>>();
    const captureServer = {
      tool: (name: string, _desc: string, shape: Record<string, import("zod").ZodType>) => {
        shapes.set(name, shape);
      },
    } as unknown as McpServer;
    registerContentTools(captureServer, client);
    const shape = shapes.get("lookup_metadata");
    if (!shape) throw new Error("lookup_metadata not registered");

    const tooMany = Array.from({ length: 51 }, (_, i) => `spotify:track:${i}`);
    const parsed = shape.uris.safeParse(tooMany);
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-Spotify-URI string via the registered zod schema", () => {
    const { client } = createFakeClient();
    const shapes = new Map<string, Record<string, import("zod").ZodType>>();
    const captureServer = {
      tool: (name: string, _desc: string, shape: Record<string, import("zod").ZodType>) => {
        shapes.set(name, shape);
      },
    } as unknown as McpServer;
    registerContentTools(captureServer, client);
    const shape = shapes.get("lookup_metadata");
    if (!shape) throw new Error("lookup_metadata not registered");

    const parsed = shape.uris.safeParse(["not-a-uri"]);
    expect(parsed.success).toBe(false);
  });
});

describe("get_taste_profile", () => {
  it("calls run with just ['taste'] and no params", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({ genres: ["idm"] }));
    const handler = getHandler(client, "get_taste_profile");

    const result = await handler({});

    expect(run).toHaveBeenCalledWith(["taste"]);
    expect(result.content[0].text).toContain("idm");
  });

  it("maps a SpotifyCliError to isError text output", async () => {
    const error = new SpotifyCliError(1, "boom", "", undefined, ["taste"]);
    const { client } = createFakeClient(() => Promise.reject(error));
    const handler = getHandler(client, "get_taste_profile");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });
});

describe("get_top_history", () => {
  it("builds argv with just ['history', 'top'] when type/limit omitted", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({}));
    const handler = getHandler(client, "get_top_history");

    await handler({});

    expect(run).toHaveBeenCalledWith(["history", "top"]);
  });

  it("appends --type and --limit when provided", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({}));
    const handler = getHandler(client, "get_top_history");

    await handler({ type: "artists", limit: 10 });

    expect(run).toHaveBeenCalledWith(["history", "top", "--type", "artists", "--limit", "10"]);
  });

  it("maps a SpotifyCliError to isError text output", async () => {
    const error = new SpotifyCliError(1, "boom", "", undefined, ["history", "top"]);
    const { client } = createFakeClient(() => Promise.reject(error));
    const handler = getHandler(client, "get_top_history");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });
});

describe("get_recent_history", () => {
  it("builds argv with just ['history', 'recent'] when limit omitted", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({}));
    const handler = getHandler(client, "get_recent_history");

    await handler({});

    expect(run).toHaveBeenCalledWith(["history", "recent"]);
  });

  it("appends --limit when provided", async () => {
    const { client, run } = createFakeClient(() => Promise.resolve({}));
    const handler = getHandler(client, "get_recent_history");

    await handler({ limit: 20 });

    expect(run).toHaveBeenCalledWith(["history", "recent", "--limit", "20"]);
  });

  it("passes the quirky embedded-text-blob 'name' field through unmodified", async () => {
    const quirkyName = "spotify:track:abc123 -- Composer: Jane Doe; Lyricist: John Roe; Producer: X; Released: 2020-01-01; A moody instrumental";
    const { client } = createFakeClient(() =>
      Promise.resolve({ items: [{ name: quirkyName }] })
    );
    const handler = getHandler(client, "get_recent_history");

    const result = await handler({});

    expect(result.content[0].text).toContain(quirkyName);
  });

  it("maps a SpotifyCliError to isError text output", async () => {
    const error = new SpotifyCliError(1, "boom", "", undefined, ["history", "recent"]);
    const { client } = createFakeClient(() => Promise.reject(error));
    const handler = getHandler(client, "get_recent_history");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(error.toText());
  });
});
