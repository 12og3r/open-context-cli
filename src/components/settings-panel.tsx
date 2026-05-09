import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Settings, DisplayMode } from "../lib/settings.ts";
import { t, type Lang } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

const ACCENT = "cyan";

type FieldDef = {
  [K in keyof Settings]: {
    key: K;
    title: string;
    options: Array<{ value: Settings[K]; label: string; description: string }>;
  };
}[keyof Settings];

function buildFields(lang: Lang): FieldDef[] {
  return [
    {
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
  ];
}

export function SettingsPanel({
  settings,
  onChange,
  focused,
  width,
  height,
}: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  focused: boolean;
  width: number;
  height: number;
}) {
  const lang = useLang();
  const FIELDS = useMemo(() => buildFields(lang), [lang]);
  const [fieldIdx, setFieldIdx] = useState(0);
  // Per-field "option cursor" — independent of the applied value. Initialized
  // to the applied option when this panel first opens (or settings hydrate).
  // ←/→ moves this cursor; Space applies cursor → settings.
  const [optionCursor, setOptionCursor] = useState<Record<string, number>>(() =>
    initialCursor(FIELDS, settings),
  );

  // When the panel becomes focused, re-anchor the cursor on each field to
  // whatever value is currently applied. That way leaving and re-entering the
  // panel doesn't leave a stale cursor on a value the user never confirmed.
  useEffect(() => {
    if (focused) setOptionCursor(initialCursor(FIELDS, settings));
  }, [focused, settings, FIELDS]);

  const field = FIELDS[fieldIdx]!;

  useInput((input, key) => {
    if (!focused) return;
    if (key.upArrow || input === "k") {
      setFieldIdx(i => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setFieldIdx(i => Math.min(FIELDS.length - 1, i + 1));
    } else if (key.leftArrow || input === "h") {
      moveCursor(field, -1);
    } else if (key.rightArrow || input === "l") {
      moveCursor(field, +1);
    } else if (input === " ") {
      applyCursor(field);
    } else if (key.return) {
      // Enter == "confirm" → apply whatever the cursor is on, then let
      // SessionBrowser handle the panel close + preview focus.
      applyCursor(field);
    }
  });

  function moveCursor(f: FieldDef, dir: 1 | -1) {
    setOptionCursor(prev => {
      const len = f.options.length;
      const cur = prev[f.key] ?? 0;
      return { ...prev, [f.key]: (cur + dir + len) % len };
    });
  }

  function applyCursor(f: FieldDef) {
    const idx = optionCursor[f.key] ?? 0;
    const next = f.options[idx]!;
    // The FieldDef union ties f.key to the option's value type, but TS can't
    // see through the parametrized callback signature; the cast below is safe
    // because the runtime pair (key, value) always matches by construction.
    (onChange as (k: string, v: unknown) => void)(f.key, next.value);
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexShrink={0} marginBottom={1}>
        <Text dimColor>{t(lang, "settings.help")}</Text>
      </Box>
      {FIELDS.map((f, i) => {
        const fieldSelected = i === fieldIdx;
        const current = settings[f.key];
        const cursorIdx = optionCursor[f.key] ?? 0;
        return (
          <Box key={f.key} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={fieldSelected && focused ? ACCENT : undefined} bold={fieldSelected && focused}>
                {fieldSelected && focused ? "› " : "  "}{f.title}
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="row" flexWrap="wrap">
              {f.options.map((opt, oi) => {
                const isApplied = opt.value === current;
                const isCursor = focused && fieldSelected && oi === cursorIdx;
                return (
                  <Box key={String(opt.value)} marginRight={oi < f.options.length - 1 ? 2 : 0}>
                    <Option label={opt.label} applied={isApplied} cursor={isCursor} />
                  </Box>
                );
              })}
            </Box>
            <Box marginLeft={2}>
              <Text dimColor>
                {f.options.find(o => o.value === current)?.description ?? ""}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
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

function initialCursor(fields: FieldDef[], settings: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
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
