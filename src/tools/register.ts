import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { SpotifyCliError } from "../cli/errors.js";

/** The MCP content payload every tool in this server returns. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Thrown by a tool handler for an input problem that the tool's Zod schema
 * cannot express on its own -- e.g. 'seek' allowing a negative `ms` only when
 * `relative` is also set, a constraint that spans two fields. Surfaced to the
 * caller as an error result rather than a thrown exception, so the model can
 * read the explanation and retry with corrected arguments.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * Registers an MCP tool whose handler just returns the response text.
 *
 * Every tool here wraps a spotify_cli invocation and needs the identical
 * failure handling: turn a SpotifyCliError into an `isError` result carrying
 * the command, exit code, and CLI output, and let anything else propagate as
 * a genuine bug in this server. Repeating that try/catch in each of the 50+
 * registrations is pure noise and invites one of them to drift; centralizing
 * it leaves each tool as just its schema, its annotations, and the argv it
 * builds.
 */
export function defineTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: {
    description: string;
    inputSchema: Args;
    annotations: ToolAnnotations;
  },
  handler: (params: z.output<z.ZodObject<Args>>) => Promise<string>
): void {
  server.registerTool(
    name,
    {
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: config.annotations,
    },
    (async (params: z.output<z.ZodObject<Args>>): Promise<ToolResult> => {
      try {
        return { content: [{ type: "text" as const, text: await handler(params) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        if (error instanceof ToolInputError) {
          return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
        }
        throw error;
      }
      // The SDK derives ToolCallback's parameter type through its own
      // ZodRawShapeCompat machinery, which does not unify with the plain
      // z.ZodObject inference used above even though both describe the same
      // object. The cast keeps that mismatch confined to this one line while
      // call sites still get fully inferred, checked `params`.
    }) as Parameters<typeof server.registerTool>[2]
  );
}

/**
 * Annotation presets for the three behavioural classes of tool in this
 * server. `openWorldHint` is true throughout: every tool talks to Spotify's
 * backend via the desktop app, so results depend on state outside this
 * process (catalog, account, connected devices).
 *
 * These are hints for the host application, not enforcement -- this server
 * deliberately has no confirmation step of its own (see the README's Design
 * Decisions), so accurate hints are exactly what lets a host decide which
 * calls to gate behind a prompt.
 */
export const ANNOTATIONS = {
  /** Reads state; changes nothing. */
  readOnly: (title: string): ToolAnnotations => ({
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  }),

  /**
   * Writes, but only adds or sets state -- nothing a caller could not undo by
   * setting the previous value back or removing what was just added.
   */
  additive: (title: string, idempotent = false): ToolAnnotations => ({
    title,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: true,
  }),

  /**
   * Removes or overwrites persisted account data (saved library items,
   * playlist tracks, folders) with no undo available through this API.
   */
  destructive: (title: string): ToolAnnotations => ({
    title,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  }),
} as const;
