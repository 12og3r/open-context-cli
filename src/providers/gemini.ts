import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import {
  geminiTmpDir,
  geminiProjectsRegistryPath,
} from "../lib/gemini-paths.ts";
import type { Message, SessionMeta, SessionProvider } from "./types.ts";

// Gemini CLI session layout:
//   <root>/<projectId>/chats/session-<YYYY-MM-DDTHH-MM>-<shortId>.jsonl
//
// `<projectId>` is an opaque per-project slug (or legacy hex hash) generated
// by gemini's ProjectRegistry; the reverse mapping back to the absolute
// project path lives in `<root>/../projects.json`. We read the registry
// once per `listSessions` call so every SessionMeta can carry the right
// `cwd`.
//
// Each `.jsonl` line is one of three record shapes:
//   - Metadata bootstrap (first line): `{ sessionId, projectHash, startTime,
//     lastUpdated, kind, directories? }`
//   - Metadata patch: `{ $set: { ...partial } }`
//   - Message: `{ id, timestamp, type: "user"|"gemini"|"info"|"error"|
//     "warning", content, displayContent?, toolCalls?, thoughts?, model? }`
//   - Rewind: `{ $rewindTo: "<messageId>" }` — drops every message recorded
//     from that id onward (gemini's own loader treats it the same way).
//
// `content` is either a string or an array of parts; tool calls are
// attached to gemini-type messages via the `toolCalls` array, each
// carrying `args` (the input) and `resultDisplay` (the output). We split
// those into separate `tool_use` / `tool_result` openctx Messages so the
// preview renders them just like Claude/Codex tool turns.

const SESSION_FILE_PREFIX = "session-";

interface GeminiToolCall {
  id?: string;
  name?: string;
  displayName?: string;
  args?: unknown;
  resultDisplay?: unknown;
  status?: string;
}

interface GeminiMessageRecord {
  id: string;
  timestamp?: string;
  type: "user" | "gemini" | "info" | "error" | "warning";
  content?: unknown;
  displayContent?: unknown;
  toolCalls?: GeminiToolCall[];
  thoughts?: Array<{ subject?: string; description?: string }>;
}

export class GeminiProvider implements SessionProvider {
  readonly name = "gemini";
  readonly defaultPaths = [geminiTmpDir()];

  async listSessions(root: string): Promise<SessionMeta[]> {
    const files = await collectSessionFiles(root);
    if (files.length === 0) return [];
    // Reverse-index projects.json so SessionMeta can carry the project's
    // absolute path. Registry lives one level up from `tmp/` by default;
    // when the user picks a non-default root we tolerate the file being
    // missing and fall back to a slug-only display.
    const idToPath = await loadProjectsRegistry(path.join(root, "..", "projects.json"));
    const out: SessionMeta[] = [];
    for (const filePath of files) {
      const projectId = path.basename(path.dirname(path.dirname(filePath)));
      const projectPath = idToPath.get(projectId) ?? "";
      const meta = await readMeta(filePath, projectPath);
      if (meta) out.push(meta);
    }
    out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return out;
  }

  async *loadSession(filePath: string): AsyncIterable<Message> {
    // Walk the JSONL once, applying `$rewindTo` records as we go — the
    // user-visible conversation is the post-rewind state, matching what
    // gemini-cli's own loader produces. We collect every message first so
    // a late rewind can pop earlier entries before we emit anything.
    const records = await readAllRecords(filePath);
    const messages = applyRewinds(records);
    for (const rec of messages) {
      yield* messagesFromRecord(rec);
    }
  }
}

async function collectSessionFiles(root: string): Promise<string[]> {
  let projects: string[];
  try {
    projects = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const projectId of projects) {
    const chatsDir = path.join(root, projectId, "chats");
    let entries: string[];
    try {
      entries = await fs.readdir(chatsDir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.startsWith(SESSION_FILE_PREFIX)) continue;
      if (!f.endsWith(".jsonl") && !f.endsWith(".json")) continue;
      out.push(path.join(chatsDir, f));
    }
  }
  return out;
}

