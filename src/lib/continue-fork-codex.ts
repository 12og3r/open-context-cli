import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";

export interface CodexForkSpec {
  srcPath: string;
  dstPath: string;
  // The synthetic per-message uuid from CodexProvider — either a real
  // `payload.id` from the response_item (rare in current rollouts) or
  // `codex:<entryIndex>` where entryIndex matches the loadSession line
  // count exactly.
  targetUuid: string;
  // user-cut excludes the cursor line; assistant-cut includes it. Matches
  // continue-fork.ts's semantics for Claude sessions.
  targetRole: "user" | "assistant";
  // New session id written into session_meta.payload.id so codex resume
  // can locate the rewritten rollout.
  newSessionId: string;
}

// Stream the source rollout JSONL, copy entries up to (and possibly
// including) the cursor message, and rewrite the session_meta id to
// newSessionId. `codex resume <newSessionId>` then finds this rewritten
// rollout via its standard sessions-directory scan.
//
// Codex's own resume/fork subcommands don't take a per-message cut
// point — without this slicing the resumed session would replay the
// entire transcript past the user's cursor, which contradicts what
// "continue from here" implies in the UI.
export async function forkCodexSession(spec: CodexForkSpec): Promise<void> {
  const { srcPath, dstPath, targetUuid, targetRole, newSessionId } = spec;

  const out: string[] = [];
  let lineIndex = 0;
  let metaSeen = false;
  let found = false;

  const rl = readline.createInterface({
    input: createReadStream(srcPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

    if (entry.type === "session_meta" && !metaSeen) {
      metaSeen = true;
      const payload = entry.payload as Record<string, unknown> | undefined;
      if (payload) payload.id = newSessionId;
      out.push(JSON.stringify(entry));
      lineIndex += 1;
      continue;
    }

    // Match the cursor entry the same way CodexProvider.loadSession
    // does, so a synthetic `codex:<n>` uuid matches the same line that
    // produced it.
    if (entry.type === "response_item") {
      const payload = entry.payload as Record<string, unknown> | undefined;
      const id = typeof payload?.id === "string" ? payload.id : `codex:${lineIndex}`;
      if (id === targetUuid) {
        found = true;
        if (targetRole === "assistant") out.push(JSON.stringify(entry));
        break;
      }
    }

    out.push(JSON.stringify(entry));
    lineIndex += 1;
  }

  if (!found) throw new Error(`target uuid not found in source: ${targetUuid}`);
  await fs.writeFile(dstPath, out.join("\n") + (out.length ? "\n" : ""), "utf8");
}
