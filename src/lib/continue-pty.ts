import process from "node:process";
import { trace } from "./debug-trace.ts";

const PASTE_START = "\x1b[200~";
const PASTE_END   = "\x1b[201~";

export interface PtyRunSpec {
  cwd: string;
  resumeId: string;
  prefillText?: string;
}

const debug = (s: string) => trace("pty", s);

// Spawn `claude --resume <id>` via node-pty, attach stdio, optionally inject
// `prefillText` as a bracketed paste (~80ms after the first stdout chunk so
// the Ink UI inside claude has had a chance to draw its prompt). Resolves
// with the child's exit code.
export async function runPty(spec: PtyRunSpec): Promise<number> {
  debug("import @lydell/node-pty");
  const ptyMod = await import("@lydell/node-pty");
  debug("import ok");
  const cols = process.stdout.columns ?? 100;
  const rows = process.stdout.rows ?? 30;
  const env = { ...process.env, TERM: process.env.TERM ?? "xterm-256color" };

  debug(`spawn claude --resume ${spec.resumeId.slice(0, 8)} cwd=${spec.cwd}`);
  const child = ptyMod.spawn("claude", ["--resume", spec.resumeId], {
    name: env.TERM,
    cols, rows,
    cwd: spec.cwd,
    env,
  });
  debug(`spawned pid=${child.pid}`);

  let injected = false;
  const inject = () => {
    if (injected || !spec.prefillText) return;
    injected = true;
    child.write(PASTE_START + spec.prefillText + PASTE_END);
  };

  let firstChunkSeen = false;
  let chunkCount = 0;
  const onData = child.onData((data) => {
    chunkCount += 1;
    if (!firstChunkSeen) { firstChunkSeen = true; debug(`first chunk ${data.length} bytes`); }
    if (chunkCount <= 5) debug(`chunk #${chunkCount} ${data.length}b head=${JSON.stringify(data.slice(0, 40))}`);
    process.stdout.write(data);
    if (!injected && spec.prefillText) {
      // Wait one paint after the first byte, then inject.
      setTimeout(() => { debug("inject paste"); inject(); }, 80);
    }
  });

  // Hand the user's keystrokes through to the child. Force raw mode + utf8
  // encoding (string chunks). Bun's stdin defaults can pause without resume
  // and silently swallow the keys; this dance matches node-pty's own example.
  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding?.("utf8");
  process.stdin.resume();
  const onStdin = (chunk: string | Buffer) => {
    debug(`stdin ${chunk.length}b`);
    child.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  };
  process.stdin.on("data", onStdin);

  const onResize = () => {
    const c = process.stdout.columns ?? 100;
    const r = process.stdout.rows ?? 30;
    try { child.resize(c, r); } catch { /* ignore */ }
  };
  process.stdout.on("resize", onResize);

  return await new Promise<number>((resolve) => {
    child.onExit(({ exitCode }) => {
      debug(`child exit code=${exitCode}`);
      onData.dispose();
      process.stdin.off("data", onStdin);
      process.stdout.off("resize", onResize);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve(exitCode ?? 0);
    });
  });
}
