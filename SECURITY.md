# Security Policy

This project is an MCP server that shells out to a local binary
(`spotify_cli`, bundled inside the Spotify desktop app) on behalf of an AI
assistant, and can create, modify, and permanently delete real playlists,
library items, and playlist folders in whichever Spotify account is logged
in on the machine it runs on. A vulnerability here could cause unintended
data loss in a user's real account, or (if argument construction were ever
unsafe) allow command injection against the local process. Please report
security issues privately rather than opening a public GitHub issue.

## Reporting a Vulnerability

Please report suspected vulnerabilities via **GitHub Security Advisories**:

1. Go to <https://github.com/mrvnklm/spotify-cli-mcp/security/advisories/new>.
2. Or, from the repository's **Security** tab, click **Report a vulnerability** to open a private advisory.

If you cannot use GitHub Security Advisories, email the maintainer instead
(see the GitHub profile for a contact address). Please do not file a public
issue for anything that could cause unexpected data loss or a way to run
arbitrary commands through this server.

## Scope

Areas of particular interest for this project:

- Any code path that builds `spotify_cli` arguments from tool input using a
  shell (rather than passing an argv array directly to `execFile`/`spawn`)
  -- this project must never construct a shell command string from
  untrusted input.
- `remove_folder`'s `keep_contents` parameter not actually defaulting to
  `true` (this inverts the underlying CLI's own dangerous default, which
  deletes nested playlists) -- a regression here is a data-loss bug, not
  just a style issue.
- Tool descriptions that understate a destructive or irreversible action --
  this project deliberately has no internal `confirm` parameter or
  env-gated safety switch (see the README's Design Decisions section), so
  accurate, honest tool descriptions are the only safety net besides the
  host application's own permission prompts.
- Input validation on tool arguments (Zod schemas) that could allow
  malformed or unexpected values to reach `spotify_cli`.

## Response

This is a small, single-maintainer open-source project without a formal SLA.
Reports are reviewed as soon as reasonably possible and a fix or mitigation
is prioritized for anything involving data loss or command injection. You'll
get an acknowledgement and, where relevant, credit in the release notes once
a fix ships (unless you prefer to stay anonymous).

## Supported Versions

Only the latest published release on npm / the `main` branch is supported
with security fixes. There is no long-term-support branch.
