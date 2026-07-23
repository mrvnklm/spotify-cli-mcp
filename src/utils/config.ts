export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface SpotifyCliConfig {
  cliPath: string;
  retry?: RetryConfig;
}

/**
 * Default macOS install location of the spotify_cli binary bundled inside
 * the Spotify desktop app. Windows/Linux equivalents are unconfirmed and
 * out of scope for v1 -- this project targets macOS only.
 */
const DEFAULT_MACOS_CLI_PATH = "/Applications/Spotify.app/Contents/MacOS/spotify_cli";

const DEFAULT_RETRY_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;

/**
 * Resolves the config needed to invoke spotify_cli.
 *
 * cliPath resolution order:
 *   1. SPOTIFY_CLI_PATH env var (matches the env var Spotify's own bundled
 *      AI tooling already uses, so it lines up with user expectation)
 *   2. the default macOS path
 *
 * Deliberately does NOT check the filesystem here -- fs access at
 * config-load time would be a surprising side effect for a config loader.
 * Existence should be checked lazily by the client on first real invocation
 * (e.g. by handling ENOENT from execFile/spawn).
 */
export function loadConfig(env?: Record<string, string | undefined>): SpotifyCliConfig {
  const get = (key: string): string | undefined => (env ? env[key] : process.env[key]);

  const cliPath = get("SPOTIFY_CLI_PATH") || DEFAULT_MACOS_CLI_PATH;

  const retryMaxAttemptsRaw = get("SPOTIFY_MCP_RETRY_MAX_ATTEMPTS");
  const retryBaseDelayRaw = get("SPOTIFY_MCP_RETRY_BASE_DELAY_MS");

  const retry: RetryConfig = {
    maxAttempts: retryMaxAttemptsRaw ? parseInt(retryMaxAttemptsRaw, 10) : DEFAULT_RETRY_MAX_ATTEMPTS,
    baseDelayMs: retryBaseDelayRaw ? parseInt(retryBaseDelayRaw, 10) : DEFAULT_RETRY_BASE_DELAY_MS,
  };

  return { cliPath, retry };
}
