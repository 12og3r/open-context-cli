import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import type { ContinueResult } from "./continue-launch.ts";
import { codexSessionsDir } from "./codex-paths.ts";
import { forkCodexSession } from "./continue-fork-codex.ts";
import { runPty } from "./continue-pty.ts";
import { spawnNewWindow } from "./continue-spawn.ts";
import { trace } from "./debug-trace.ts";

// Resolve the cwd to spawn `codex resume` in. The PTY's spawn-helper does
// the chdir itself and exits with code 1 (no stderr surfaced) if the path
// is missing — which propagates as a silent process.exit(1) on our side.
// Fall back to process.cwd() when the recorded directory was deleted or
// renamed since the session was captured.
export function resolveCodexLaunchCwd(sourceCwd: string | undefined): string {
  if (sourceCwd && fs.existsSync(sourceCwd)) return sourceCwd;
  return process.cwd();
}

/**
 * Continue a Codex session. Codex's own `resume` and `fork` subcommands
 * are whole-session operations (no per-message cut point), so we slice
 * the rollout JSONL ourselves down to the user's cursor and have codex
 * resume the rewritten file. If the cursor is on a user message that
 * text is also prefilled via bracketed paste so the user can edit
 * before sending.
 */
export async function executeContinueCodex(req: ContinueRequest): Promise<ContinueResult> {
  trace("launch-codex", `enter mode=${req.launchMode} role=${req.targetRole} session=${req.sessionId.slice(0, 8)}`);

  if (req.launchMode === "reuse-current" && !process.stdout.isTTY) {
    return { ok: false, error: "current stdout is not a TTY" };
  }

  if (req.launchMode === "new-window" && process.platform !== "darwin") {
    return { ok: false, error: "\"new window\" mode is only supported on macOS" };
  }

  const cwd = resolveCodexLaunchCwd(req.sourceCwd);
  trace("launch-codex", `cwd=${cwd} (sourceCwd=${req.sourceCwd ?? "(none)"})`);

  // Fork the source rollout up to the cursor so codex doesn't replay
  // everything past that point. The forked file lands in codex's own
  // sessions tree under today's date so `codex resume <id>` can find
  // it via the standard scan.
  const newId = randomUUID();
  const dstPath = forkedRolloutPath(codexSessionsDir(), newId);
  trace("launch-codex", `fork → ${dstPath}`);

  try {
    await fsp.mkdir(path.dirname(dstPath), { recursive: true });
    await forkCodexSession({
      srcPath: req.sourcePath,
      dstPath,
      targetUuid: req.targetUuid,
      targetRole: req.targetRole,
      newSessionId: newId,
    });
  } catch (e) {
    trace("launch-codex", `fork FAIL: ${(e as Error).message}`);
    return { ok: false, error: `failed to fork codex session: ${(e as Error).message}` };
  }

  const command = { exe: "codex", args: ["resume", newId] };

  if (req.launchMode === "reuse-current") {
    try {
      const code = await runPty({ cwd, command, prefillText: req.userText });
      return { ok: true, childExitCode: code };
    } catch (e) {
      await silentRemove(dstPath);
      return { ok: false, error: `failed to launch codex: ${(e as Error).message}` };
    }
  }

  try {
    await spawnNewWindow({ cwd, command, prefillText: req.userText });
    return { ok: true };
  } catch (e) {
    await silentRemove(dstPath);
    return { ok: false, error: `failed to launch codex: ${(e as Error).message}` };
  }
}

// Codex stores rollouts at
// `<root>/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl` using
// local time (verified against existing on-disk samples whose filename
// stamp is offset from the recorded UTC `payload.timestamp`). Match that
// layout so codex's session enumerator finds the forked file.
export function forkedRolloutPath(root: string, sessionId: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  const filename = `rollout-${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}-${sessionId}.jsonl`;
  return path.join(root, yyyy, mm, dd, filename);
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

async function silentRemove(p: string): Promise<void> {
  try { await fsp.unlink(p); } catch { /* ignore */ }
}
