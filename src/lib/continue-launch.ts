import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import { forkSession } from "./continue-fork.ts";
import { runPty } from "./continue-pty.ts";
import { spawnNewWindow } from "./continue-spawn.ts";
import { decodeProjectPath } from "./decode-project-path.ts";

export interface ContinueResult {
  ok: boolean;
  // Set when ok=false; printed before the process exits.
  error?: string;
  // When mode-A successfully ran, the child's exit code propagates here.
  childExitCode?: number;
}

const debug = (s: string) => {
  if (process.env.OPEN_CONTEXT_DEBUG) process.stderr.write(`[oc:launch] ${s}\n`);
};

export async function executeContinue(req: ContinueRequest): Promise<ContinueResult> {
  debug(`enter mode=${req.launchMode} role=${req.targetRole} uuid=${req.targetUuid.slice(0, 8)}`);
  if (!hasClaudeOnPath()) {
    return { ok: false, error: "claude not found in PATH" };
  }
  debug("preflight: claude on PATH");

  if (req.launchMode === "reuse-current" && !process.stdout.isTTY) {
    return { ok: false, error: "current stdout is not a TTY" };
  }

  if (req.launchMode === "new-window" && process.platform !== "darwin") {
    return { ok: false, error: "\"new window\" mode is only supported on macOS" };
  }

  const newUuid = randomUUID();
  const dir = path.dirname(req.sourcePath);
  const dstPath = path.join(dir, `${newUuid}.jsonl`);
  debug(`fork → ${dstPath}`);

  try {
    await forkSession({
      srcPath: req.sourcePath,
      dstPath,
      targetUuid: req.targetUuid,
      targetRole: req.targetRole,
      newSessionId: newUuid,
    });
  } catch (e) {
    return { ok: false, error: `failed to fork session: ${(e as Error).message}` };
  }
  debug("fork ok");

  const cwd = await detectProjectCwd(req.sourcePath);
  debug(`cwd=${cwd}`);

  if (req.launchMode === "reuse-current") {
    debug("runPty starting");
    try {
      const code = await runPty({ cwd, resumeId: newUuid, prefillText: req.userText });
      debug(`runPty exited code=${code}`);
      return { ok: true, childExitCode: code };
    } catch (e) {
      await silentRemove(dstPath);
      return { ok: false, error: `failed to launch claude: ${(e as Error).message}` };
    }
  }

  // mode === "new-window"
  try {
    await spawnNewWindow({ cwd, resumeId: newUuid, clipboardText: req.userText });
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
