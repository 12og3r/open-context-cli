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
  const [cursor, setCursor] = useState(0);
  // While pinToBottom is true, the cursor follows the most recent message
  // automatically. The user "unpins" by moving the cursor, but session-switch
  // re-pins so a new session opens at the latest.
  const [pinToBottom, setPinToBottom] = useState(true);
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
  const effectiveCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);

  // Reserve 1 row for the overflow hint.
  const viewportHeight = Math.max(1, height - 1 - (searchOpen ? 1 : 0));

  const query = committedQuery || (searchOpen ? searchValue : "");

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

  const cursorStart = buffer.startLine[effectiveCursor] ?? 0;
  const cursorEnd = buffer.endLine[effectiveCursor] ?? buffer.lines.length;

  // While pinned, always anchor the viewport to the bottom of the buffer so
  // the latest message sits at the bottom even as messages stream in.
  // Otherwise, only shift when the cursor's lines would leave the viewport.
  const actualScrollLine = pinToBottom
    ? Math.max(0, buffer.lines.length - viewportHeight)
    : clampScroll(scrollLine, cursorStart, cursorEnd, viewportHeight, buffer.lines.length);

  // Persist the clamped value so subsequent user actions start from the right place.
  useEffect(() => {
    if (actualScrollLine !== scrollLine) setScrollLine(actualScrollLine);
  }, [actualScrollLine, scrollLine]);

  const moveCursorTo = (next: number) => {
    const clamped = Math.max(0, Math.min(lastIdx, next));
    if (clamped === effectiveCursor && !pinToBottom) return;
    if (clamped === effectiveCursor && pinToBottom && clamped === lastIdx) {
      // No-op: pinned at last and trying to go past it.
      return;
    }
    setCursor(clamped);
    setPinToBottom(clamped === lastIdx);
  };

  const doScroll = (delta: number) => {
    const max = Math.max(0, buffer.lines.length - viewportHeight);
    const next = Math.max(0, Math.min(max, actualScrollLine + delta));
    setScrollLine(next);
    const newCursor = moveCursorToVisible(effectiveCursor, next, viewportHeight, buffer, lastIdx, delta);
    setCursor(newCursor);
    setPinToBottom(newCursor === lastIdx && next >= max);
  };

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return;
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    if (input === "j" || key.downArrow) moveCursorTo(effectiveCursor + 1);
    else if (input === "k" || key.upArrow) moveCursorTo(effectiveCursor - 1);
    else if (key.ctrl && input === "d") doScroll(Math.floor(viewportHeight / 2));
    else if (key.ctrl && input === "u") doScroll(-Math.floor(viewportHeight / 2));
    else if (key.pageDown) doScroll(viewportHeight);
    else if (key.pageUp) doScroll(-viewportHeight);
    else if (input === "G") {
      setPinToBottom(true);
      setCursor(lastIdx);
    }
    else if (input === "g") moveCursorTo(0);
    else if (key.tab && !key.shift) {
      setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(effectiveCursor)) next.delete(effectiveCursor);
        else next.add(effectiveCursor);
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
  const showOverflowHint = buffer.lines.length > viewportHeight;
  const hasAbove = actualScrollLine > 0;
  const hasBelow = actualScrollLine + viewportHeight < buffer.lines.length;

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

function clampScroll(
  prev: number,
  cursorStart: number,
  cursorEnd: number,
  viewportHeight: number,
  totalLines: number,
): number {
  let s = prev;
  if (cursorStart < s) s = cursorStart;
  if (cursorEnd > s + viewportHeight) s = cursorEnd - viewportHeight;
  if (s < 0) s = 0;
  const max = Math.max(0, totalLines - viewportHeight);
  if (s > max) s = max;
  return s;
}

function moveCursorToVisible(
  cursor: number,
  scrollLine: number,
  viewportHeight: number,
  buffer: { startLine: number[]; endLine: number[] },
  lastIdx: number,
  direction: number,
): number {
  const top = scrollLine;
  const bottom = scrollLine + viewportHeight;
  if (cursor < 0) return 0;
  if (cursor > lastIdx) return lastIdx;
  const start = buffer.startLine[cursor] ?? 0;
  const end = buffer.endLine[cursor] ?? 0;
  if (start >= top && end <= bottom) return cursor;
  if (direction < 0) {
    for (let i = 0; i <= lastIdx; i++) {
      if ((buffer.startLine[i] ?? 0) >= top) return i;
    }
    return cursor;
  } else {
    for (let i = lastIdx; i >= 0; i--) {
      if ((buffer.endLine[i] ?? 0) <= bottom) return i;
    }
    return cursor;
  }
}
