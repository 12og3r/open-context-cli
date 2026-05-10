import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { detectInstaller, installCommand } from "./installer.ts";

export interface RunUpdateDeps {
  // Injectable so tests can drive the child lifecycle without forking
  // a real process. Defaults to node:child_process.spawn.
  spawn?: typeof nodeSpawn;
  // Path used as the source of truth for installer detection. In
  // production we pass process.argv[1] through realpathSync; tests pass
  // a fixed string.
  scriptPath?: string;
  // stderr sink for the human-readable "Running: ..." preview and for
  // error messages. Tests capture; production writes to process.stderr.
  stderr?: (s: string) => void;
}

export async function runUpdate(
  opts: { version?: string },
  deps: RunUpdateDeps = {},
): Promise<number> {
  const spawn = deps.spawn ?? nodeSpawn;
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s));
  const scriptPath = deps.scriptPath ?? resolveScriptPath();

  const installer = detectInstaller(scriptPath);
  const cmd = installCommand(installer, opts.version);

  stderr(`→ Running: ${cmd.exe} ${cmd.args.join(" ")}\n`);

  return new Promise<number>((resolve) => {
    const child = spawn(cmd.exe, cmd.args, { stdio: "inherit" });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        stderr(`open-context: ${cmd.exe} not found in PATH\n`);
      } else {
        stderr(`open-context: ${err.message}\n`);
      }
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

function resolveScriptPath(): string {
  const argv1 = process.argv[1];
  if (!argv1) return "";
  // Follow symlinks: the global bin entry is typically a symlink into
  // the package's actual install dir, which is what we need to classify.
  try { return fs.realpathSync(argv1); } catch { return argv1; }
}
