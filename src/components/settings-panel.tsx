import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Settings, DisplayMode } from "../lib/settings.ts";
import type {
  SessionStatusBySource,
  SourceStatus,
} from "../lib/session-status.ts";
import type { Source } from "../providers/types.ts";
import { t, type Lang } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

const ACCENT = "cyan";
const DANGER = "red";
const OK = "green";

// Setting keys that are edited via the path-input UX (text box + restore
// default button). Anything else is rendered as an options field.
type PathSettingsKey = "sessionsDir" | "codexSessionsDir" | "geminiSessionsDir";
type ShowSourceKey = "showClaudeCode" | "showCodex" | "showGemini";
const PATH_SETTING_KEYS: readonly PathSettingsKey[] = [
  "sessionsDir",
  "codexSessionsDir",
  "geminiSessionsDir",
] as const;

type OptionsKeys = Exclude<keyof Settings, PathSettingsKey | ShowSourceKey>;
type OptionsFieldDef = {
  [K in OptionsKeys]: {
    kind: "options";
    key: K;
    title: string;
    options: Array<{ value: Settings[K]; label: string; description: string }>;
  };
}[OptionsKeys];

type SourceFieldDef = {
  kind: "source";
  source: Source;
  pathKey: PathSettingsKey;
  toggleKey: ShowSourceKey;
  title: string;
  defaultLabel: string;
  restoreLabel: string;
};

type FieldDef = OptionsFieldDef | SourceFieldDef;

function buildFields(
  lang: Lang,
  defaultClaudeDir: string,
  defaultCodexDir: string,
  defaultGeminiDir: string,
): FieldDef[] {
  return [
    {
      kind: "source",
      source: "claude-code",
      pathKey: "sessionsDir",
      toggleKey: "showClaudeCode",
      title: t(lang, "settings.sessions_dir.title"),
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultClaudeDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
    },
    {
      kind: "source",
      source: "codex",
      pathKey: "codexSessionsDir",
      toggleKey: "showCodex",
      title: t(lang, "settings.codex_sessions_dir.title"),
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultCodexDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
    },
    {
      kind: "source",
      source: "gemini",
      pathKey: "geminiSessionsDir",
      toggleKey: "showGemini",
      title: t(lang, "settings.gemini_sessions_dir.title"),
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultGeminiDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
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

type SourceSubCursor = "input" | "restore" | "toggle";

type PathDrafts = Record<PathSettingsKey, string>;

export function SettingsPanel({
  settings,
  onChange,
  focused,
  width,
  height,
  defaultClaudeDir,
  defaultCodexDir,
  defaultGeminiDir,
  sessionStatusBySource,
}: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  focused: boolean;
  width: number;
  height: number;
  defaultClaudeDir: string;
  defaultCodexDir: string;
  defaultGeminiDir: string;
  sessionStatusBySource: SessionStatusBySource;
}) {
  const lang = useLang();
  const FIELDS = useMemo(
    () => buildFields(lang, defaultClaudeDir, defaultCodexDir, defaultGeminiDir),
    [lang, defaultClaudeDir, defaultCodexDir, defaultGeminiDir],
  );
  const [fieldIdx, setFieldIdx] = useState(0);
  // Per-field "option cursor" — independent of the applied value. Initialized
  // to the applied option when this panel first opens (or settings hydrate).
  // ←/→ moves this cursor; Space applies cursor → settings.
  const [optionCursor, setOptionCursor] = useState<Record<string, number>>(() =>
    initialCursor(FIELDS, settings),
  );

  // Sub-cursor for source-kind fields: which sub-element currently owns input.
  // Reset to "input" whenever any source field is (re)entered, so typing works
  // immediately without a Tab.
  const [sourceSubCursor, setSourceSubCursor] = useState<SourceSubCursor>("input");

  // Local drafts of each path setting. Decoupled from settings so we can
  // debounce the rescan in app.tsx — drafts commit to settings only when
  // the panel closes (Esc / Enter), via the unmount cleanup below.
  const [pathDrafts, setPathDrafts] = useState<PathDrafts>(() => ({
    sessionsDir: settings.sessionsDir,
    codexSessionsDir: settings.codexSessionsDir,
    geminiSessionsDir: settings.geminiSessionsDir,
  }));
  const pathDraftsRef = useRef(pathDrafts);
  useEffect(() => {
    pathDraftsRef.current = pathDrafts;
  }, [pathDrafts]);

  // When the panel becomes focused, re-anchor the cursor on each field to
  // whatever value is currently applied. That way leaving and re-entering
  // the panel doesn't leave a stale cursor on a value the user never
  // confirmed.
  useEffect(() => {
    if (focused) {
      setOptionCursor(initialCursor(FIELDS, settings));
      setPathDrafts({
        sessionsDir: settings.sessionsDir,
        codexSessionsDir: settings.codexSessionsDir,
        geminiSessionsDir: settings.geminiSessionsDir,
      });
      setSourceSubCursor("input");
    }
  }, [focused, settings, FIELDS]);

  // Commit any path drafts whose current value differs from settings on
  // unmount. The parent unmounts SettingsPanel synchronously when the user
  // closes the panel (rightView flips to "preview"), so the focused-prop
  // false transition never fires with the panel still mounted; using an
  // unmount cleanup makes the commit reliable regardless of how the panel
  // is closed.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => {
    return () => {
      const drafts = pathDraftsRef.current;
      const applied = settingsRef.current;
      for (const key of PATH_SETTING_KEYS) {
        if (drafts[key] !== applied[key]) {
          onChangeRef.current(key, drafts[key]);
        }
      }
    };
  }, []);

  // Pin the sub-cursor back to "input" when the user moves to a source field
  // from elsewhere (so the next keystroke types into the input box).
  useEffect(() => {
    setSourceSubCursor("input");
  }, [fieldIdx]);

  const field = FIELDS[fieldIdx]!;

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

  function moveCursor(f: OptionsFieldDef, dir: 1 | -1) {
    setOptionCursor(prev => {
      const len = f.options.length;
      const cur = prev[f.key] ?? 0;
      return { ...prev, [f.key]: (cur + dir + len) % len };
    });
  }

  function applyCursor(f: OptionsFieldDef) {
    const idx = optionCursor[f.key] ?? 0;
    const next = f.options[idx]!;
    // The OptionsFieldDef union ties f.key to the option's value type, but
    // TS can't see through the parametrized callback signature; the cast
    // below is safe because the runtime pair (key, value) always matches.
    (onChange as (k: string, v: unknown) => void)(f.key, next.value);
  }

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
}

