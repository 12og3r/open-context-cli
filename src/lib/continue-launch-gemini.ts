import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import type { ContinueResult } from "./continue-launch.ts";
import { forkGeminiSession } from "./continue-fork-gemini.ts";
import { runPty } from "./continue-pty.ts";
import { spawnNewWindow } from "./continue-spawn.ts";
import { trace } from "./debug-trace.ts";

// Resolve the cwd to spawn `gemini -r` in. Gemini's session loader is
// project-scoped (it only looks at sessions under the current project's
// `~/.gemini/tmp/<projectId>/chats/` dir), so launching outside the
// recorded project would surface "session not found." Fall back to
// process.cwd() only when the recorded directory is gone — same defensive
// pattern as the codex launcher.
export function resolveGeminiLaunchCwd(sourceCwd: string | undefined): string {
  if (sourceCwd && fs.existsSync(sourceCwd)) return sourceCwd;
  return process.cwd();
}

/**
 * Continue a Gemini CLI session. Gemini's `-r/--resume <uuid>` is a
 * whole-session resume — without external slicing it would replay
 * everything past the user's cursor. We fork the source transcript into
 * the same `chats/` directory under a new UUID, then `gemini -r <newId>`
 * picks it up via its standard project-scoped scan. When the cursor is on
 * a user message the prefill text is paste-injected so the user can edit
 * before sending.
 */
export async function executeContinueGemini(req: ContinueRequest): Promise<ContinueResult> {
  trace("launch-gemini", `enter mode=${req.launchMode} role=${req.targetRole} session=${req.sessionId.slice(0, 8)}`);

  if (req.launchMode === "reuse-current" && !process.stdout.isTTY) {
    return { ok: false, error: "current stdout is not a TTY" };
  }

  if (req.launchMode === "new-window" && process.platform !== "darwin") {
    return { ok: false, error: "\"new window\" mode is only supported on macOS" };
  }

  const cwd = resolveGeminiLaunchCwd(req.sourceCwd);
  trace("launch-gemini", `cwd=${cwd} (sourceCwd=${req.sourceCwd ?? "(none)"})`);

  // Fork the source rollout into the same chats/ directory as the
  // original. Gemini's loader scans only the current project's chats
  // dir, so writing the fork anywhere else would make `gemini -r`
  // unable to find it.
  const newId = randomUUID();
  const chatsDir = path.dirname(req.sourcePath);
  const dstPath = forkedSessionPath(chatsDir, newId);
  trace("launch-gemini", `fork → ${dstPath}`);

  try {
    await fsp.mkdir(chatsDir, { recursive: true });
    await forkGeminiSession({
      srcPath: req.sourcePath,
      dstPath,
      targetUuid: req.targetUuid,
      targetRole: req.targetRole,
      newSessionId: newId,
    });
  } catch (e) {
    trace("launch-gemini", `fork FAIL: ${(e as Error).message}`);
    return { ok: false, error: `failed to fork gemini session: ${(e as Error).message}` };
  }

  const command = { exe: "gemini", args: ["-r", newId] };

  if (req.launchMode === "reuse-current") {
    try {
      const code = await runPty({ cwd, command, prefillText: req.userText });
      return { ok: true, childExitCode: code };
    } catch (e) {
      await silentRemove(dstPath);
      return { ok: false, error: `failed to launch gemini: ${(e as Error).message}` };
    }
  }

  try {
    await spawnNewWindow({ cwd, command, prefillText: req.userText });
    return { ok: true };
  } catch (e) {
    await silentRemove(dstPath);
    return { ok: false, error: `failed to launch gemini: ${(e as Error).message}` };
  }
}

// Gemini's own session writer uses `session-<YYYY-MM-DDTHH-MM>-<shortId>.jsonl`
// where shortId is the first 8 chars of the sessionId. The CLI's
// `sessionExists` check looks for files ending in `-<shortId>.jsonl`, so
// matching that pattern keeps the rewritten fork discoverable.
export function forkedSessionPath(chatsDir: string, sessionId: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const shortId = sessionId.slice(0, 8);
  const filename = `session-${yyyy}-${mm}-${dd}T${hh}-${mi}-${shortId}.jsonl`;
  return path.join(chatsDir, filename);
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

async function silentRemove(p: string): Promise<void> {
  try { await fsp.unlink(p); } catch { /* ignore */ }
}
