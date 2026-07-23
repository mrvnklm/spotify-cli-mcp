import { z } from "zod";

/**
 * Matches Spotify URIs like "spotify:track:...", "spotify:playlist:...",
 * "spotify:artist:...", "spotify:album:...", "spotify:show:...",
 * "spotify:episode:...", "spotify:user:...", and the longer user-scoped
 * folder shape "spotify:user:<name>:folder:<id>". Deliberately permissive
 * (rather than an exhaustive enum of resource types) so it doesn't need to
 * be kept in lockstep with every URI shape the CLI accepts.
 */
export const spotifyUriSchema = z
  .string()
  .regex(/^spotify:[a-z]+:.+/i, "Must be a Spotify URI (e.g. spotify:track:...)")
  .describe("A Spotify URI, e.g. spotify:track:4iV5W9uYEdYUVa79Axb7Rh, spotify:playlist:..., or spotify:user:<name>:folder:<id>");

export const volumeLevelSchema = z
  .number()
  .min(0)
  .max(1)
  .describe("Volume level between 0.0 and 1.0");

export const playbackSpeedSchema = z
  .number()
  .min(0)
  .max(2)
  .describe("Playback speed between 0.0 and 2.0");

/**
 * Valid --fields values for the 'lookup' command. Not documented in
 * docs/spotify-cli-reference.txt (the recursive -h dump does not surface
 * 'lookup --help' the same way as other commands) -- this list was
 * confirmed by live testing against the real CLI this session.
 */
export const lookupFields = [
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
] as const;

export const lookupFieldsSchema = z
  .enum(lookupFields)
  .describe(`Field to look up. One of: ${lookupFields.join(", ")}`);
