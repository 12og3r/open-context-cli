import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../providers/types.ts";
import { renderConversation } from "../lib/render-message.ts";
import { SearchBar } from "./search-bar.tsx";

export function SessionPreview({
  messages,
  sessionId,
  focused,
  height,
  width,
  emoji = true,
}: {
  messages: Message[];
  sessionId: string | null;
  focused: boolean;
  height: number;
  width: number;
  emoji?: boolean;
}) {
  // pinToBottom: while true, the viewport sticks to the latest message and the
  //   cursor sits on lastIdx automatically. Any j/k/g/PgUp/PgDn unpins.
  const [pinToBottom, setPinToBottom] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [scrollLine, setScrollLine] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");

  // Reset only on real session switch.
  useEffect(() => {
    setPinToBottom(true);
    setCursor(0);
    setScrollLine(0);
    setExpanded(new Set());
    setSearchOpen(false);
    setSearchValue("");
    setCommittedQuery("");
  }, [sessionId]);

  const lastIdx = Math.max(0, messages.length - 1);
  const viewportHeight = Math.max(1, height - 1 - (searchOpen ? 1 : 0));
  const query = committedQuery || (searchOpen ? searchValue : "");

  const effectiveCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);

  const buffer = useMemo(
    () =>
      renderConversation(messages, {
        width,
        cursor: effectiveCursor,
        focused,
        expanded,
        emoji,
        now: new Date(),
        query,
      }),
    [messages, width, effectiveCursor, focused, expanded, emoji, query],
  );

  const totalLines = buffer.lines.length;
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const actualScrollLine = pinToBottom ? maxScroll : clampToRange(scrollLine, 0, maxScroll);

  // Persist the clamped scroll value when it differs from state.
  useEffect(() => {
    if (!pinToBottom && actualScrollLine !== scrollLine) setScrollLine(actualScrollLine);
  }, [actualScrollLine, scrollLine, pinToBottom]);

  // Step the viewport by `delta` lines. Cursor advances/retreats only when its
  // current message is fully scrolled past the corresponding edge.
  const step = (delta: number) => {
    const wasPinned = pinToBottom;
    const curCursor = wasPinned ? lastIdx : Math.min(cursor, lastIdx);
    const curScroll = wasPinned ? maxScroll : actualScrollLine;
    const cs = buffer.startLine[curCursor] ?? 0;
    const ce = buffer.endLine[curCursor] ?? totalLines;

    let nextCursor = curCursor;
    let nextScroll = curScroll;

    if (delta > 0) {
      // Down: only advance cursor when its last line has reached the viewport bottom.
      if (ce > curScroll + viewportHeight) {
        nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
      } else if (curCursor < lastIdx) {
        nextCursor = curCursor + 1;
        nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
      } else {
        nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
      }
    } else {
      // Up: only retreat cursor when its first line is at or above the viewport top.
      if (cs < curScroll) {
        nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
      } else if (curCursor > 0) {
        nextCursor = curCursor - 1;
        nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
      } else {
        nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
      }
    }

    setPinToBottom(nextCursor === lastIdx && nextScroll === maxScroll);
    setCursor(nextCursor);
    setScrollLine(nextScroll);
  };

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return;
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    if (input === "j" || key.downArrow) step(1);
    else if (input === "k" || key.upArrow) step(-1);
    else if (key.ctrl && input === "d") step(Math.floor(viewportHeight / 2));
    else if (key.ctrl && input === "u") step(-Math.floor(viewportHeight / 2));
    else if (key.pageDown) step(viewportHeight);
    else if (key.pageUp) step(-viewportHeight);
    else if (input === "G") {
      setPinToBottom(true);
      setCursor(lastIdx);
    }
    else if (input === "g") {
      setPinToBottom(false);
      setCursor(0);
      setScrollLine(0);
    }
    else if (key.tab && !key.shift) {
      const target = pinToBottom ? lastIdx : effectiveCursor;
      setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(target)) next.delete(target);
        else next.add(target);
        return next;
      });
    }
  });

  if (messages.length === 0) {
    return (
      <Box width={width} height={height} alignItems="center" justifyContent="center">
        <Text dimColor>(no messages)</Text>
      </Box>
    );
  }

  const visibleLines = buffer.lines.slice(actualScrollLine, actualScrollLine + viewportHeight);
  const showOverflowHint = totalLines > viewportHeight;
  const hasAbove = actualScrollLine > 0;
  const hasBelow = actualScrollLine + viewportHeight < totalLines;

  return (
    <Box flexDirection="column" width={width} height={height}>
      {searchOpen && (
        <SearchBar
          label={<Text color="cyan">🔎</Text>}
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={(v) => { setCommittedQuery(v); setSearchOpen(false); }}
        />
      )}
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">{line || " "}</Text>
        ))}
      </Box>
      {showOverflowHint && (
        <Box flexShrink={0}>
          <Text dimColor>
            {hasAbove ? "  ↑ " : "    "}
            {effectiveCursor + 1} / {messages.length}
            {hasBelow ? "  ↓" : "   "}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function clampToRange(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
