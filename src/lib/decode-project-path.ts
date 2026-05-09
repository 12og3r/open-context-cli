/**
 * Claude Code encodes a project path by replacing every "/" with "-".
 * `/Users/roger/projects/foo` → `-Users-roger-projects-foo`.
 * Decoding is lossy: original hyphens in path segments become "/".
 * We accept that ambiguity rather than guessing.
 */
export function decodeProjectPath(encoded: string): string {
  if (!encoded.startsWith("-")) return "";
  return encoded.replace(/-/g, "/");
}

/**
 * Inverse of decodeProjectPath. Used by the continue-conversation launcher
 * to figure out which `~/.claude/projects/<slug>/` directory claude will
 * look in when resuming, given the cwd we're going to launch into.
 */
export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/\//g, "-");
}
