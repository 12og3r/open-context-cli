import os from "node:os";
import path from "node:path";

/**
 * Resolve Claude Code's projects directory.
 *
 * Claude Code lays its sessions out at `<config>/projects/<slug>/<uuid>.jsonl`
 * on every supported OS (macOS, Linux, Windows). The only thing that varies
 * by platform is the home directory itself, which `os.homedir()` already
 * resolves correctly per-user — typically:
 *   - macOS:   /Users/<name>/.claude/projects
 *   - Linux:   /home/<name>/.claude/projects
 *   - Windows: C:\Users\<name>\.claude\projects
 *
 * Claude Code also honors the `CLAUDE_CONFIG_DIR` environment variable as an
 * undocumented override that relocates the entire `.claude` tree (see e.g.
 * anthropics/claude-code#28808). When set, sessions live under
 * `$CLAUDE_CONFIG_DIR/projects` instead — we honor it here so users with a
 * non-standard install still see their history.
 */
export function claudeProjectsDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  const base = override ? override : path.join(os.homedir(), ".claude");
  return path.join(base, "projects");
}
