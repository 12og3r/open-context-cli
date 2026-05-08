import React from "react";
import { Box, Text } from "ink";
import type { SessionMeta } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { truncate } from "../lib/truncate.ts";

const ROWS_PER_ITEM = 2;
const ROWS_PER_DIVIDER = 1;
const ROWS_PER_BLOCK = ROWS_PER_ITEM + ROWS_PER_DIVIDER; // item + trailing divider

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
  const innerWidth = Math.max(1, width - 2);
  const divider = "─".repeat(innerWidth);

  const visible = windowSessions(sessions, selectedId, height);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {visible.map((s, i) => (
        <Box key={s.id} flexDirection="column" flexShrink={0}>
          <Item meta={s} selected={s.id === selectedId} innerWidth={innerWidth} now={now} />
          {i < visible.length - 1 && (
            <Text dimColor>{" " + divider + " "}</Text>
          )}
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
  const capacity = Math.max(1, Math.floor((height + ROWS_PER_DIVIDER) / ROWS_PER_BLOCK));
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

function Item({ meta, selected, innerWidth, now }: {
  meta: SessionMeta;
  selected: boolean;
  innerWidth: number;
  now: Date;
}) {
  const marker = selected ? "▸ " : "  ";
  const summary = truncate(meta.summary, innerWidth - 2);
  const meta2 = `  ${relativeTime(meta.modifiedAt, now)} · ${meta.messageCount} msgs`;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text inverse={selected}>{marker}{summary}</Text>
      <Text dimColor>{truncate(meta2, innerWidth)}</Text>
    </Box>
  );
}
