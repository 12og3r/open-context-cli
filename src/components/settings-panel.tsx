import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Settings, DisplayMode } from "../lib/settings.ts";
import type { SessionStatusBySource } from "../lib/session-status.ts";
import { t, type Lang } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

const ACCENT = "cyan";
const DANGER = "red";
const OK = "green";

// Setting keys that are edited via the path-input UX (text box + restore
// default button). Anything else is rendered as an options field.
type PathSettingsKey = "sessionsDir" | "codexSessionsDir";
const PATH_SETTING_KEYS: readonly PathSettingsKey[] = [
  "sessionsDir",
  "codexSessionsDir",
] as const;

type OptionsFieldDef = {
  [K in Exclude<keyof Settings, PathSettingsKey>]: {
    kind: "options";
    key: K;
    title: string;
    options: Array<{ value: Settings[K]; label: string; description: string }>;
  };
}[Exclude<keyof Settings, PathSettingsKey>];

type PathFieldDef = {
  kind: "path";
  key: PathSettingsKey;
  title: string;
  description: string;
  defaultPath: string;
  defaultLabel: string;
  restoreLabel: string;
  placeholder: string;
  // Only the first path field is the one whose status badge ("Sessions
  // found" / "missing") is meaningful — that's the Claude one. Codex shows
  // no status badge to keep the panel uncluttered.
  showStatus: boolean;
};

type FieldDef = OptionsFieldDef | PathFieldDef;

