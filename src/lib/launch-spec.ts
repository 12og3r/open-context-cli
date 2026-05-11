import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LaunchCommand } from "./continue-pty.ts";

// Self-contained description of a PTY launch handed off from the parent
// openctx process (which knows the user's intent) to a fresh openctx
// process running in a new terminal window (which doesn't, because it
// was started via AppleScript / `open -na` and has no inherited
// channel back to the parent).
export interface LaunchSpec {
  cwd: string;
  command: LaunchCommand;
  // Bracketed paste injected once the child TUI has mounted. Not
  // auto-sent — the user reviews and presses Enter.
  prefillText?: string;
  // Extra env vars to apply on top of the new shell's environment.
  // Used for debug-trace propagation (OPEN_CONTEXT_DEBUG).
  env?: Record<string, string>;
}

export const DEFAULT_SPEC_DIR = join(homedir(), ".openctx", "launch-specs");
const SPEC_PREFIX = "ctxcli_";
const SPEC_SUFFIX = ".json";
const STALE_MS = 60 * 60 * 1000;

// Write a spec to a stable on-disk location and return the absolute
// path. The caller hands this path to a freshly-spawned openctx in
// another window via the `__launch` subcommand. We sweep stale specs
// (>1h old) on the way in so the directory doesn't accumulate over
// time — a parent that crashes between writeLaunchSpec and the actual
// window opening would otherwise leave its spec behind forever.
//
// `dir` is overridable for tests; production code uses DEFAULT_SPEC_DIR.
export async function writeLaunchSpec(spec: LaunchSpec, dir: string = DEFAULT_SPEC_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  await cleanupStaleSpecs(dir);
  const name = `${SPEC_PREFIX}${Date.now()}_${randomUUID()}${SPEC_SUFFIX}`;
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(spec), "utf8");
  return path;
}

// Read a spec then delete it. The spec is one-shot — the child window
// consumes it exactly once on startup, and leaving it around after
// would leak the user's prefill text to anyone with filesystem access.
export async function consumeLaunchSpec(path: string): Promise<LaunchSpec> {
  const raw = await readFile(path, "utf8");
  await silentUnlink(path);
  const parsed = JSON.parse(raw) as LaunchSpec;
  if (
    typeof parsed?.cwd !== "string" ||
    typeof parsed?.command?.exe !== "string" ||
    !Array.isArray(parsed?.command?.args)
  ) {
    throw new Error("invalid launch spec");
  }
  return parsed;
}

// Best-effort removal — used when spawnNewWindow fails after a spec
// was written, so we don't leave dangling files.
export async function discardLaunchSpec(path: string): Promise<void> {
  await silentUnlink(path);
}

async function cleanupStaleSpecs(dir: string): Promise<void> {
  let entries: string[] = [];
  try { entries = await readdir(dir); } catch { return; }
  const now = Date.now();
  await Promise.all(
    entries
      .filter((n) => n.startsWith(SPEC_PREFIX) && n.endsWith(SPEC_SUFFIX))
      .map(async (n) => {
        const p = join(dir, n);
        try {
          const st = await stat(p);
          if (now - st.mtimeMs > STALE_MS) await silentUnlink(p);
        } catch { /* ignore */ }
      }),
  );
}

async function silentUnlink(p: string): Promise<void> {
  try { await unlink(p); } catch { /* ignore */ }
}
