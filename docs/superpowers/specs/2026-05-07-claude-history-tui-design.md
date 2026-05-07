# claude-history-cli — TUI session viewer

**Date:** 2026-05-07
**Status:** Approved design, pending implementation plan

## Summary

A terminal application built with React Ink that lets the user browse historical
AI coding sessions stored on disk. The MVP supports Claude Code session files
(`~/.claude/projects/<encoded-path>/<uuid>.jsonl`) but is structured around a
pluggable `SessionProvider` interface so additional providers (Codex, Gemini
CLI, Claude Engineer, etc.) can be added later without refactoring.

The primary view is a two-pane layout: a scrollable session list on the left
and a conversation preview on the right.

## Goals

- Open the app, see all local Claude Code sessions instantly with useful labels.
- Browse any past conversation without leaving the terminal.
- Survive a missing/empty default directory by letting the user enter a custom
  path manually.
- Keep the door open for non-Claude-Code providers by isolating provider-specific
  logic behind a small interface.

## Non-Goals (MVP)

- Editing or replaying sessions.
- Cross-machine sync.
- LLM-generated summaries (we use Claude Code's saved summary line and fall
  back to the first user message).
- Session search beyond simple substring matching.
- Built-in support for providers other than Claude Code. The interface exists,
  but only one implementation ships.

## User Flow

```
launch
  └─ scan default paths for the active provider (Claude Code: ~/.claude/projects)
       ├─ found ≥1 .jsonl file → SessionBrowser
       └─ none found / directory missing → PathInput
                                            └─ on submit → SessionBrowser
```

`PathInput` accepts either a directory (scanned recursively for `.jsonl`) or a
single file path. Invalid input shows an inline error and lets the user try
again. The user can return to PathInput at any time with a keybinding (`p`).

## Architecture

### Provider abstraction

```ts
// src/providers/types.ts
export interface SessionProvider {
  readonly name: string;                           // e.g. "claude-code"
  readonly defaultPaths: string[];                 // e.g. ["~/.claude/projects"]
  listSessions(root: string): Promise<SessionMeta[]>;
  loadSession(filePath: string): AsyncIterable<Message>;
}

export interface SessionMeta {
  id: string;                // session uuid (filename without extension)
  filePath: string;          // absolute path to the .jsonl
  summary: string;           // jsonl summary line, or first user message, or "(empty session)"
  projectPath: string;       // decoded from parent dir name; "" if not derivable
  modifiedAt: Date;
  messageCount: number;
}

export interface Message {
  role: "user" | "assistant" | "tool" | "system";
  content: string;           // raw text; rendering happens at the component layer
  timestamp: Date;
  toolName?: string;         // populated when role === "tool"
  raw: unknown;              // original parsed jsonl entry, for debugging/expand
}
```

Only `ClaudeCodeProvider` is implemented in the MVP. A `providers/index.ts`
registry maps `name` → provider instance and exposes `getProvider(name)`.

### Claude Code provider

Reads `.jsonl` files. Each line is a JSON object with a `type` field. Known
types observed in current Claude Code sessions:

- `summary` — `{ type: "summary", summary: string, leafUuid: string }`. Usually
  the first line. Use `summary` for `SessionMeta.summary` when present.
- `user` — `{ type: "user", message: { role: "user", content: ... }, ... }`
- `assistant` — `{ type: "assistant", message: { role: "assistant", content: ... }, ... }`
- `tool_use`, `tool_result`, `system` — collapsed/styled differently in preview.

`listSessions(root)` walks `root` one level deep (each subdirectory represents
an encoded project path), then for each `.jsonl` it:

1. Streams just enough lines to grab the `summary` line (typically line 1) and
   the first `user` message as a fallback.
2. Stats the file for `modifiedAt`.
3. Counts lines for `messageCount` (cheap; we already streamed once).

Decoded project paths: the parent directory name like
`-Users-roger-projects-claude-history` is converted to
`/Users/roger/projects/claude-history` by replacing the leading and embedded
hyphens with `/`. We treat any failure to decode as `projectPath = ""` rather
than crashing.

### App state machine

```
type AppState =
  | { kind: "scanning" }
  | { kind: "path-input"; reason: "no-default-path" | "user-requested"; error?: string }
  | { kind: "browser"; root: string; sessions: SessionMeta[]; selectedId: string | null }
  | { kind: "loading-session"; meta: SessionMeta }
  | { kind: "browser-with-detail"; root: string; sessions: SessionMeta[]; selected: SessionMeta; messages: Message[]; focus: "list" | "preview" };
```

Transitions live in `app.tsx` and are driven by user input plus async results
from the active provider.

## UI

### Layout

