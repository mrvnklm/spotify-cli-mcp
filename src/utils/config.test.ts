import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses SPOTIFY_CLI_PATH when set", () => {
    const config = loadConfig({ SPOTIFY_CLI_PATH: "/custom/path/spotify_cli" });
    expect(config.cliPath).toBe("/custom/path/spotify_cli");
  });

  it("falls back to the default macOS path when SPOTIFY_CLI_PATH is unset", () => {
    const config = loadConfig({});
    expect(config.cliPath).toBe("/Applications/Spotify.app/Contents/MacOS/spotify_cli");
  });

  it("falls back to the default macOS path when SPOTIFY_CLI_PATH is empty string", () => {
    const config = loadConfig({ SPOTIFY_CLI_PATH: "" });
    expect(config.cliPath).toBe("/Applications/Spotify.app/Contents/MacOS/spotify_cli");
  });

  it("does not touch the filesystem / never throws for a nonexistent path", () => {
    expect(() => loadConfig({ SPOTIFY_CLI_PATH: "/does/not/exist" })).not.toThrow();
  });

  it("defaults retry.maxAttempts to 2 and baseDelayMs to 300", () => {
    const config = loadConfig({});
    expect(config.retry).toEqual({ maxAttempts: 2, baseDelayMs: 300 });
  });

  it("reads retry overrides from env", () => {
    const config = loadConfig({
      SPOTIFY_MCP_RETRY_MAX_ATTEMPTS: "5",
      SPOTIFY_MCP_RETRY_BASE_DELAY_MS: "1000",
    });
    expect(config.retry).toEqual({ maxAttempts: 5, baseDelayMs: 1000 });
  });

  it("reads from process.env when no env object is passed", () => {
    const original = process.env.SPOTIFY_CLI_PATH;
    process.env.SPOTIFY_CLI_PATH = "/from/process/env";
    try {
      const config = loadConfig();
      expect(config.cliPath).toBe("/from/process/env");
    } finally {
      if (original === undefined) delete process.env.SPOTIFY_CLI_PATH;
      else process.env.SPOTIFY_CLI_PATH = original;
    }
  });
});
