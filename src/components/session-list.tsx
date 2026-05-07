// src/components/session-list.tsx
import React from "react";
import { Box, Text } from "ink";
import type { SessionMeta } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { truncate } from "../lib/truncate.ts";

export function SessionList({
  sessions,
  selectedId,
  width,
  now = new Date(),
}: {
  sessions: SessionMeta[];
  selectedId: string | null;
  width: number;
  now?: Date;
}) {
  const innerWidth = Math.max(1, width - 2); // 2 columns of padding
  const divider = "─".repeat(innerWidth);
  return (
    <Box flexDirection="column" width={width}>
      {sessions.map((s, i) => (
        <Box key={s.id} flexDirection="column">
          <Item meta={s} selected={s.id === selectedId} innerWidth={innerWidth} now={now} />
          {i < sessions.length - 1 && (
            <Text dimColor>{" " + divider + " "}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
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
    <Box flexDirection="column">
      <Text inverse={selected}>{marker}{summary}</Text>
      <Text dimColor>{truncate(meta2, innerWidth)}</Text>
    </Box>
  );
}