async function loadProjectsRegistry(registryPath: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const raw = await fs.readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw) as { projects?: Record<string, string> };
    const projects = parsed?.projects;
    if (projects && typeof projects === "object") {
      for (const [absPath, shortId] of Object.entries(projects)) {
        if (typeof shortId === "string") {
          out.set(shortId, absPath);
        }
      }
    }
  } catch {
    // Registry is best-effort: a missing or malformed file just means we
    // fall back to an empty projectPath. Sessions remain browsable.
  }
  return out;
}

async function readMeta(filePath: string, projectPath: string): Promise<SessionMeta | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return null;

  let sessionId = "";
  let kind: string | undefined;
  let summary = "";
  let directoriesFirst = "";
  let firstUserText = "";
  let firstAssistantText = "";
  // Track message ids in arrival order so rewind records can pop entries
  // before they ever count toward the visible-message tally.
  const messageIds: string[] = [];
  const messageRoles = new Map<string, "user" | "gemini" | "other">();
  const messageTexts = new Map<string, string>();

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

    if (typeof rec.$rewindTo === "string") {
      const targetId = rec.$rewindTo;
      const idx = messageIds.indexOf(targetId);
      if (idx >= 0) {
        for (const id of messageIds.splice(idx)) {
          messageRoles.delete(id);
          messageTexts.delete(id);
        }
      } else {
        // Target already gone — gemini's loader clears the entire run in
        // this case; we follow suit so the summary survives nothing-left
        // rewinds (rare in practice).
        messageIds.length = 0;
        messageRoles.clear();
        messageTexts.clear();
      }
      continue;
    }

    if (isMetadataSet(rec)) {
      const patch = rec.$set as Record<string, unknown>;
      if (typeof patch.summary === "string" && !summary) summary = patch.summary;
      if (Array.isArray(patch.directories) && !directoriesFirst) {
        const first = patch.directories.find(x => typeof x === "string");
        if (first) directoriesFirst = first as string;
      }
      continue;
    }

    if (isBootstrapMetadata(rec)) {
      if (typeof rec.sessionId === "string" && !sessionId) sessionId = rec.sessionId;
      if (typeof rec.summary === "string" && !summary) summary = rec.summary;
      if (typeof rec.kind === "string") kind = rec.kind;
      if (Array.isArray(rec.directories) && !directoriesFirst) {
        const first = (rec.directories as unknown[]).find(x => typeof x === "string");
        if (first) directoriesFirst = first as string;
      }
      continue;
    }

    if (typeof rec.id === "string" && typeof rec.type === "string") {
      const id = rec.id;
      const type = rec.type as string;
      const role = type === "user" ? "user" : type === "gemini" ? "gemini" : "other";
      messageIds.push(id);
      messageRoles.set(id, role);
      const text = stringifyContent(rec.content);
      if (text) messageTexts.set(id, text);
    }
  }

  // Subagent transcripts are gemini's internal sub-conversations — they
  // duplicate the parent's turns at a different granularity and only
  // confuse the browse view. Filter them out the same way gemini's own
  // session selector does.
  if (kind === "subagent") return null;
  // Bootstrap metadata absent means this isn't a real session record;
  // skip rather than surface a half-decoded entry.
  if (!sessionId) return null;

  let messageCount = 0;
  for (const id of messageIds) {
    if (messageRoles.get(id) !== "other") messageCount += 1;
    if (!firstUserText && messageRoles.get(id) === "user") {
      firstUserText = (messageTexts.get(id) ?? "").trim();
    }
    if (!firstAssistantText && messageRoles.get(id) === "gemini") {
      const raw = messageTexts.get(id) ?? "";
      firstAssistantText = (raw.split("\n")[0] ?? "").trim();
    }
  }

  if (!summary) {
    summary = firstUserText || firstAssistantText || "(empty session)";
  }

  const cwd = directoriesFirst || projectPath;
  return {
    id: sessionId,
    filePath,
    summary,
    projectPath: cwd,
    modifiedAt: stat.mtime,
    messageCount,
    cwd: cwd || undefined,
    source: "gemini",
  };
}

async function readAllRecords(filePath: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip */ }
  }
  return out;
}

