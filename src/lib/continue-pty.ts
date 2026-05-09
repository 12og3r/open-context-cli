import process from "node:process";

const PASTE_START = "\x1b[200~";
const PASTE_END   = "\x1b[201~";

export interface PtyRunSpec {
  cwd: string;
  resumeId: string;
  prefillText?: string;
}

// Spawn `claude --resume <id>` via node-pty, attach stdio, optionally inject
// `prefillText` as a bracketed paste (~80ms after the first stdout chunk so
// the Ink UI inside claude has had a chance to draw its prompt). Resolves
// with the child's exit code.
export async function runPty(spec: PtyRunSpec): Promise<number> {
  const ptyMod = await import("@lydell/node-pty");
  const cols = process.stdout.columns ?? 100;
  const rows = process.stdout.rows ?? 30;
  const env = { ...process.env, TERM: process.env.TERM ?? "xterm-256color" };

  const child = ptyMod.spawn("claude", ["--resume", spec.resumeId], {
    name: env.TERM,
    cols, rows,
    cwd: spec.cwd,
    env,
  });

  let injected = false;
  const inject = () => {
    if (injected || !spec.prefillText) return;
    injected = true;
    child.write(PASTE_START + spec.prefillText + PASTE_END);
  };

  const onData = child.onData((data) => {
    process.stdout.write(data);
    if (!injected && spec.prefillText) {
      // Wait one paint after the first byte, then inject.
      setTimeout(inject, 80);
    }
  });

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  const onStdin = (buf: Buffer) => child.write(buf);
  process.stdin.on("data", onStdin);

  const onResize = () => {
    const c = process.stdout.columns ?? 100;
    const r = process.stdout.rows ?? 30;
    try { child.resize(c, r); } catch { /* ignore */ }
  };
  process.stdout.on("resize", onResize);

  return await new Promise<number>((resolve) => {
    child.onExit(({ exitCode }) => {
      onData.dispose();
      process.stdin.off("data", onStdin);
      process.stdout.off("resize", onResize);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve(exitCode ?? 0);
    });
  });
}
