import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../providers/types.ts";
import { MessageBlock } from "./message-block.tsx";
import { SearchBar } from "./search-bar.tsx";

const APPROX_ROWS_PER_MSG = 3;

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
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");

  // Reset cursor/expansion when message stream changes (i.e., session switch).
  const ident = useMemo(() => messages.length, [messages]);
  const lastIdent = useRef(-1);
  useEffect(() => {
    if (lastIdent.current !== ident) {
      setCursor(Math.max(0, ident - 1));
      setExpanded(new Set());
      setSearchOpen(false);
      setSearchValue("");
      setCommittedQuery("");
      lastIdent.current = ident;
    }
  }, [ident]);

  const fit = Math.max(1, Math.floor((height - (searchOpen ? 1 : 0)) / APPROX_ROWS_PER_MSG));
  const lastIdx = Math.max(0, messages.length - 1);
  const safeCursor = Math.min(cursor, lastIdx);

  // Window: keep cursor inside [windowStart, windowStart + fit).
  // Anchor cursor near the bottom of the window so users see context above it.
  let windowStart = safeCursor - fit + 1;
  windowStart = Math.max(0, windowStart);
  windowStart = Math.min(windowStart, Math.max(0, messages.length - fit));
  const windowEnd = Math.min(messages.length, windowStart + fit);

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return; // SearchBar's TextInput owns keys
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    const max = lastIdx;
    const half = Math.max(1, Math.floor(fit / 2));
    if (input === "j" || key.downArrow) setCursor(c => Math.min(max, c + 1));
    else if (input === "k" || key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.ctrl && input === "d") setCursor(c => Math.min(max, c + half));
    else if (key.ctrl && input === "u") setCursor(c => Math.max(0, c - half));
    else if (key.pageDown) setCursor(c => Math.min(max, c + fit));
    else if (key.pageUp) setCursor(c => Math.max(0, c - fit));
    else if (input === "G") setCursor(max);
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

  const visible = messages.slice(windowStart, windowEnd);
  const showOverflowHint = messages.length > fit;
  const query = committedQuery || (searchOpen ? searchValue : "");

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
        {visible.map((m, i) => {
          const realIdx = windowStart + i;
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
            {windowStart > 0 ? "  ↑ " : "    "}
            {safeCursor + 1} / {messages.length}
            {windowEnd < messages.length ? "  ↓" : "   "}
          </Text>
        </Box>
      )}
    </Box>
  );
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
