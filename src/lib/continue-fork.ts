import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";

export interface ForkSpec {
  srcPath: string;
  dstPath: string;
  targetUuid: string;
  targetRole: "user" | "assistant";
  newSessionId: string;
  // When set, every copied entry has its `cwd` field overwritten to this path.
  // Used by force mode where the original project directory no longer exists
  // and we re-anchor the session to a different (current) directory so
  // claude doesn't trip on the now-broken context.
  newCwd?: string;
}

// Stream the source JSONL, copy contiguous user/assistant entries up to (and
// possibly including) the entry whose uuid matches targetUuid. Drops
// summary / custom-title lines so claude regenerates its own metadata for
// the forked session. Rewrites each entry's sessionId to newSessionId, and
// optionally each entry's cwd to newCwd. Throws if the target uuid is never
// seen.
export async function forkSession(spec: ForkSpec): Promise<void> {
  const { srcPath, dstPath, targetUuid, targetRole, newSessionId, newCwd } = spec;
  const lines: string[] = [];
  let found = false;

  const rewrite = (entry: Record<string, unknown>): void => {
    entry.sessionId = newSessionId;
    if (newCwd !== undefined) entry.cwd = newCwd;
  };

  const rl = readline.createInterface({
    input: createReadStream(srcPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    if (type !== "user" && type !== "assistant") continue;

    const isTarget = typeof entry.uuid === "string" && entry.uuid === targetUuid;
    if (isTarget) {
      found = true;
      if (targetRole === "assistant") {
        rewrite(entry);
        lines.push(JSON.stringify(entry));
      }
      // user-cut: target line is excluded.
      break;
    }

    rewrite(entry);
    lines.push(JSON.stringify(entry));
  }

  if (!found) throw new Error(`target uuid not found in source: ${targetUuid}`);
  await fs.writeFile(dstPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}
