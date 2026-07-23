# Spotify CLI MCP Server

[![npm](https://img.shields.io/npm/v/spotify-cli-mcp)](https://www.npmjs.com/package/spotify-cli-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)

An MCP (Model Context Protocol) server that connects AI assistants like
Claude to Spotify -- through the Spotify **desktop app's own bundled local
CLI helper**, not the public Web API. Control playback, search and inspect
tracks (including BPM/key/Camelot key for DJ-style mixing), manage your
library, playlists, and playlist folders, all through natural language.

> **Disclaimer:** This is an unofficial, community-built project and is not
> affiliated with, endorsed by, or supported by Spotify. It is provided "AS
> IS", without warranty of any kind (see [License](#license)). This tool can
> create, modify, and **permanently delete** real playlists, library items,
> and playlist folders in your Spotify account via natural-language
> instructions to an AI assistant. It deliberately has **no internal
> confirmation step** of its own (see [Design Decisions](#design-decisions))
> -- always review what an AI assistant is about to do before approving a
> tool call, especially anything this README marks as destructive or
> irreversible.

## How this works (no API keys needed)

Unlike most MCP servers, this one needs **no API keys, no OAuth, no
credentials at all**. It shells out to `spotify_cli`, a CLI binary Spotify
already bundles inside the desktop app -- it's there because it powers
"Studio by Spotify Labs," a research-preview AI feature built into the
Spotify desktop app itself. Authentication is implicit: whichever Spotify
account is already logged into the desktop app on this machine is the
account the tools operate on.

That means:
- The Spotify desktop app must be **installed, running, and logged in** on
  the same machine as this server.
- This is a **local-only, stdio MCP server** -- it cannot be hosted remotely,
  because it depends on a local process. It will not work with ChatGPT's
  connector model or any other remote-MCP client.
- **macOS only for now.** The bundled path
  (`/Applications/Spotify.app/Contents/MacOS/spotify_cli`) is confirmed
  working; Windows/Linux equivalents are unconfirmed (see
  [Configuration](#configuration)).
- **No app registration, OAuth scopes, or per-app API quotas to manage** --
  there's no developer dashboard, no client id/secret, and nothing to
  request higher rate limits for. That said, `spotify_cli` still talks to
  Spotify's backend internally, so this isn't a claim that requests are
  literally unthrottled -- occasional transient failures are handled with a
  small automatic retry (see [Configuration](#configuration)).

## Features

- **No API keys, OAuth, or app registration** -- runs against your own
  already-logged-in Spotify desktop app, so there's no developer dashboard
  to set up and no per-app rate-limit tier to request or manage.
- **Playback control** -- play/pause/resume, skip, seek, shuffle, repeat,
  speed, volume, now-playing.
- **Devices, queue, and Jam sessions** -- list/transfer/set volume on
  devices, manage the upcoming queue, create/join/manage shared Jam
  sessions.
- **Rich search and lookup** -- resolve one or more Spotify URIs to metadata
  including **BPM, musical key, and Camelot key** (handy for DJ-style
  harmonic mixing), monthly listeners, follower counts, play counts, release
  dates, and genres -- batched in a single call.
- **Library, playlists, and folders** -- list/check/add/remove saved items,
  get/create/update playlists, add/remove tracks, and manage playlist
  folders (including a batch-operations tool for running many changes in
  one call).
- **Zod validation** on all tool inputs with descriptive error messages.
- **One-click Claude Desktop install** via a `.mcpb` extension bundle -- no
  terminal or config file editing required.

## Quick Start

This gets the server connected to **Claude Desktop** on macOS. Takes about 2
minutes -- no API keys to look up, since there aren't any.

- **Option A -- one-click extension (easiest):** download a `.mcpb` file and
  drag it into Claude Desktop. No terminal, no editing JSON files.
- **Option B -- manual config:** edit Claude Desktop's config file by hand.

### 1. Make sure Spotify is installed, open, and logged in

Open the Spotify desktop app and make sure you're logged into your account.
Leave it running.

### 2a. Option A: Install as a one-click extension

1. Go to the [latest release](https://github.com/mrvnklm/spotify-cli-mcp/releases/latest) and download the `.mcpb` file (under "Assets").
2. Open Claude Desktop, open the menu → **File → Settings → Extensions**, and drag the downloaded `.mcpb` file into that window (or click "Install Extension…" and select it).
3. Click **Install**. Leave the optional "Spotify CLI path" field blank unless Spotify.app is installed somewhere other than `/Applications`. Skip ahead to [step 3](#3-verify-it-worked).

### 2b. Option B: Manual config file

Claude Desktop reads its list of MCP servers from a config file, which
usually doesn't exist yet -- you'll create it.

**On Mac:**
1. Open **Finder**, press `Cmd+Shift+G` ("Go to Folder"), and paste in:
   ```
   ~/Library/Application Support/Claude/
   ```
2. Open (or create) a file named `claude_desktop_config.json` there in a plain text editor -- TextEdit works, but make sure **Format → Make Plain Text** is selected first, otherwise it saves rich text and Claude Desktop won't be able to read it.

**Paste this in:**

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "spotify-cli-mcp"]
    }
  }
}
```

> If the file already has other servers configured under `mcpServers`, add a comma after the previous entry's closing `}` and paste `"spotify": { ... }` in as a new entry, instead of replacing the whole file -- JSON is picky about commas and braces, so a [validator](https://jsonlint.com/) helps if something doesn't work.

If Spotify.app is installed somewhere other than `/Applications`, add an
`env` block with `"SPOTIFY_CLI_PATH": "/path/to/Spotify.app/Contents/MacOS/spotify_cli"`.

Save the file, then fully quit and reopen Claude Desktop (`Cmd+Q`; closing
the window alone isn't enough, and the config is only read on startup).

### 3. Verify it worked

Open a new chat in Claude Desktop and look for a tools icon near the message
box, or check **Settings → Extensions** / **Developer** -- `spotify` should
be listed. Then try asking:

> "What's currently playing on Spotify?"

If Claude calls the tool and shows your current track, it's working.

### Troubleshooting

| Problem | Fix |
|---|---|
| `spotify` doesn't show up at all | Fully quit and reopen Claude Desktop (not just close the window). For Option B, double-check the JSON has no missing commas or braces. |
| Tool calls fail with "Spotify CLI not found" | Confirm Spotify.app is installed in `/Applications` (or set `SPOTIFY_CLI_PATH` to its actual location). |
| Tool calls fail with a connection/login error | Open the Spotify desktop app and make sure you're logged in; try `get_connection_status` to check. |
| Edited the config but nothing changed (Option B) | Claude Desktop only reads the config file on startup -- fully quit and reopen after every edit. |
| Still stuck | Check the logs -- Mac: `~/Library/Logs/Claude/mcp*.log` -- or open an [issue on GitHub](https://github.com/mrvnklm/spotify-cli-mcp/issues). |

### Running from source instead

If you want to modify the code, see [Contributing](#contributing) below.

### Compatibility

This server uses the stdio MCP transport (a local process launched via
`npx`), so it works with Claude Desktop, Claude Code, Cursor, and other MCP
clients that support local stdio servers **on macOS**.

**ChatGPT is not supported**, and neither is any other remote/hosted MCP
client -- this server fundamentally requires a local `spotify_cli` process
talking to a local, logged-in Spotify desktop app. There is no API to proxy
remotely.

## Tool Reference

51 tools. Each one is annotated for the host application as read-only,
additive, or **destructive** -- the nine destructive ones are marked below,
and are the calls worth reading carefully before you approve them.

### Playback

| Tool | Description |
|------|-------------|
| `play` | Play a Spotify URI, or resume playback; optionally on a specific device |
| `pause` | Pause playback |
| `resume` | Resume playback |
| `skip_to_next` | Skip to the next track |
| `skip_to_previous` | Skip to the previous track |
| `seek` | Seek to (or by, with `--relative`) a position in the current track |
| `set_shuffle` | Turn shuffle on or off |
| `set_repeat` | Set repeat mode (off / context / track) |
| `set_playback_speed` | Set playback speed (0.0-2.0) |
| `set_volume` | Set playback volume (0.0-1.0) |
| `get_now_playing` | Show the currently playing track |

### Devices, Queue, and Jam

| Tool | Description |
|------|-------------|
| `list_devices` | List connected playback devices |
| `get_device_info` | Show detailed info for a specific device |
| `transfer_playback` | Transfer playback to a specific device |
| `set_device_volume` | Set volume on a specific device |
| `get_queue` | View the playback queue |
| `add_to_queue` | Add a track to the end of the playback queue |
| ⚠️ `remove_from_queue` | Remove a track from the playback queue by position |
| `move_in_queue` | Reorder a track within the playback queue |
| `get_jam_status` | Show the current Jam session status |
| `list_jam_members` | List members of the current Jam session |
| `create_jam` | Start a new Jam session |
| `leave_jam` | Leave the current Jam session |
| ⚠️ `end_jam` | End the current Jam session (host only) |
| ⚠️ `kick_from_jam` | Remove a member from the Jam session (host only) |
| `set_jam_permissions` | View or change Jam session permissions |

### Content (search, lookup, taste, history)

| Tool | Description |
|------|-------------|
| `search` | Search the Spotify catalog for tracks, artists, albums, and more |
| `lookup_metadata` | Resolve one or more Spotify URIs to rich metadata -- BPM, musical key, Camelot key, monthly listeners, followers, play counts, release date, genres |
| `get_taste_profile` | Show your Spotify-generated music taste profile |
| `get_top_history` | Show your most-played tracks/artists |
| `get_recent_history` | Show your recently played tracks |

### Library, Playlists, and Folders

| Tool | Description |
|------|-------------|
| `list_library` | List saved items in your library |
| `check_library_contains` | Check whether items are saved in your library |
| `add_to_library` | Save items to your library |
| ⚠️ `remove_from_library` | **Permanently** remove saved items from your library |
| ⚠️ `run_library_batch` | Run a batch of mixed library/playlist/folder operations in one call |
| `get_playlist` | Get a playlist's details and tracks |
| `create_playlist` | Create a new playlist |
| ⚠️ `update_playlist` | Update a playlist's name, description, cover image, or visibility |
| `add_tracks_to_playlist` | Add tracks to a playlist |
| ⚠️ `remove_tracks_from_playlist` | **Permanently** remove tracks from a playlist by position |
| `list_folders` | List playlist folders |
| `create_folder` | Create a new playlist folder |
| ⚠️ `rename_folder` | Rename a playlist folder |
| `move_to_folder` | Move playlists or folders into another folder |
| ⚠️ `remove_folder` | Remove a playlist folder -- nested playlists are **kept** by default (see below) |

### System

| Tool | Description |
|------|-------------|
| `get_current_user` | Show the currently logged-in Spotify user |
| `get_connection_status` | Check whether the Spotify desktop app is running and logged in |
| `open_spotify_app` | Launch or focus the Spotify desktop app |
| `navigate_to_uri` | Navigate the Spotify app to a specific URI |
| `get_cli_version` | Show the Spotify CLI and helper versions |

## Architecture

```
src/
  index.ts                   # Node.js stdio entry point
  server.ts                  # MCP server factory
  cli/
    client.ts                # spotify_cli process wrapper (execFile/spawn, retry, JSON parsing)
    errors.ts                # SpotifyCliError with transient-failure detection
  tools/
    register.ts              # defineTool() -- shared error handling + annotation presets
    playback.ts              # 11 tools
    devices.ts               #  4 tools
    queue.ts                 #  4 tools
    jam.ts                   #  7 tools
    content.ts               #  5 tools -- search/lookup/taste/history
    library.ts               #  5 tools -- library + batch
    playlists.ts             #  5 tools
    folders.ts               #  5 tools
    system.ts                #  5 tools
  utils/
    config.ts                # SPOTIFY_CLI_PATH resolution
    validators.ts            # Shared Zod schemas (spotifyUriSchema, volume/speed ranges, ...)
    formatters.ts            # Thin JSON formatting helper
docs/
  spotify-cli-reference.txt  # Full captured --help/-h output of every spotify_cli command
```

51 tools in total. Every tool is registered through `defineTool()`, which
attaches the tool's Zod input schema and MCP annotations and applies one
shared error path: a failed `spotify_cli` call comes back as an `isError`
result carrying the command, exit code, and CLI output, rather than as a
transport-level exception.

### Design Decisions

- **No API/OAuth layer at all**: auth is implicit via the already-logged-in
  Spotify desktop app -- there is nothing to configure beyond an optional
  binary path override.
- **No internal `confirm` parameters, no env-gated write-tool switch**: this
  was a deliberate choice. Every tool whose underlying command mutates
  persisted account data (library, playlists, folders) says so plainly in
  its description and Zod field docs. Safety relies on that description
  text being accurate, plus the host application's own per-call permission
  prompts -- not on an extra confirmation step baked into this server.
- **Every tool carries MCP annotations** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`), which is what makes the point above
  workable: a host can gate the 9 destructive tools behind a prompt while
  letting the 18 read-only ones through, without having to parse English
  descriptions to tell them apart. `openWorldHint` is true throughout --
  every tool reaches Spotify's backend via the desktop app. A test asserts
  the destructive and read-only sets exactly, so a newly added tool cannot
  quietly register as harmless.
- **One deliberate exception**: `remove_folder`'s `keep_contents` parameter
  defaults to `true`. The underlying CLI's own default is the opposite --
  it deletes a folder's nested playlists unless `--keep-contents` is passed
  -- which is a real data-loss footgun. Defaulting the *parameter* safely is
  a plain, minimal choice, not new confirmation machinery.
- **1:1 tool-to-command mapping** rather than consolidated "action"-style
  tools: Spotify's CLI verbs are already small and distinct (unlike, say,
  a REST CRUD surface), so mirroring them directly is clearer than
  introducing an artificial discriminator parameter.
- **`spotify_cli` is invoked via `execFile`/`spawn` with a real argv array**,
  never through a shell -- no command-injection surface from tool input.
- **Most mutation commands ignore `--format json` on success**: confirmed by
  live testing, `playlist`/`folder`/`library` create/update/add/remove/
  rename/move commands (and `pause`/`resume`/`volume` under playback) print
  a short human-readable line (or nothing at all) instead of JSON, even
  though the command succeeded (exit code 0). The client treats any
  non-JSON stdout on a successful exit as a plain-text success message
  (`{ message }`) rather than an error -- a real failure is always a
  non-zero exit, handled separately. Mutating tools that create something
  with a URI (e.g. `create_playlist`, `create_folder`) extract that URI from
  the message so it can be chained into a follow-up call without an extra
  lookup round-trip.
- **No caching layer**, unlike a typical HTTP API wrapper. This is deliberate,
  not a gap: most tools here either reflect live state that a cache would
  make stale on the next read (now-playing, the queue, devices, Jam status),
  or feed position-based mutations (`remove_tracks_from_playlist` explicitly
  warns that positions shift after other edits). Caching would make it
  easier for an agent to act on stale positions -- actively worse for safety,
  not better -- and there's no rate-limit pressure here to trade that risk
  against in the first place (see above).

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `SPOTIFY_CLI_PATH` | No | `/Applications/Spotify.app/Contents/MacOS/spotify_cli` | Path to the `spotify_cli` binary. Same variable name "Studio by Spotify Labs" itself already uses. |
| `SPOTIFY_MCP_RETRY_MAX_ATTEMPTS` | No | `2` | Retry attempts for the one known transient CLI failure mode (occasional local IPC `HTTP request failed` errors). |
| `SPOTIFY_MCP_RETRY_BASE_DELAY_MS` | No | `300` | Delay between retries (ms). |

## Known Limitations

- **No way to delete a playlist you own.** `remove_from_library` maps to
  `spotify_cli library remove`, which follows Spotify's "save/unsave"
  model -- it works for unsaving playlists created by *other* people, but
  the underlying CLI rejects it for a playlist you own (confirmed live: it
  fails with "client connection failed" every time, not a transient error).
  There is no other command in this CLI that deletes an owned playlist.
  If you create a playlist with `create_playlist` and want it gone, delete
  it from the Spotify app itself (right-click → Delete).
- **Two mutation commands return no output at all on success**: `pause` and
  `resume` print empty stdout even with `--format json`. This is handled the
  same way as the raw-text case above (see Design Decisions) -- the tool
  reports `{"success": true, "message": ""}` rather than erroring.

## Future Improvements

- **Windows/Linux support**: confirm the equivalent bundled CLI path (if any)
  on other platforms.
- **"Save to Spotify" podcast tools**: upload audio/video, manage shows,
  episodes, and episode timelines -- deliberately excluded from this first
  version since it's a distinct risk domain (publishing public content)
  orthogonal to controlling/querying your own listening.
- **Audit logging**: optionally log mutating tool calls locally for
  after-the-fact review.

## Contributing

```bash
git clone https://github.com/mrvnklm/spotify-cli-mcp.git && cd spotify-cli-mcp
npm install
npm test           # vitest run
npx tsc --noEmit   # typecheck
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, including how to
safely test mutating tools without touching your real library/playlists.

## License

MIT
