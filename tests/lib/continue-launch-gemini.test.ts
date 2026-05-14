import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  forkedSessionPath,
  resolveGeminiLaunchCwd,
} from "../../src/lib/continue-launch-gemini.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "oc-gemini-cwd-"));
  tmpDirs.push(d);
  return d;
}

describe("resolveGeminiLaunchCwd", () => {
  test("uses sourceCwd when it exists", () => {
    const dir = mkTmp();
    expect(resolveGeminiLaunchCwd(dir)).toBe(dir);
  });

  // Gemini's session selector is per-project; launching outside the
  // recorded project would surface "session not found." Falling back to
  // process.cwd() at least keeps the user inside a valid working dir so
  // gemini doesn't crash on spawn.
  test("falls back to process.cwd() when sourceCwd does not exist", () => {
    const ghost = path.join(os.tmpdir(), "oc-gemini-cwd-does-not-exist-" + Date.now());
    expect(fs.existsSync(ghost)).toBe(false);
    expect(resolveGeminiLaunchCwd(ghost)).toBe(process.cwd());
  });

  test("falls back to process.cwd() when sourceCwd is undefined", () => {
    expect(resolveGeminiLaunchCwd(undefined)).toBe(process.cwd());
  });
});

describe("forkedSessionPath", () => {
  test("produces a filename matching gemini's session-<ts>-<shortId>.jsonl pattern", () => {
    const p = forkedSessionPath(
      "/tmp/chats",
      "abcd1234-5678-9012-3456-789012345678",
    );
    expect(p.startsWith("/tmp/chats/session-")).toBe(true);
    expect(p.endsWith("-abcd1234.jsonl")).toBe(true);
    // The middle should look like a YYYY-MM-DDTHH-MM stamp. Don't pin
    // the exact value — it's wall-clock-dependent — just shape-check it.
    expect(p).toMatch(/session-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-abcd1234\.jsonl$/);
  });
});
