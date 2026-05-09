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
| `⏎`            | On a user/assistant row: open the *Continue conversation* footer; ⏎ again confirms |
| `esc` / `←` / `h` | Back to the list             |
| `q`            | Quit                            |

### Continue conversation

With the cursor on any user or assistant message, hit `⏎` once to reveal a
*Continue conversation* row at the bottom of the preview, then `⏎` again to
fork the session. `open-context` writes a fresh JSONL alongside the original
(new UUID, same project directory) containing the entries up to your cut
point, then runs `claude --resume <new-uuid>`.

What happens at the cut point depends on which message you picked:

- **User message** — the new history stops *before* this entry; the message
  text is pre-filled into claude's input box (via PTY + bracketed paste) so
  you can edit it before sending.
- **Assistant message** — the new history *includes* this entry; the input
  box is empty, ready for whatever you want to say next.

The Settings panel exposes a *Continue-conversation launch mode* option:

- **Reuse current terminal** (default) — `open-context` exits and hands the
  current terminal over to `claude` via [`@lydell/node-pty`][nodepty].
- **Open in new terminal window** (macOS only) — `open-context` keeps
  running, copies the user message to the clipboard with `pbcopy`, and asks
  Terminal.app to open a fresh window. Paste with Cmd+V.

[nodepty]: https://github.com/lydell/node-pty

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

### PTY runtime selection

The continue-conversation feature spawns `claude` inside a PTY. Two libraries
are bundled and chosen at runtime:

- **Node:** `@lydell/node-pty` (prebuilt for darwin-x64, darwin-arm64,
  linux-x64, linux-arm64, win-x64; falls back to `node-gyp` requiring
  Python 3 + a C++ toolchain on PATH).
- **Bun:** `bun-pty` (Rust + `bun:ffi`; ships its own prebuilt natives).
  Necessary because Bun's child-process semantics don't complete
  `@lydell/node-pty`'s spawn-helper handshake.

To get diagnostic traces of the launch path, run with
`OPEN_CONTEXT_DEBUG=1`; events will append to
`/tmp/open-context-trace.log` (override path via `OPEN_CONTEXT_TRACE`).
