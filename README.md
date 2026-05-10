# openctx

A terminal UI for browsing your local Claude Code **and Codex CLI** session
history in one place.

`openctx` reads the JSONL transcripts that Claude Code writes to
`~/.claude/projects/` and the rollouts that Codex CLI writes to
`~/.codex/sessions/`, merging them into a single two-pane browser:
sessions on the left, the rendered conversation on the right. Each row
is tagged with the source CLI it came from. Markdown is rendered to
ANSI, tool calls collapse to one line by default, and a `Ctrl-F` search
inside the preview lets you jump through hits in the active conversation.

## Install

```bash
npm install -g @12og3r/openctx
```

Requires Node ≥ 20. Bun is also supported — if you install under Bun, the
`bun-pty` optional dependency is picked up automatically for the
continue-conversation feature.

### Build from source

```bash
bun install
bun run build
bun link        # exposes the `openctx` binary on your PATH
```

Or run straight from source during development:

```bash
bun run dev
```

## Usage

```bash
openctx                      # scan ~/.claude/projects and ~/.codex/sessions
openctx --no-emoji           # plain role labels instead of emoji
openctx update               # reinstall to the latest version
openctx update 0.2.0         # pin a specific version
openctx -v                   # print version and exit
openctx --help
```

`openctx update` reinstalls via whichever package manager owns the binary
on disk (npm / bun / pnpm / yarn — detected from the install path).

If no sessions are found at the default location, `openctx` opens directly
on the Settings panel with a red status indicator next to the *Sessions
directory* field, so you can point it at the right path without leaving the
app.

## Key bindings

**Session list**

| Key            | Action                                 |
| -------------- | -------------------------------------- |
| `↑` / `↓` `j` / `k` | Move selection                    |
| `⏎` / `→` / `l` | Focus the preview pane                |
| `Tab`          | Open the feature bar (Settings, Delete)|
| `q` / `Ctrl-C` | Quit                                   |

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
*Continue conversation* row at the bottom of the preview (with a chip
showing the source CLI), then `⏎` again to launch.

For **Claude Code** sessions, `openctx` writes a fresh JSONL alongside
the original (new UUID, same project directory) containing the entries
up to your cut point, then runs `claude --resume <new-uuid>`. What
happens at the cut point depends on which message you picked:

- **User message** — the new history stops *before* this entry; the message
  text is pre-filled into claude's input box (via PTY + bracketed paste) so
  you can edit it before sending.
- **Assistant message** — the new history *includes* this entry; the input
  box is empty, ready for whatever you want to say next.

For **Codex** sessions, `openctx` calls `codex resume <session-id>`.
Codex's CLI doesn't expose a per-message cut point, so the resume picks
up the existing transcript whole; if the cursor is on a user message,
that text is still pre-filled via bracketed paste so you can edit
before sending.

The Settings panel exposes a *Continue-conversation launch mode* option:

- **Reuse current terminal** (default) — `openctx` exits and hands the
  current terminal over to `claude` via [`@lydell/node-pty`][nodepty].
- **Open in new terminal window** (macOS only) — `openctx` keeps
  running, copies the user message to the clipboard with `pbcopy`, and asks
  Terminal.app to open a fresh window. Paste with Cmd+V.

[nodepty]: https://github.com/lydell/node-pty

## How sessions are discovered

Claude Code stores one directory per workspace under `~/.claude/projects/`,
with a `.jsonl` file per session. The directory name is a slugified version of
the absolute project path (slashes replaced with dashes). `openctx`
decodes that back into a real path so the list shows where the session ran.

Codex CLI writes one rollout JSONL per session under
`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. The
`session_meta` line at the top of each file carries the cwd, which
`openctx` reads to display the project path.

Both source directories are configurable in the Settings panel
(Claude Code sessions directory, Codex sessions directory), and each
source can be hidden independently. The defaults honor the
`CLAUDE_CONFIG_DIR` and `CODEX_HOME` environment variables when set.

## Architecture

The codebase is intentionally small:

```
src/
├── cli.tsx            # arg parsing + render(<App />)
├── app.tsx            # top-level state machine: scan → browser
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
