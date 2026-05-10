import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveCodexLaunchCwd } from "../../src/lib/continue-launch-codex.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "oc-codex-cwd-"));
  tmpDirs.push(d);
  return d;
}

describe("resolveCodexLaunchCwd", () => {
  test("uses sourceCwd when it exists", () => {
    const dir = mkTmp();
    expect(resolveCodexLaunchCwd(dir)).toBe(dir);
  });

  // The recorded cwd in session_meta can point at a project directory the
  // user has since deleted or renamed. Without this fallback the PTY's
  // spawn-helper chdir fails silently — the child exits with code 1 and
  // openctx exits with the same code, no error output. Falling back to
  // process.cwd() matches the comment in continue-launch-codex.ts.
  test("falls back to process.cwd() when sourceCwd does not exist", () => {
    const ghost = path.join(os.tmpdir(), "oc-codex-cwd-does-not-exist-" + Date.now());
    expect(fs.existsSync(ghost)).toBe(false);
    expect(resolveCodexLaunchCwd(ghost)).toBe(process.cwd());
  });

  test("falls back to process.cwd() when sourceCwd is undefined", () => {
    expect(resolveCodexLaunchCwd(undefined)).toBe(process.cwd());
  });
});
