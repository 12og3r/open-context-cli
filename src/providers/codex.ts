import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { codexSessionsDir } from "../lib/codex-paths.ts";
import type { Message, SessionMeta, SessionProvider } from "./types.ts";

// Codex CLI session layout:
//   <root>/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
// Each line is JSON of shape `{ timestamp, type, payload }`. We care about:
//   - type "session_meta" — first line; `payload.id` and `payload.cwd`
//   - type "response_item" with `payload.type === "message"` — user/assistant
//     messages. `payload.role` is one of user|assistant|developer; content
//     is an array of parts, each carrying a `text` field.
//   - type "response_item" with `payload.type === "function_call"` /
//     "function_call_output" — tool calls / results.
// Everything else (event_msg, turn_context, compacted) is skipped for the
// preview. event_msg.type === "user_message" duplicates the response_item;
// dedupe by always preferring the response_item entry.

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;

export class CodexProvider implements SessionProvider {
  readonly name = "codex";
  readonly defaultPaths = [codexSessionsDir()];

  async listSessions(root: string): Promise<SessionMeta[]> {
    const files = await collectRollouts(root);
    const out: SessionMeta[] = [];
    for (const filePath of files) {
      const meta = await readMeta(filePath);
      if (meta) out.push(meta);
    }
    out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return out;
  }

  async *loadSession(filePath: string): AsyncIterable<Message> {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    let entryIndex = 0;
    for await (const line of rl) {
      if (!line) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      yield* messagesFromEntry(entry, entryIndex);
      entryIndex += 1;
    }
  }
}

// Walk the YYYY/MM/DD tree under `root` and return every rollout-*.jsonl
// path. Tolerates partial/missing year and month directories (e.g. an
// empty fresh ~/.codex/sessions has no children at all).
async function collectRollouts(root: string): Promise<string[]> {
  const out: string[] = [];
  let years: string[];
  try { years = await fs.readdir(root); } catch { return out; }
  for (const y of years) {
    const yPath = path.join(root, y);
    let months: string[];
    try { months = await fs.readdir(yPath); } catch { continue; }
    for (const m of months) {
      const mPath = path.join(yPath, m);
      let days: string[];
      try { days = await fs.readdir(mPath); } catch { continue; }
      for (const d of days) {
        const dPath = path.join(mPath, d);
        let files: string[];
        try { files = await fs.readdir(dPath); } catch { continue; }
        for (const f of files) {
          if (!ROLLOUT_RE.test(f)) continue;
          out.push(path.join(dPath, f));
        }
      }
    }
  }
  return out;
}

async function readMeta(filePath: string): Promise<SessionMeta | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return null;

  let id = "";
  let recordedCwd = "";
  let conciseCount = 0;
  let fullCount = 0;
  let firstUserText = "";
  let firstAssistantText = "";
  let entryIndex = 0;

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    const payload = entry.payload as Record<string, unknown> | undefined;

    if (type === "session_meta" && payload) {
      if (typeof payload.id === "string" && !id) id = payload.id;
      if (typeof payload.cwd === "string" && !recordedCwd) recordedCwd = payload.cwd;
      entryIndex += 1;
      continue;
    }

    // Count what the preview will actually render: messagesFromEntry drops
    // boilerplate-only user turns and turn-context noise the same way the
    // preview does, so concise/full counts here match what the user sees
    // when they open the session.
    const fanned = messagesFromEntry(entry, entryIndex);
    fullCount += fanned.length;
    for (const m of fanned) {
      if (m.role === "user" || m.role === "assistant") conciseCount += 1;
    }

    if (payload && type === "response_item" && payload.type === "message") {
      const role = payload.role;
      if (role === "user" && !firstUserText) {
        firstUserText = cleanBoilerplate(joinTextParts(payload.content));
      }
      if (role === "assistant" && !firstAssistantText) {
        firstAssistantText = (joinTextParts(payload.content).split("\n")[0] ?? "").trim();
      }
    }
    entryIndex += 1;
  }

  if (!id) {
    // Fall back to the UUID embedded in the filename (last 36-char chunk
    // before the extension, but a simple regex is enough for the standard
    // `rollout-<ts>-<uuid>.jsonl` layout).
    const base = path.basename(filePath, ".jsonl");
    const match = base.match(/([0-9a-f-]{36})$/i);
    id = match ? match[1]! : base;
  }

  const summary = firstUserText || firstAssistantText || "(empty session)";

  return {
    id,
    filePath,
    summary,
    projectPath: recordedCwd,
    modifiedAt: stat.mtime,
    messageCounts: { concise: conciseCount, full: fullCount },
    cwd: recordedCwd || undefined,
    source: "codex",
  };
}

