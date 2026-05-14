import process from "node:process";
import { trace } from "./debug-trace.ts";

const PASTE_START = "\x1b[200~";
const PASTE_END   = "\x1b[201~";

export interface LaunchCommand {
  // Executable name resolved via PATH ("claude", "codex"). Not an absolute
  // path because the PTY backends look it up via the shell.
  exe: string;
  args: string[];
}

export interface PtyRunSpec {
  cwd: string;
  command: LaunchCommand;
  prefillText?: string;
  // Optional pattern in the child's PTY output that marks "TUI has mounted
  // and the input box is about to render." The first match starts an idle
  // timer (300ms by default); inject fires when the stream falls quiet.
  //
  // Defaults to claude's alt-screen-enter sequence so existing claude/codex
  // call sites are unchanged. Gemini doesn't emit alt-screen, so its launcher
  // passes a different pattern (the OSC title bar's "Ready" status string).
  readinessPattern?: RegExp;
  // Cap on how long we'll wait after the first chunk before injecting
  // anyway. Provider-specific because their startup latencies differ —
  // claude takes ~1.5s, gemini ~4s. Defaults to 5000ms (claude-tuned).
  hardDeadlineMs?: number;
}

// Per-CLI PTY readiness tuning. Centralized so both the reuse-current and
// new-window launch paths agree on when to inject prefill text — the
// new-window path goes through `openctx __launch`, which only knows the
// command name, so it must derive these from the executable instead of
// having them passed in from the caller.
export function ptyTuningFor(exe: string): { readinessPattern?: RegExp; hardDeadlineMs?: number } {
  if (exe === "gemini") {
    // Gemini's Ink UI sets an OSC title `\x1b]0;◇  Ready (cwd)\x07` once
    // the input box is about to paint (~3.8s after spawn, ~300ms before
    // the placeholder text appears). Reliably emitted across runs in our
    // PTY probe. 2500ms hard-deadline fallback matches the observed worst
    // case before the title appears.
    return { readinessPattern: /\x1b\]0;[^\x07]*Ready\b/, hardDeadlineMs: 2500 };
  }
  if (exe === "codex") {
    // Codex's first sync-output frame (\x1b[?2026h ... \x1b[?2026l) wraps
    // the initial layout pass but finishes ~500ms after spawn — before
    // codex's input handler is actually ready to receive bracketed paste.
    // Injecting at that point silently drops the prefill (the brackets
    // reach codex but its TUI never displays the text).
    //
    // We don't have a reliable "input handler armed" signal, so we fall
    // back to a fixed hard deadline. 2500ms is empirically late enough
    // for codex to be accepting paste while still feeling much snappier
    // than the previous claude-tuned 5000ms default. No readinessPattern
    // here — the alt-screen default never matches codex's output, which
    // means the inject only fires on hardDeadlineMs and timing stays
    // predictable across terminals.
    return { hardDeadlineMs: 2500 };
  }
  // claude falls back to the runPty defaults (alt-screen + 5s).
  return {};
}

const debug = (s: string) => trace("pty", s);

// Minimum PTY surface we need. Both @lydell/node-pty and bun-pty expose
// this exact shape (modulo a few options node-pty marks optional that
// bun-pty marks required — handled at the call site).
interface MinIPty {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number | string }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

interface MinPtyModule {
  spawn(file: string, args: string[], options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
  }): MinIPty;
}

// Pick the runtime-appropriate PTY library. Bun's child-process semantics
// don't complete @lydell/node-pty's spawn-helper handshake (the helper
// hangs before exec'ing the target), so under Bun we need bun-pty's
// Rust+ffi implementation. Under Node either works; @lydell/node-pty
// is the conservative choice with widest prebuilt coverage.
async function loadPtyModule(): Promise<MinPtyModule> {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
    || typeof process.versions?.bun === "string";
  if (isBun) {
    debug("loading bun-pty (Bun runtime detected)");
    return (await import("bun-pty")) as unknown as MinPtyModule;
  }
  debug("loading @lydell/node-pty (Node runtime)");
  return (await import("@lydell/node-pty")) as unknown as MinPtyModule;
}

function stringifyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  // bun-pty's IPtyForkOptions.env rejects `undefined` values that
  // process.env's type allows. Strip them.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// Spawn the target CLI via node-pty, attach stdio, optionally inject
// `prefillText` as a bracketed paste once the child's TUI has mounted.
// Resolves with the child's exit code. The command (claude vs codex,
// args) is provided by the caller — this function is shape-agnostic.
export async function runPty(spec: PtyRunSpec): Promise<number> {
  const ptyMod = await loadPtyModule();
  debug("pty module loaded");
  const cols = process.stdout.columns ?? 100;
  const rows = process.stdout.rows ?? 30;
  const term = process.env.TERM ?? "xterm-256color";
  const env = stringifyEnv({ ...process.env, TERM: term });

  debug(`spawn ${spec.command.exe} ${spec.command.args.join(" ")} cwd=${spec.cwd}`);
  const child = ptyMod.spawn(spec.command.exe, spec.command.args, {
    name: term,
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

  // Inject the bracketed paste once the child's TUI is actually mounted.
  // The default pattern — `\x1b[?1049h` — is claude's "switch to alternate
  // screen" sequence, which it emits right before painting its TUI. Idle
  // detection only starts AFTER the first match, so we don't inject during
  // the terminal capability negotiation phase (where the input box doesn't
  // exist yet).
  //
  // Sequence on a real claude run looks roughly like:
  //   t=0       chunk #1  cursor save/restore + show cursor
  //   t=6ms     chunk #3  \x1b[?2004h (paste mode on)  ← paste mode IS on
  //   t=320ms   <silence — looks "idle" but claude hasn't mounted yet>
  //   t=1550ms  chunk #7  \x1b[?1049h (enter alt screen)  ← TUI mount
  //   t=1580ms  chunk #8+ session content rendered
  //   t=~1900ms idle settles → safe to inject
  //
  // Gemini's mount signature is different — it sets an OSC title containing
  // "Ready" once its Ink UI is hydrated and the input box is about to paint,
  // so the gemini launcher passes that as its readinessPattern.
  const IDLE_MS = 300;
  const HARD_DEADLINE_MS = spec.hardDeadlineMs ?? 5000;
  const READINESS_PATTERN = spec.readinessPattern ?? /\x1b\[\?1049h/;
  let firstChunkAt = 0;
  let readyAt = 0;
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
    if (readyAt === 0 && READINESS_PATTERN.test(data)) {
      readyAt = Date.now();
      debug(`tui-ready at chunk #${chunkCount} (${readyAt - firstChunkAt}ms)`);
    }
    process.stdout.write(data);

    if (spec.prefillText && !injected && readyAt !== 0) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => inject("idle after tui-ready"), IDLE_MS);
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
