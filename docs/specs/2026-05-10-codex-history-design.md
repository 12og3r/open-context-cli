# Codex session history support

Date: 2026-05-10
Status: Proposed

## Summary

Add `~/.codex/sessions` as a second history source alongside Claude Code,
present both in one merged list with a per-row source chip, let the user
toggle each source on/off, and configure each source's directory
independently. The Continue-conversation flow is wired through to the
Codex CLI's native `resume`/`fork` subcommands.

## Why

`openctx` is a TUI for browsing local agent session history. The
codebase already exposes a `SessionProvider` seam with one
implementation (`claude-code`). Codex CLI writes JSONL transcripts in
the same spirit but with a different schema and directory layout. Users
who switch between the two CLIs want a single browser.

## Codex format (observed on this machine, codex 0.130.0)

- Path: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`.
- One JSON object per line, shape: `{ timestamp, type, payload }`.
- `type` values seen: `session_meta`, `event_msg`, `response_item`,
  `turn_context`, `compacted`.
- The first line is a `session_meta` with the session id, the cwd, the
  cli version, and the originator. Use this for the SessionMeta id and
  cwd; if absent, fall back to the filename UUID and `process.cwd()`.
- Real messages live on `response_item` lines where
  `payload.type === "message"`. Roles: `user`, `assistant`, `developer`
  (we map `developer` → `system`). Content is an array of parts, each
  with a `type` (e.g. `input_text`, `output_text`) and a `text` field.
- Tool calls appear as `response_item` lines with
  `payload.type === "function_call"` (call) /
  `"function_call_output"` (result), with `name` and `arguments` (or
  `output`) fields.
- Codex env honors `$CODEX_HOME` (analogous to Claude's
  `$CLAUDE_CONFIG_DIR`); when set, sessions live under
  `$CODEX_HOME/sessions`.

## Codex resume / fork CLI (codex 0.130.0)

- `codex resume [SESSION_ID] [PROMPT]`: resumes an existing session;
  optional prompt is sent as the next user turn.
- `codex fork [SESSION_ID] [PROMPT]`: forks a session into a new one
  starting from the *end* of the source; same prompt slot.
- **Both are whole-session operations.** Neither command takes a
  message UUID or "cut after this turn" flag. We can't replicate
  Claude's fork-at-cursor on the Codex side without writing into
  Codex's rollout format ourselves, which is brittle (it'd break on
  any schema bump).

We therefore implement Codex continue as **resume-with-prefill**:
launch `codex resume <session-id>` and, when the cursor is on a user
message, PTY-prefill that text via bracketed paste — the same
mechanism the Claude path already uses. The prefill semantics (edit
before send) are preserved; the only thing not preserved is the
cut-at-N truncation, which is a CLI-level limitation we document.

If Codex later grows a `--from-message <uuid>` flag or similar, we
swap `resume` for the more precise call without changing the rest of
the flow.

## Architecture

### SessionMeta gains a source tag

```ts
export type Source = "claude-code" | "codex";

export interface SessionMeta {
  // existing fields …
  source: Source;
}
```

Each provider stamps its own value. Code that needs to dispatch behind
the scenes (load detail, launch continue) reads `meta.source` and
looks up the right provider/launcher.

### CodexProvider

New file `src/providers/codex.ts` implementing `SessionProvider`:

- `name = "codex"`, `defaultPaths = [codexSessionsDir()]` (where
  `codexSessionsDir()` returns `${CODEX_HOME ?? ~/.codex}/sessions`).
- `listSessions(root)`: walks the YYYY/MM/DD tree, picks
  `rollout-*.jsonl`, reads the first `session_meta` line plus any
  early user/assistant turns to compute `summary` and `cwd`, returns
  one SessionMeta per file with `source: "codex"`. The session id is
  the UUID encoded in the filename / session_meta.
- `loadSession(file)`: streams JSONL, yields one Message per
  `response_item` message, plus tool_use/tool_result for the
  function_call shapes.

A small `src/lib/codex-paths.ts` mirrors `claude-paths.ts`.

### Aggregation

`src/providers/index.ts` registers both providers and gains:

```ts
export const ALL_SOURCES: readonly Source[] = ["claude-code", "codex"];

export function getProviderForSource(source: Source): SessionProvider;

