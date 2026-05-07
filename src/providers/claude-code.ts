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

  async *loadSession(_filePath: string): AsyncIterable<Message> {
    // Implemented in the next task.
    throw new Error("not implemented yet");
  }
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
