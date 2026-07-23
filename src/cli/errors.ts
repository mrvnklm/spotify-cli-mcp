/**
 * The one real transient failure signature observed during live testing:
 * 'history top' failed once with a stderr containing "HTTP request failed"
 * and succeeded on an immediate retry. This is local IPC flakiness between
 * spotify_cli and the running desktop app -- not a rate limit and not an
 * auth problem -- so it is the only signature treated as safe to retry.
 */
const TRANSIENT_ERROR_PATTERN = /HTTP request failed/i;

export class SpotifyCliError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdout: string,
    message?: string,
    /** The spotify_cli subcommand args this error came from, for toText(). */
    public readonly command?: string[]
  ) {
    super(message ?? SpotifyCliError.summarize(exitCode, stderr, stdout));
    this.name = "SpotifyCliError";
  }

  private static summarize(exitCode: number, stderr: string, stdout: string): string {
    const detail = stderr.trim() || stdout.trim();
    return detail
      ? `spotify_cli exited with code ${exitCode}: ${detail}`
      : `spotify_cli exited with code ${exitCode}`;
  }

  static isTransientError(error: unknown): boolean {
    if (error instanceof SpotifyCliError) {
      return TRANSIENT_ERROR_PATTERN.test(error.stderr) || TRANSIENT_ERROR_PATTERN.test(error.message);
    }
    return false;
  }

  /** Concise human-readable error string suitable for an MCP tool's error content. */
  toText(): string {
    const parts: string[] = [];
    if (this.command && this.command.length > 0) {
      parts.push(`Command: spotify_cli ${this.command.join(" ")}`);
    }
    parts.push(`Exit code: ${this.exitCode}`);
    const stderrTrimmed = this.stderr.trim();
    if (stderrTrimmed) {
      parts.push(`Error: ${stderrTrimmed}`);
    } else {
      parts.push(`Error: ${this.message}`);
    }
    return parts.join("\n");
  }
}
