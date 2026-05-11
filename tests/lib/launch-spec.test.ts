import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  consumeLaunchSpec,
  discardLaunchSpec,
  writeLaunchSpec,
  type LaunchSpec,
} from "../../src/lib/launch-spec.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "oc-launch-spec-"));
  tmpDirs.push(d);
  return d;
}

const sample: LaunchSpec = {
  cwd: "/tmp/somewhere",
  command: { exe: "claude", args: ["--resume", "abc"] },
  prefillText: "hello\nworld with 'quotes' and emoji 🎉",
};

describe("launch-spec", () => {
  test("roundtrip preserves all fields", async () => {
    const dir = mkTmp();
    const p = await writeLaunchSpec(sample, dir);
    expect(p.startsWith(dir)).toBe(true);
    expect(fs.existsSync(p)).toBe(true);

    const read = await consumeLaunchSpec(p);
    expect(read).toEqual(sample);
  });

  test("consume deletes the spec file", async () => {
    const dir = mkTmp();
    const p = await writeLaunchSpec(sample, dir);
    expect(fs.existsSync(p)).toBe(true);
    await consumeLaunchSpec(p);
    expect(fs.existsSync(p)).toBe(false);
  });

  test("consume rejects malformed spec", async () => {
    const dir = mkTmp();
    const p = path.join(dir, "ctxcli_bad.json");
    await fsp.writeFile(p, JSON.stringify({ wrong: "shape" }), "utf8");
    await expect(consumeLaunchSpec(p)).rejects.toThrow("invalid launch spec");
  });

  test("write cleans up stale specs but keeps fresh ones", async () => {
    const dir = mkTmp();
    await fsp.mkdir(dir, { recursive: true });

    // An ancient ctxcli spec from a hypothetical earlier run — should be swept.
    const stale = path.join(dir, "ctxcli_old.json");
    await fsp.writeFile(stale, "{}", "utf8");
    const ancient = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await fsp.utimes(stale, ancient, ancient);

    // A user-owned file that doesn't match our prefix — must not be touched.
    const unrelated = path.join(dir, "user_notes.json");
    await fsp.writeFile(unrelated, "{}", "utf8");
    await fsp.utimes(unrelated, ancient, ancient);

    const fresh = await writeLaunchSpec(sample, dir);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  test("discard silently removes the spec", async () => {
    const dir = mkTmp();
    const p = await writeLaunchSpec(sample, dir);
    await discardLaunchSpec(p);
    expect(fs.existsSync(p)).toBe(false);
    // Idempotent — discarding a missing spec must not throw.
    await discardLaunchSpec(p);
  });

  test("writes unique filenames for back-to-back calls", async () => {
    const dir = mkTmp();
    const a = await writeLaunchSpec(sample, dir);
    const b = await writeLaunchSpec(sample, dir);
    expect(a).not.toBe(b);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
  });
});
