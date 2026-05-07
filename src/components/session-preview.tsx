// src/components/session-preview.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../providers/types.ts";
import { MessageBlock } from "./message-block.tsx";
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
  const [scroll, setScroll] = useState(0);                  // line offset from bottom (0 = at bottom)
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [activeTool, setActiveTool] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");

  // Reset scroll/expansion when message stream changes (i.e., session switch).
  const ident = useMemo(() => messages.length, [messages]);
  const lastIdent = useRef(ident);
  useEffect(() => {
    if (lastIdent.current !== ident) {
      setScroll(0);
      setExpanded(new Set());
      setActiveTool(0);
      setSearchOpen(false);
      setSearchValue("");
      setCommittedQuery("");
      lastIdent.current = ident;
    }
  }, [ident]);

  const toolIndices = useMemo(
    () => messages.flatMap((m, i) => (m.role === "tool_use" || m.role === "tool_result") ? [i] : []),
    [messages],
  );

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return; // SearchBar handles its own input via TextInput
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    if (input === "j" || key.downArrow) setScroll(s => Math.max(0, s - 1));
    else if (input === "k" || key.upArrow) setScroll(s => s + 1);
    else if (key.ctrl && input === "d") setScroll(s => Math.max(0, s - Math.floor(height / 2)));
    else if (key.ctrl && input === "u") setScroll(s => s + Math.floor(height / 2));
    else if (key.pageDown) setScroll(s => Math.max(0, s - height));
    else if (key.pageUp) setScroll(s => s + height);
    else if (input === "G") setScroll(0);
    else if (input === "g") setScroll(Number.MAX_SAFE_INTEGER);
    else if (key.tab && !key.shift) {
      // Toggle expand on the active tool block.
      const idx = toolIndices[activeTool];
      if (idx != null) {
        setExpanded(prev => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx); else next.add(idx);
          return next;
        });
      }
    } else if (key.tab && key.shift) {
      if (toolIndices.length > 0) {
        setActiveTool(t => (t + 1) % toolIndices.length);
      }
    }
  });

  if (messages.length === 0) {
    return (
      <Box width={width} height={height} alignItems="center" justifyContent="center">
        <Text dimColor>(no messages)</Text>
      </Box>
    );
  }

  // For MVP we render every message and rely on Ink's box height to clip.
  // Scroll is approximated by trimming messages from the top: each scroll unit
  // pushes one message off the top, exposing more recent content below. When
  // scroll === 0 we show only the tail that fits.
  const tailMessages = sliceForScroll(messages, scroll, height);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {searchOpen && (
        <SearchBar
          label="🔎"
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={(v) => { setCommittedQuery(v); setSearchOpen(false); }}
        />
      )}
      <Box flexDirection="column" flexGrow={1}>
        {tailMessages.map((m, i) => (
          <MessageBlock
            key={`${i}-${m.timestamp.getTime()}`}
            message={highlight(m, committedQuery || (searchOpen ? searchValue : ""))}
            expanded={expanded.has(messages.indexOf(m))}
            emoji={emoji}
          />
        ))}
      </Box>
    </Box>
  );
}

function sliceForScroll(all: Message[], scroll: number, height: number): Message[] {
  // Approximate: each message takes >=2 rows, so we keep enough messages to
  // overflow the height. The Box clips the rest.
  const approxPerMsg = 3;
  const fit = Math.max(1, Math.ceil(height / approxPerMsg));
  const upTo = Math.max(0, all.length - scroll);
  const start = Math.max(0, upTo - fit);
  return all.slice(start, upTo);
}

function highlight(m: Message, query: string): Message {
  if (!query) return m;
  // Case-insensitive substring; wrap matches with ANSI inverse.
  const re = new RegExp(escape(query), "gi");
  const inverse = (s: string) => `\x1b[7m${s}\x1b[27m`;
  const next = { ...m, content: m.content.replace(re, inverse) };
  return next;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
