import React from "react";
import { Box, Text } from "ink";
import type { SessionMeta } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { truncate } from "../lib/truncate.ts";
import { t } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

const ROWS_PER_ITEM = 2;
const ROWS_PER_GAP = 1;
const ROWS_PER_BLOCK = ROWS_PER_ITEM + ROWS_PER_GAP;

const SELECTED_MARKER = "▌ ";
const UNSELECTED_MARKER = "  ";
const MARKER_WIDTH = 2;

export function SessionList({
  sessions,
  selectedId,
  width,
  height,
  now = new Date(),
}: {
  sessions: SessionMeta[];
  selectedId: string | null;
  width: number;
  height?: number;
  now?: Date;
}) {
  const lang = useLang();
  const innerWidth = Math.max(1, width);
  const visible = windowSessions(sessions, selectedId, height);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {visible.map((s, i) => (
        <Box key={s.id} flexDirection="column" flexShrink={0}>
          <Item meta={s} selected={s.id === selectedId} innerWidth={innerWidth} now={now} lang={lang} />
          {i < visible.length - 1 && <Box height={1} flexShrink={0} />}
        </Box>
      ))}
    </Box>
  );
}

function windowSessions(
  sessions: SessionMeta[],
  selectedId: string | null,
  height: number | undefined,
): SessionMeta[] {
  if (!height || height <= 0) return sessions;
  const capacity = Math.max(1, Math.floor((height + ROWS_PER_GAP) / ROWS_PER_BLOCK));
  if (sessions.length <= capacity) return sessions;
  const selectedIdx = Math.max(0, sessions.findIndex(s => s.id === selectedId));
  const half = Math.floor(capacity / 2);
  let start = selectedIdx - half;
  let end = start + capacity;
  if (start < 0) { end -= start; start = 0; }
  if (end > sessions.length) { start -= end - sessions.length; end = sessions.length; }
  start = Math.max(0, start);
  return sessions.slice(start, end);
}

function Item({ meta, selected, innerWidth, now, lang }: {
  meta: SessionMeta;
  selected: boolean;
  innerWidth: number;
  now: Date;
  lang: import("../lib/i18n.ts").Lang;
}) {
  const marker = selected ? SELECTED_MARKER : UNSELECTED_MARKER;
  const summary = truncate(meta.summary, innerWidth - MARKER_WIDTH);
  const meta2 = `  ${relativeTime(meta.modifiedAt, now, lang)}  ·  ${meta.messageCount} ${t(lang, "list.msgs_suffix")}`;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text>
        <Text color={selected ? "cyan" : "gray"}>{marker}</Text>
        <Text color={selected ? "cyan" : undefined} bold={selected}>{summary}</Text>
      </Text>
      <Text dimColor>{truncate(meta2, innerWidth)}</Text>
    </Box>
  );
}