function OptionsRow<F extends OptionsFieldDef>({
  field,
  applied,
  cursorIdx,
  fieldFocused,
}: {
  field: F;
  applied: F["options"][number]["value"];
  cursorIdx: number;
  fieldFocused: boolean;
}) {
  return (
    <>
      <Box marginLeft={2} flexDirection="row" flexWrap="wrap">
        {field.options.map((opt, oi) => {
          const isApplied = opt.value === applied;
          const isCursor = fieldFocused && oi === cursorIdx;
          return (
            <Box key={String(opt.value)} marginRight={oi < field.options.length - 1 ? 2 : 0}>
              <Option label={opt.label} applied={isApplied} cursor={isCursor} />
            </Box>
          );
        })}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>
          {field.options.find(o => o.value === applied)?.description ?? ""}
        </Text>
      </Box>
    </>
  );
}

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

  return (
    <>
      <Box flexDirection="row" justifyContent="space-between" width={width} flexShrink={0}>
        <Box>
          <Text color={fieldFocused ? ACCENT : undefined} bold={fieldFocused}>
            {fieldFocused ? "› " : "  "}{field.title}
            <Text>{"  "}</Text>
            <StatusBadge status={status} lang={lang} />
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
      <Box marginLeft={2} flexShrink={0}>
        <PathInput
          value={draft}
          onChange={onDraftChange}
          focus={inputFocused}
          placeholder={field.defaultLabel}
        />
      </Box>
      <Box marginLeft={2} flexShrink={0}>
        <RestoreButton label={field.restoreLabel} cursor={restoreFocused} />
      </Box>
      {/*
        Description line intentionally omitted on source fields. With six
        rows per source the panel overflows typical terminal heights and
        Ink starts squashing rows; the squashed row would land on top of
        the input caret, making it look unfocusable. The description
        ("Leave empty to use the default", "Where Codex CLI writes…") is
        non-essential context and the extra line isn't worth the layout
        instability.
      */}
    </>
  );
}

