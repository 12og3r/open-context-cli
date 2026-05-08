import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../providers/types.ts";
import { MessageBlock } from "./message-block.tsx";
import { SearchBar } from "./search-bar.tsx";

const APPROX_ROWS_PER_MSG = 4;

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
  const [windowStart, setWindowStart] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");

  const ident = useMemo(() => messages.length, [messages]);
  const lastIdent = useRef<number | null>(null);

  // Available rows for messages, accounting for search bar + overflow hint.
  const fit = Math.max(
    1,
    Math.floor((height - (searchOpen ? 1 : 0) - 1) / APPROX_ROWS_PER_MSG),
  );

  const lastIdx = Math.max(0, messages.length - 1);
  const safeCursor = Math.min(cursor, lastIdx);

  // Reset on session switch — cursor at latest, window at the bottom.
  useEffect(() => {
    if (lastIdent.current !== ident) {
      const c = Math.max(0, ident - 1);
      setCursor(c);
      setWindowStart(Math.max(0, c - fit + 1));
      setExpanded(new Set());
      setSearchOpen(false);
      setSearchValue("");
      setCommittedQuery("");
      lastIdent.current = ident;
    }
  }, [ident, fit]);

  // Compute final windowStart for rendering. Persists state but also clamps
  // to a valid range when messages or fit change underneath us.
  const renderWindowStart = clampWindow(windowStart, safeCursor, fit, messages.length);

  // Move the cursor and shift the window only if the cursor would otherwise
  // leave the visible range.
  const moveTo = (raw: number) => {
    const next = Math.max(0, Math.min(lastIdx, raw));
    setCursor(next);
    setWindowStart(prev => {
      const start = clampWindow(prev, next, fit, messages.length);
      // The window shifts only when next is outside [start, start + fit).
      return start;
    });
  };

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return; // SearchBar's TextInput owns keys
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    const half = Math.max(1, Math.floor(fit / 2));
    if (input === "j" || key.downArrow) moveTo(safeCursor + 1);
    else if (input === "k" || key.upArrow) moveTo(safeCursor - 1);
    else if (key.ctrl && input === "d") moveTo(safeCursor + half);
    else if (key.ctrl && input === "u") moveTo(safeCursor - half);
    else if (key.pageDown) moveTo(safeCursor + fit);
    else if (key.pageUp) moveTo(safeCursor - fit);
    else if (input === "G") moveTo(lastIdx);
    else if (input === "g") moveTo(0);
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

  const windowEnd = Math.min(messages.length, renderWindowStart + fit);
  const visible = messages.slice(renderWindowStart, windowEnd);
  const showOverflowHint = messages.length > fit;
  const query = committedQuery || (searchOpen ? searchValue : "");

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {searchOpen && (
        <SearchBar
          label={<Text color="cyan">🔎</Text>}
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={(v) => { setCommittedQuery(v); setSearchOpen(false); }}
        />
      )}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((m, i) => {
          const realIdx = renderWindowStart + i;
          return (
            <MessageBlock
              key={realIdx}
              message={highlight(m, query)}
              expanded={expanded.has(realIdx)}
              emoji={emoji}
              current={focused && realIdx === safeCursor}
            />
          );
        })}
      </Box>
      {showOverflowHint && (
        <Box flexShrink={0}>
          <Text dimColor>
            {renderWindowStart > 0 ? "  ↑ " : "    "}
            {safeCursor + 1} / {messages.length}
            {windowEnd < messages.length ? "  ↓" : "   "}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function clampWindow(prev: number, cursor: number, fit: number, total: number): number {
  if (total <= fit) return 0;
  let s = prev;
  if (cursor < s) s = cursor;                       // cursor moved past the top
  if (cursor >= s + fit) s = cursor - fit + 1;      // cursor moved past the bottom
  s = Math.max(0, Math.min(s, total - fit));        // keep within valid range
  return s;
}

function highlight(m: Message, query: string): Message {
  if (!query) return m;
  const re = new RegExp(escape(query), "gi");
  const inverse = (s: string) => `\x1b[7m${s}\x1b[27m`;
  return { ...m, content: m.content.replace(re, inverse) };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
