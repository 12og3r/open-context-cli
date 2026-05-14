import fsp from "node:fs/promises";
import path from "node:path";
import { trace } from "./debug-trace.ts";

// Gemini's session retention cleanup (default enabled with maxAge=30d) treats
// any session file that has NO user/assistant messages as "deletable" — and
// when it deletes one, it cascade-deletes EVERY file in the chats dir matching
// the same 8-char shortId (the suffix in `session-...-<shortId>.jsonl`).
//
// Where the trigger files come from:
//   `gemini -r <id>` constructs a GeminiClient and calls its initialize(),
//   which makes a fresh GeminiChat with NO resumedSessionData → spawns a fresh
//   `session-<utc>-<shortId>.jsonl` containing only a bootstrap line. Then the
//   UI's session-resume effect calls geminiClient.resumeChat(...) which
//   *replaces* the chat object with one bound to the resumed file. The first
//   chat's bootstrap file is orphaned: never written to again, never deleted.
//
// The cascade trigger:
//   On a SUBSEQUENT `gemini -r <newId>` startup, cleanupExpiredSessions →
//   identifySessionsToDelete unconditionally pushes every file with
//   `sessionInfo === null` (i.e. bootstrap-only) onto the delete list,
//   regardless of `maxAge`. Each entry's shortId is then expanded into a glob
//   that wipes both the orphan AND any legitimate session sharing that
//   shortId — including the openctx fork we'd just made.
//
// This sweep removes stale orphan bootstraps before forking so the cascade
// never has a trigger to find. We deliberately skip files modified in the last
// 60s — a brand-new gemini process may have written a bootstrap but not yet
// recorded its first message, and clobbering it under that race would corrupt
// the live session.
export async function sweepGeminiOrphans(chatsDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fsp.readdir(chatsDir);
  } catch {
    return 0;
  }
  let removed = 0;
  const staleAfterMs = 60_000;
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith("session-") || !name.endsWith(".jsonl")) continue;
    const full = path.join(chatsDir, name);
    try {
      const stat = await fsp.stat(full);
      // Bootstrap lines are ~150–500 bytes. Cap conservatively to keep this
      // O(small) — a real conversation file will blow past 4KB after one turn.
      if (stat.size > 4096) continue;
      if (now - stat.mtimeMs < staleAfterMs) continue;
      const content = await fsp.readFile(full, "utf8");
      const lines = content.split("\n").filter(l => l.trim().length > 0);
      if (lines.length !== 1) continue;
      let rec: Record<string, unknown>;
      try { rec = JSON.parse(lines[0]!) as Record<string, unknown>; } catch { continue; }
      // Must look like a bootstrap (sessionId + projectHash) and nothing else.
      if (typeof rec.sessionId !== "string") continue;
      if (typeof rec.projectHash !== "string") continue;
      await fsp.unlink(full);
      removed += 1;
      trace("sweep-gemini", `removed orphan ${name} (sessionId=${(rec.sessionId as string).slice(0, 8)}, size=${stat.size})`);
    } catch {
      // Per-file failures (race with unlink elsewhere, permissions) are
      // intentionally swallowed; sweeping is best-effort.
    }
  }
  if (removed > 0) trace("sweep-gemini", `swept ${removed} orphan(s) from ${chatsDir}`);
  return removed;
}
