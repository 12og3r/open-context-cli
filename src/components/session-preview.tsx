import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import type { Message } from "../providers/types.ts";
import {
  applyCursorOverlay,
  CancelledError,
  renderConversationAsync,
  type ConversationBuffer,
} from "../lib/render-message.ts";
import { SearchBar } from "./search-bar.tsx";
import type { Match } from "../lib/matches.ts";

const EMPTY_BUFFER: ConversationBuffer = { lines: [], startLine: [], endLine: [], matches: [] };

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
  const [matchIndex, setMatchIndex] = useState<number>(-1);

  // Reset only on real session switch.
  useEffect(() => {
    setPinToBottom(true);
    setCursor(0);
    setScrollLine(0);
    setExpanded(new Set());
    setSearchOpen(false);
    setSearchValue("");
    setCommittedQuery("");
    setMatchIndex(-1);
    lastInitKey.current = null;
  }, [sessionId]);

  const lastIdx = Math.max(0, messages.length - 1);
  const viewportHeight = Math.max(1, height - 1 - (searchOpen ? 1 : 0));
  const query = committedQuery || (searchOpen ? searchValue : "");

  const effectiveCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);

  // The buffer is built off the render path so a heavy markdown→ANSI pass
  // (~700 ms on a 1000-message session) doesn't block the React commit
  // phase or the terminal-input handlers. While the build is in flight we
  // show a spinner; the build is cancelled if the inputs change underneath.
  const [buffer, setBuffer] = useState<ConversationBuffer>(EMPTY_BUFFER);
  const [isBuilding, setIsBuilding] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsBuilding(true);
    (async () => {
      try {
        const result = await renderConversationAsync(
          messages,
          { width, expanded, emoji, now: new Date(), query, matchIndex },
          () => cancelled,
        );
        if (cancelled) return;
        setBuffer(result);
        setIsBuilding(false);
      } catch (err) {
        if (err instanceof CancelledError) return;
        throw err;
      }
    })();
    return () => { cancelled = true; };
  }, [messages, width, expanded, emoji, query, matchIndex]);

  const matches = buffer.matches;
  const matchCount = matches.length;

  const totalLines = buffer.lines.length;
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const actualScrollLine = pinToBottom ? maxScroll : clampToRange(scrollLine, 0, maxScroll);

  // Persist the clamped scroll value when it differs from state.
  useEffect(() => {
    if (!pinToBottom && actualScrollLine !== scrollLine) setScrollLine(actualScrollLine);
  }, [actualScrollLine, scrollLine, pinToBottom]);

  // Scroll the viewport so that match `m` is visible. The line is approximate:
  // it interpolates by character offset within the message, which can drift
  // from the rendered line for word-wrapped or markdown-heavy content. Good
  // enough to bring the match into view; the visible highlight does the rest.
  const scrollMatchIntoView = (m: Match) => {
    const msgStart = buffer.startLine[m.msgIndex] ?? 0;
    const msgEnd = buffer.endLine[m.msgIndex] ?? totalLines;
    const msgHeight = Math.max(1, msgEnd - msgStart);
    const content = messages[m.msgIndex]?.content ?? "";
    const fraction = content.length > 0 ? m.contentOffset / content.length : 0;
    const approxLine = msgStart + Math.floor(fraction * msgHeight);
    if (approxLine < actualScrollLine || approxLine >= actualScrollLine + viewportHeight) {
      setScrollLine(clampToRange(approxLine - 2, 0, maxScroll));
    }
  };

  // Track the query|messages.length pair for which we last placed the initial
  // matchIndex. Using a ref avoids adding matchIndex to the dep array (which
  // would loop: effect sets matchIndex → re-render → matches identity changes
  // → effect re-runs).
  const lastInitKey = useRef<string | null>(null);

  useEffect(() => {
    if (!searchOpen) { lastInitKey.current = null; return; }
    if (matches.length === 0) {
      if (matchIndex !== -1) setMatchIndex(-1);
      return;
    }

    const initKey = `${query}|${messages.length}`;
    if (lastInitKey.current === initKey) return;
    lastInitKey.current = initKey;

    // cursor, pinToBottom, lastIdx are intentionally not deps — we want their
    // values at the moment the search opens (or the query/messages change),
    // not on every cursor move.
    const startCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);
    const firstAfter = matches.findIndex(m => m.msgIndex >= startCursor);
    const idx = firstAfter >= 0 ? firstAfter : 0;
    setMatchIndex(idx);

    const target = matches[idx]!;
    setCursor(target.msgIndex);
    setPinToBottom(false);
    scrollMatchIntoView(target);
  // matches is derived from buffer.matches which lags during async render;
  // including it lets us re-run once the buffer catches up. Loop is bounded
  // by the initKey guard above.
  }, [searchOpen, query, messages, matches]);

  // Step the viewport by `delta` lines. Cursor only crosses to a neighbor when
  // that neighbor's first line is visible in the post-scroll viewport. As a
  // safety net, if the cursor's own message would scroll entirely off-screen,
  // the cursor falls back to the nearest visible message.
  const step = (delta: number) => {
    const wasPinned = pinToBottom;
    const curCursor = wasPinned ? lastIdx : Math.min(cursor, lastIdx);
    const curScroll = wasPinned ? maxScroll : actualScrollLine;

    const nextScroll = clampToRange(curScroll + delta, 0, maxScroll);
    let nextCursor = curCursor;

    if (delta > 0 && curCursor < lastIdx) {
      const nextStart = buffer.startLine[curCursor + 1] ?? totalLines;
      if (nextStart >= nextScroll && nextStart < nextScroll + viewportHeight) {
        nextCursor = curCursor + 1;
      }
    } else if (delta < 0 && curCursor > 0) {
      const prevStart = buffer.startLine[curCursor - 1] ?? 0;
      if (prevStart >= nextScroll && prevStart < nextScroll + viewportHeight) {
        nextCursor = curCursor - 1;
      }
    }

    // Reel cursor back onto a visible message if it would otherwise be entirely
    // outside the viewport.
    const cs = buffer.startLine[nextCursor] ?? 0;
    const ce = buffer.endLine[nextCursor] ?? totalLines;
    if (ce <= nextScroll) {
      // Cursor's message is entirely above the viewport — pick the topmost
      // message that still has content showing.
      for (let i = 0; i <= lastIdx; i++) {
        if ((buffer.endLine[i] ?? 0) > nextScroll) {
          nextCursor = i;
          break;
        }
      }
    } else if (cs >= nextScroll + viewportHeight) {
      // Entirely below the viewport — pick the bottommost visible message.
      for (let i = lastIdx; i >= 0; i--) {
        if ((buffer.startLine[i] ?? 0) < nextScroll + viewportHeight) {
          nextCursor = i;
          break;
        }
      }
    }

    setPinToBottom(nextCursor === lastIdx && nextScroll === maxScroll);
    setCursor(nextCursor);
    setScrollLine(nextScroll);
  };

  // goToMatch: single entry point for jumping to a match by index.
  // Math.max(0, matchIndex) guards against -1, but in practice Task 7's init
  // effect has already set matchIndex >= 0 before onNext/onPrev are reachable.
  const goToMatch = (idx: number) => {
    if (idx < 0 || idx >= matches.length) return;
    const m = matches[idx]!;
    setMatchIndex(idx);
    setCursor(m.msgIndex);
    setPinToBottom(false);
    scrollMatchIntoView(m);
  };

  const onNext = () => {
    if (matches.length === 0) return;
    goToMatch((Math.max(0, matchIndex) + 1) % matches.length);
  };

  const onPrev = () => {
    if (matches.length === 0) return;
    goToMatch((Math.max(0, matchIndex) - 1 + matches.length) % matches.length);
  };

  const commitSearch = () => {
    setSearchOpen(false);
    setCommittedQuery(searchValue);
    if (matches.length > 0 && matchIndex >= 0) {
      const target = matches[matchIndex]!;
      setCursor(target.msgIndex);
      setPinToBottom(target.msgIndex === lastIdx);
    }
  };

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return;

    // searchOpen is already guarded above; just check the committed query.
    const inAfterglow = committedQuery !== "";
    const isOrdinaryNav =
      key.upArrow || key.downArrow || key.leftArrow || key.rightArrow ||
      input === "j" || input === "k" || input === "g" || input === "G" ||
      key.pageUp || key.pageDown ||
      (key.ctrl && (input === "d" || input === "u")) ||
      (key.tab && !key.shift);

    if (inAfterglow && isOrdinaryNav) {
      setCommittedQuery("");
      setMatchIndex(-1);
      // Fall through — the key still performs its normal action below.
    }

    const openSearchFresh = () => {
      setCommittedQuery("");
      setSearchValue("");
      setMatchIndex(-1);
      setSearchOpen(true);
    };

    if ((key.ctrl && (input === "f" || input === "F")) || input === "/") {
      openSearchFresh();
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
    else if ((key.tab && !key.shift) || key.return) {
      const target = pinToBottom ? lastIdx : effectiveCursor;
      if (key.return) {
        const role = messages[target]?.role;
        if (role !== "tool_use" && role !== "tool_result") return;
      }
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

  if (isBuilding) {
    return (
      <Box width={width} height={height} alignItems="center" justifyContent="center">
        <Box>
          <Text color="cyan"><Spinner /></Text>
          <Text dimColor> rendering…</Text>
        </Box>
      </Box>
    );
  }

  const showOverflowHint = totalLines > viewportHeight;
  const hasAbove = actualScrollLine > 0;
  const hasBelow = actualScrollLine + viewportHeight < totalLines;

  const cursorStart = buffer.startLine[effectiveCursor] ?? -1;
  const cursorEnd = buffer.endLine[effectiveCursor] ?? -1;
  const cursorLastLine = cursorEnd - 1;

  const visibleLines: string[] = [];
  for (let i = actualScrollLine; i < actualScrollLine + viewportHeight; i++) {
    if (i >= totalLines) {
      visibleLines.push("");
      continue;
    }
    const raw = buffer.lines[i] ?? "";
    if (focused && i >= cursorStart && i < cursorEnd) {
      const kind = i === cursorStart ? "header" : i === cursorLastLine ? "margin" : "body";
      visibleLines.push(applyCursorOverlay(raw, kind));
    } else {
      visibleLines.push(raw);
    }
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {searchOpen && (
        <SearchBar
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={commitSearch}
          onCancel={commitSearch}
          onPrev={onPrev}
          onNext={onNext}
          matchIndex={matchIndex}
          matchCount={matchCount}
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
