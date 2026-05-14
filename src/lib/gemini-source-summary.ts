import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { trace } from "./debug-trace.ts";

// `gemini -r <id>` runs a background `generateSummary(config)` on startup
// that picks the most-recent OTHER session lacking "summary metadata" and
// writes an LLM-generated one-line summary into it via `$set:{summary}`.
// Without intervention, every fork-from-fork causes the source session to
// get re-stamped with a generic summary like
// "User wants help with a software engineering task."
//
// The check gemini uses (`hasSessionSummaryMetadata`) is misleadingly named:
// it tests `memoryScratchpad && !memoryScratchpadIsStale`, NOT `summary`.
// memoryScratchpad goes stale the moment a message or rewind appears after
// the last `$set:{memoryScratchpad}` patch — which is the normal state for
// any forked file you'd want to resume from. So preventing gemini's
// overwrite requires us to refresh memoryScratchpad (not just write a
// summary).
//
// What we do, before forking:
//   1. Stream the source once to compute its effective summary + scratchpad.
//   2. If it lacks summary OR scratchpad is stale/missing, append ONE line:
//        {"$set":{"summary":<derived>,"memoryScratchpad":<preserved>}}
//      so the source itself shows a sensible title in openctx/gemini's list,
//      and the fork (which we make next) inherits that same line via the
//      normal $set copy path — keeping both files' summaries identical.
//
// The summary is derived from the first user message, truncated to match
// gemini's own 80-char ceiling. memoryScratchpad is preserved if the source
// ever had one; otherwise we use the smallest non-falsy stub that gemini's
// loader treats as present.

const SUMMARY_MAX_CHARS = 80;
const DEFAULT_SCRATCHPAD = { version: 1 } as const;

interface SourceSummaryState {
  hasSummary: boolean;
  // True when memoryScratchpad is present in the file AND no subsequent
  // message/rewind line has made it stale.
  scratchpadFresh: boolean;
  // Preserve whatever the source's last memoryScratchpad value was so we
  // don't clobber any real content the user (or gemini) put there.
  lastScratchpad: unknown | undefined;
  firstUserText: string;
}

async function readSourceState(srcPath: string): Promise<SourceSummaryState> {
  const state: SourceSummaryState = {
    hasSummary: false,
    scratchpadFresh: false,
    lastScratchpad: undefined,
    firstUserText: "",
  };
  // Mirror gemini's loader semantics for `memoryScratchpadIsStale`:
  // any message or $rewindTo line AFTER a $set:{memoryScratchpad} flips
  // stale=true; the next $set:{memoryScratchpad} resets it.
  let tracking = false;
  let stale = false;

  const rl = readline.createInterface({
    input: createReadStream(srcPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

    if (typeof rec.$rewindTo === "string") {
      if (tracking) stale = true;
      continue;
    }
    const set = (rec as { $set?: Record<string, unknown> }).$set;
    if (set && typeof set === "object") {
      if ("summary" in set && typeof set.summary === "string" && set.summary.length > 0) {
        state.hasSummary = true;
      }
      if ("memoryScratchpad" in set) {
        const v = set.memoryScratchpad;
        if (v) {
          state.lastScratchpad = v;
          tracking = true;
          stale = false;
        } else {
          tracking = false;
          stale = false;
        }
      }
      continue;
    }
    // Bootstrap (sessionId + projectHash + summary?) can also carry summary.
    if (typeof rec.sessionId === "string" && typeof rec.projectHash === "string") {
      if (typeof rec.summary === "string" && rec.summary.length > 0) {
        state.hasSummary = true;
      }
      continue;
    }
    // Message record — has id + type.
    if (typeof rec.id === "string" && typeof rec.type === "string") {
      if (tracking) stale = true;
      if (!state.firstUserText && rec.type === "user") {
        state.firstUserText = stringifyContent(rec.content);
      }
      continue;
    }
  }

  state.scratchpadFresh = tracking && !stale && state.lastScratchpad !== undefined;
  return state;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (typeof part === "string") out += part;
      else if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string") {
        out += (part as { text: string }).text;
      }
    }
    return out.trim();
  }
  return "";
}

function deriveSummary(firstUserText: string): string {
  // Mimic gemini's own cleaning: collapse whitespace, strip surrounding
  // quotes, cap at 80 chars. Empty input falls back to a generic but
  // honest label so the source still gets a non-empty summary.
  let s = firstUserText.replace(/\s+/g, " ").trim();
  s = s.replace(/^["']|["']$/g, "");
  if (!s) s = "Forked conversation";
  if (s.length > SUMMARY_MAX_CHARS) s = s.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd() + "…";
  return s;
}

/**
 * Append a `$set:{summary, memoryScratchpad}` line to the source rollout if
 * either field is missing, so that:
 *   - gemini's background summary writer (which runs on every `gemini -r`
 *     startup and picks the most recent unsummarized session) skips this
 *     file going forward;
 *   - the fork we create next inherits the same line via $set copy, keeping
 *     both files' summaries identical.
 *
 * Returns the summary text that was stamped (or null if no stamp was needed).
 * The path is mutated in place via append; a no-op if nothing needs writing.
 */
export async function stampSourceSummary(srcPath: string): Promise<string | null> {
  const state = await readSourceState(srcPath);
  // If both axes are already covered, do nothing — we don't want to add a
  // duplicate line every time the user forks the same source twice.
  if (state.hasSummary && state.scratchpadFresh) {
    trace("stamp-summary", `${srcPath}: already has summary + fresh scratchpad, skipping`);
    return null;
  }
  const summary = deriveSummary(state.firstUserText);
  const scratchpad = state.lastScratchpad ?? DEFAULT_SCRATCHPAD;
  const patch: Record<string, unknown> = { memoryScratchpad: scratchpad };
  if (!state.hasSummary) patch.summary = summary;
  const line = JSON.stringify({ $set: patch }) + "\n";
  await fs.appendFile(srcPath, line, "utf8");
  trace(
    "stamp-summary",
    `${srcPath}: wrote $set (hadSummary=${state.hasSummary} scratchpadFresh=${state.scratchpadFresh} summary="${summary.slice(0, 40)}")`,
  );
  return state.hasSummary ? null : summary;
}