```
┌─ Sessions (42) ─────────┬─ Preview ──────────────────────────────┐
│ ▸ Building Ink TUI app  │ user · 2h ago                          │
│   2h ago · 24 msgs      │ 我想做一款终端应用...                  │
│ ─────────────────────── │                                        │
│   Refactor parser       │ assistant                              │
│   Yesterday · 18 msgs   │ 好的，先了解一下...                    │
│ ─────────────────────── │                                        │
│   Debug auth flow       │ ▸ Bash: ls -la (12 lines)              │
│   3d ago · 56 msgs      │                                        │
└─────────────────────────┴────────────────────────────────────────┘
 ↑/↓ select   Enter focus preview   / search   ⌃F search-in-preview   q quit
```

- Left column fixed width: `min(36, floor(termWidth * 0.35))`.
- Right column takes remaining width.
- Footer hint bar shows context-sensitive keybindings.
- When a session is selected but the preview is still loading, show a small
  spinner in the preview pane.

### Session list item (two-line)

```
▸ <summary, truncated to fit width>
  <relative time> · <messageCount> msgs
```

- The marker `▸` indicates the currently selected row; uses inverse video.
- Summary line is truncated with `…`. Multi-byte/CJK aware truncation
  (use `string-width`).
- Relative time examples: `just now`, `2h ago`, `Yesterday`, `3d ago`,
  `2026-04-12`.
- Items are separated by a horizontal divider — a row of `─` characters
  spanning the inner width of the left column, rendered in dim color. The
  divider is drawn between every pair of adjacent items but not above the
  first or below the last.

### Preview pane

Messages render top-down in chronological order. Each message has a header
line (`<role> · <relative time>`) followed by the content. Long messages are
not truncated by default — the user scrolls.

**Initial scroll position is the bottom** — the most recent message is
visible without any user action. This matches how chat clients open a
conversation. The user scrolls up (`PgUp`, `Ctrl-u`, `k` while the preview
has focus) to walk back through history. `g` jumps to the very first
message; `G` jumps back to the latest. Whenever the user switches to a
different session, the preview resets to bottom again.

Rendering rules per role:

- **user / assistant**: markdown rendered to ANSI (bold, italic, inline code,
  fenced code blocks, lists, headings). Uses `marked` to parse and a small
  hand-written renderer for ANSI output. No external heavyweight Markdown ANSI
  library.
- **tool_use**: rendered collapsed as `▸ <toolName>: <one-line summary>`. The
  preview maintains an integer "active block index" pointing at one tool block
  at a time (defaulting to the first visible one). `Tab` toggles its expanded
  state; `Shift-Tab` advances the active block index to the next tool block
  in the message stream. Expanded view shows full input/output.
- **tool_result**: same collapsed convention; the result body is shown in dim
  color when expanded.
- **system**: dim, italic, prefixed with `system`.

### In-preview search

While the right pane has focus the user can press `Ctrl-F` (the spec
intentionally uses `Ctrl-F` rather than `Cmd-F` because most terminal
emulators on macOS — Terminal.app, iTerm2, Ghostty — intercept `Cmd-F` for
their own find dialog and never deliver it to the application; the footer
hint advertises this as "⌃F search" so the binding is discoverable). A
single-line search input slides in at the top of the preview pane.

- Typing filters in real time. The preview highlights all matches in the
  rendered text (inverse video on the matched substring) and auto-scrolls
  to the first match at or after the current viewport top.
- `Enter` commits the query and closes the input bar; the highlights stay
  on screen and the user uses the normal scroll keys (`PgUp` / `PgDn`,
  `Ctrl-u` / `Ctrl-d`, `k` / `j`, `g` / `G`) to walk through the
  conversation and visually find the next match.
- `Esc` clears the query, removes highlights, and returns the viewport to
  where the user was before opening search.
- Match logic: case-insensitive substring on the rendered text of each
  message (post-markdown). Tool blocks are searched in their expanded
  form; a collapsed tool block whose body matches is auto-expanded so the
  highlight is visible.

Per-match navigation (`n` / `N`) is intentionally out of scope for the
MVP — visual scrolling over highlighted matches is enough for the
expected session sizes. We can add it later if it becomes painful.

## Keybindings

| Key                  | Context     | Action                                 |
|----------------------|-------------|----------------------------------------|
| `↑` / `k`            | list focus  | move selection up                      |
| `↓` / `j`            | list focus  | move selection down                    |
| `Enter` / `→` / `l`  | list focus  | move focus to preview                  |
| `Esc` / `←` / `h`    | preview     | move focus back to list                |
| `PgUp` / `Ctrl-u`    | preview     | scroll up half a page                  |
| `PgDn` / `Ctrl-d`    | preview     | scroll down half a page                |
| `g` / `G`            | preview     | jump to first / latest message         |
| `Tab`                | preview     | toggle expand on active tool block     |
| `Shift-Tab`          | preview     | move active tool block to next         |
| `Ctrl-F`             | preview     | open in-preview search                 |
| `Enter`              | preview-search | commit query, keep highlights       |
| `Esc`                | preview-search | exit search (clear query + highlights) |
| `/`                  | list focus  | open list-search input                 |
| `Esc`                | list-search | close search, clear filter             |
| `Enter`              | list-search | apply filter, return to list focus     |
| `p`                  | any         | switch to PathInput                    |
| `q` / `Ctrl-c`       | any         | quit                                   |