function buildFields(
  lang: Lang,
  defaultClaudeDir: string,
  defaultCodexDir: string,
): FieldDef[] {
  return [
    {
      kind: "path",
      key: "sessionsDir",
      title: t(lang, "settings.sessions_dir.title"),
      description: t(lang, "settings.sessions_dir.description"),
      defaultPath: defaultClaudeDir,
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultClaudeDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
      placeholder: t(lang, "settings.sessions_dir.placeholder"),
      showStatus: true,
    },
    {
      kind: "path",
      key: "codexSessionsDir",
      title: t(lang, "settings.codex_sessions_dir.title"),
      description: t(lang, "settings.codex_sessions_dir.description"),
      defaultPath: defaultCodexDir,
      defaultLabel: t(lang, "settings.sessions_dir.default_label", {
        path: defaultCodexDir || "—",
      }),
      restoreLabel: t(lang, "settings.sessions_dir.restore"),
      placeholder: t(lang, "settings.sessions_dir.placeholder"),
      showStatus: false,
    },
    {
      kind: "options",
      key: "showClaudeCode",
      title: t(lang, "settings.show_source.claude_title"),
      options: [
        {
          value: true,
          label: t(lang, "settings.show_source.on"),
          description: t(lang, "settings.show_source.on_desc"),
        },
        {
          value: false,
          label: t(lang, "settings.show_source.off"),
          description: t(lang, "settings.show_source.off_desc"),
        },
      ],
    },
    {
      kind: "options",
      key: "showCodex",
      title: t(lang, "settings.show_source.codex_title"),
      options: [
        {
          value: true,
          label: t(lang, "settings.show_source.on"),
          description: t(lang, "settings.show_source.on_desc"),
        },
        {
          value: false,
          label: t(lang, "settings.show_source.off"),
          description: t(lang, "settings.show_source.off_desc"),
        },
      ],
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

type PathSubCursor = "input" | "restore";

type PathDrafts = Record<PathSettingsKey, string>;

export function SettingsPanel({
  settings,
  onChange,
  focused,
  width,
  height,
  defaultClaudeDir,
  defaultCodexDir,
  sessionStatusBySource,
}: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  focused: boolean;
  width: number;
  height: number;
  defaultClaudeDir: string;
  defaultCodexDir: string;
  sessionStatusBySource: SessionStatusBySource;
}) {
  const lang = useLang();
  const FIELDS = useMemo(
    () => buildFields(lang, defaultClaudeDir, defaultCodexDir),
    [lang, defaultClaudeDir, defaultCodexDir],
  );
  const [fieldIdx, setFieldIdx] = useState(0);
  // Per-field "option cursor" — independent of the applied value. Initialized
  // to the applied option when this panel first opens (or settings hydrate).
  // ←/→ moves this cursor; Space applies cursor → settings.
  const [optionCursor, setOptionCursor] = useState<Record<string, number>>(() =>
    initialCursor(FIELDS, settings),
  );

  // Sub-cursor for path-kind fields: which sub-element currently owns input.
  // Reset to "input" whenever any path field is (re)entered, so typing works
  // immediately without a Tab.
  const [pathSubCursor, setPathSubCursor] = useState<PathSubCursor>("input");

  // Local drafts of each path setting. Decoupled from settings so we can
  // debounce the rescan in app.tsx — drafts commit to settings only when
  // the panel closes (Esc / Enter), via the unmount cleanup below.
  const [pathDrafts, setPathDrafts] = useState<PathDrafts>(() => ({
    sessionsDir: settings.sessionsDir,
    codexSessionsDir: settings.codexSessionsDir,
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
      });
      setPathSubCursor("input");
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

  // Pin the sub-cursor back to "input" when the user moves to a path field
  // from elsewhere (so the next keystroke types into the input box).
  useEffect(() => {
    setPathSubCursor("input");
  }, [fieldIdx]);

  const field = FIELDS[fieldIdx]!;

  useInput((input, key) => {
    if (!focused) return;

    // While a path input owns input, only handle field navigation + Tab.
    // Everything else (typing, ←/→ within text) is delegated to
    // ink-text-input via its `focus` prop.
    if (field.kind === "path" && pathSubCursor === "input") {
      if (key.upArrow) {
        setFieldIdx(i => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setFieldIdx(i => Math.min(FIELDS.length - 1, i + 1));
      } else if (key.tab) {
        setPathSubCursor("restore");
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
    if (key.tab) {
      if (field.kind === "path") setPathSubCursor("input");
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

    // field.kind === "path", pathSubCursor === "restore"
    if (input === " " || key.return) {
      // Restore default: clear both the draft and the applied setting so
      // the change takes effect immediately, and drop focus back into the
      // input for the next edit.
      setPathDrafts(prev => ({ ...prev, [field.key]: "" }));
      if (settings[field.key] !== "") onChange(field.key, "");
      setPathSubCursor("input");
    } else if (key.leftArrow || input === "h" || key.rightArrow || input === "l") {
      setPathSubCursor("input");
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

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexShrink={0} marginBottom={1}>
        <Text dimColor>{t(lang, "settings.help")}</Text>
      </Box>
      {FIELDS.map((f, i) => {
        const fieldSelected = i === fieldIdx;
        const showStatus = f.kind === "path" && f.showStatus;
        const claudeStatus = sessionStatusBySource["claude-code"];
        const statusColor = claudeStatus === "ok" ? OK : DANGER;
        const statusKey =
          claudeStatus === "ok"
            ? "settings.session_status.ok"
            : "settings.session_status.missing";
        return (
          <Box key={f.key} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={fieldSelected && focused ? ACCENT : undefined} bold={fieldSelected && focused}>
                {fieldSelected && focused ? "› " : "  "}{f.title}
              </Text>
              {showStatus && (
                <Text>
                  <Text>{"  "}</Text>
                  <Text color={statusColor} bold>● </Text>
                  <Text color={statusColor}>{t(lang, statusKey)}</Text>
                </Text>
              )}
            </Box>
            {f.kind === "options" ? (
              <OptionsRow
                field={f}
                applied={settings[f.key]}
                cursorIdx={optionCursor[f.key] ?? 0}
                fieldFocused={fieldSelected && focused}
              />
            ) : (
              <PathRow
                field={f}
                draft={pathDrafts[f.key]}
                onDraftChange={(v) =>
                  setPathDrafts(prev => ({ ...prev, [f.key]: v }))
                }
                subCursor={pathSubCursor}
                fieldFocused={fieldSelected && focused}
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

function PathRow({
  field,
  draft,
  onDraftChange,
  subCursor,
  fieldFocused,
}: {
  field: PathFieldDef;
  draft: string;
  onDraftChange: (v: string) => void;
  subCursor: PathSubCursor;
  fieldFocused: boolean;
}) {
  const inputFocused = fieldFocused && subCursor === "input";
  const restoreFocused = fieldFocused && subCursor === "restore";
  return (
    <>
      <Box marginLeft={2}>
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
      <Box marginLeft={2} marginTop={0}>
        <RestoreButton label={field.restoreLabel} cursor={restoreFocused} />
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{field.description}</Text>
      </Box>
    </>
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

function initialCursor(fields: FieldDef[], settings: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (f.kind !== "options") continue;
    const i = f.options.findIndex(o => o.value === settings[f.key]);
    out[f.key] = i >= 0 ? i : 0;
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
