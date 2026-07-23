# Contributing

Thanks for your interest in improving this project. It's a small,
single-maintainer repo, so this file is intentionally short.

## Getting started

```bash
npm install
npm run build      # tsc
npm test           # vitest run
npx tsc --noEmit   # typecheck only
npm run build:mcpb # optional: package as a .mcpb Claude Desktop extension
```

You'll need the Spotify desktop app installed, running, and logged in to
exercise the server end-to-end -- but the automated test suite does **not**
touch a live Spotify install at all. Every test mocks `node:child_process`
and never spawns the real `spotify_cli` binary.

## Before opening a PR

- Keep changes focused; unrelated refactors make review slower.
- Add or update tests for any behavior change (see `src/**/*.test.ts` for
  existing patterns -- all mocked, no live process calls).
- Run `npm run build`, `npm test`, and `npx tsc --noEmit` locally -- CI runs
  the same checks on Node 20 and 22.

## Manual/live testing -- read this before touching your real account

Read-only commands are always safe to exercise against your real Spotify
account: `get_connection_status`, `get_current_user`, `get_now_playing`,
`search`, `lookup_metadata`, `get_playlist`, `list_library`, `list_folders`,
`get_queue`, `list_devices`, `get_taste_profile`, `get_top_history`,
`get_recent_history`. None of these can change anything.

**Never** manually exercise a mutating tool (`create_playlist`,
`add_tracks_to_playlist`, `remove_tracks_from_playlist`, `add_to_library`,
`remove_from_library`, `create_folder`, `rename_folder`, `move_to_folder`,
`remove_folder`, `run_library_batch`, playback-control tools that would
disrupt someone else's active Jam session, etc.) against your real library,
playlists, or folders. Create a disposable playlist/folder first (name it
something like "MCP Test -- safe to delete") and only mutate that, then
delete it by hand afterwards. This project intentionally has no internal
`confirm` parameter or safety gate (see the README's Design Decisions
section) -- the person running it is the only safety net, so be deliberate
during manual testing the same way you'd want an AI assistant to be.

## Reporting bugs vs. security issues

Regular bugs: open a GitHub issue. Anything that could cause data loss in a
user's real Spotify account (e.g. a tool silently deleting more than
documented, or `remove_folder`'s `keep_contents` default not actually
defaulting to `true`): please follow [SECURITY.md](SECURITY.md) instead of
filing a public issue.

## Project structure (quick orientation)

- `src/cli/` -- the `spotify_cli` process wrapper (`client.ts`) and its error
  type (`errors.ts`).
- `src/tools/` -- one file per MCP tool group (playback, devices, queue, jam,
  content, library, playlists, folders, system).
- `src/utils/` -- shared helpers (config parsing, Zod validators, formatters).
- `src/server.ts` / `src/index.ts` -- MCP server factory and stdio entrypoint.
- `docs/spotify-cli-reference.txt` -- the full `--help`/`-h` output of every
  `spotify_cli` command, captured directly from the binary. Check this before
  changing any tool's flags/arguments -- don't guess.

There's no formal RFC process -- for anything larger than a small fix or new
tool, opening an issue first to discuss the approach is appreciated but not
required.

## Releasing (maintainer only)

Publishing to npm is automated via
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), triggered
by pushing a `v*.*.*` tag:

```bash
npm version patch   # or minor / major -- bumps package.json and creates a git tag
git push --follow-tags
```

CI then builds, typechecks, tests, and runs `npm publish --provenance` via
OIDC trusted publishing (no `NPM_TOKEN` secret needed). It then builds the
`.mcpb` Claude Desktop extension and attaches it to a GitHub Release for the
tag, alongside auto-generated release notes.

> **One-time setup before the first release.** npm's trusted-publisher
> settings live on a package's settings page, so they cannot be configured
> for a name that has never been published -- the workflow above will fail
> its publish step on the very first tag. Publish `0.1.0` once from a local
> checkout (`npm publish --access public`, using an npm token or `npm login`),
> then add the trusted publisher on npmjs.com under
> **Package settings → Trusted Publisher → GitHub Actions**, pointing at this
> repo and `publish.yml`. Every release after that runs entirely through CI.

`manifest.json` (used for the `.mcpb` build) has its own `version` field --
`npm run build:mcpb` overwrites it from `package.json` at build time, so you
don't need to bump it by hand.
