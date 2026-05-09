import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SpawnNewWindowSpec {
  cwd: string;
  resumeId: string;
  userText?: string;
}

// macOS-only: ask the user's terminal app to open a fresh window running
// `claude --resume <id> "<userText>"`. claude treats the positional prompt
// as the first message and sends it automatically — no clipboard staging
// needed. Each terminal exposes a different launch surface, so we dispatch
// on TERM_PROGRAM:
//
//   * Apple_Terminal — AppleScript `do script`. Native, reliable.
//   * iTerm.app      — AppleScript `create window with default profile`.
//                       Native to iTerm2's scripting suite.
//   * ghostty        — `open -na Ghostty --args -e /bin/sh -c <cmd>`. Ghostty's
//                       `-e` flag runs a command in the new window.
//   * WarpTerminal   — Warp Launch Configuration: write a temp YAML to
//                       ~/.warp/launch_configurations/ then trigger
//                       `warp://launch/<name>`. Zero permissions, both cwd
//                       and the command are honored natively. Falls back to
//                       Terminal.app on failure.
//   * everything else — Terminal.app fallback.
export async function spawnNewWindow(spec: SpawnNewWindowSpec): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("spawnNewWindow is only supported on macOS");
  }

  const tp = process.env.TERM_PROGRAM;

  if (tp === "iTerm.app") {
    const cmd = composeShellCmd(spec.cwd, spec.resumeId, spec.userText);
    await runOsa(
      `tell application "iTerm"\n` +
      `  create window with default profile command ${appleScriptString(cmd)}\n` +
      `end tell`,
    );
    return;
  }

  if (tp === "ghostty") {
    const cmd = composeShellCmd(spec.cwd, spec.resumeId, spec.userText);
    await runOpen(["-na", "Ghostty", "--args", "-e", "/bin/sh", "-c", cmd]);
    return;
  }

  if (tp === "WarpTerminal") {
    try {
      await launchInWarp(spec.cwd, spec.resumeId, spec.userText);
      return;
    } catch {
      // Filesystem error or unusual setup — fall through so the user still
      // gets a working window via Terminal.app.
    }
  }

  // Apple_Terminal explicit + universal fallback.
  const cmd = composeShellCmd(spec.cwd, spec.resumeId, spec.userText);
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
async function launchInWarp(cwd: string, resumeId: string, userText?: string): Promise<void> {
  const dir = join(homedir(), ".warp", "launch_configurations");
  await mkdir(dir, { recursive: true });

  const stale = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    stale
      .filter((n) => n.startsWith("_ctxcli_") && n.endsWith(".yaml"))
      .map((n) => unlink(join(dir, n)).catch(() => {})),
  );

  const name = `_ctxcli_${Date.now()}`;
  const exec = composeClaudeCmd(resumeId, userText);
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

function composeClaudeCmd(resumeId: string, userText?: string): string {
  const promptSeg = userText ? ` ${shellQuote(userText)}` : "";
  return `claude --resume ${shellQuote(resumeId)}${promptSeg}`;
}

function composeShellCmd(cwd: string, resumeId: string, userText?: string): string {
  const cdSeg = cwd ? `cd ${shellQuote(cwd)} && ` : "";
  return `${cdSeg}${composeClaudeCmd(resumeId, userText)}`;
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
