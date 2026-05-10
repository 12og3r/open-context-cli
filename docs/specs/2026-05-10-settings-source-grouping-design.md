# Settings Panel: Per-Source Grouping & Detection Badge

**Date:** 2026-05-10
**Status:** Approved for implementation planning

## Problem

The settings panel currently exposes four independent rows for the
two session sources (Claude Code, Codex):

1. `Claude Code sessions directory` (path input)
2. `Codex sessions directory` (path input)
3. `Show Claude Code sessions` (On / Off)
4. `Show Codex sessions` (On / Off)

Two issues with this layout:

- **No detection badge for Codex.** A `● Sessions found` /
  `No valid session found` badge is rendered next to the Claude path
  row only. The badge is also driven by a single global
  `sessionStatus` (ok if any enabled source produced sessions), so a
  misconfigured Codex path goes unnoticed when Claude is healthy.
- **Show/hide toggles are visually divorced from the source they
  govern.** The toggle for "show Codex sessions" sits two rows below
  the Codex path field. Users naturally expect the toggle and the
  path to belong to the same conceptual block.

## Goal

Group the four rows into **two per-source compound fields**, each
containing the path input *and* a right-aligned `On / Off` toggle.
Replace the global session status with a **per-source detection
badge** on each compound field.

## Visual Design

```
↑↓ field · ←→ move cursor · ⇥ next sub-field · space to apply · esc back

› Claude Code sessions                       [● On]  ○ Off
    ● Sessions found · Default: ~/.claude/projects
    ▍ /Users/roger/.claude/projects
    [↺ Restore default]
    Leave empty to use the default.

  Codex sessions                             ● On  [○ Off]
    — Hidden · Default: ~/.codex/sessions
    ▍ (using default)
    [↺ Restore default]
    Where Codex CLI writes rollout-*.jsonl files.

  Display mode
    [● Concise]  ○ Full
    Show only user and assistant messages.

  …
```

The remaining fields (`displayMode`, `showHash`, `language`,
`continueLaunchMode`) keep their current rendering. The total field
count drops from eight to six.

### Status badge — three states

Per source, derived from app state:

| Toggle | Sessions | Badge                              | i18n key                              | Color |
| ------ | -------- | ---------------------------------- | ------------------------------------- | ----- |
| On     | ≥ 1      | `● Sessions found`                 | `settings.session_status.ok` (existing) | green |
| On     | 0        | `● No valid session found`         | `settings.session_status.missing` (existing) | red   |
| Off    | —        | `— Hidden`                         | `settings.session_status.hidden` (new) | dim   |

The badge text is followed by ` · Default: <path>` on the same line,
which carries the default-directory hint formerly rendered on its
own line.

### Toggle rendering

`[● On]  ○ Off` — same `●/○` glyph and `[ ]` cursor brackets used
elsewhere in the panel for two-option fields, just placed inline at
the right edge of the title row instead of on its own row below.

## Field Model

`FieldDef` gains a new variant `kind: "source"`:

```ts
type SourceFieldDef = {
  kind: "source";
  source: Source;                 // "claude-code" | "codex"
  pathKey: PathSettingsKey;       // "sessionsDir" | "codexSessionsDir"
  toggleKey: ShowSourceKey;       // "showClaudeCode" | "showCodex"
  title: string;
  description: string;
  defaultPath: string;
  defaultLabel: string;
  restoreLabel: string;
  placeholder: string;
};

type FieldDef = OptionsFieldDef | SourceFieldDef;
```

`buildFields()` produces:

1. `kind: "source"` — Claude Code
2. `kind: "source"` — Codex
3. `kind: "options"` — `displayMode`
4. `kind: "options"` — `showHash`
5. `kind: "options"` — `language`
6. `kind: "options"` — `continueLaunchMode`

The standalone `kind: "path"` variant is removed; the standalone
`showClaudeCode` / `showCodex` options entries are removed.

## Sub-Cursor Model

Source fields carry a sub-cursor:

```ts
type SourceSubCursor = "input" | "restore" | "toggle";
```

- **Default on field entry:** `"input"` (preserves the
  type-immediately experience of the current path field).
