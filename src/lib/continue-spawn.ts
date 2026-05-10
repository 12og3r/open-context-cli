import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LaunchCommand } from "./continue-pty.ts";

export interface SpawnNewWindowSpec {
  cwd: string;
  command: LaunchCommand;
  // Optional positional prompt appended to the command line (claude and
  // codex both treat the first positional arg after the session id as an
  // initial prompt that's auto-sent). For claude this is the user's
  // message; for codex it's the same.
  userText?: string;
}

// macOS-only: ask the user's terminal app to open a fresh window running
// the launch command. The exact mechanism varies by terminal app, so we
// dispatch on TERM_PROGRAM:
//
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

  const tp = process.env.TERM_PROGRAM;

  if (tp === "iTerm.app") {
    const cmd = composeShellCmd(spec.cwd, spec.command, spec.userText);
    await runOsa(
      `tell application "iTerm"\n` +
      `  create window with default profile command ${appleScriptString(cmd)}\n` +
      `end tell`,
    );
    return;
  }

  if (tp === "ghostty") {
    const cmd = composeShellCmd(spec.cwd, spec.command, spec.userText);
    await runOpen(["-na", "Ghostty", "--args", "-e", "/bin/sh", "-c", cmd]);
    return;
  }

  if (tp === "WarpTerminal") {
    try {
      await launchInWarp(spec.cwd, spec.command, spec.userText);
      return;
    } catch {
      // Filesystem error or unusual setup — fall through so the user still
      // gets a working window via Terminal.app.
    }
  }

  // Apple_Terminal explicit + universal fallback.
  const cmd = composeShellCmd(spec.cwd, spec.command, spec.userText);
  await runOsa(
    `tell application "Terminal" to do script ${appleScriptString(cmd)}`,
  );
}

// Drive Warp via a Launch Configuration: a YAML file that Warp reads when
// `warp://launch/<name>` is opened. cwd and exec are honored natively,
// no Accessibility permission required.
//
// We clean up stale ctxcli configs from prior runs before writing a fresh
// one — leaving them around would clutter Warp's Launch Configurations UI.
async function launchInWarp(
  cwd: string,
  command: LaunchCommand,
  userText?: string,
): Promise<void> {
  const dir = join(homedir(), ".warp", "launch_configurations");
  await mkdir(dir, { recursive: true });

  const stale = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    stale
      .filter((n) => n.startsWith("_ctxcli_") && n.endsWith(".yaml"))
      .map((n) => unlink(join(dir, n)).catch(() => {})),
  );

  const name = `_ctxcli_${Date.now()}`;
  const exec = composeLaunchCmd(command, userText);
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

function composeLaunchCmd(command: LaunchCommand, userText?: string): string {
  const argSeg = command.args.map(shellQuote).join(" ");
  const promptSeg = userText ? ` ${shellQuote(userText)}` : "";
  return `${shellQuote(command.exe)} ${argSeg}${promptSeg}`;
}

function composeShellCmd(
  cwd: string,
  command: LaunchCommand,
  userText?: string,
): string {
  const cdSeg = cwd ? `cd ${shellQuote(cwd)} && ` : "";
  return `${cdSeg}${composeLaunchCmd(command, userText)}`;
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
