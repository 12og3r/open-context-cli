import os from "node:os";
import path from "node:path";

/**
 * Resolve Gemini CLI's per-project sessions tree.
 *
 * Gemini CLI keeps one subdirectory per project under
 * `<home>/.gemini/tmp/<projectId>/`, with the chat transcript JSONLs sitting
 * inside `chats/`. The `<projectId>` is an opaque slug (or legacy hex hash)
 * minted by Gemini's `ProjectRegistry`; its mapping back to the project's
 * absolute path lives in `<home>/.gemini/projects.json`.
 *
 * Honors the `GEMINI_CLI_HOME` env var the way gemini-cli itself does —
 * it overrides the home directory used to compose the `.gemini` path.
 *
 * Pointing the openctx setting at the `tmp` root (rather than a single
 * project's `chats/`) lets the provider aggregate sessions across every
 * project the user has run Gemini in, matching what Claude Code and
 * Codex do with their respective roots.
 */
export function geminiTmpDir(): string {
  return path.join(geminiHome(), "tmp");
}

export function geminiProjectsRegistryPath(): string {
  return path.join(geminiHome(), "projects.json");
}

function geminiHome(): string {
  const override = process.env.GEMINI_CLI_HOME?.trim();
  const base = override ? override : os.homedir();
  return path.join(base, ".gemini");
}
