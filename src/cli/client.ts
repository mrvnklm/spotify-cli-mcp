import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { SpotifyCliError } from "./errors.js";
import type { SpotifyCliConfig, RetryConfig } from "../utils/config.js";

const execFileAsync = promisify(execFileCb);

const DEFAULT_RUN_TIMEOUT_MS = 15_000;
const DEFAULT_BATCH_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY: RetryConfig = { maxAttempts: 2, baseDelayMs: 300 };

/**
 * Shape of the error object node:child_process rejects with. execFile/spawn
 * attach `code`/`killed`/`signal`, and (for execFile via util.promisify)
 * `stdout`/`stderr` as captured so far.
 */
interface ChildProcessError extends Error {
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

export class SpotifyCliClient {
  private readonly cliPath: string;
  private readonly retry: RetryConfig;

  constructor(config: SpotifyCliConfig) {
    this.cliPath = config.cliPath;
    this.retry = config.retry ?? DEFAULT_RETRY;
  }

  /**
   * Runs a spotify_cli command, appending --format json automatically, and
   * parses stdout as JSON. Retries on SpotifyCliError.isTransientError per
   * the configured retry settings, using a small fixed delay between
   * attempts (this is a local process, not a shared rate-limited API, so
   * exponential backoff isn't needed).
   */
  async run<T = unknown>(args: string[]): Promise<T> {
    const fullArgs = [...args, "--format", "json"];
    const maxAttempts = Math.max(1, this.retry.maxAttempts);

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.execOnce<T>(fullArgs);
      } catch (error) {
        lastError = error;
        const isLast = attempt >= maxAttempts - 1;
        if (isLast || !SpotifyCliError.isTransientError(error)) {
          throw error;
        }
        await this.delay(this.retry.baseDelayMs);
      }
    }
    // Unreachable, but satisfies TypeScript.
    throw lastError;
  }

  private async execOnce<T>(fullArgs: string[]): Promise<T> {
    let stdout: string;
    let stderr: string;
    try {
      const result = await execFileAsync(this.cliPath, fullArgs, {
        timeout: DEFAULT_RUN_TIMEOUT_MS,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      throw this.toSpotifyCliError(error, fullArgs);
    }

    try {
      return JSON.parse(stdout) as T;
    } catch {
      // A number of spotify_cli mutation commands (playlist create/update/
      // add/remove, folder create/rename/move/remove, library add/remove)
      // ignore --format json on success and print a short human-readable
      // line instead (e.g. "Created: My Playlist  spotify:playlist:abc123"),
      // confirmed via live testing against a real account. We only reach
      // this branch after execFileAsync already resolved (i.e. exit code
      // 0) -- a real failure is a non-zero exit, thrown above, before this
      // parse is attempted -- so non-JSON stdout here means the command
      // actually succeeded, just without structured output. Return it as a
      // raw-message fallback rather than throwing; utils/formatters.ts's
      // formatMutationResult() turns this into a structured response and
      // extracts a URI when the message contains one.
      return { message: stdout.trim() } as T;
    }
  }

  private toSpotifyCliError(error: unknown, command: string[]): SpotifyCliError {
    const err = error as ChildProcessError;

    if (err.code === "ENOENT") {
      return new SpotifyCliError(
        -1,
        "",
        "",
        `Spotify CLI not found at ${this.cliPath} -- set SPOTIFY_CLI_PATH or install Spotify.app`,
        command
      );
    }

    if (err.killed && err.signal) {
      return new SpotifyCliError(
        -1,
        err.stderr ?? "",
        err.stdout ?? "",
        `spotify_cli timed out after ${DEFAULT_RUN_TIMEOUT_MS}ms (command: ${command.join(" ")})`,
        command
      );
    }

    const exitCode = typeof err.code === "number" ? err.code : -1;
    return new SpotifyCliError(exitCode, err.stderr ?? "", err.stdout ?? "", err.message, command);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Runs 'library batch', piping the manifest as JSON to the child's stdin
   * (spawn, not execFile, since we need to write to stdin). 'library batch'
   * emits JSON-lines regardless of --format: one JSON object per completed
   * op, followed by a final JSON summary line. --format json is still
   * appended so that summary line itself is guaranteed to be JSON.
   *
   * Per docs/spotify-cli-reference.txt, the CLI continues past failed ops by
   * default and its exit code is simply non-zero *if any op failed* -- so a
   * non-zero exit is the expected, common outcome for a mixed-result batch,
   * not proof the whole run is unusable. Throwing immediately on
   * `exitCode !== 0` would silently discard the already-parsed per-op
   * results (including which destructive ops -- library_remove/
   * folder_remove/playlist_remove -- already succeeded), which is exactly
   * the information a caller needs most in that scenario. So a non-zero
   * exit code only becomes a thrown SpotifyCliError when stdout does NOT
   * contain a parseable batch result (i.e. a hard/early failure with no
   * structured output) -- otherwise the parsed {results, summary} is
   * returned normally, and the summary itself reports the failed-op count.
   */
  async runBatch(manifest: unknown): Promise<{ results: unknown[]; summary: unknown }> {
    const args = ["library", "batch", "--format", "json"];
    const input = JSON.stringify(manifest);

    const { stdout, stderr, exitCode } = await this.spawnWithStdin(args, input, DEFAULT_BATCH_TIMEOUT_MS);

    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new SpotifyCliError(
        exitCode,
        stderr,
        stdout,
        exitCode === 0 ? "spotify_cli library batch produced no output" : undefined,
        args
      );
    }

    let parsedLines: unknown[];
    try {
      parsedLines = lines.map((line) => JSON.parse(line));
    } catch {
      throw new SpotifyCliError(
        exitCode,
        stderr,
        stdout,
        `Failed to parse spotify_cli library batch output as JSON lines: ${stdout.slice(0, 200)}`,
        args
      );
    }

    const summary = parsedLines[parsedLines.length - 1];
    const results = parsedLines.slice(0, -1);
    return { results, summary };
  }

  private spawnWithStdin(
    args: string[],
    input: string,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error: ChildProcessError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(
            new SpotifyCliError(
              -1,
              "",
              "",
              `Spotify CLI not found at ${this.cliPath} -- set SPOTIFY_CLI_PATH or install Spotify.app`,
              args
            )
          );
          return;
        }
        reject(new SpotifyCliError(-1, stderr, stdout, error.message, args));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (timedOut) {
          reject(
            new SpotifyCliError(
              -1,
              stderr,
              stdout,
              `spotify_cli library batch timed out after ${timeoutMs}ms`,
              args
            )
          );
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      child.stdin.write(input);
      child.stdin.end();
    });
  }
}
