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
  const inject = (reason: string) => {
    if (injected || !spec.prefillText) return;
    injected = true;
    debug(`inject paste (${reason})`);
    child.write(PASTE_START + spec.prefillText + PASTE_END);
  };

  // Inject the bracketed paste once claude's TUI is actually mounted. We
  // watch for `\x1b[?1049h` — the "switch to alternate screen" sequence
  // that claude emits right before painting its TUI. Idle detection only
  // starts AFTER that, so we don't inject during the terminal capability
  // negotiation phase (where the input box doesn't exist yet).
  //
  // Sequence on a real run looks roughly like:
  //   t=0       chunk #1  cursor save/restore + show cursor
  //   t=6ms     chunk #3  \x1b[?2004h (paste mode on)  ← paste mode IS on
  //   t=320ms   <silence — looks "idle" but claude hasn't mounted yet>
  //   t=1550ms  chunk #7  \x1b[?1049h (enter alt screen)  ← TUI mount
  //   t=1580ms  chunk #8+ session content rendered
  //   t=~1900ms idle settles → safe to inject
  const IDLE_MS = 300;
  const HARD_DEADLINE_MS = 5000;
  let firstChunkAt = 0;
  let altScreenAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let chunkCount = 0;

  const onData = child.onData((data) => {
    chunkCount += 1;
    if (firstChunkAt === 0) {
      firstChunkAt = Date.now();
      debug(`first chunk ${data.length} bytes`);
      if (spec.prefillText) {
        deadlineTimer = setTimeout(() => inject("hard deadline"), HARD_DEADLINE_MS);
      }
    }
    if (altScreenAt === 0 && data.includes("\x1b[?1049h")) {
      altScreenAt = Date.now();
      debug(`alt-screen-enter at chunk #${chunkCount} (${altScreenAt - firstChunkAt}ms)`);
    }
    process.stdout.write(data);

    if (spec.prefillText && !injected && altScreenAt !== 0) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => inject("idle after alt-screen"), IDLE_MS);
    }
  });

  // Hand the user's keystrokes through to the child. Force raw mode + utf8
  // encoding (string chunks). Bun's stdin defaults can pause without resume
  // and silently swallow the keys; this dance matches node-pty's own example.
  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding?.("utf8");
  process.stdin.resume();
  const onStdin = (chunk: string | Buffer) => {
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
    const onExitDisposable = child.onExit(({ exitCode, signal }) => {
      debug(`child exit code=${exitCode} signal=${signal ?? "none"}`);
      if (idleTimer) clearTimeout(idleTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      onData.dispose();
      onExitDisposable.dispose();
      process.stdin.off("data", onStdin);
      process.stdout.off("resize", onResize);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve(exitCode ?? 0);
    });
    debug("onExit registered, awaiting child");
  });
}