function joinTextParts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (typeof p.text === "string") {
      out += (out ? "\n\n" : "") + p.text;
    }
  }
  return out;
}

// Strip wrapper tags Codex injects into "user" content as part of the
// initial-turn boilerplate (environment context, collaboration mode,
// permissions, etc.). Returns the first non-empty line of the cleaned
// text. The set of tags is the union of what we've observed; missing
// ones just pass through unmodified.
const BOILERPLATE_TAG = /<(?:environment_context|collaboration_mode|permissions[^>]*|skills_instructions|plugins_instructions|system-reminder|developer-instructions|local-command-caveat|command-name|command-message|command-args|local-command-stdout|local-command-stderr|command-stdout|command-stderr|bash-input|bash-stdout|bash-stderr)\b[^>]*>[\s\S]*?<\/(?:environment_context|collaboration_mode|permissions[^>]*|skills_instructions|plugins_instructions|system-reminder|developer-instructions|local-command-caveat|command-name|command-message|command-args|local-command-stdout|local-command-stderr|command-stdout|command-stderr|bash-input|bash-stdout|bash-stderr)>/g;

function cleanBoilerplate(text: string): string {
  const stripped = text.replace(BOILERPLATE_TAG, "");
  for (const line of stripped.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function messagesFromEntry(entry: Record<string, unknown>, entryIndex: number): Message[] {
  if (entry.type !== "response_item") return [];
  const payload = entry.payload as Record<string, unknown> | undefined;
  if (!payload) return [];
  const ts = parseTs(entry.timestamp);
  // Real Codex rollouts only put `id` on session_meta, not on response_item
  // payloads. Synthesize a stable per-entry id from the line position so
  // every Message gets a string uuid — the session-preview Enter handler
  // gates the continue-conversation footer on `typeof uuid === "string"`,
  // and without this fallback Enter would silently no-op on Codex sessions.
  const id = typeof payload.id === "string" ? payload.id : `codex:${entryIndex}`;

  if (payload.type === "message") {
    const role = payload.role;
    const text = joinTextParts(payload.content);
    if (role === "user" || role === "assistant") {
      // Hide the boilerplate-only first user turn from the rendered
      // conversation to match how Claude's preview behaves: those wrapped
      // tags are runtime context, not user prose. If the wrapper-strip
      // leaves nothing meaningful, drop the message entirely.
      const cleaned = role === "user" ? cleanBoilerplate(text) : text;
      if (!cleaned) return [];
      return [{ role, content: cleaned, timestamp: ts, uuid: id, raw: entry }];
    }
    if (role === "developer") {
      // Keep these but tag as system; they're the long instructions block
      // and the user can hide them via the concise display mode.
      if (!text) return [];
      return [{ role: "system", content: text, timestamp: ts, uuid: id, raw: entry }];
    }
    return [];
  }

  if (payload.type === "function_call") {
    const name = typeof payload.name === "string" ? payload.name : undefined;
    const args = typeof payload.arguments === "string"
      ? prettyJson(payload.arguments)
      : payload.arguments != null
        ? JSON.stringify(payload.arguments, null, 2)
        : "";
    return [{
      role: "tool_use",
      content: args,
      timestamp: ts,
      toolName: name,
      uuid: id,
      raw: entry,
    }];
  }

  if (payload.type === "function_call_output") {
    const output = typeof payload.output === "string"
      ? payload.output
      : payload.output != null
        ? JSON.stringify(payload.output, null, 2)
        : "";
    return [{
      role: "tool_result",
      content: output,
      timestamp: ts,
      uuid: id,
      raw: entry,
    }];
  }

  return [];
}

function prettyJson(maybeJson: string): string {
  try {
    return JSON.stringify(JSON.parse(maybeJson), null, 2);
  } catch {
    return maybeJson;
  }
}

function parseTs(ts: unknown): Date {
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(0);
}
