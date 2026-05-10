import { spawnSync } from "node:child_process";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import { executeContinueClaude } from "./continue-launch-claude.ts";
import { executeContinueCodex } from "./continue-launch-codex.ts";
import { trace } from "./debug-trace.ts";

export interface ContinueResult {
  ok: boolean;
  // Set when ok=false; printed before the process exits.
  error?: string;
  // When mode-A successfully ran, the child's exit code propagates here.
  childExitCode?: number;
}

/**
 * Dispatch a continue request to the right per-source launcher. The
 * shared pre-flight (binary on PATH) lives here; everything else —
 * forking, command composition, prefill semantics — lives in the
 * source-specific launcher.
 */
export async function executeContinue(req: ContinueRequest): Promise<ContinueResult> {
  trace("launch", `dispatch source=${req.source} mode=${req.launchMode}`);

  const cliBinary = req.source === "codex" ? "codex" : "claude";
  if (!hasOnPath(cliBinary)) {
    trace("launch", `preflight FAIL: ${cliBinary} not on PATH`);
    return { ok: false, error: `${cliBinary} not found in PATH` };
  }

  if (req.source === "codex") return executeContinueCodex(req);
  return executeContinueClaude(req);
}

function hasOnPath(exe: string): boolean {
  // bun.which would be nicer but we want this to work under plain Node too.
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [exe], {
    stdio: "ignore",
  });
  return probe.status === 0;
}
