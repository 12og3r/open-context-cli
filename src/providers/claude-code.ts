import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { decodeProjectPath } from "../lib/decode-project-path.ts";
import type { Message, SessionMeta, SessionProvider } from "./types.ts";

export class ClaudeCodeProvider implements SessionProvider {
  readonly name = "claude-code";
  readonly defaultPaths = [path.join(os.homedir(), ".claude", "projects")];

  async listSessions(root: string): Promise<SessionMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return [];
    }
    const sessions: SessionMeta[] = [];
    for (const dir of entries) {
      const sub = path.join(root, dir);
      let stat;
      try { stat = await fs.stat(sub); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const projectPath = decodeProjectPath(dir);
      let files: string[];
      try { files = await fs.readdir(sub); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const filePath = path.join(sub, f);
        const meta = await readMeta(filePath, projectPath);
        if (meta) sessions.push(meta);
      }
    }
    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return sessions;
  }

  async *loadSession(filePath: string): AsyncIterable<Message> {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      yield* messagesFromEntry(entry);
    }
  }
}

function messagesFromEntry(entry: Record<string, unknown>): Message[] {
  const type = entry.type;
  if (type !== "user" && type !== "assistant") return [];
  const ts = parseTs(entry.timestamp);
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  const out: Message[] = [];

  if (typeof content === "string") {
    out.push({ role: type, content, timestamp: ts, raw: entry });
    return out;
  }
  if (!Array.isArray(content)) return out;

  let textBuf = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
    if (p.type === "text" && typeof p.text === "string") {
      textBuf += (textBuf ? "\n\n" : "") + p.text;
    } else if (p.type === "tool_use") {
      if (textBuf) {
        out.push({ role: type, content: textBuf, timestamp: ts, raw: entry });
        textBuf = "";
      }
      out.push({
        role: "tool_use",
        content: p.input != null ? JSON.stringify(p.input, null, 2) : "",
        timestamp: ts,
        toolName: p.name,
        raw: part,
      });
    } else if (p.type === "tool_result") {
      if (textBuf) {
        out.push({ role: type, content: textBuf, timestamp: ts, raw: entry });
        textBuf = "";
      }
      const body = typeof p.content === "string"
        ? p.content
        : Array.isArray(p.content)
          ? (p.content as Array<{ text?: string }>)
              .map(x => (typeof x?.text === "string" ? x.text : ""))
              .join("\n")
          : JSON.stringify(p.content ?? "");
      out.push({
        role: "tool_result",
        content: body,
        timestamp: ts,
        raw: part,
      });
    }
  }
  if (textBuf) out.push({ role: type, content: textBuf, timestamp: ts, raw: entry });
  return out;
}

function parseTs(ts: unknown): Date {
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(0);
}

async function readMeta(filePath: string, projectPath: string): Promise<SessionMeta | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return null;
  const id = path.basename(filePath, ".jsonl");

  let summary = "";
  let firstUserText = "";
  let messageCount = 0;

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    if (type === "summary" && !summary && typeof entry.summary === "string") {
      summary = entry.summary;
    } else if ((type === "user" || type === "assistant")) {
      messageCount += 1;
      if (!firstUserText && type === "user") {
        firstUserText = extractFirstUserText(entry);
      }
    }
  }

  if (!summary) summary = firstUserText || "(empty session)";

  return {
    id,
    filePath,
    summary,
    projectPath,
    modifiedAt: stat.mtime,
    messageCount,
  };
}

function extractFirstUserText(entry: Record<string, unknown>): string {
  const msg = (entry.message as { content?: unknown } | undefined)?.content;
  if (typeof msg === "string") return msg.split("\n")[0] ?? "";
  if (Array.isArray(msg)) {
    for (const part of msg) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const text = (part as { text?: string }).text;
        if (typeof text === "string") return text.split("\n")[0] ?? "";
      }
    }
  }
  return "";
}