- **Tab cycle:** `input → restore → toggle → input` (forward only;
  Shift-Tab not handled — matches existing behavior).
- **`input` mode:** ↑↓ navigates between fields; all other keys
  delegate to `ink-text-input` via the `focus` prop.
- **`restore` mode:** Space/Enter clears the path draft and applied
  setting; ←/→ jumps back to `input`.
- **`toggle` mode:** ←/→ moves the option cursor between On/Off;
  Space/Enter applies the cursor to the `toggleKey` setting; ↑↓
  navigates fields.

The existing `optionCursor` map already keys by setting key, so it
naturally accommodates the toggle cursor when keyed by `toggleKey`.

## App State Changes

`app.tsx` replaces `sessionStatus: SessionStatus` with
per-source status:

```ts
type SourceStatus = "ok" | "missing" | "hidden";
type SessionStatusBySource = Record<Source, SourceStatus>;
```

Derivation, after each scan completes:

```ts
function deriveStatus(
  enabled: Enabled,
  sessions: SessionMeta[],
): SessionStatusBySource {
  const out = {} as SessionStatusBySource;
  for (const s of ALL_SOURCES) {
    if (!enabled[s]) { out[s] = "hidden"; continue; }
    const count = sessions.filter(m => m.source === s).length;
    out[s] = count > 0 ? "ok" : "missing";
  }
  return out;
}
```

- The status is recomputed in the same places the old
  `sessionStatus` was set: after the initial scan, after a scan
  error (all enabled sources → `"missing"`), and after
  `onSessionRemoved`.
- A disabled source contributes `"hidden"` regardless of what's on
  disk — when the source is off we don't scan it, so we have no
  count to report. Toggling it on triggers a fresh scan via the
  existing `enabled`-changed effect, which then surfaces the real
  status.

The "any source healthy → don't auto-open settings" check in
`SessionBrowser` (currently `sessionStatus === "missing"`) becomes
"every enabled source is missing" — i.e., open settings only when
no enabled source has sessions. Pure cosmetic re-derivation; same
boolean as before.

## Behavior When a Source Is Off

- Path input remains editable. Users may pre-configure a path
  before enabling the source.
- Restore button still works.
- Status badge shows `— Hidden`. No scan is performed, no count is
  shown.

## Out of Scope

- Showing session counts (`● 12 sessions found`). Possible later
  refinement; not part of this change.
- Disabling/dimming the path input when the source is off.
- Reordering the remaining (non-source) fields.
- Adding shift-Tab to walk sub-cursors backward.

## Test Plan

Existing tests touched:

- `tests/lib/settings.test.ts` — no schema change, but the helper
  `enabledSourcesFromSettings` keeps its current shape.
- Any settings-panel rendering tests — none currently exist for
  this panel; manual verification only.

New verification (manual, via `bun run dev`):

1. With both sources enabled and valid paths: each source row shows
   green `● Sessions found`.
2. Toggle Codex off: Codex row shows dim `— Hidden`; list filters
   to Claude only.
3. Set Codex path to a non-existent directory, toggle on: Codex
   row shows red `● No valid session found`.
4. Tab cycles `input → restore → toggle → input` on each source row.
5. ←/→ on toggle moves cursor; Space applies; persisted to
   `~/.openctx/settings.json`.
6. Restore button still clears path draft and applied setting
   (regression check).
7. Closing and reopening the panel re-anchors the toggle cursor on
   the currently-applied On/Off value.

## Files Affected

- `src/components/settings-panel.tsx` — field-model refactor,
  source-field renderer, sub-cursor expansion.
- `src/app.tsx` — `SessionStatus` → `SessionStatusBySource`;
  derivation helper; pass-through to `SessionBrowser`.
- `src/components/session-browser.tsx` — propagate per-source
  status; update the "open settings on missing" gate.
- `src/lib/i18n.ts` — add `settings.session_status.hidden` (en + zh);
  update the `settings.help` value to mention `⇥ next sub-field`
  (key name unchanged).
- No changes to `src/lib/settings.ts` (schema unchanged).
