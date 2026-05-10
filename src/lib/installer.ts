// Detects which package manager installed the openctx binary so
// `openctx update` can dispatch to the same one. The function is pure;
// the caller is responsible for resolving any symlinks (realpathSync)
// before passing the script path in.

const PKG = "@12og3r/openctx";

export type Installer = "npm" | "bun" | "pnpm" | "yarn";

export interface InstallCommand {
  exe: string;
  args: string[];
}

export function detectInstaller(scriptPath: string): Installer {
  if (/[\\/]\.bun[\\/]/.test(scriptPath)) return "bun";
  if (/[\\/]pnpm[\\/]/.test(scriptPath)) return "pnpm";
  if (/[\\/]yarn[\\/]/.test(scriptPath)) return "yarn";
  return "npm";
}

export function installCommand(
  installer: Installer,
  version: string | undefined,
): InstallCommand {
  const spec = version ? `${PKG}@${version}` : PKG;
  switch (installer) {
    case "npm":  return { exe: "npm",  args: ["install", "-g", spec] };
    case "bun":  return { exe: "bun",  args: ["add",     "-g", spec] };
    case "pnpm": return { exe: "pnpm", args: ["add",     "-g", spec] };
    case "yarn": return { exe: "yarn", args: ["global",  "add", spec] };
  }
}