export async function listAllSessions(opts: {
  enabled: Record<Source, boolean>;
  rootForSource: (s: Source) => string;
}): Promise<SessionMeta[]>;
```

`listAllSessions` calls every enabled provider's `listSessions` in
parallel, concatenates the results, and sorts by `modifiedAt` desc.
A failure in one provider doesn't kill the other — we surface the
failure as an empty result for that source plus an error reported up
the hook.

### App.tsx

The `provider` constant is replaced with a registry. `effectiveRoot`
splits into a per-source root. `useSessionDetail` resolves its
provider from `selected.source` (instead of taking a fixed provider
prop).

The scanning state stays a single state for the merged list — both
providers run concurrently inside `listAllSessions`, the merged
result drives the browser.

### Settings

`src/lib/settings.ts` gains:

```ts
export interface Settings {
  // existing fields …
  codexSessionsDir: string; // empty = default codex sessions dir
  enabledSources: Record<Source, boolean>; // default { "claude-code": true, codex: true }
}
```

`sessionsDir` keeps its current meaning (Claude Code dir) — no
rename, no migration needed; we just add a sibling field.

### Settings panel

After the existing "Sessions directory" path field, add:
1. A second path field "Codex sessions directory" with the same
   restore-default UX.
2. A multi-option field "Visible sources" with two on/off toggles
   (Claude Code, Codex), rendered like other options-kind fields but
   each toggle independent. To keep the existing field machinery
   simple, model this as **two separate options-kind fields** —
   "Show Claude Code" and "Show Codex" — each a boolean. Both default
   on.

When both sources are off, the list is empty and the settings panel
opens automatically (same path as the existing "no sessions found"
recovery — already handled by `sessionStatus === "missing"`).

### UI: source chip

- **Session list row.** Append `· [Claude Code]` / `· [Codex]` to the
  meta line under each summary. Dim color, same style as the rest of
  the meta string.
- **Continue-conversation footer label.** Append the same chip:
  ```
  ↪ Continue conversation [Codex]
  ↪ Continue conversation (force) [Claude Code]
  ```
- **i18n.** Add chip strings (`source.claude_code`, `source.codex`)
  to both `en` and `zh` tables.

### Continue conversation: launcher dispatch

`src/lib/continue-launch.ts` becomes a router that dispatches on
`source`. Two siblings:

- `continue-launch-claude.ts` — current behavior, lifted out of the
  current `executeContinue`.
- `continue-launch-codex.ts` — new. No JSONL fork: just calls the
  existing PTY runner (or new-window spawner) with `codex resume
  <session-id>` as the command, and the user-text prefill flowing
  through the same bracketed-paste path. New helpers receive a
  `command: string[]` so the PTY/new-window code stays generic.

`continue-pty.ts` and `continue-spawn.ts` are generalized to take a
`{ cwd, command, prefillText }` shape rather than the
Claude-specific `{ cwd, resumeId, prefillText }`.

### Pre-flight checks

The `onRequestContinue` callback in `session-browser.tsx` currently
probes `which claude`. Generalize: probe `which claude` for
claude-code sessions and `which codex` for codex sessions, with
matching error strings.

For Codex, skip the JSONL fork pre-flight (no fork happens). Skip
the cwd-existence check too — `codex resume` doesn't require the
original cwd to exist. (If the user's project dir is gone, Codex
itself handles the fallback.)

## Tests

- `tests/fixtures/codex/` with 3-4 sample rollout files: minimal
  user/assistant pair, a tool call, a malformed line.
- `tests/providers/codex.test.ts` mirroring
  `claude-code.test.ts`: lists sessions, loads messages,
  handles malformed lines, pulls cwd from session_meta.
- `tests/lib/settings.test.ts`: cover the new fields'
  load/save/sanitize.
- `tests/components/session-list.test.tsx`: assert the source chip
  renders for each source.

## Out of scope

- Per-message fork on Codex (waits on a `codex` CLI feature).
- Auto-detecting which dir is which when both are non-default (the
  user configures each independently).
- A "merge sessions across sources by cwd" view — out of scope; the
  flat list is the merge.

## Migration

None for existing users. The new settings keys default to "show
both, codex dir = default", which is what a fresh install would do.
Old settings files without the new keys load cleanly via the existing
`sanitize` flow.
