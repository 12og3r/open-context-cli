import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Settings, DisplayMode } from "../lib/settings.ts";

const ACCENT = "cyan";

interface OptionDef<V extends string> {
  value: V;
  label: string;
  description: string;
}

interface FieldDef<K extends keyof Settings> {
  key: K;
  title: string;
  options: OptionDef<Settings[K] & string>[];
}

const FIELDS: [FieldDef<"displayMode">] = [
  {
    key: "displayMode",
    title: "Display mode",
    options: [
      {
        value: "concise",
        label: "Concise",
        description: "Show only user and assistant messages.",
      },
      {
        value: "full",
        label: "Full",
        description: "Show every message, including tool calls and results.",
      },
    ],
  },
];

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
  const [fieldIdx, setFieldIdx] = useState(0);
  // Per-field "option cursor" — independent of the applied value. Initialized
  // to the applied option when this panel first opens (or settings hydrate).
  // ←/→ moves this cursor; Space applies cursor → settings.
  const [optionCursor, setOptionCursor] = useState<Record<string, number>>(() =>
    initialCursor(settings),
  );

  // When the panel becomes focused, re-anchor the cursor on each field to
  // whatever value is currently applied. That way leaving and re-entering the
  // panel doesn't leave a stale cursor on a value the user never confirmed.
  useEffect(() => {
    if (focused) setOptionCursor(initialCursor(settings));
  }, [focused, settings]);

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

  function moveCursor<K extends keyof Settings>(f: FieldDef<K>, dir: 1 | -1) {
    setOptionCursor(prev => {
      const len = f.options.length;
      const cur = prev[f.key as string] ?? 0;
      return { ...prev, [f.key as string]: (cur + dir + len) % len };
    });
  }

  function applyCursor<K extends keyof Settings>(f: FieldDef<K>) {
    const idx = optionCursor[f.key as string] ?? 0;
    const next = f.options[idx]!;
    onChange(f.key, next.value as Settings[K]);
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexShrink={0} marginBottom={1}>
        <Text dimColor>
          ←→ move cursor · space to apply · ⏎ confirm · esc back
        </Text>
      </Box>
      {FIELDS.map((f, i) => {
        const fieldSelected = i === fieldIdx;
        const current = settings[f.key];
        const cursorIdx = optionCursor[f.key as string] ?? 0;
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
                  <Box key={opt.value} marginRight={oi < f.options.length - 1 ? 2 : 0}>
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

function initialCursor(settings: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of FIELDS) {
    const i = f.options.findIndex(o => o.value === settings[f.key]);
    out[f.key as string] = i >= 0 ? i : 0;
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
