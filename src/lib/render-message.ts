import wrapAnsi from "wrap-ansi";
import type { Message, Role } from "../providers/types.ts";
import { markdownToAnsi } from "./markdown-ansi.ts";
import { relativeTime } from "./relative-time.ts";
import { truncate } from "./truncate.ts";

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

function headerLabel(m: Message): string {
  switch (m.role) {
    case "tool_use": return m.toolName ?? "tool";
    case "tool_result": return "result";
    default: return m.role;
  }
}

export type RenderMessageOpts = {
  width: number;
  current: boolean;
  expanded: boolean;
  emoji: boolean;
  now: Date;
};

/**
 * Render one Message into the array of terminal lines it occupies. Each line
 * is an ANSI-styled string with no embedded newlines, sized so that
 * stringWidth(line) <= width. The output always ends with one blank line so
 * adjacent messages are separated by visible space.
 */
export function renderMessageLines(message: Message, opts: RenderMessageOpts): string[] {
  const { width, current, expanded, emoji, now } = opts;
  const out: string[] = [];

  const fg = ROLE_FG[message.role];
  const primary = isPrimary(message.role);
  const muted = (message.role === "system" || message.role === "tool_result") && !current;

  const cursorMark = current ? `${FG_CYAN}${BOLD}› ${RESET}` : "  ";
  const bar = `${fg}${primary ? BOLD : ""}▍ ${RESET}`;
  const labelText = `${emoji ? ROLE_EMOJI[message.role] + " " : ""}${headerLabel(message)}`;
  let labelStyle = fg;
  if (primary || current) labelStyle += BOLD;
  if (message.role === "system") labelStyle += ITALIC;
  if (muted) labelStyle += DIM;
  const time = relativeTime(message.timestamp, now);
  out.push(
    `${cursorMark}${bar}${labelStyle}${labelText}${RESET}${DIM}  ·  ${time}${RESET}`,
  );

  const indent = "    ";
  const bodyWidth = Math.max(8, width - indent.length);
  let bodyText: string;
  let bodyStyle = "";

  if (message.role === "tool_use" || message.role === "tool_result") {
    if (!expanded) {
      const first = (message.content || "").split("\n")[0] ?? "";
      const lineCount = (message.content || "").split("\n").length;
      const tail = lineCount > 1 ? `  (${lineCount} lines)` : "";
      bodyText = truncate(`▸ ${first}${tail}`, bodyWidth);
      bodyStyle = DIM;
    } else {
      bodyText = message.content || "";
      bodyStyle = DIM;
    }
  } else if (message.role === "system") {
    bodyText = message.content || "";
    bodyStyle = `${DIM}${ITALIC}`;
  } else {
    bodyText = markdownToAnsi(message.content || "");
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
): string[] {
  let bucket = messageLineCache.get(message);
  if (!bucket) {
    bucket = new Map();
    messageLineCache.set(message, bucket);
  }
  // Round 'now' to the minute so cached line entries don't churn on every
  // render but still pick up "Nm ago → (N+1)m ago" eventually.
  const nowMin = Math.floor(now.getTime() / 60_000);
  const key = `${width}|${emoji ? 1 : 0}|${expanded ? 1 : 0}|${nowMin}`;
  const cached = bucket.get(key);
  if (cached !== undefined) return cached;

  const lines = renderMessageLines(message, { width, current: false, expanded, emoji, now });
  bucket.set(key, lines);
  if (bucket.size > PER_MESSAGE_CACHE_LIMIT) {
    const firstKey: string | undefined = bucket.keys().next().value;
    if (firstKey !== undefined) bucket.delete(firstKey);
  }
  return lines;
}

/**
 * Render the full conversation into a flat line buffer plus per-message line
 * ranges. The buffer does NOT include cursor highlighting — that gets applied
 * cheaply at view time via `applyCursorOverlay`, so we don't have to rebuild
 * the whole conversation when the cursor moves.
 *
 * Per-message rendering is memoized by Message identity, so revisiting a
 * session whose messages are still alive in detailCache is effectively free
 * (the loop just hands back cached line arrays).
 */
export function renderConversation(
  messages: Message[],
  opts: {
    width: number;
    expanded: Set<number>;
    emoji: boolean;
    now: Date;
    query: string;
  },
): {
  lines: string[];
  startLine: number[];   // startLine[i] = first line index of message i
  endLine: number[];     // endLine[i]   = first line index AFTER message i
} {
  // Highlighted messages are new objects, so we only memoize when there is no
  // search query. With a query active we accept the rebuild cost — searches
  // are interactive and infrequent compared to navigation.
  const useCache = !opts.query;
  const hl = useCache ? messages : applyHighlight(messages, opts.query).messages;

  const lines: string[] = [];
  const startLine: number[] = new Array(hl.length);
  const endLine: number[] = new Array(hl.length);
  for (let i = 0; i < hl.length; i++) {
    startLine[i] = lines.length;
    const msgLines = useCache
      ? memoRenderMessageLines(hl[i]!, opts.width, opts.expanded.has(i), opts.emoji, opts.now)
      : renderMessageLines(hl[i]!, {
          width: opts.width,
          current: false,
          expanded: opts.expanded.has(i),
          emoji: opts.emoji,
          now: opts.now,
        });
    for (const ml of msgLines) lines.push(ml);
    endLine[i] = lines.length;
  }
  return { lines, startLine, endLine };
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

const INVERSE = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

function applyHighlight(messages: Message[], query: string): { messages: Message[] } {
  if (!query) return { messages };
  const re = new RegExp(escapeRegex(query), "gi");
  return {
    messages: messages.map(m => ({
      ...m,
      content: m.content.replace(re, s => `${INVERSE}${s}${INVERSE_OFF}`),
    })),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