/**
 * Single-line text input with a thin `│` cursor that follows typing.
 *
 * We can't use ink-text-input here: its cursor is a `chalk.inverse`
 * block on the character at cursorOffset, which means typing "/" gets
 * rendered as an inverted "/", and the user can't see the character
 * the cursor is on. The user explicitly asked for a thin vertical-line
 * cursor that sits between characters instead. The implementation
 * mirrors ink-text-input's keystroke handling (typing, backspace,
 * left/right) so behavior matches what users expect from a text box.
 */
function PathInput({
  value,
  onChange,
  focus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  focus: boolean;
  placeholder?: string;
}) {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  // Snap cursor to end whenever focus turns on, so re-entering the
  // field doesn't leave a stale offset from the last edit.
  useEffect(() => {
    if (focus) setCursorOffset(value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Clamp cursor when value shrinks externally (e.g. Restore default).
  useEffect(() => {
    if (cursorOffset > value.length) setCursorOffset(value.length);
  }, [value, cursorOffset]);

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) return;
    if (key.tab || (key.shift && key.tab)) return;
    if (key.return || key.escape) return;
    if (key.ctrl || key.meta) return;

    if (key.leftArrow) {
      setCursorOffset(o => Math.max(0, o - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset(o => Math.min(value.length, o + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursorOffset === 0) return;
      const next = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
      setCursorOffset(o => o - 1);
      onChange(next);
      return;
    }
    if (input) {
      const next = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
      setCursorOffset(o => o + input.length);
      onChange(next);
    }
  }, { isActive: focus });

  // Empty value: show placeholder (and the cursor at start when focused).
  if (value.length === 0) {
    if (focus) {
      return (
        <Text>
          <Text color={ACCENT}>│</Text>
          {placeholder ? <Text dimColor>{placeholder}</Text> : null}
        </Text>
      );
    }
    return placeholder ? <Text dimColor>{placeholder}</Text> : <Text> </Text>;
  }

  // Has value: render value, with the thin cursor inserted at cursorOffset
  // when focused.
  if (!focus) {
    return <Text>{value}</Text>;
  }
  const before = value.slice(0, cursorOffset);
  const after = value.slice(cursorOffset);
  return (
    <Text>
      {before}
      <Text color={ACCENT}>│</Text>
      {after}
    </Text>
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

function Option({ label, applied, cursor }: { label: string; applied: boolean; cursor: boolean }) {
  const marker = applied ? "●" : "○";
  // Brackets show the cursor; color shows what's applied.
  const open = cursor ? "[" : " ";
  const close = cursor ? "]" : " ";
  if (applied) {
    return (
      <Text>
        <Text color={cursor ? ACCENT : undefined} bold={cursor}>{open}</Text>
        <Text color="green" bold>{marker} {label}</Text>
        <Text color={cursor ? ACCENT : undefined} bold={cursor}>{close}</Text>
      </Text>
    );
  }
  return (
    <Text>
      <Text color={cursor ? ACCENT : undefined} bold={cursor}>{open}</Text>
      <Text color={cursor ? ACCENT : undefined} dimColor={!cursor}>{marker} {label}</Text>
      <Text color={cursor ? ACCENT : undefined} bold={cursor}>{close}</Text>
    </Text>
  );
}

function RestoreButton({ label, cursor }: { label: string; cursor: boolean }) {
  const open = cursor ? "[" : " ";
  const close = cursor ? "]" : " ";
  return (
    <Text>
      <Text color={cursor ? ACCENT : undefined} bold={cursor}>{open}</Text>
      <Text color={cursor ? ACCENT : undefined} dimColor={!cursor} bold={cursor}>{label}</Text>
      <Text color={cursor ? ACCENT : undefined} bold={cursor}>{close}</Text>
    </Text>
  );
}

function fieldKey(f: FieldDef): string {
  return f.kind === "options" ? f.key : f.pathKey;
}

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

export function applyDisplayMode<T extends { role: string }>(
  messages: T[],
  mode: DisplayMode,
): T[] {
  if (mode === "full") return messages;
  return messages.filter(m => m.role === "user" || m.role === "assistant");
}