/**
 * Replay the rewind machinery against a flat record list and return the
 * surviving message records in their final order. Metadata records and
 * rewinds drop out of the result — only `id`-carrying messages remain.
 */
export function applyRewinds(records: Record<string, unknown>[]): GeminiMessageRecord[] {
  const messages: GeminiMessageRecord[] = [];
  for (const rec of records) {
    if (typeof rec.$rewindTo === "string") {
      const idx = messages.findIndex(m => m.id === rec.$rewindTo);
      if (idx >= 0) {
        messages.splice(idx);
      } else {
        // Target gone: mirror gemini's loader, which wipes the prior run.
        messages.length = 0;
      }
      continue;
    }
    if (typeof rec.id === "string" && typeof rec.type === "string") {
      messages.push(rec as unknown as GeminiMessageRecord);
    }
  }
  return messages;
}

function messagesFromRecord(rec: GeminiMessageRecord): Message[] {
  const ts = parseTs(rec.timestamp);
  const id = rec.id;
  const out: Message[] = [];

  if (rec.type === "user") {
    const text = stringifyContent(rec.displayContent) || stringifyContent(rec.content);
    if (!text) return out;
    out.push({ role: "user", content: text, timestamp: ts, uuid: id, raw: rec });
    return out;
  }

  if (rec.type === "gemini") {
    const text = stringifyContent(rec.displayContent) || stringifyContent(rec.content);
    if (text) {
      out.push({ role: "assistant", content: text, timestamp: ts, uuid: id, raw: rec });
    }
    const calls = Array.isArray(rec.toolCalls) ? rec.toolCalls : [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]!;
      const callUuid = typeof call.id === "string" ? call.id : `${id}:tool${i}`;
      const argsText = call.args != null
        ? typeof call.args === "string" ? call.args : JSON.stringify(call.args, null, 2)
        : "";
      out.push({
        role: "tool_use",
        content: argsText,
        timestamp: ts,
        toolName: call.displayName || call.name,
        uuid: callUuid,
        raw: call,
      });
      if (call.resultDisplay != null) {
        const resultText = typeof call.resultDisplay === "string"
          ? call.resultDisplay
          : JSON.stringify(call.resultDisplay, null, 2);
        out.push({
          role: "tool_result",
          content: resultText,
          timestamp: ts,
          uuid: callUuid,
          raw: call,
        });
      }
    }
    return out;
  }

  // info / warning / error — surface as system rows so the user can hide
  // them via the concise display mode, just like Codex developer turns.
  const text = stringifyContent(rec.displayContent) || stringifyContent(rec.content);
  if (!text) return out;
  out.push({ role: "system", content: text, timestamp: ts, uuid: id, raw: rec });
  return out;
}

function stringifyContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (typeof content === "object") {
      const part = content as { text?: string };
      if (typeof part.text === "string") return part.text;
    }
    return "";
  }
  let out = "";
  for (const part of content) {
    if (typeof part === "string") {
      out += part;
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const p = part as {
      text?: string;
      thought?: unknown;
      functionCall?: { name?: string };
      functionResponse?: { name?: string };
      inlineData?: { mimeType?: string };
      fileData?: unknown;
    };
    if (typeof p.text === "string") {
      out += p.text;
    } else if (p.functionCall?.name) {
      out += `[Function Call: ${p.functionCall.name}]`;
    } else if (p.functionResponse?.name) {
      out += `[Function Response: ${p.functionResponse.name}]`;
    } else if (p.inlineData?.mimeType) {
      out += `[Inline Data: ${p.inlineData.mimeType}]`;
    } else if (p.fileData) {
      out += "[File Data]";
    }
    // thought parts: ignored in the rendered text — gemini already promotes
    // them into a separate `thoughts` field on the message record.
  }
  return out;
}

function isMetadataSet(rec: Record<string, unknown>): boolean {
  return rec.$set !== undefined && rec.$set !== null && typeof rec.$set === "object";
}

function isBootstrapMetadata(rec: Record<string, unknown>): boolean {
  return typeof rec.sessionId === "string" && typeof rec.projectHash === "string";
}

function parseTs(ts: unknown): Date {
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(0);
}
