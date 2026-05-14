import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { applyRewinds } from "../providers/gemini.ts";
import { trace } from "./debug-trace.ts";

export interface GeminiForkSpec {
  srcPath: string;
  dstPath: string;
  // The gemini message id from the rendered Message — either a user
  // message's `id` field or a gemini (assistant) message's `id` field.
  // Tool rows are not valid cut points; the preview UI already gates
  // Enter on user/assistant rows only.
  targetUuid: string;
  // user-cut excludes the cursor line; assistant-cut includes it. Matches
  // the semantics used by the claude + codex forks.
  targetRole: "user" | "assistant";
  // New session id written into the bootstrap metadata so
  // `gemini -r <newSessionId>` can locate the rewritten transcript.
  newSessionId: string;
}

// Slice a gemini session JSONL down to (and possibly through) the user's
// cursor and stamp it with a new sessionId. Gemini's CLI exposes only a
// whole-session resume (`gemini -r <uuid>`), so without this slicing the
// resumed conversation would still contain everything the user wanted
// to discard. Mirrors what the codex fork does for the same reason.
//
// `$rewindTo` records in the source are applied while computing the
// surviving message set; the destination file is post-rewind and omits
// the rewind records themselves. Bootstrap metadata is rewritten with
// the new sessionId, `lastUpdated` is bumped to "now", and every
// `$set` patch line is preserved in source order.
export async function forkGeminiSession(spec: GeminiForkSpec): Promise<void> {
  const { srcPath, dstPath, targetUuid, targetRole, newSessionId } = spec;
  trace("fork-gemini", `src=${srcPath}`);
  trace("fork-gemini", `dst=${dstPath}`);
  trace("fork-gemini", `target=${targetUuid.slice(0, 8)} role=${targetRole} newId=${newSessionId.slice(0, 8)}`);

  const records = await readAllRecords(srcPath);
  trace("fork-gemini", `read ${records.length} records from source`);
  const surviving = applyRewinds(records);
  trace("fork-gemini", `${surviving.length} messages survive rewinds`);
  const cutIndex = surviving.findIndex(m => m.id === targetUuid);
  if (cutIndex === -1) {
    trace("fork-gemini", `target uuid NOT FOUND among surviving messages: ${targetUuid}`);
    trace("fork-gemini", `surviving ids = [${surviving.map(m => `${m.id.slice(0, 8)}:${m.type}`).join(", ")}]`);
    throw new Error(`target uuid not found in source: ${targetUuid}`);
  }
  trace("fork-gemini", `cutIndex=${cutIndex}`);
  const keepCount = targetRole === "user" ? cutIndex : cutIndex + 1;
  const keptIds = new Set(surviving.slice(0, keepCount).map(m => m.id));
  trace("fork-gemini", `keeping ${keptIds.size} messages (keepCount=${keepCount})`);

  const out: string[] = [];
  let bootstrapWritten = false;
  let strippedSessionIdSets = 0;
  let droppedEmptySets = 0;
  const nowIso = new Date().toISOString();

  for (const rec of records) {
    if (typeof rec.$rewindTo === "string") continue; // already applied
    if (!bootstrapWritten
        && typeof rec.sessionId === "string"
        && typeof rec.projectHash === "string") {
      const next: Record<string, unknown> = {
        ...rec,
        sessionId: newSessionId,
        lastUpdated: nowIso,
      };
      out.push(JSON.stringify(next));
      bootstrapWritten = true;
      trace("fork-gemini", `wrote new bootstrap with sessionId=${newSessionId.slice(0, 8)}`);
      continue;
    }
    if (rec.$set !== undefined && rec.$set !== null && typeof rec.$set === "object") {
      // Preserve $set patches — they may carry summary or memoryScratchpad
      // updates that are independent of which messages survive the cut.
      // BUT strip any `sessionId` field: gemini's own loader re-stamps
      // resumed sessions by appending `{"$set":{"sessionId": <runtimeId>}}`
      // to the rollout, and copying that line verbatim would override the
      // new bootstrap sessionId at load time — making `gemini -r <newId>`
      // fail with "Invalid session identifier".
      const patch = { ...(rec.$set as Record<string, unknown>) };
      const hadSessionId = "sessionId" in patch;
      delete patch.sessionId;
      if (hadSessionId) strippedSessionIdSets += 1;
      if (Object.keys(patch).length === 0) {
        droppedEmptySets += 1;
        continue;
      }
      out.push(JSON.stringify({ ...rec, $set: patch }));
      continue;
    }
    if (typeof rec.id === "string" && keptIds.has(rec.id)) {
      out.push(JSON.stringify(rec));
    }
  }

  if (!bootstrapWritten) {
    throw new Error("source rollout is missing bootstrap metadata");
  }
  trace("fork-gemini", `stripped sessionId from ${strippedSessionIdSets} $set patches, dropped ${droppedEmptySets} that became empty`);
  trace("fork-gemini", `writing ${out.length} lines to dst`);
  await fs.writeFile(dstPath, out.join("\n") + (out.length ? "\n" : ""), "utf8");
  trace("fork-gemini", "write complete");
}

async function readAllRecords(srcPath: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const rl = readline.createInterface({
    input: createReadStream(srcPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip */ }
  }
  return out;
}