## Performance

- **List load**: only the metadata pass touches each file. We stream lines via
  Node's `readline` and stop reading once we have a `summary` and the first
  user message. For sessions without a summary, we also keep the first user
  message (already captured during the same pass). `messageCount` is the count
  of lines whose `type` is `user` or `assistant` (summary/system/tool entries
  do not count); it is tallied incrementally during a full streaming pass when
  the cache is cold.
- **Preview load**: streamed when a session is selected; emit messages as they
  parse so the preview can show content before the full file is consumed.
- **Caching**: in-memory cache keyed by `(filePath, mtime)`. Listing again
  with the same mtime returns the cached `SessionMeta`; loading the same
  session again with the same mtime returns the cached `Message[]`. Cache
  is bounded (LRU, e.g. 50 sessions of message data) to keep memory in check.

## Error handling

- Default path missing → transition to `path-input` with reason
  `no-default-path`.
- User-supplied path doesn't exist or has no `.jsonl` → stay in `path-input`,
  set `error`.
- Malformed `.jsonl` line → skip it, continue parsing; emit a debug log only.
  A session that produces zero valid lines still appears with summary
  `"(empty session)"` so the user can see it exists.
- Provider errors during `loadSession` → show an error block in the preview
  pane, allow the user to pick another session.

## Tech stack

- **Runtime**: Bun. Used for dev server (`bun --hot`), package manager, and
  test runner.
- **Language**: TypeScript with `strict: true`.
- **UI**: `ink`, `ink-text-input` (search box and PathInput), `ink-spinner`
  (loading state).
- **Markdown**: `marked` for parsing, a small `lib/markdown-ansi.ts` for
  rendering.
- **Width math**: `string-width` for CJK-safe truncation.
- **Testing**: `bun test` for unit tests; `ink-testing-library` for component
  tests.

## File layout

```
claude-history-cli/
├── package.json                      # "name": "claude-history-cli"
├── tsconfig.json
├── bun.lockb
├── README.md
├── src/
│   ├── cli.tsx                       # entry — parses argv, mounts <App/>
│   ├── app.tsx                       # state machine, top-level component
│   ├── providers/
│   │   ├── types.ts                  # SessionProvider, SessionMeta, Message
│   │   ├── index.ts                  # registry; getProvider(name)
│   │   └── claude-code.ts            # ClaudeCodeProvider
│   ├── components/
│   │   ├── path-input.tsx
│   │   ├── session-browser.tsx       # owns layout + focus state
│   │   ├── session-list.tsx
│   │   ├── session-preview.tsx
│   │   ├── message-block.tsx         # one rendered message
│   │   ├── search-bar.tsx
│   │   └── footer.tsx                # context-sensitive hint bar
│   ├── hooks/
│   │   ├── use-sessions.ts           # listSessions + caching
│   │   ├── use-session-detail.ts     # loadSession streaming
│   │   └── use-keybindings.ts        # central key dispatcher
│   └── lib/
│       ├── jsonl.ts                  # streaming line parser
│       ├── decode-project-path.ts
│       ├── relative-time.ts
│       ├── markdown-ansi.ts
│       └── truncate.ts               # string-width-aware truncation
└── tests/
    ├── lib/
    │   ├── decode-project-path.test.ts
    │   ├── relative-time.test.ts
    │   └── jsonl.test.ts
    ├── providers/
    │   └── claude-code.test.ts       # uses fixture .jsonl files
    ├── components/
    │   ├── session-list.test.tsx
    │   └── session-preview.test.tsx
    └── fixtures/
        └── claude-code/              # small captured .jsonl files
```

## Testing strategy

- **Pure libs** (`decode-project-path`, `relative-time`, `jsonl`, `truncate`):
  unit tests exhaustive on edge cases (empty paths, CJK, DST boundaries,
  malformed lines).
- **Provider** (`claude-code`): fixture-based — a few real, small `.jsonl`
  files captured into `tests/fixtures/claude-code/` covering: a session with a
  summary line, one without, one with tool calls, one malformed.
- **Components**: `ink-testing-library` for snapshot + key-event tests on
  `session-list`, `session-preview`, and `path-input`. Focus particularly on
  keybinding behavior and focus transitions.

## Open questions / future work

- Provider selection UI (toggle Claude Code ↔ Codex ↔ Gemini CLI) — deferred
  until a second provider is implemented.
- Export / copy a session to clipboard — defer.
- Filtering by project path — deferred; current `/` search hits both summary
  and project path so this is partially covered.
- Pin / favorite sessions — defer.
