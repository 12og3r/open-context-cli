import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../providers/types.ts";
import { renderConversation } from "../lib/render-message.ts";
import { SearchBar } from "./search-bar.tsx";

export function SessionPreview({
  messages,
  focused,
  height,
  width,
  emoji = true,
}: {
  messages: Message[];
  focused: boolean;
  height: number;
  width: number;
  emoji?: boolean;
}) {
  const [cursor, setCursor] = useState(Math.max(0, messages.length - 1));
  const [scrollLine, setScrollLine] = useState(Number.MAX_SAFE_INTEGER);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const lastIdent = useRef<number | null>(null);

  const lastIdx = Math.max(0, messages.length - 1);
  const safeCursor = Math.min(cursor, lastIdx);

  // Reserve 1 row for the overflow hint.
  const viewportHeight = Math.max(1, height - 1 - (searchOpen ? 1 : 0));

  const query = committedQuery || (searchOpen ? searchValue : "");

  const buffer = useMemo(
    () =>
      renderConversation(messages, {
        width,
        cursor: safeCursor,
        focused,
        expanded,
        emoji,
        now: new Date(),
        query,
      }),
    [messages, width, safeCursor, focused, expanded, emoji, query],
  );

  // Reset on session switch — cursor at latest, scrolled so latest is at the bottom of the viewport.
  useEffect(() => {
    const ident = messages.length;
    if (lastIdent.current !== ident) {
      const c = Math.max(0, ident - 1);
      setCursor(c);
      setExpanded(new Set());
      setSearchOpen(false);
      setSearchValue("");
      setCommittedQuery("");
      // Sentinel: clampScroll will pull this down to the valid bottom on the
      // first render that has a buffer.
      setScrollLine(Number.MAX_SAFE_INTEGER);
      lastIdent.current = ident;
    }
  }, [messages]);

  // Compute the actual scroll offset for this render, so the very first paint
  // already shows the cursor's lines without waiting for a useEffect tick.
  const cursorStart = buffer.startLine[safeCursor] ?? 0;
  const cursorEnd = buffer.endLine[safeCursor] ?? buffer.lines.length;
  const actualScrollLine = clampScroll(
    scrollLine,
    cursorStart,
    cursorEnd,
    viewportHeight,
    buffer.lines.length,
  );

  // Persist the clamped value so subsequent user actions start from the right place.
  useEffect(() => {
    if (actualScrollLine !== scrollLine) setScrollLine(actualScrollLine);
  }, [actualScrollLine, scrollLine]);

  const doScroll = (delta: number) => {
    const max = Math.max(0, buffer.lines.length - viewportHeight);
    const next = Math.max(0, Math.min(max, actualScrollLine + delta));
    setScrollLine(next);
    setCursor(c => moveCursorToVisible(c, next, viewportHeight, buffer, lastIdx, delta));
  };

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return;
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    if (input === "j" || key.downArrow) setCursor(c => Math.min(lastIdx, c + 1));
    else if (input === "k" || key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.ctrl && input === "d") doScroll(Math.floor(viewportHeight / 2));
    else if (key.ctrl && input === "u") doScroll(-Math.floor(viewportHeight / 2));
    else if (key.pageDown) doScroll(viewportHeight);
    else if (key.pageUp) doScroll(-viewportHeight);
    else if (input === "G") setCursor(lastIdx);
    else if (input === "g") setCursor(0);
    else if (key.tab && !key.shift) {
      setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(safeCursor)) next.delete(safeCursor);
        else next.add(safeCursor);
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
            {safeCursor + 1} / {messages.length}
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
  // Cursor's first line above viewport → scroll up so cursor's start is at top.
  if (cursorStart < s) s = cursorStart;
  // Cursor's last line past the viewport bottom → scroll just enough so it
  // ends at the viewport bottom.
  if (cursorEnd > s + viewportHeight) s = cursorEnd - viewportHeight;
  // Keep within bounds.
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
  if (start >= top && end <= bottom) return cursor; // still fully visible
  if (direction < 0) {
    // Scrolling up → put cursor on the topmost message whose start is in view.
    for (let i = 0; i <= lastIdx; i++) {
      if ((buffer.startLine[i] ?? 0) >= top) return i;
    }
    return cursor;
  } else {
    // Scrolling down → put cursor on the bottommost message whose end fits.
    for (let i = lastIdx; i >= 0; i--) {
      if ((buffer.endLine[i] ?? 0) <= bottom) return i;
    }
    return cursor;
  }
}
