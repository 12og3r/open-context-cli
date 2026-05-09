import { spawn } from "node:child_process";
import { once } from "node:events";

export interface SpawnNewWindowSpec {
  cwd: string;
  resumeId: string;
  clipboardText?: string;
}

// macOS-only: stage `clipboardText` on the system clipboard, then ask
// Terminal.app to open a fresh window running `cd <cwd> && claude --resume <id>`.
// The user pastes the prefill manually (Cmd+V) — this path doesn't have a PTY.
export async function spawnNewWindow(spec: SpawnNewWindowSpec): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("spawnNewWindow is only supported on macOS");
  }

  if (spec.clipboardText) {
    await pbcopy(spec.clipboardText);
  }

  const cdSeg = spec.cwd ? `cd ${shellQuote(spec.cwd)} && ` : "";
  const cmd = `${cdSeg}claude --resume ${shellQuote(spec.resumeId)}`;
  const osa = `tell application "Terminal" to do script ${appleScriptString(cmd)}`;
  const child = spawn("osascript", ["-e", osa], { stdio: "ignore" });
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) throw new Error(`osascript exited with code ${code}`);
}

async function pbcopy(text: string): Promise<void> {
  const child = spawn("pbcopy");
  child.stdin.write(text);
  child.stdin.end();
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) throw new Error(`pbcopy exited with code ${code}`);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
