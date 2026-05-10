import wrapAnsi from "wrap-ansi";
import emojiRegex from "emoji-regex";
import stringWidth from "string-width";
import type { Message, Role } from "../providers/types.ts";
import { markdownToAnsi } from "./markdown-ansi.ts";
import { findMatches, type Match } from "./matches.ts";
import { DEFAULT_LANG, t, type Lang } from "./i18n.ts";
import { localTimeOfDay, relativeTime } from "./relative-time.ts";
import { truncate } from "./truncate.ts";

// Apple Color Emoji renders some glyphs taller than the monospace cell — most
// visibly ✅ in Warp / Ghostty — so the row containing the emoji vertically
// pushes / steals from neighboring rows. We can't change the terminal's row
// height from here, and a blank-spacer compensation does not help in every
// terminal, so the only reliable fix is to never let the terminal reach for
// the emoji font in the first place: replace each emoji match with width-
// preserving whitespace before the content goes through markdown / wrapping.
const EMOJI_RE_GLOBAL = emojiRegex();
function stripEmojiKeepWidth(s: string): string {
  EMOJI_RE_GLOBAL.lastIndex = 0;
  return s.replace(EMOJI_RE_GLOBAL, m => " ".repeat(Math.max(1, stringWidth(m))));
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const FG_CYAN = "\x1b[36m";
const FG_MAGENTA = "\x1b[35m";
const FG_YELLOW = "\x1b[33m";
const FG_GRAY = "\x1b[90m";

const ROLE_EMOJI: Record<Role, string> = {
  user: "👨",
  assistant: "🤖",
  tool_use: "🔧",
  tool_result: "📥",
  system: "ℹ️ ",
};

const ROLE_FG: Record<Role, string> = {
  user: FG_CYAN,
  assistant: FG_MAGENTA,
  tool_use: FG_YELLOW,
  tool_result: FG_GRAY,
  system: FG_GRAY,
};

function isPrimary(role: Role): boolean {
  return role === "user" || role === "assistant";
}

function headerLabel(m: Message, lang: Lang): string {
  switch (m.role) {
    case "tool_use": return m.toolName ?? t(lang, "role.tool");
    case "tool_result": return t(lang, "role.tool_result");
    default: return t(lang, `role.${m.role}`);
  }
}

export type RenderMessageOpts = {
  width: number;
  current: boolean;
  expanded: boolean;
  emoji: boolean;
  now: Date;
  lang?: Lang;
};

/**
 * Render one Message into the array of terminal lines it occupies. Each line
 * is an ANSI-styled string with no embedded newlines, sized so that
 * stringWidth(line) <= width. The output always ends with one blank line so
 * adjacent messages are separated by visible space.
 */
export function renderMessageLines(message: Message, opts: RenderMessageOpts): string[] {
  const { width, current, expanded, emoji, now, lang = DEFAULT_LANG } = opts;
  const out: string[] = [];

  const fg = ROLE_FG[message.role];
  const primary = isPrimary(message.role);
  const muted = (message.role === "system" || message.role === "tool_result") && !current;

  const cursorMark = current ? `${FG_CYAN}${BOLD}› ${RESET}` : "  ";
  const bar = `${fg}${primary ? BOLD : ""}▍ ${RESET}`;
  const labelText = `${emoji ? ROLE_EMOJI[message.role] + " " : ""}${headerLabel(message, lang)}`;
  let labelStyle = fg;
  if (primary || current) labelStyle += BOLD;
  if (message.role === "system") labelStyle += ITALIC;
  if (muted) labelStyle += DIM;
  const time = relativeTime(message.timestamp, now, lang);
  const clock = localTimeOfDay(message.timestamp);
  out.push(
    `${cursorMark}${bar}${labelStyle}${labelText}${RESET}${DIM}  ·  ${time}  ·  ${clock}${RESET}`,
  );

  const indent = "    ";
  // Reserve 1 cell of slack so the cursor-body overlay fits even when its
  // stripe character `▏` (U+258F, East-Asian-Width = Ambiguous) is rendered
  // as 2 cells. CJK-configured terminals commonly draw Ambiguous-width chars
  // 2 cells wide, in which case the overlay prefix "  ▏ " visually occupies
  // 5 cells instead of 4. Without this slack, body lines wrapped to fit
  // innerWidth exactly would overflow by 1 cell when the cursor lands on the
  // message — the terminal auto-wraps them, breaking the pane layout.
  const bodyWidth = Math.max(8, width - indent.length - 1);
  let bodyText: string;
  let bodyStyle = "";

  if (message.role === "tool_use" || message.role === "tool_result") {
    const content = stripEmojiKeepWidth(message.content || "");
    const lines = content.split("\n");
    const lineCount = lines.length;
    bodyStyle = DIM;
    // Single-line tool bodies have nothing to reveal — drop the disclosure
    // icon and the expand affordance entirely. Multi-line bodies keep the
    // icon in both states so the user can see *that* the row is expandable
    // (▸ collapsed, ▾ expanded) instead of having the marker disappear on
    // open.
    if (lineCount <= 1) {
      bodyText = truncate(content, bodyWidth);
    } else if (!expanded) {
      bodyText = truncate(`▸ ${lines[0] ?? ""}  (${lineCount} lines)`, bodyWidth);
    } else {
      bodyText = `▾ ${content}`;
    }
  } else if (message.role === "system") {
    bodyText = stripEmojiKeepWidth(message.content || "");
    bodyStyle = `${DIM}${ITALIC}`;
  } else {
    bodyText = markdownToAnsi(stripEmojiKeepWidth(message.content || ""));
  }

  // Body line prefix: matches the header's bar column. For the current
  // (cursor) message we render a thin cyan stripe so you can see which
  // message you're on even when its header has scrolled off-screen.
  const bodyPrefix = current
    ? `  ${FG_CYAN}▏${RESET} `
    : indent;

  if (bodyText.length > 0) {
    const wrapped = wrapAnsi(bodyText, bodyWidth, { hard: true, trim: false });
    for (const ln of wrapped.split("\n")) {
      // Always wrap the body line in its own style envelope so a wrapped row
      // doesn't inherit stale styles from the previous one.
      out.push(`${bodyPrefix}${bodyStyle}${ln}${RESET}`);
    }
  }

  // Trailing margin row also carries the stripe so the visible "current
  // message" band is uninterrupted at the bottom of the message.
  out.push(current ? `  ${FG_CYAN}▏${RESET}` : "");
  return out;
}

// Per-message render cache. Keyed by the Message object reference (so it's
// automatically dropped when the session is evicted from useSessionDetail's
// detailCache). Within each bucket we keep a small set of variant renderings
// keyed by the rendering options that affect line content.
const messageLineCache = new WeakMap<Message, Map<string, string[]>>();
const PER_MESSAGE_CACHE_LIMIT = 4;

function memoRenderMessageLines(
  message: Message,
  width: number,
  expanded: boolean,
  emoji: boolean,
  now: Date,
  lang: Lang,
): string[] {
  let bucket = messageLineCache.get(message);
  if (!bucket) {
    bucket = new Map();
    messageLineCache.set(message, bucket);
  }
  // Round 'now' to the minute so cached line entries don't churn on every
  // render but still pick up "Nm ago → (N+1)m ago" eventually.
  const nowMin = Math.floor(now.getTime() / 60_000);
  const key = `${width}|${emoji ? 1 : 0}|${expanded ? 1 : 0}|${nowMin}|${lang}`;
  const cached = bucket.get(key);
  if (cached !== undefined) return cached;

  const lines = renderMessageLines(message, { width, current: false, expanded, emoji, now, lang });
  bucket.set(key, lines);
  if (bucket.size > PER_MESSAGE_CACHE_LIMIT) {
    const firstKey: string | undefined = bucket.keys().next().value;
    if (firstKey !== undefined) bucket.delete(firstKey);
  }
  return lines;
}

export type ConversationBuffer = {
  lines: string[];
  startLine: number[];
  endLine: number[];
  matches: Match[];
};

export type RenderConversationOpts = {
  width: number;
  expanded: Set<number>;
  emoji: boolean;
  now: Date;
  query: string;
  matchIndex: number;
  lang?: Lang;
};

const YIELD_EVERY = 64;

/**
 * Synchronous render — keep for tests and tiny fixtures. Real previews use
 * `renderConversationAsync` so the markdown→ANSI pass for big sessions
 * doesn't block the React commit / event loop.
 */
export function renderConversation(messages: Message[], opts: RenderConversationOpts): ConversationBuffer {
  const hasQuery = !!opts.query;
  const { messages: hl, matches } = hasQuery
    ? applyHighlight(messages, opts.query, opts.matchIndex)
    : { messages, matches: [] as Match[] };
  const lines: string[] = [];
  const startLine: number[] = new Array(hl.length);
  const endLine: number[] = new Array(hl.length);
  for (let i = 0; i < hl.length; i++) {
    startLine[i] = lines.length;
    // Only messages whose content was rewritten by applyHighlight (new ref)
    // bypass the WeakMap cache. The rest still hit it, so a search query
    // that matches a few of N messages isn't an N-message re-render.
    const cacheable = hl[i] === messages[i];
    const msgLines = renderOne(hl[i]!, opts, cacheable, i);
    for (const ml of msgLines) lines.push(ml);
    endLine[i] = lines.length;
  }
  return { lines, startLine, endLine, matches };
}

/**
 * Build the conversation buffer in chunks, yielding to the event loop every
 * `YIELD_EVERY` messages so terminal input handlers can run while rendering.
 * Per-message rendering is memoized via WeakMap, so revisiting a cached
 * session completes in microseconds even though it still walks the loop.
 *
 * Throws a `CancelledError` if `isCancelled()` returns true between batches.
 */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

export async function renderConversationAsync(
  messages: Message[],
  opts: RenderConversationOpts,
  isCancelled?: () => boolean,
): Promise<ConversationBuffer> {
  const hasQuery = !!opts.query;
  const { messages: hl, matches } = hasQuery
    ? applyHighlight(messages, opts.query, opts.matchIndex)
    : { messages, matches: [] as Match[] };
  const lines: string[] = [];
  const startLine: number[] = new Array(hl.length);
  const endLine: number[] = new Array(hl.length);
  for (let i = 0; i < hl.length; i++) {
    if (isCancelled?.()) throw new CancelledError();
    startLine[i] = lines.length;
    // Per-message cache decision: messages whose content was rewritten by
    // applyHighlight (new ref) bypass the WeakMap cache; the rest still hit
    // it so a sparse search isn't an N-message markdown re-render.
    const cacheable = hl[i] === messages[i];
    const msgLines = renderOne(hl[i]!, opts, cacheable, i);
    for (const ml of msgLines) lines.push(ml);
    endLine[i] = lines.length;
    if ((i + 1) % YIELD_EVERY === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return { lines, startLine, endLine, matches };
}

function renderOne(
  message: Message,
  opts: RenderConversationOpts,
  useCache: boolean,
  i: number,
): string[] {
  const lang = opts.lang ?? DEFAULT_LANG;
  if (useCache) {
    return memoRenderMessageLines(message, opts.width, opts.expanded.has(i), opts.emoji, opts.now, lang);
  }
  return renderMessageLines(message, {
    width: opts.width,
    current: false,
    expanded: opts.expanded.has(i),
    emoji: opts.emoji,
    now: opts.now,
    lang,
  });
}

/**
 * Overlay the cursor styling on a single rendered line. Cheap — just rewrites
 * the leading prefix. Called per visible line of the cursor's message.
 */
export function applyCursorOverlay(line: string, kind: "header" | "body" | "margin"): string {
  if (kind === "margin") {
    return `  ${FG_CYAN}▏${RESET}`;
  }
  if (kind === "header") {
    // Header lines from renderMessageLines start with "  " (two spaces) when
    // current=false. Replace those two columns with the cursor mark.
    return `${FG_CYAN}${BOLD}› ${RESET}` + line.slice(2);
  }
  // body: starts with 4 spaces of indent. Replace with "  ▏ ".
  return `  ${FG_CYAN}▏${RESET} ` + line.slice(4);
}

// Outline (non-current) matches: underline only. Underline is rarely used by
// markdown body text, so opening 4m / closing 24m doesn't clobber any embedded
// bold/italic. Avoid using \x1b[22m here — it would reset markdown bold too.
const OUTLINE_OPEN = "\x1b[4m";
const OUTLINE_CLOSE = "\x1b[24m";
// Current (selected) match: red fg + underline. We avoid background-color
// schemes (bright-bg \x1b[107m, standard bg \x1b[43m, reverse \x1b[7m) because
// many terminals only paint background on the first cell of a 2-cell CJK
// glyph, leaving the highlight visibly half-width. Foreground color and
// underline both apply cell-by-cell, so they always cover the full glyph.
// The closes (\x1b[39m, \x1b[24m) only reset fg/underline, leaving any
// surrounding markdown styles intact.
const CURRENT_OPEN = "\x1b[4m\x1b[31m";
const CURRENT_CLOSE = "\x1b[24m\x1b[39m";

export function applyHighlight(
  messages: Message[],
  query: string,
  matchIndex: number,
): { messages: Message[]; matches: Match[] } {
  if (!query) return { messages, matches: [] };
  const matches = findMatches(messages, query);
  if (matches.length === 0) return { messages, matches };

  // Group matches by msgIndex for one pass per affected message.
  const byMsg = new Map<number, Array<{ m: Match; globalIdx: number }>>();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    let arr = byMsg.get(m.msgIndex);
    if (!arr) { arr = []; byMsg.set(m.msgIndex, arr); }
    arr.push({ m, globalIdx: i });
  }

  const newMessages = messages.map((m, i) => {
    const list = byMsg.get(i);
    if (!list) return m;
    let result = "";
    let cursor = 0;
    for (const { m: match, globalIdx } of list) {
      result += m.content.slice(cursor, match.contentOffset);
      const isCurrent = globalIdx === matchIndex;
      const open = isCurrent ? CURRENT_OPEN : OUTLINE_OPEN;
      const close = isCurrent ? CURRENT_CLOSE : OUTLINE_CLOSE;
      result +=
        open +
        m.content.slice(match.contentOffset, match.contentOffset + match.length) +
        close;
      cursor = match.contentOffset + match.length;
    }
    result += m.content.slice(cursor);
    return { ...m, content: result };
  });

  return { messages: newMessages, matches };
}
