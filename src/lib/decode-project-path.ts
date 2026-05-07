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
