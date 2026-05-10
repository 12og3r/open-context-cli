# Settings Source-Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the two source paths and their show/hide toggles into per-source compound fields, with a per-source detection badge replacing the global `sessionStatus`.

**Architecture:** Introduce a new `kind: "source"` variant in the SettingsPanel field model that bundles `{pathKey, toggleKey}`; thread per-source status as `Record<Source, "ok"|"missing"|"hidden">` from `app.tsx` through `SessionBrowser` to `SettingsPanel`; add a `"toggle"` sub-cursor with Tab cycling `input → restore → toggle → input`.

**Tech Stack:** React + Ink 5 (TUI), TypeScript, Bun test runner, ink-testing-library, ink-text-input.

**Spec:** `docs/specs/2026-05-10-settings-source-grouping-design.md`

---

## File Structure

| File | Role | Change |
| --- | --- | --- |
| `src/lib/i18n.ts` | i18n dictionaries | Add `settings.session_status.hidden` (en + zh); update `settings.help` value |
| `src/lib/session-status.ts` | **(new)** pure helper | `SourceStatus`, `SessionStatusBySource`, `deriveSessionStatusBySource()` |
| `src/app.tsx` | Top-level state owner | Replace `SessionStatus` field on `AppState` with `SessionStatusBySource`; use the new derivation helper |
| `src/components/session-browser.tsx` | Layout shell | Rename incoming prop to `sessionStatusBySource`; update auto-open-settings gate; pass new prop to `SettingsPanel` |
| `src/components/settings-panel.tsx` | The panel itself | New `kind: "source"` field; `SourceRow` renderer; expand sub-cursor to include `"toggle"`; remove `kind: "path"` and standalone `showClaudeCode`/`showCodex` options |
| `tests/lib/session-status.test.ts` | **(new)** | Unit tests for `deriveSessionStatusBySource` |
| `tests/components/settings-panel.test.tsx` | **(new)** | Render tests for source rows: badge per state, toggle cursor placement |

`src/lib/settings.ts` is **not** changed — the persisted settings schema is unchanged (we only restructure how those four existing keys are presented).

---

## Task 1: i18n keys + help line

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add `settings.session_status.hidden` to the English dictionary**

Open `src/lib/i18n.ts`. Locate the English block, line ~70 where `"settings.session_status.missing"` is defined, and append a `hidden` entry beneath it:

```ts
"settings.session_status.ok": "Sessions found",
"settings.session_status.missing": "No valid session found",
"settings.session_status.hidden": "Hidden",
```

- [ ] **Step 2: Add the same key to the Chinese dictionary**

Locate the Chinese block (`zh:`) — search for `"settings.session_status.ok": "已找到会话",` (currently line ~186). Add the hidden entry right below `.missing`:

```ts
"settings.session_status.ok": "已找到会话",
"settings.session_status.missing": "当前找不到有效的 session",
"settings.session_status.hidden": "已隐藏",
```

- [ ] **Step 3: Update the `settings.help` value to mention Tab**

In the English block, replace:

```ts
"settings.help": "↑↓ field · ←→ move cursor · space to apply · ⏎ confirm · esc back",
```

with:

```ts
"settings.help": "↑↓ field · ←→ move cursor · ⇥ next sub-field · space to apply · esc back",
```

In the Chinese block, replace:

```ts
"settings.help": "↑↓ 字段 · ←→ 移动光标 · 空格 切换 · ⏎ 确认 · esc 返回",
```

with:

```ts
"settings.help": "↑↓ 字段 · ←→ 移动光标 · ⇥ 子字段 · 空格 切换 · esc 返回",
```

- [ ] **Step 4: Verify typecheck still passes**

Run: `bun run typecheck`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "i18n: add session_status.hidden, mention Tab sub-field nav"
```

---

## Task 2: Per-source status derivation helper (TDD)

**Files:**
- Create: `src/lib/session-status.ts`
- Create: `tests/lib/session-status.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/lib/session-status.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { deriveSessionStatusBySource } from "../../src/lib/session-status.ts";
import type { SessionMeta } from "../../src/providers/types.ts";

const NOW = new Date("2026-05-10T12:00:00Z");

function meta(id: string, source: "claude-code" | "codex"): SessionMeta {
  return {
    id,
    filePath: `/${id}.jsonl`,
    summary: id,
    projectPath: "/p",
    modifiedAt: NOW,
    messageCount: 1,
    source,
  };
}

