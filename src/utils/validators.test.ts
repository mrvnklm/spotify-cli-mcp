import { describe, it, expect } from "vitest";
import {
  spotifyUriSchema,
  volumeLevelSchema,
  playbackSpeedSchema,
  lookupFieldsSchema,
  lookupFields,
} from "./validators.js";

describe("spotifyUriSchema", () => {
  it.each([
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
    "spotify:artist:0OdUWJ0sBjDrqHygGUXeCF",
    "spotify:album:1DFixLWuPkv3KT3TnV35m3",
    "spotify:show:4rOoJ6Egrf8K2IrywzwOMk",
    "spotify:episode:512ojhOuo1ktJprKbVcKyQ",
    "spotify:user:someuser",
    "spotify:user:someuser:folder:1234567890abcdef",
  ])("accepts %s", (uri) => {
    expect(spotifyUriSchema.safeParse(uri).success).toBe(true);
  });

  it.each([
    "not-a-uri",
    "http://open.spotify.com/track/abc",
    "",
    "spotify:",
  ])("rejects %s", (uri) => {
    expect(spotifyUriSchema.safeParse(uri).success).toBe(false);
  });
});

describe("volumeLevelSchema", () => {
  it("accepts values within [0, 1]", () => {
    expect(volumeLevelSchema.safeParse(0).success).toBe(true);
    expect(volumeLevelSchema.safeParse(0.5).success).toBe(true);
    expect(volumeLevelSchema.safeParse(1).success).toBe(true);
  });

  it("rejects values outside [0, 1]", () => {
    expect(volumeLevelSchema.safeParse(-0.1).success).toBe(false);
    expect(volumeLevelSchema.safeParse(1.1).success).toBe(false);
  });
});

describe("playbackSpeedSchema", () => {
  it("accepts values within [0, 2]", () => {
    expect(playbackSpeedSchema.safeParse(0).success).toBe(true);
    expect(playbackSpeedSchema.safeParse(1).success).toBe(true);
    expect(playbackSpeedSchema.safeParse(2).success).toBe(true);
  });

  it("rejects values outside [0, 2]", () => {
    expect(playbackSpeedSchema.safeParse(-0.1).success).toBe(false);
    expect(playbackSpeedSchema.safeParse(2.1).success).toBe(false);
  });
});

describe("lookupFieldsSchema", () => {
  it("accepts every documented field", () => {
    for (const field of lookupFields) {
      expect(lookupFieldsSchema.safeParse(field).success).toBe(true);
    }
  });

  it("rejects an unknown field", () => {
    expect(lookupFieldsSchema.safeParse("not_a_field").success).toBe(false);
  });

  it("includes the fields confirmed by live testing", () => {
    expect(lookupFields).toEqual([
      "duration",
      "content_ratings",
      "genres",
      "formats",
      "monthly_listeners",
      "total_plays",
      "followers",
      "is_verified",
      "rating",
      "rating_count",
      "release_date",
      "spotify_release_date",
      "copyright",
      "entity_type",
      "bpm",
      "key",
      "mode",
      "camelot_key",
    ]);
  });
});
