# open-context-cli

A terminal UI for browsing your local Claude Code session history.

`open-context` reads the JSONL transcripts that Claude Code writes to
`~/.claude/projects/` and presents them as a two-pane browser: sessions on the
left, the rendered conversation on the right. Markdown is rendered to ANSI,
tool calls collapse to one line by default, and `/` opens an incremental
search over both the session list and the active conversation.

## Install

The package is not published yet. Build and link it locally:

```bash
bun install
bun run build
bun link        # exposes the `open-context` binary on your PATH
```

Or run straight from source during development:

```bash
bun run dev
```

## Usage

```bash
open-context                      # scan ~/.claude/projects
open-context --path ./logs        # use a custom directory or a single .jsonl
open-context --no-emoji           # plain role labels instead of emoji
open-context --help
```

If no sessions are found at the default location, the app prompts for a path.

## Key bindings

**Session list**

| Key            | Action                          |
| -------------- | ------------------------------- |
| `↑` / `↓` `j` / `k` | Move selection             |
| `⏎` / `→` / `l` | Focus the preview pane         |
| `/`            | Filter sessions by summary/path |
| `p`            | Re-enter a different root path  |
| `q` / `Ctrl-C` | Quit                            |

**Preview pane**

| Key            | Action                          |
| -------------- | ------------------------------- |
| `↑` / `↓`      | Scroll                          |
| `Ctrl-F`       | Find within the conversation    |
| `Tab`          | Expand the focused tool call    |
| `esc` / `←` / `h` | Back to the list             |
| `q`            | Quit                            |

## How sessions are discovered

Claude Code stores one directory per workspace under `~/.claude/projects/`,
with a `.jsonl` file per session. The directory name is a slugified version of
the absolute project path (slashes replaced with dashes). `open-context`
decodes that back into a real path so the list shows where the session ran.

You can also point `--path` at any directory of `.jsonl` files, or at a single
file, to inspect transcripts that live elsewhere.

## Architecture

The codebase is intentionally small:

```
src/
├── cli.tsx            # arg parsing + render(<App />)
├── app.tsx            # top-level state machine: scan → path-input → browser
├── components/        # ink components (list, preview, search bar, footer …)
├── hooks/             # session-listing and session-detail loaders
├── lib/               # markdown→ANSI, jsonl streaming, path decoding, matching
└── providers/         # pluggable session sources
    ├── types.ts       # SessionProvider interface
    └── claude-code.ts # the only provider today
```

`SessionProvider` is the seam for adding other history sources: implement
`listSessions` and `loadSession` and register the provider in
`providers/index.ts`.

## Develop

```bash
bun install
bun run dev          # run the TUI from source
bun test             # run the unit + smoke test suites
bun run typecheck    # tsc --noEmit
bun run build        # bundle to dist/cli.js
```

Tests use `ink-testing-library` for components and fixture `.jsonl` files in
`tests/fixtures/` for the provider layer.
