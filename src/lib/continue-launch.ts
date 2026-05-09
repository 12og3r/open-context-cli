import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import { forkSession } from "./continue-fork.ts";
import { runPty } from "./continue-pty.ts";
import { spawnNewWindow } from "./continue-spawn.ts";
import { decodeProjectPath, encodeProjectPath } from "./decode-project-path.ts";
import { trace } from "./debug-trace.ts";

export interface ContinueResult {
  ok: boolean;
  // Set when ok=false; printed before the process exits.
  error?: string;
  // When mode-A successfully ran, the child's exit code propagates here.
  childExitCode?: number;
}

export async function executeContinue(req: ContinueRequest): Promise<ContinueResult> {
  trace("launch", `enter mode=${req.launchMode} role=${req.targetRole} uuid=${req.targetUuid.slice(0, 8)}`);
  if (!hasClaudeOnPath()) {
    trace("launch", "preflight FAIL: claude not on PATH");
    return { ok: false, error: "claude not found in PATH" };
  }
  trace("launch", "preflight: claude on PATH");

  if (req.launchMode === "reuse-current" && !process.stdout.isTTY) {
    trace("launch", "preflight FAIL: stdout not TTY");
    return { ok: false, error: "current stdout is not a TTY" };
  }

  if (req.launchMode === "new-window" && process.platform !== "darwin") {
    return { ok: false, error: "\"new window\" mode is only supported on macOS" };
  }

  // Resolve launch cwd first — claude's --resume looks for the JSONL under
  // `~/.claude/projects/<encode(cwd)>/<id>.jsonl`, so the fork has to land
  // there, not next to the source. Priority: forceCwd (user override) >
  // sourceCwd (recorded in JSONL, unambiguous) > slug decode + fallback.
  const cwd = req.forceCwd ?? req.sourceCwd ?? (await detectProjectCwd(req.sourcePath));
  trace("launch", `cwd=${cwd}`);

  const newUuid = randomUUID();
  const dstDir = path.join(os.homedir(), ".claude", "projects", encodeProjectPath(cwd));
  const dstPath = path.join(dstDir, `${newUuid}.jsonl`);
  trace("launch", `fork → ${dstPath}${req.forceCwd ? " (force)" : ""}`);

  try {
    await fs.mkdir(dstDir, { recursive: true });
    await forkSession({
      srcPath: req.sourcePath,
      dstPath,
      targetUuid: req.targetUuid,
      targetRole: req.targetRole,
      newSessionId: newUuid,
      newCwd: req.forceCwd,
    });
  } catch (e) {
    trace("launch", `fork FAIL: ${(e as Error).message}`);
    return { ok: false, error: `failed to fork session: ${(e as Error).message}` };
  }
  trace("launch", "fork ok");

  if (req.launchMode === "reuse-current") {
    trace("launch", "runPty starting");
    try {
      const code = await runPty({ cwd, resumeId: newUuid, prefillText: req.userText });
      trace("launch", `runPty exited code=${code}`);
      return { ok: true, childExitCode: code };
    } catch (e) {
      trace("launch", `runPty FAIL: ${(e as Error).message}`);
      await silentRemove(dstPath);
      return { ok: false, error: `failed to launch claude: ${(e as Error).message}` };
    }
  }

  // mode === "new-window"
  try {
    await spawnNewWindow({ cwd, resumeId: newUuid, userText: req.userText });
    return { ok: true };
  } catch (e) {
    await silentRemove(dstPath);
    return { ok: false, error: `failed to launch claude: ${(e as Error).message}` };
  }
}

function hasClaudeOnPath(): boolean {
  // bun.which would be nicer but we want this to work under plain Node too.
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

async function detectProjectCwd(sourcePath: string): Promise<string> {
  // Sessions live at ~/.claude/projects/<slug>/<uuid>.jsonl. Decode the slug
  // back to a real path; if the directory doesn't exist anymore, fall back
  // to process.cwd() so claude at least starts somewhere.
  const slug = path.basename(path.dirname(sourcePath));
  const decoded = decodeProjectPath(slug);
  if (decoded) {
    try {
      const stat = await fs.stat(decoded);
      if (stat.isDirectory()) return decoded;
    } catch { /* fall through */ }
  }
  return process.cwd();
}

async function silentRemove(p: string): Promise<void> {
  try { await fs.unlink(p); } catch { /* ignore */ }
}