describe("deriveSessionStatusBySource", () => {
  test("both sources enabled with sessions → both ok", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true },
      [meta("a", "claude-code"), meta("b", "codex")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "ok" });
  });

  test("both enabled but only claude has sessions → codex missing", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true },
      [meta("a", "claude-code")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "missing" });
  });

  test("disabled source is hidden regardless of sessions", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": false },
      [meta("a", "claude-code"), meta("b", "codex")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "hidden" });
  });

  test("all disabled → all hidden", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": false, "codex": false },
      [],
    );
    expect(status).toEqual({ "claude-code": "hidden", "codex": "hidden" });
  });

  test("all enabled, no sessions → all missing", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true },
      [],
    );
    expect(status).toEqual({ "claude-code": "missing", "codex": "missing" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/lib/session-status.test.ts`

Expected: FAIL — module `../../src/lib/session-status.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/session-status.ts`:

```ts
import { ALL_SOURCES } from "../providers/index.ts";
import type { SessionMeta, Source } from "../providers/types.ts";

export type SourceStatus = "ok" | "missing" | "hidden";
export type SessionStatusBySource = Record<Source, SourceStatus>;

/**
 * Compute per-source status from the merged sessions list and the
 * `enabled` map. A disabled source is always "hidden" — we don't scan
 * disabled sources, so we have nothing to count for them.
 */
export function deriveSessionStatusBySource(
  enabled: Record<Source, boolean>,
  sessions: readonly SessionMeta[],
): SessionStatusBySource {
  const out = {} as SessionStatusBySource;
  for (const s of ALL_SOURCES) {
    if (!enabled[s]) {
      out[s] = "hidden";
      continue;
    }
    const count = sessions.filter(m => m.source === s).length;
    out[s] = count > 0 ? "ok" : "missing";
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/lib/session-status.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Run the full test suite to make sure nothing else broke**

Run: `bun test && bun run typecheck`

Expected: all tests pass; no typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/session-status.ts tests/lib/session-status.test.ts
git commit -m "Add deriveSessionStatusBySource helper with unit tests"
```

---

## Task 3: Thread per-source status through props (transitional)

This is a plumbing task. After it lands, the panel still renders the old layout (Claude path field shows the badge, Codex doesn't, show/hide toggles are still separate rows) — but everything is reading from the new per-source map. Task 4 reworks the renderer.

**Files:**
- Modify: `src/app.tsx`
- Modify: `src/components/session-browser.tsx`
- Modify: `src/components/settings-panel.tsx`

- [ ] **Step 1: Replace `SessionStatus` on `AppState` with the new map**

In `src/app.tsx`:

Remove the line:

```ts
export type SessionStatus = "ok" | "missing";
```

Add imports near the top of the file (next to the existing `enabledSourcesFromSettings` import):

```ts
import {
  deriveSessionStatusBySource,
  type SessionStatusBySource,
} from "./lib/session-status.ts";
```

In the `AppState` `browser` variant, replace:

```ts
sessionStatus: SessionStatus;
```

with:

```ts
sessionStatusBySource: SessionStatusBySource;
```

- [ ] **Step 2: Update the three places that produce or consume the field in `app.tsx`**

After the successful scan (around line 95–101), replace:

```ts
setState({
  kind: "browser",
  roots: state.roots,
  enabled: state.enabled,
  sessions,
  sessionStatus: sessions.length === 0 ? "missing" : "ok",
});
```

with:

```ts
setState({
  kind: "browser",
  roots: state.roots,
  enabled: state.enabled,
  sessions,
  sessionStatusBySource: deriveSessionStatusBySource(state.enabled, sessions),
});
```

After the scan-error catch (around line 104–110), replace:

```ts
setState({
  kind: "browser",
  roots: state.roots,
  enabled: state.enabled,
  sessions: [],
  sessionStatus: "missing",
});
```

with:

```ts
setState({
  kind: "browser",
  roots: state.roots,
  enabled: state.enabled,
  sessions: [],
  sessionStatusBySource: deriveSessionStatusBySource(state.enabled, []),
});
```

In the `onSessionRemoved` block (around line 142–150), replace:

```ts
setState(prev => {
  if (prev.kind !== "browser") return prev;
  const next = prev.sessions.filter(s => s.id !== id);
  return {
    ...prev,
    sessions: next,
    sessionStatus: next.length === 0 ? "missing" : "ok",
  };
});
```

with:

```ts
setState(prev => {
  if (prev.kind !== "browser") return prev;
  const next = prev.sessions.filter(s => s.id !== id);
  return {
    ...prev,
    sessions: next,
    sessionStatusBySource: deriveSessionStatusBySource(prev.enabled, next),
  };
});
```

In the `<SessionBrowser>` JSX (around line 134), replace:

```tsx
sessionStatus={state.sessionStatus}
```

with:

```tsx
sessionStatusBySource={state.sessionStatusBySource}
```

- [ ] **Step 3: Update `SessionBrowser`'s prop signature and gate**

In `src/components/session-browser.tsx`:

Replace the import:

```ts
import type { SessionStatus } from "../app.tsx";
```

with:

```ts
import type { SessionStatusBySource } from "../lib/session-status.ts";
```

In the prop list (around line 33–44), rename the prop:

```ts
sessionStatusBySource,
```

and in the type definition (around line 44):

```ts
sessionStatusBySource: SessionStatusBySource;
```

Replace the two auto-open-settings gates (around lines 73 and 76). Above them, derive a single boolean:

```ts
const noSourceOk = !Object.values(sessionStatusBySource).some(s => s === "ok");

const [focus, setFocus] = useState<Focus>(
  noSourceOk ? "settings" : "list",
);
const [rightView, setRightView] = useState<RightView>(
  noSourceOk ? "settings" : "preview",
);
```

In the `<SettingsPanel>` JSX (around line 314), replace:

```tsx
sessionStatus={sessionStatus}
```

with:

```tsx
sessionStatusBySource={sessionStatusBySource}
```

- [ ] **Step 4: Update `SettingsPanel` to consume the new prop (renderer change deferred to Task 4)**

In `src/components/settings-panel.tsx`:

Replace the import:

```ts
import type { SessionStatus } from "../app.tsx";
```

with:

```ts
import type { SessionStatusBySource } from "../lib/session-status.ts";
```

In the props (around line 199 and 208), rename:

```ts
sessionStatusBySource,
```

and in the type:

```ts
sessionStatusBySource: SessionStatusBySource;
```

Inside the `FIELDS.map(...)` body (around line 364), replace:

```ts
const statusColor = sessionStatus === "ok" ? OK : DANGER;
const statusKey =
  sessionStatus === "ok"
    ? "settings.session_status.ok"
    : "settings.session_status.missing";
```

with the per-source equivalent (still attached only to the Claude path field via `showStatus`, since Task 4 reworks the layout):

```ts
const claudeStatus = sessionStatusBySource["claude-code"];
const statusColor = claudeStatus === "ok" ? OK : DANGER;
const statusKey =
  claudeStatus === "ok"
    ? "settings.session_status.ok"
    : "settings.session_status.missing";
```

(Note: this is intentionally still single-source — Task 4 redoes the badge per-source.)

- [ ] **Step 5: Run typecheck and tests**

Run: `bun run typecheck && bun test`

Expected: no errors; all existing tests still pass.

- [ ] **Step 6: Smoke test in the dev runner**

Run: `bun run dev` in a separate terminal. Open the settings panel (right pane → settings). Confirm the Claude path row still shows the green/red badge as before. Quit with `q`.

- [ ] **Step 7: Commit**

```bash
git add src/app.tsx src/components/session-browser.tsx src/components/settings-panel.tsx
git commit -m "Thread per-source session status through panel props"
```

---

## Task 4: SettingsPanel source-row refactor

The substantive UI change. Combine the two path fields and their corresponding show/hide toggles into two compound `kind: "source"` fields, with a right-aligned toggle and a per-source detection badge merged into the Default line.

**Files:**
- Modify: `src/components/settings-panel.tsx`
- Create: `tests/components/settings-panel.test.tsx`

- [ ] **Step 1: Write failing render tests**

Create `tests/components/settings-panel.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SettingsPanel } from "../../src/components/settings-panel.tsx";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.ts";

const PROPS = {
  onChange: () => {},
  focused: false,
  width: 80,
  height: 30,
  defaultClaudeDir: "/home/u/.claude/projects",
  defaultCodexDir: "/home/u/.codex/sessions",
};

describe("SettingsPanel source rows", () => {
  test("Claude row shows green badge when status is ok", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "missing" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Claude Code sessions");
    expect(out).toContain("Sessions found");
    expect(out).toContain("Default: /home/u/.claude/projects");
  });

  test("Codex row shows red badge when status is missing", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "missing" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Codex sessions");
    expect(out).toContain("No valid session found");
  });

  test("source row shows Hidden badge when toggle is off", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={{ ...DEFAULT_SETTINGS, showCodex: false }}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "hidden" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Hidden");
  });

  test("toggle renders inline on the source title line", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");

    // The Claude row's title line must carry the toggle's On/Off labels,
    // not relegate them to a separate row below the title.
    const claudeTitleLine = lines.find(l => l.includes("Claude Code sessions"));
    expect(claudeTitleLine).toBeDefined();
    expect(claudeTitleLine!).toContain("On");
    expect(claudeTitleLine!).toContain("Off");

    const codexTitleLine = lines.find(l => l.includes("Codex sessions"));
    expect(codexTitleLine).toBeDefined();
    expect(codexTitleLine!).toContain("On");
    expect(codexTitleLine!).toContain("Off");
  });

  test("standalone show-source rows are gone", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    // Old standalone titles must NOT appear.
    expect(out).not.toContain("Show Claude Code sessions");
    expect(out).not.toContain("Show Codex sessions");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/components/settings-panel.test.tsx`

Expected: FAIL — at least the "Hidden" test, the "standalone rows are gone" test, and possibly the badge tests fail because the panel currently only badges the first path field (and only as ok/missing, not hidden).

- [ ] **Step 3: Refactor field types in `src/components/settings-panel.tsx`**

Replace the `PathSettingsKey` block (lines 13–19):

```ts
type PathSettingsKey = "sessionsDir" | "codexSessionsDir";
const PATH_SETTING_KEYS: readonly PathSettingsKey[] = [
  "sessionsDir",
  "codexSessionsDir",
] as const;
```

with:

```ts
type PathSettingsKey = "sessionsDir" | "codexSessionsDir";
type ShowSourceKey = "showClaudeCode" | "showCodex";
const PATH_SETTING_KEYS: readonly PathSettingsKey[] = [
  "sessionsDir",
  "codexSessionsDir",
] as const;
```

Replace the `OptionsFieldDef` block (lines 21–28):

```ts
type OptionsFieldDef = {
  [K in Exclude<keyof Settings, PathSettingsKey>]: {
    kind: "options";
    key: K;
    title: string;
    options: Array<{ value: Settings[K]; label: string; description: string }>;
  };
}[Exclude<keyof Settings, PathSettingsKey>];
```

with a tighter exclusion (we also exclude the show-source keys from the options union, since they now live inside source fields):

```ts
type OptionsKeys = Exclude<keyof Settings, PathSettingsKey | ShowSourceKey>;
type OptionsFieldDef = {
  [K in OptionsKeys]: {
    kind: "options";
    key: K;
    title: string;
    options: Array<{ value: Settings[K]; label: string; description: string }>;
  };
}[OptionsKeys];
```

Replace the entire `PathFieldDef` block (lines 30–43) and the `FieldDef` union (line 45) with the new `SourceFieldDef`:

```ts
import type { Source } from "../providers/types.ts";

type SourceFieldDef = {
  kind: "source";
  source: Source;
  pathKey: PathSettingsKey;
  toggleKey: ShowSourceKey;
  title: string;
  description: string;
  defaultPath: string;
  defaultLabel: string;
  restoreLabel: string;
  placeholder: string;
};

type FieldDef = OptionsFieldDef | SourceFieldDef;
```

(The `Source` import goes near the existing imports at the top of the file. If a similar import already exists, reuse it.)

- [ ] **Step 4: Rewrite `buildFields()` to emit two source fields and drop the standalone show toggles**

Replace the entire body of `buildFields()` (lines 47–185). The new version:

```ts
function buildFields(
  lang: Lang,
  defaultClaudeDir: string,
  defaultCodexDir: string,
): FieldDef[] {
  return [
    {
      kind: "source",
      source: "claude-code",
      pathKey: "sessionsDir",
      toggleKey: "showClaudeCode",
      title: t(lang, "settings.sessions_dir.title"),
      description: t(lang, "settings.sessions_dir.description"),
      defaultPath: defaultClaudeDir,
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultClaudeDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
      placeholder: t(lang, "settings.sessions_dir.placeholder"),
    },
    {
      kind: "source",
      source: "codex",
      pathKey: "codexSessionsDir",
      toggleKey: "showCodex",
      title: t(lang, "settings.codex_sessions_dir.title"),
      description: t(lang, "settings.codex_sessions_dir.description"),
      defaultPath: defaultCodexDir,
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultCodexDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
      placeholder: t(lang, "settings.sessions_dir.placeholder"),
    },
    {
      kind: "options",
      key: "displayMode",
      title: t(lang, "settings.display_mode.title"),
      options: [
        {
          value: "concise",
          label: t(lang, "settings.display_mode.concise"),
          description: t(lang, "settings.display_mode.concise_desc"),
        },
        {
          value: "full",
          label: t(lang, "settings.display_mode.full"),
          description: t(lang, "settings.display_mode.full_desc"),
        },
      ],
    },
    {
      kind: "options",
      key: "showHash",
      title: t(lang, "settings.show_hash.title"),
      options: [
        {
          value: true,
          label: t(lang, "settings.show_hash.on"),
          description: t(lang, "settings.show_hash.on_desc"),
        },
        {
          value: false,
          label: t(lang, "settings.show_hash.off"),
          description: t(lang, "settings.show_hash.off_desc"),
        },
      ],
    },
    {
      kind: "options",
      key: "language",
      title: t(lang, "settings.language.title"),
      options: [
        {
          value: "en",
          label: t(lang, "settings.language.en"),
          description: t(lang, "settings.language.en_desc"),
        },
        {
          value: "zh",
          label: t(lang, "settings.language.zh"),
          description: t(lang, "settings.language.zh_desc"),
        },
      ],
    },
    {
      kind: "options",
      key: "continueLaunchMode",
      title: t(lang, "settings.launch_mode.title"),
      options: [
        {
          value: "reuse-current",
          label: t(lang, "settings.launch_mode.option_reuse"),
          description: t(lang, "settings.launch_mode.option_reuse_desc"),
        },
        {
          value: "new-window",
          label: t(lang, "settings.launch_mode.option_new_window") +
            (process.platform === "darwin"
              ? ""
              : ` (${t(lang, "settings.launch_mode.unsupported_note")})`),
          description: t(lang, "settings.launch_mode.option_new_window_desc"),
        },
      ],
    },
  ];
}
```

- [ ] **Step 5: Rename `PathSubCursor` to `SourceSubCursor` and add the `"toggle"` state**

Replace (around line 187):

```ts
type PathSubCursor = "input" | "restore";
```

with:

```ts
type SourceSubCursor = "input" | "restore" | "toggle";
```

Then rename every reference to `PathSubCursor` in the file to `SourceSubCursor` (there are about 3: the type alias declaration, the `useState<PathSubCursor>("input")` call, and the `PathRow` props type). Likewise rename `pathSubCursor` → `sourceSubCursor` (state variable + setter + every read site). Use a single multi-line edit per location to avoid drift.

(`PATH_SETTING_KEYS` and `PathSettingsKey` keep their names — they refer to setting keys, not sub-cursor.)

- [ ] **Step 6: Update the `useInput` handler for the new sub-cursor model**

Replace the `useInput((input, key) => { ... })` block (around lines 285–337) with:

```ts
useInput((input, key) => {
  if (!focused) return;

  // While the path input has focus, only handle field navigation + Tab.
  // Everything else (typing, ←/→ within text) is delegated to
  // ink-text-input via its `focus` prop.
  if (field.kind === "source" && sourceSubCursor === "input") {
    if (key.upArrow) {
      setFieldIdx(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFieldIdx(i => Math.min(FIELDS.length - 1, i + 1));
    } else if (key.tab) {
      setSourceSubCursor("restore");
    }
    return;
  }

  if (key.upArrow || input === "k") {
    setFieldIdx(i => Math.max(0, i - 1));
    return;
  }
  if (key.downArrow || input === "j") {
    setFieldIdx(i => Math.min(FIELDS.length - 1, i + 1));
    return;
  }

  if (field.kind === "source" && key.tab) {
    // input → restore → toggle → input
    setSourceSubCursor(c =>
      c === "restore" ? "toggle" : c === "toggle" ? "input" : "restore",
    );
    return;
  }
  if (field.kind === "options" && key.tab) {
    // No sub-cursor for options fields; ignore.
    return;
  }

  if (field.kind === "options") {
    if (key.leftArrow || input === "h") {
      moveCursor(field, -1);
    } else if (key.rightArrow || input === "l") {
      moveCursor(field, +1);
    } else if (input === " " || key.return) {
      applyCursor(field);
    }
    return;
  }

  // field.kind === "source"
  if (sourceSubCursor === "restore") {
    if (input === " " || key.return) {
      // Restore default: clear both the draft and the applied setting so
      // the change takes effect immediately, and drop focus back into the
      // input for the next edit.
      setPathDrafts(prev => ({ ...prev, [field.pathKey]: "" }));
      if (settings[field.pathKey] !== "") onChange(field.pathKey, "");
      setSourceSubCursor("input");
    } else if (key.leftArrow || input === "h" || key.rightArrow || input === "l") {
      setSourceSubCursor("input");
    }
    return;
  }

  // sourceSubCursor === "toggle"
  if (key.leftArrow || input === "h") {
    moveToggleCursor(field, -1);
  } else if (key.rightArrow || input === "l") {
    moveToggleCursor(field, +1);
  } else if (input === " " || key.return) {
    applyToggleCursor(field);
  }
});
```

Below the existing `moveCursor` / `applyCursor` helpers (around lines 339–354), add the toggle equivalents:

```ts
function moveToggleCursor(f: SourceFieldDef, dir: 1 | -1) {
  setOptionCursor(prev => {
    const cur = prev[f.toggleKey] ?? 0;
    return { ...prev, [f.toggleKey]: (cur + dir + 2) % 2 };
  });
}

function applyToggleCursor(f: SourceFieldDef) {
  const idx = optionCursor[f.toggleKey] ?? 0;
  // Index 0 is "On" (true), index 1 is "Off" (false).
  const next = idx === 0;
  (onChange as (k: string, v: unknown) => void)(f.toggleKey, next);
}
```

- [ ] **Step 7: Update `initialCursor` to seed the toggle cursor too**

Replace `initialCursor` (around lines 518–526):

```ts
function initialCursor(fields: FieldDef[], settings: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (f.kind !== "options") continue;
    const i = f.options.findIndex(o => o.value === settings[f.key]);
    out[f.key] = i >= 0 ? i : 0;
  }
  return out;
}
```

with:

```ts
function initialCursor(fields: FieldDef[], settings: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (f.kind === "options") {
      const i = f.options.findIndex(o => o.value === settings[f.key]);
      out[f.key] = i >= 0 ? i : 0;
    } else if (f.kind === "source") {
      // Toggle cursor: 0 = On, 1 = Off.
      out[f.toggleKey] = settings[f.toggleKey] ? 0 : 1;
    }
  }
  return out;
}
```

- [ ] **Step 8: Replace the field renderer in the JSX**

In the `return (...)` body (around lines 356–405), replace the `FIELDS.map(...)` block with the new per-kind dispatch:

```tsx
return (
  <Box flexDirection="column" width={width} height={height}>
    <Box flexShrink={0} marginBottom={1}>
      <Text dimColor>{t(lang, "settings.help")}</Text>
    </Box>
    {FIELDS.map((f, i) => {
      const fieldSelected = i === fieldIdx;
      const fieldFocused = fieldSelected && focused;
      return (
        <Box key={fieldKey(f)} flexDirection="column" marginBottom={1}>
          {f.kind === "options" ? (
            <>
              <Box>
                <Text color={fieldFocused ? ACCENT : undefined} bold={fieldFocused}>
                  {fieldFocused ? "› " : "  "}{f.title}
                </Text>
              </Box>
              <OptionsRow
                field={f}
                applied={settings[f.key]}
                cursorIdx={optionCursor[f.key] ?? 0}
                fieldFocused={fieldFocused}
              />
            </>
          ) : (
            <SourceRow
              field={f}
              draft={pathDrafts[f.pathKey]}
              onDraftChange={(v) =>
                setPathDrafts(prev => ({ ...prev, [f.pathKey]: v }))
              }
              subCursor={sourceSubCursor}
              fieldFocused={fieldFocused}
              status={sessionStatusBySource[f.source]}
              toggleApplied={settings[f.toggleKey]}
              toggleCursorIdx={optionCursor[f.toggleKey] ?? 0}
              lang={lang}
              width={width}
            />
          )}
        </Box>
      );
    })}
  </Box>
);
```

Also add the helper just below the main component (or at the end of the file with the other helpers):

```ts
function fieldKey(f: FieldDef): string {
  return f.kind === "options" ? f.key : f.pathKey;
}
```

- [ ] **Step 9: Remove the obsolete `PathRow` component and add the new `SourceRow`**

Delete the entire `PathRow` function (around lines 441–481).

Add a new `SourceRow` component below `OptionsRow`:

```tsx
function SourceRow({
  field,
  draft,
  onDraftChange,
  subCursor,
  fieldFocused,
  status,
  toggleApplied,
  toggleCursorIdx,
  lang,
  width,
}: {
  field: SourceFieldDef;
  draft: string;
  onDraftChange: (v: string) => void;
  subCursor: SourceSubCursor;
  fieldFocused: boolean;
  status: SourceStatus;
  toggleApplied: boolean;
  toggleCursorIdx: number;
  lang: Lang;
  width: number;
}) {
  const inputFocused = fieldFocused && subCursor === "input";
  const restoreFocused = fieldFocused && subCursor === "restore";
  const toggleFocused = fieldFocused && subCursor === "toggle";

  // Title row: title left, toggle chip right.
  // We don't have full flex justifyContent in older Ink versions for inline
  // text, so we emit two child <Box>es and let Ink's row layout space them.
  return (
    <>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Box>
          <Text color={fieldFocused ? ACCENT : undefined} bold={fieldFocused}>
            {fieldFocused ? "› " : "  "}{field.title}
          </Text>
        </Box>
        <Box>
          <Toggle
            applied={toggleApplied}
            cursorIdx={toggleCursorIdx}
            focused={toggleFocused}
            lang={lang}
          />
        </Box>
      </Box>
      <Box marginLeft={2}>
        <StatusBadge status={status} lang={lang} />
        <Text dimColor>{" · "}</Text>
        <Text dimColor>{field.defaultLabel}</Text>
      </Box>
      <Box marginLeft={2} flexDirection="row">
        <Text color={inputFocused ? ACCENT : undefined}>{inputFocused ? "▍ " : "  "}</Text>
        {draft.length === 0 && !inputFocused ? (
          <Text dimColor>{field.placeholder}</Text>
        ) : (
          <TextInput
            value={draft}
            onChange={onDraftChange}
            focus={inputFocused}
          />
        )}
      </Box>
      <Box marginLeft={2}>
        <RestoreButton label={field.restoreLabel} cursor={restoreFocused} />
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{field.description}</Text>
      </Box>
    </>
  );
}

function Toggle({
  applied,
  cursorIdx,
  focused,
  lang,
}: {
  applied: boolean;
  cursorIdx: number;
  focused: boolean;
  lang: Lang;
}) {
  const onLabel = t(lang, "settings.show_source.on");
  const offLabel = t(lang, "settings.show_source.off");
  const onCursor = focused && cursorIdx === 0;
  const offCursor = focused && cursorIdx === 1;
  return (
    <>
      <Option label={onLabel} applied={applied === true} cursor={onCursor} />
      <Box marginLeft={2}>
        <Option label={offLabel} applied={applied === false} cursor={offCursor} />
      </Box>
    </>
  );
}

function StatusBadge({ status, lang }: { status: SourceStatus; lang: Lang }) {
  if (status === "hidden") {
    return (
      <Text>
        <Text dimColor>— </Text>
        <Text dimColor>{t(lang, "settings.session_status.hidden")}</Text>
      </Text>
    );
  }
  const color = status === "ok" ? OK : DANGER;
  const key =
    status === "ok"
      ? "settings.session_status.ok"
      : "settings.session_status.missing";
  return (
    <Text>
      <Text color={color} bold>● </Text>
      <Text color={color}>{t(lang, key)}</Text>
    </Text>
  );
}
```

Add `SourceStatus` to the existing `import type` line at the top of the file (next to `SessionStatusBySource`):

```ts
import type {
  SessionStatusBySource,
  SourceStatus,
} from "../lib/session-status.ts";
```

- [ ] **Step 10: Run the new and existing tests**

Run: `bun test`

Expected: all existing tests still pass; the 5 new `tests/components/settings-panel.test.tsx` tests pass.

If a test fails, examine `lastFrame()` output by adding a temporary `console.log(lastFrame())` to inspect what the panel actually renders. Common issues:
- The `›` arrow is only present when `focused` is true. The `focused` prop defaults to `false` in our test props, so titles render without the arrow. The "title contains" assertions don't depend on the arrow.
- Ink's `justifyContent="space-between"` requires the parent `<Box>` to have a fixed width — the test passes `width={80}`, which should suffice.

- [ ] **Step 11: Run typecheck**

Run: `bun run typecheck`

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/components/settings-panel.tsx tests/components/settings-panel.test.tsx
git commit -m "Group settings panel by source with inline toggle and per-source badge"
```

---

## Task 5: End-to-end manual verification

**Files:** none modified unless a regression is found.

The unit + render tests cover state-shape and per-status rendering, but the keyboard interaction is not covered automatically. This task walks the spec's seven manual-verification scenarios.

- [ ] **Step 1: Launch the dev runner**

Run: `bun run dev` in a terminal where settings live at `~/openctx/settings.json`.

- [ ] **Step 2: Scenario 1 — both sources enabled with valid paths**

Action: open settings (right pane → Settings).

Expected: Claude row shows green `● Sessions found · Default: <path>`. Codex row shows green `● Sessions found · Default: <path>`. Toggles both on the `[● On]` cursor.

- [ ] **Step 3: Scenario 2 — disable Codex via toggle**

Action: with the Codex row selected (↓ to navigate to it, then Tab twice to land on the toggle), press → to move cursor to Off, then Space to apply.

Expected: badge changes to dim `— Hidden`. Session list filters down to Claude only.

- [ ] **Step 4: Scenario 3 — Codex path misconfigured**

Action: re-enable Codex (Tab to toggle, ← to On, Space). Tab back to the input. Type a path that does not exist (e.g. `/tmp/no-codex-here`).

Expected: after the existing rescan debounce settles (panel reads from the new path on close), reopen the panel — Codex row shows red `● No valid session found`.

- [ ] **Step 5: Scenario 4 — Tab cycle on each source row**

Action: with focus on the Claude row, press Tab repeatedly.

Expected: cursor moves `input → restore button → toggle → input → ...`. The `▍` caret on the input row, the `[ ]` brackets around the restore button, and the toggle bracket should each highlight in turn.

- [ ] **Step 6: Scenario 5 — Toggle persistence**

Action: toggle a source off; quit the app with `q`.

Verify: `cat ~/openctx/settings.json` shows the corresponding `showCodex` (or `showClaudeCode`) is `false`. Re-launch `bun run dev`; the badge is `Hidden` from the start.

- [ ] **Step 7: Scenario 6 — Restore button still works**

Action: type a custom path into the Claude input; Tab to restore; Space.

Expected: input clears (placeholder `(using default)` reappears), and on close the saved `sessionsDir` becomes `""` again (`cat ~/openctx/settings.json`).

- [ ] **Step 8: Scenario 7 — Cursor re-anchors on reopen**

Action: with the Codex toggle on Off, close the panel and reopen it.

Expected: when navigating to the toggle sub-cursor, the brackets sit on `[○ Off]` (the applied value), not on `[● On]`.

- [ ] **Step 9: Run the full test suite + typecheck once more**

Run: `bun test && bun run typecheck`

Expected: all green.

- [ ] **Step 10: Commit if anything was tweaked during verification**

If you needed to fix something during manual verification, commit the fix:

```bash
git add <file(s)>
git commit -m "Fix <specific issue from verification>"
```

If nothing needed fixing, no commit is needed.

---

## Self-Review Notes

- **Spec coverage**
  - Visual design / Option C layout → Task 4 Step 9 (SourceRow renderer with right-aligned Toggle and merged status+Default line).
  - Status badge three states → Task 4 Step 9 (StatusBadge component handles ok/missing/hidden).
  - Field model `kind: "source"` → Task 4 Steps 3, 4, 8.
  - Sub-cursor `input → restore → toggle` cycle → Task 4 Steps 5, 6.
  - App state `SessionStatusBySource` → Task 2 (helper) + Task 3 (plumbing).
  - SessionBrowser auto-open gate → Task 3 Step 3.
  - i18n hidden key + help line update → Task 1.
  - Off-but-input-still-editable → preserved by SourceRow Step 9 (no `focus` gating on the `<TextInput>` beyond the existing `subCursor === "input"` rule); also covered by Scenario 6 in Task 5.
  - Out-of-scope items (counts, dimming input, Shift-Tab) → not in any task.

- **Type consistency**
  - `pathKey` / `toggleKey` / `source` fields on `SourceFieldDef` are referenced consistently in `useInput`, `moveToggleCursor`, `applyToggleCursor`, `initialCursor`, and the JSX renderer.
  - `SourceSubCursor` (renamed from `PathSubCursor`) is the only sub-cursor type after Task 4; Step 5 covers the rename.
  - `sessionStatusBySource` (named identically across `app.tsx`, `SessionBrowser`, `SettingsPanel`) — single name, no drift.

- **Placeholder scan**
  - No "TODO", "TBD", or "implement later" remain.
  - Each step shows the actual code or the actual command + expected output.
  - Test code is complete in Task 2 Step 1 and Task 4 Step 1.
