import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { SessionMeta, Source } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { truncate } from "../lib/truncate.ts";
import { t, type Lang } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

export function sourceChipLabel(source: Source, lang: Lang): string {
  return source === "codex"
    ? t(lang, "source.codex")
    : t(lang, "source.claude_code");
}

// Source label rendered in front of the metadata subtitle:
// "[Claude]" / "[Codex]". The text comes from the i18n table so it
// stays in sync with the preview chip; the color reinforces the same
// signal at a glance.
const SOURCE_COLOR: Record<Source, string> = {
  "claude-code": "cyan",
  "codex":       "magenta",
};
const SELECTION_BAR = "▌";

const ROWS_PER_ITEM = 2;
const ROWS_PER_GAP = 1;
const ROWS_PER_BLOCK = ROWS_PER_ITEM + ROWS_PER_GAP;

const LEAD_WIDTH = 2; // selection bar (or blank) + trailing space

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
  const windowStartRef = useRef(0);
  const visible = windowSessions(sessions, selectedId, height, windowStartRef);

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

// Scroll-on-edge windowing: the window only shifts when the selection crosses
// out of the currently visible range. Moving down within the visible block
// keeps the window pinned; pressing down on the last visible row shifts the
// window down by one. The ref persists `start` across renders so we don't
// snap back to a centered position on every selection change.
function windowSessions(
  sessions: SessionMeta[],
  selectedId: string | null,
  height: number | undefined,
  startRef: React.MutableRefObject<number>,
): SessionMeta[] {
  if (!height || height <= 0) return sessions;
  const capacity = Math.max(1, Math.floor((height + ROWS_PER_GAP) / ROWS_PER_BLOCK));
  if (sessions.length <= capacity) {
    startRef.current = 0;
    return sessions;
  }
  const selectedIdx = Math.max(0, sessions.findIndex(s => s.id === selectedId));
  let start = startRef.current;
  if (selectedIdx < start) start = selectedIdx;
  else if (selectedIdx >= start + capacity) start = selectedIdx - capacity + 1;
  const maxStart = Math.max(0, sessions.length - capacity);
  if (start > maxStart) start = maxStart;
  if (start < 0) start = 0;
  startRef.current = start;
  return sessions.slice(start, start + capacity);
}

function Item({ meta, selected, innerWidth, now, lang }: {
  meta: SessionMeta;
  selected: boolean;
  innerWidth: number;
  now: Date;
  lang: Lang;
}) {
  const sourceColor = SOURCE_COLOR[meta.source];
  // Title row: the selection bar (▌) marks selected rows in the source's
  // color; unselected rows leave that cell blank so titles read clean.
  // The source-identifying label lives on the subtitle below.
  const leadGlyph = selected ? SELECTION_BAR : " ";
  const summary = truncate(meta.summary, innerWidth - LEAD_WIDTH);
  // Subtitle: "[Claude] 1m ago · 355 msgs". Single space after the
  // source chip (no separating dot); the remaining metadata pieces are
  // joined with single-space dots to keep the row tight on narrow panes.
  // The source prefix is always shown; the rest is truncated if needed.
  const sourceLabel = `[${sourceChipLabel(meta.source, lang)}]`;
  const rest = ` ${relativeTime(meta.modifiedAt, now, lang)} · ${meta.messageCount} ${t(lang, "list.msgs_suffix")}`;
  const restWidth = Math.max(0, innerWidth - sourceLabel.length);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text>
        <Text color={sourceColor} bold={selected}>{leadGlyph}</Text>
        <Text>{" "}</Text>
        <Text color={selected ? sourceColor : undefined} bold={selected}>{summary}</Text>
      </Text>
      <Text>
        <Text color={sourceColor} bold>{sourceLabel}</Text>
        <Text dimColor>{truncate(rest, restWidth)}</Text>
      </Text>
    </Box>
  );
}
