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
import { t } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";
import { trace } from "../lib/debug-trace.ts";

const EMPTY_BUFFER: ConversationBuffer = { lines: [], startLine: [], endLine: [], matches: [] };

export function SessionPreview({
  messages,
  sessionId,
  focused,
  height,
  width,
  emoji = true,
  showHash = false,
  onRequestContinue,
}: {
  messages: Message[];
  sessionId: string | null;
  focused: boolean;
  height: number;
  width: number;
  emoji?: boolean;
  showHash?: boolean;
  onRequestContinue?: (info: { targetUuid: string; targetRole: "user" | "assistant"; userText?: string }) => void;
}) {
  const lang = useLang();
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
  // continueOpen: when true, the bottom shows a "↪ Continue conversation"
  // confirm row and ordinary preview navigation is suppressed. Enter confirms,
  // Esc cancels.
  const [continueOpen, setContinueOpen] = useState(false);

  // Track the query|messages.length pair for which we last placed the initial
  // matchIndex. Using a ref avoids adding matchIndex to the dep array (which
  // would loop: effect sets matchIndex → re-render → matches identity changes
  // → effect re-runs). Loop is bounded by the initKey guard.
  const lastInitKey = useRef<string | null>(null);

  // Tracks the last visited match position (msgIndex + contentOffset).
  // On first open the anchor is null (falls back to cursor). After each
  // navigate or re-anchor the ref is updated so that narrowing the query
  // stays near the user's current offset within a long message.
  const lastAnchorRef = useRef<{ msgIndex: number; contentOffset: number } | null>(null);

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
    setContinueOpen(false);
    lastInitKey.current = null;
    lastAnchorRef.current = null;
    // Wipe the buffer so the spinner shows for the new session, instead of
    // flashing the previous session's content while the new render is in flight.
    setBuffer(EMPTY_BUFFER);
  }, [sessionId]);

  const lastIdx = Math.max(0, messages.length - 1);
  // The search row is visible while the user is typing (searchOpen) AND
  // while the committed query's highlights are still on screen (afterglow),
  // so the user always sees what they searched for and which match is current.
  // When shown, it's the bar + a thin separator rule = 2 rows.
  const showSearchRow = searchOpen || committedQuery !== "";
  // Both rows take 2 lines (separator + content). Reserve room for whichever
  // are visible so the message list isn't clipped from the bottom.
  const extraRows = (showSearchRow ? 2 : 0) + (continueOpen ? 2 : 0);
  const viewportHeight = Math.max(1, height - 1 - extraRows);
  const query = committedQuery || (searchOpen ? searchValue : "");

  const effectiveCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);

  // The buffer is built off the render path so a heavy markdown→ANSI pass
  // (~700 ms on a 1000-message session) doesn't block the React commit
  // phase or the terminal-input handlers. We keep the previous buffer
  // visible while the next render is in flight so typing in the search bar
  // doesn't flash the screen on every keystroke; only the initial build
  // (buffer === EMPTY_BUFFER) shows the spinner.
  const [buffer, setBuffer] = useState<ConversationBuffer>(EMPTY_BUFFER);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await renderConversationAsync(
          messages,
          { width, expanded, emoji, now: new Date(), query, matchIndex, lang },
          () => cancelled,
        );
        if (cancelled) return;
        setBuffer(result);
      } catch (err) {
        if (err instanceof CancelledError) return;
        throw err;
      }
    })();
    return () => { cancelled = true; };
  }, [messages, width, expanded, emoji, query, matchIndex, lang]);

  const matches = buffer.matches;
  const matchCount = matches.length;

  const totalLines = buffer.lines.length;
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const actualScrollLine = pinToBottom ? maxScroll : clampToRange(scrollLine, 0, maxScroll);

  // Persist the clamped scroll value when it differs from state.
  useEffect(() => {
    if (!pinToBottom && actualScrollLine !== scrollLine) setScrollLine(actualScrollLine);
  }, [actualScrollLine, scrollLine, pinToBottom]);

  // Keep matchIndex in bounds whenever the matches array changes. The init
  // effect's lastInitKey guard short-circuits a re-anchor once a query is
  // already in flight, so a buffer that settles with a smaller match set
  // would otherwise leave matchIndex pointing past matches.length. Loop is
  // bounded — once matchIndex is in range the body is a no-op.
  useEffect(() => {
    if (matches.length === 0) {
      if (matchIndex !== -1) setMatchIndex(-1);
    } else if (matchIndex >= matches.length) {
      setMatchIndex(matches.length - 1);
    }
  }, [matches, matchIndex]);

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

  useEffect(() => {
    if (!searchOpen) {
      lastInitKey.current = null;
      lastAnchorRef.current = null;
      return;
    }
    if (matches.length === 0) {
      if (matchIndex !== -1) setMatchIndex(-1);
      return;
    }

    const initKey = `${query}|${messages.length}`;
    if (lastInitKey.current === initKey) return;
    lastInitKey.current = initKey;

    // Determine anchor: on first open use cursor position; on subsequent
    // typing use the last visited match (preserves offset within a message).
    let anchorMsgIndex: number;
    let anchorOffset: number;
    if (lastAnchorRef.current === null) {
      // First open — anchor to the cursor's message, offset 0.
      const startCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);
      anchorMsgIndex = startCursor;
      anchorOffset = 0;
    } else {
      anchorMsgIndex = lastAnchorRef.current.msgIndex;
      anchorOffset = lastAnchorRef.current.contentOffset;
    }

    // First match at-or-after the anchor (both msgIndex and contentOffset).
    const firstAfter = matches.findIndex(
      m => m.msgIndex > anchorMsgIndex ||
           (m.msgIndex === anchorMsgIndex && m.contentOffset >= anchorOffset)
    );
    const idx = firstAfter >= 0 ? firstAfter : 0;
    setMatchIndex(idx);

    const target = matches[idx]!;
    // Update anchor to the chosen match so the next query change stays here.
    lastAnchorRef.current = { msgIndex: target.msgIndex, contentOffset: target.contentOffset };
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
    // Update the anchor so that subsequent query narrowing stays near this offset.
    lastAnchorRef.current = { msgIndex: m.msgIndex, contentOffset: m.contentOffset };
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
    lastAnchorRef.current = null;
    // Clamp defensively: narrowing a query (e.g. "a"→"a3") can shrink matches
    // before the init effect re-anchors, so matchIndex may have drifted past
    // matches.length. Without this guard, matches[matchIndex] is undefined
    // and target.msgIndex throws.
    if (matches.length > 0) {
      const safeIdx = matchIndex >= 0 && matchIndex < matches.length
        ? matchIndex
        : 0;
      if (safeIdx !== matchIndex) setMatchIndex(safeIdx);
      const target = matches[safeIdx]!;
      setCursor(target.msgIndex);
      setPinToBottom(target.msgIndex === lastIdx);
    }
  };

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return;

    // Continue-conversation footer mode: suppress all preview navigation;
    // Enter confirms (calls back), Esc cancels.
    if (continueOpen) {
      trace("preview", `continueOpen handler key.return=${!!key.return} key.escape=${!!key.escape}`);
      if (key.return) {
        const target = pinToBottom ? lastIdx : effectiveCursor;
        const msg = messages[target];
        trace("preview", `confirm target=${target} role=${msg?.role} uuid=${msg?.uuid?.slice(0, 8) ?? "(none)"}`);
        if (msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.uuid === "string") {
          trace("preview", "calling onRequestContinue");
          onRequestContinue?.({
            targetUuid: msg.uuid,
            targetRole: msg.role,
            userText: msg.role === "user" ? msg.content : undefined,
          });
          trace("preview", "onRequestContinue returned");
        } else {
          trace("preview", `gate failed: msg=${!!msg} uuidIsString=${typeof msg?.uuid === "string"}`);
        }
        setContinueOpen(false);
      } else if (key.escape) {
        setContinueOpen(false);
      }
      return;
    }

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
        // Enter on user/assistant rows opens the continue-conversation footer.
        // Tool rows still toggle expansion as before.
        if (role === "user" || role === "assistant") {
          if (typeof messages[target]?.uuid === "string") setContinueOpen(true);
          return;
        }
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
        <Text dimColor>{t(lang, "empty.messages")}</Text>
      </Box>
    );
  }

  // Initial build only — once we have a buffer we keep showing it through
  // subsequent re-renders, so typing in search doesn't flash the spinner.
  if (buffer === EMPTY_BUFFER) {
    return (
      <Box width={width} height={height} alignItems="center" justifyContent="center">
        <Box>
          <Text color="cyan"><Spinner /></Text>
          <Text dimColor> {t(lang, "loading.rendering")}</Text>
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

  // After the clamp effect runs matchIndex is in [0, matches.length); use a
  // local clamp here too so the afterglow indicator never shows a stale
  // out-of-range position during the brief window before the effect commits.
  const displayMatchIndex = matches.length > 0 && matchIndex >= 0
    ? Math.min(matchIndex, matches.length - 1)
    : -1;

  return (
    <Box flexDirection="column" width={width} height={height}>
      {showSearchRow && (
        <>
          <SearchBar
            value={searchOpen ? searchValue : committedQuery}
            onChange={setSearchValue}
            onSubmit={commitSearch}
            onCancel={commitSearch}
            onPrev={onPrev}
            onNext={onNext}
            matchIndex={searchOpen ? matchIndex : displayMatchIndex}
            matchCount={matchCount}
            readOnly={!searchOpen}
          />
          <Box flexShrink={0}>
            <Text dimColor>{"─".repeat(width)}</Text>
          </Box>
        </>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">{line || " "}</Text>
        ))}
      </Box>
      {continueOpen && (
        <Box flexDirection="column" flexShrink={0}>
          <Text dimColor>{"─".repeat(width)}</Text>
          <Text wrap="truncate" color="cyan" bold>
            {t(lang, "continue.footer_label")}
          </Text>
        </Box>
      )}
      {(showOverflowHint || showHash) && (
        <Box flexShrink={0}>
          <Text dimColor>
            {hasAbove ? "  ↑ " : "    "}
            {effectiveCursor + 1} / {messages.length}
            {hasBelow ? "  ↓" : "   "}
            {showHash && (sessionHash7(sessionId) || msgHash7(messages[effectiveCursor]))
              ? `  ·  ${formatHashes(sessionId, messages[effectiveCursor], lang)}`
              : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}

const HASH_LEN = 7;

function shortHash(s: string | null | undefined): string {
  if (!s) return "";
  return s.slice(0, HASH_LEN);
}

function sessionHash7(sessionId: string | null): string {
  return shortHash(sessionId);
}

function msgHash7(message: Message | undefined): string {
  return shortHash(message?.uuid);
}

function formatHashes(sessionId: string | null, message: Message | undefined, lang: import("../lib/i18n.ts").Lang): string {
  const sess = sessionHash7(sessionId);
  const msg = msgHash7(message);
  const sessPrefix = t(lang, "preview.session_hash_prefix");
  const msgPrefix = t(lang, "preview.msg_hash_prefix");
  const sessPart = sess ? `${sessPrefix} ${sess}` : "";
  const msgPart = msg ? `${msgPrefix} ${msg}` : "";
  if (sessPart && msgPart) return `${sessPart}  ·  ${msgPart}`;
  return sessPart || msgPart;
}

function clampToRange(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
