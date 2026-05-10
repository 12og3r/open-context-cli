import fs from "node:fs";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import type { ContinueResult } from "./continue-launch.ts";
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
 * Continue a Codex session. Codex's `resume` and `fork` subcommands are
 * whole-session operations — neither takes a per-message cut point — so
 * we don't replicate Claude's mid-session JSONL fork on this side. We
 * just run `codex resume <session-id>` (preserving the existing
 * transcript) and, if the cursor is on a user message, prefill that
 * text via bracketed paste so the user can edit before sending.
 *
 * If Codex grows a `--from-message <uuid>` flag later, swap `resume`
 * for that without changing the rest of the flow.
 */
export async function executeContinueCodex(req: ContinueRequest): Promise<ContinueResult> {
  trace("launch-codex", `enter mode=${req.launchMode} role=${req.targetRole} session=${req.sessionId.slice(0, 8)}`);

  if (req.launchMode === "reuse-current" && !process.stdout.isTTY) {
    return { ok: false, error: "current stdout is not a TTY" };
  }

  if (req.launchMode === "new-window" && process.platform !== "darwin") {
    return { ok: false, error: "\"new window\" mode is only supported on macOS" };
  }

  // No fork happens for codex — just resume the existing session in the
  // recorded cwd if it still exists, or process.cwd() otherwise.
  const cwd = resolveCodexLaunchCwd(req.sourceCwd);
  trace("launch-codex", `cwd=${cwd} (sourceCwd=${req.sourceCwd ?? "(none)"})`);

  const command = { exe: "codex", args: ["resume", req.sessionId] };

  if (req.launchMode === "reuse-current") {
    try {
      const code = await runPty({ cwd, command, prefillText: req.userText });
      return { ok: true, childExitCode: code };
    } catch (e) {
      return { ok: false, error: `failed to launch codex: ${(e as Error).message}` };
    }
  }

  try {
    await spawnNewWindow({ cwd, command, userText: req.userText });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `failed to launch codex: ${(e as Error).message}` };
  }
}
