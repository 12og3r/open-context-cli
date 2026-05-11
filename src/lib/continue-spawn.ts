import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { LaunchCommand } from "./continue-pty.ts";
import { discardLaunchSpec, writeLaunchSpec, type LaunchSpec } from "./launch-spec.ts";

export interface SpawnNewWindowSpec {
  cwd: string;
  command: LaunchCommand;
  // Bracketed-paste prefill injected into the target's input box once
  // its TUI has mounted. Not auto-sent — the user reviews and presses
  // Enter. (Previously this was a positional CLI arg, which made
  // claude/codex auto-send the message; we now route through an
  // openctx __launch wrapper so the new window matches same-window
  // prefill semantics.)
  prefillText?: string;
}

// macOS-only: ask the user's terminal app to open a fresh window which
// re-enters openctx in `__launch` mode. That child reads a one-shot
// LaunchSpec from disk and PTY-spawns the target (claude/codex), so
// the new window gets bracketed-paste prefill instead of an auto-sent
// positional arg.
//
// Dispatch on TERM_PROGRAM:
//   * Apple_Terminal — AppleScript `do script`. Native, reliable.
//   * iTerm.app      — AppleScript `create window with default profile`.
//                       Native to iTerm2's scripting suite.
//   * ghostty        — `open -na Ghostty --args -e /bin/sh -c <cmd>`.
//   * WarpTerminal   — Warp Launch Configuration: write a temp YAML to
//                       ~/.warp/launch_configurations/ then trigger
//                       `warp://launch/<name>`. Falls back to Terminal.app
//                       on failure.
//   * everything else — Terminal.app fallback.
export async function spawnNewWindow(spec: SpawnNewWindowSpec): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("spawnNewWindow is only supported on macOS");
  }

  const launchSpec: LaunchSpec = {
    cwd: spec.cwd,
    command: spec.command,
    prefillText: spec.prefillText,
    env: process.env.OPEN_CONTEXT_DEBUG
      ? { OPEN_CONTEXT_DEBUG: process.env.OPEN_CONTEXT_DEBUG }
      : undefined,
  };

  const specPath = await writeLaunchSpec(launchSpec);
  try {
    await runInNewWindow(spec.cwd, specPath);
  } catch (e) {
    await discardLaunchSpec(specPath);
    throw e;
  }
}

async function runInNewWindow(cwd: string, specPath: string): Promise<void> {
  const tp = process.env.TERM_PROGRAM;
  const wrapper = openctxWrapperCommand(specPath);

  if (tp === "iTerm.app") {
    const cmd = composeShellCmd(cwd, wrapper);
    await runOsa(
      `tell application "iTerm"\n` +
      `  create window with default profile command ${appleScriptString(cmd)}\n` +
      `end tell`,
    );
    return;
  }

  if (tp === "ghostty") {
    const cmd = composeShellCmd(cwd, wrapper);
    await runOpen(["-na", "Ghostty", "--args", "-e", "/bin/sh", "-c", cmd]);
    return;
  }

  if (tp === "WarpTerminal") {
    try {
      await launchInWarp(cwd, wrapper);
      return;
    } catch {
      // Filesystem error or unusual setup — fall through so the user still
      // gets a working window via Terminal.app.
    }
  }

  // Apple_Terminal explicit + universal fallback.
  const cmd = composeShellCmd(cwd, wrapper);
  await runOsa(
    `tell application "Terminal" to do script ${appleScriptString(cmd)}`,
  );
}

// How to invoke openctx in the new window. We re-spawn the same
// interpreter that's running this process on the same entry script,
// so npm-installed (node), bun-installed (bun), and dev-mode
// (`bun run src/cli.tsx`, or anything analogous) all just work
// without per-runtime branching. process.execPath is absolute, so the
// new window's PATH doesn't need to contain `node`/`bun`/whatever.
// Falls back to `openctx` on PATH if argv[1] is missing (e.g. someone
// loaded the bundle via -e / -r).
function openctxWrapperCommand(specPath: string): LaunchCommand {
  const self = process.argv[1];
  if (!self) return { exe: "openctx", args: ["__launch", specPath] };
  return { exe: process.execPath, args: [self, "__launch", specPath] };
}

// Drive Warp via a Launch Configuration: a YAML file that Warp reads when
// `warp://launch/<name>` is opened. cwd and exec are honored natively,
// no Accessibility permission required.
//
// We clean up stale ctxcli configs from prior runs before writing a fresh
// one — leaving them around would clutter Warp's Launch Configurations UI.
async function launchInWarp(cwd: string, wrapper: LaunchCommand): Promise<void> {
  const dir = join(homedir(), ".warp", "launch_configurations");
  await mkdir(dir, { recursive: true });

  const stale = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    stale
      .filter((n) => n.startsWith("_ctxcli_") && n.endsWith(".yaml"))
      .map((n) => unlink(join(dir, n)).catch(() => {})),
  );

  const name = `_ctxcli_${Date.now()}`;
  const exec = composeLaunchCmd(wrapper);
  const yaml =
    `---\n` +
    `name: ${name}\n` +
    `windows:\n` +
    `  - tabs:\n` +
    `      - layout:\n` +
    `          cwd: ${JSON.stringify(cwd)}\n` +
    `          commands:\n` +
    `            - exec: ${JSON.stringify(exec)}\n`;
  await writeFile(join(dir, `${name}.yaml`), yaml);

  await runOpen([`warp://launch/${name}`]);
}

function composeLaunchCmd(command: LaunchCommand): string {
  const argSeg = command.args.map(shellQuote).join(" ");
  return `${shellQuote(command.exe)} ${argSeg}`;
}

function composeShellCmd(cwd: string, command: LaunchCommand): string {
  const cdSeg = cwd ? `cd ${shellQuote(cwd)} && ` : "";
  return `${cdSeg}${composeLaunchCmd(command)}`;
}

async function runOsa(script: string): Promise<void> {
  const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) throw new Error(`osascript exited with code ${code}`);
}

async function runOpen(args: string[]): Promise<void> {
  const child = spawn("open", args, { stdio: "ignore" });
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) throw new Error(`open exited with code ${code}`);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
