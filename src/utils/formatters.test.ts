import { describe, it, expect } from "vitest";
import { formatJson, extractUriFromMessage, isRawMessage, formatMutationResult } from "./formatters.js";

describe("formatJson", () => {
  it("pretty-prints with 2-space indentation", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("extractUriFromMessage", () => {
  it("extracts a plain Spotify URI from a CLI success message", () => {
    expect(extractUriFromMessage("Created: My Playlist  spotify:playlist:4vG0IzcmfdPzicErkGqCPT")).toBe(
      "spotify:playlist:4vG0IzcmfdPzicErkGqCPT"
    );
  });

  it("extracts a user-scoped folder URI (multiple colons)", () => {
    expect(
      extractUriFromMessage("Created: My Folder  spotify:user:marvin.kelm:folder:dde96d417b2c5cf0")
    ).toBe("spotify:user:marvin.kelm:folder:dde96d417b2c5cf0");
  });

  it("returns undefined when the message has no Spotify URI", () => {
    expect(extractUriFromMessage("Added 1 track(s)")).toBeUndefined();
    expect(extractUriFromMessage("")).toBeUndefined();
  });
});

describe("isRawMessage", () => {
  it("true for a { message: string } object", () => {
    expect(isRawMessage({ message: "Added 1 item(s)" })).toBe(true);
  });

  it("false for real parsed JSON without a message field", () => {
    expect(isRawMessage({ uri: "spotify:playlist:p", name: "Test" })).toBe(false);
  });

  it("false for a message field that isn't a string", () => {
    expect(isRawMessage({ message: 123 })).toBe(false);
  });

  it("false for null/non-objects", () => {
    expect(isRawMessage(null)).toBe(false);
    expect(isRawMessage("string")).toBe(false);
    expect(isRawMessage(undefined)).toBe(false);
  });
});

describe("formatMutationResult", () => {
  it("wraps a raw-text success message with success:true and no uri when none is present", () => {
    const text = formatMutationResult({ message: "Added 1 track(s)" });
    expect(JSON.parse(text)).toEqual({ success: true, message: "Added 1 track(s)" });
  });

  it("extracts and includes the uri when the raw message contains one", () => {
    const text = formatMutationResult({
      message: "Created: My Playlist  spotify:playlist:4vG0IzcmfdPzicErkGqCPT",
    });
    expect(JSON.parse(text)).toEqual({
      success: true,
      message: "Created: My Playlist  spotify:playlist:4vG0IzcmfdPzicErkGqCPT",
      uri: "spotify:playlist:4vG0IzcmfdPzicErkGqCPT",
    });
  });

  it("passes real parsed JSON through unchanged (does not misinterpret it as a raw message)", () => {
    const data = { uri: "spotify:playlist:p", track_count: 5 };
    expect(JSON.parse(formatMutationResult(data))).toEqual(data);
  });

  it("handles empty-string messages (e.g. 'pause'/'resume', which print nothing on success)", () => {
    const text = formatMutationResult({ message: "" });
    expect(JSON.parse(text)).toEqual({ success: true, message: "" });
  });
});
