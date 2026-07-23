import { describe, it, expect } from "vitest";
import { SpotifyCliError } from "./errors.js";

describe("SpotifyCliError", () => {
  it("builds a default message from exitCode + stderr when no message is given", () => {
    const error = new SpotifyCliError(1, "boom", "");
    expect(error.message).toContain("exited with code 1");
    expect(error.message).toContain("boom");
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe("boom");
    expect(error.name).toBe("SpotifyCliError");
  });

  it("falls back to stdout for the summary when stderr is empty", () => {
    const error = new SpotifyCliError(2, "", "some stdout");
    expect(error.message).toContain("some stdout");
  });

  it("omits detail from the summary when both stdout and stderr are empty", () => {
    const error = new SpotifyCliError(3, "", "");
    expect(error.message).toBe("spotify_cli exited with code 3");
  });

  it("uses an explicit message when provided", () => {
    const error = new SpotifyCliError(1, "stderr text", "stdout text", "custom message");
    expect(error.message).toBe("custom message");
  });

  describe("isTransientError", () => {
    it("returns true when stderr matches 'HTTP request failed'", () => {
      const error = new SpotifyCliError(1, "HTTP request failed: connection reset", "");
      expect(SpotifyCliError.isTransientError(error)).toBe(true);
    });

    it("is case-insensitive", () => {
      const error = new SpotifyCliError(1, "http REQUEST failed", "");
      expect(SpotifyCliError.isTransientError(error)).toBe(true);
    });

    it("returns true when only the (explicit) message matches, not stderr", () => {
      const error = new SpotifyCliError(1, "", "", "HTTP request failed unexpectedly");
      expect(SpotifyCliError.isTransientError(error)).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      const error = new SpotifyCliError(1, "invalid uri", "");
      expect(SpotifyCliError.isTransientError(error)).toBe(false);
    });

    it("returns false for non-SpotifyCliError values", () => {
      expect(SpotifyCliError.isTransientError(new Error("HTTP request failed"))).toBe(false);
      expect(SpotifyCliError.isTransientError("HTTP request failed")).toBe(false);
      expect(SpotifyCliError.isTransientError(undefined)).toBe(false);
    });
  });

  describe("toText", () => {
    it("includes command, exit code, and stderr", () => {
      const error = new SpotifyCliError(1, "device not found", "", undefined, ["play", "spotify:track:abc"]);
      const text = error.toText();
      expect(text).toContain("Command: spotify_cli play spotify:track:abc");
      expect(text).toContain("Exit code: 1");
      expect(text).toContain("Error: device not found");
    });

    it("omits the command line when no command was recorded", () => {
      const error = new SpotifyCliError(1, "device not found", "");
      const text = error.toText();
      expect(text).not.toContain("Command:");
      expect(text).toContain("Exit code: 1");
    });

    it("falls back to the error message when stderr is empty", () => {
      const error = new SpotifyCliError(1, "", "", "custom message");
      const text = error.toText();
      expect(text).toContain("Error: custom message");
    });
  });
});
