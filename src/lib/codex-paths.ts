import os from "node:os";
import path from "node:path";

/**
 * Resolve Codex CLI's sessions directory.
 *
 * Codex writes one rollout JSONL per session under
 * `<config>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. The config
 * directory is `~/.codex` by default and `$CODEX_HOME` when that env
 * variable is set — analogous to Claude Code's `$CLAUDE_CONFIG_DIR`.
 */
export function codexSessionsDir(): string {
  const override = process.env.CODEX_HOME?.trim();
  const base = override ? override : path.join(os.homedir(), ".codex");
  return path.join(base, "sessions");
}
