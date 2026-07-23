import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

/**
 * Server-level tests that go over a real MCP transport rather than a fake
 * server object, so they check what a client actually receives: the tool
 * list, each tool's JSON Schema, and the behavioural annotations hosts use
 * to decide which calls to gate behind a confirmation prompt.
 *
 * No tool is ever *called* here, so no spotify_cli process is spawned --
 * listing tools never touches the CLI.
 */
let tools: Tool[];

beforeAll(async () => {
  const server = createServer({ cliPath: "/nonexistent/spotify_cli" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  tools = (await client.listTools()).tools;
  await client.close();
});

/**
 * Tools that remove or overwrite state with no undo through this API. Held
 * as an exact list rather than a spot-check: the point of the annotation is
 * that a host can trust it, so a new destructive tool silently registering
 * as non-destructive should fail the build.
 */
const DESTRUCTIVE_TOOLS = [
  "remove_from_queue",
  "end_jam",
  "kick_from_jam",
  "remove_from_library",
  "run_library_batch",
  "update_playlist",
  "remove_tracks_from_playlist",
  "rename_folder",
  "remove_folder",
];

/** Tools that cannot change any state at all. */
const READ_ONLY_TOOLS = [
  "get_now_playing",
  "list_devices",
  "get_device_info",
  "get_queue",
  "get_jam_status",
  "list_jam_members",
  "search",
  "lookup_metadata",
  "get_taste_profile",
  "get_top_history",
  "get_recent_history",
  "list_library",
  "check_library_contains",
  "get_playlist",
  "list_folders",
  "get_current_user",
  "get_connection_status",
  "get_cli_version",
];

describe("createServer tool surface", () => {
  it("registers every tool exactly once", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(51);
  });

  it("gives every tool a description and annotations", () => {
    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy();
      expect(tool.annotations, `${tool.name} has no annotations`).toBeDefined();
      expect(tool.annotations?.title, `${tool.name} has no annotation title`).toBeTruthy();
    }
  });

  it("marks exactly the read-only tools with readOnlyHint", () => {
    const actual = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(actual.sort()).toEqual([...READ_ONLY_TOOLS].sort());
  });

  it("marks exactly the destructive tools with destructiveHint", () => {
    const actual = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    expect(actual.sort()).toEqual([...DESTRUCTIVE_TOOLS].sort());
  });

  it("never marks a tool both read-only and destructive", () => {
    for (const tool of tools) {
      const { readOnlyHint, destructiveHint } = tool.annotations ?? {};
      expect(readOnlyHint && destructiveHint, `${tool.name} is both read-only and destructive`).toBeFalsy();
    }
  });

  it("marks every tool as open-world, since all of them reach Spotify's backend", () => {
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, `${tool.name} is not open-world`).toBe(true);
    }
  });

  it("exposes a valid object JSON Schema for each tool", () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type, `${tool.name} input schema is not an object`).toBe("object");
    }
  });

  it("keeps remove_folder's keep_contents safe default in the published schema", () => {
    const removeFolder = tools.find((tool) => tool.name === "remove_folder");
    const keepContents = (removeFolder?.inputSchema.properties as Record<string, { default?: unknown }>)
      ?.keep_contents;
    // The CLI itself deletes nested playlists unless --keep-contents is
    // passed; this server flips that default, and the flipped value has to
    // be visible in the schema the model reads.
    expect(keepContents?.default).toBe(true);
  });
});
