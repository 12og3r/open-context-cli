import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sweepGeminiOrphans } from "../../src/lib/gemini-orphan-sweep.ts";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "gemini-orphan-test-"));
}

async function setStale(p: string): Promise<void> {
  // Push mtime/atime well past the 60s "fresh" guard.
  const past = new Date(Date.now() - 5 * 60_000);
  await fs.utimes(p, past, past);
}

describe("sweepGeminiOrphans", () => {
  test("removes a stale bootstrap-only file with matching shape", async () => {
    const dir = await tmpdir();
    const orphan = path.join(dir, "session-2026-05-10T07-00-aaaaaaaa.jsonl");
    await fs.writeFile(
      orphan,
      JSON.stringify({
        sessionId: "aaaaaaaa-1111-4000-8000-000000000001",
        projectHash: "deadbeef",
        startTime: "2026-05-10T07:00:00.000Z",
        lastUpdated: "2026-05-10T07:00:00.000Z",
        kind: "main",
      }) + "\n",
      "utf8",
    );
    await setStale(orphan);

    const removed = await sweepGeminiOrphans(dir);
    expect(removed).toBe(1);
    expect(await fileExists(orphan)).toBe(false);
  });

  test("leaves real conversation files alone (have user/assistant messages)", async () => {
    const dir = await tmpdir();
    const real = path.join(dir, "session-2026-05-10T07-00-bbbbbbbb.jsonl");
    await fs.writeFile(
      real,
      [
        JSON.stringify({ sessionId: "bbbbbbbb-2222-4000-8000-000000000002", projectHash: "deadbeef", startTime: "2026-05-10T07:00:00.000Z", lastUpdated: "2026-05-10T07:00:00.000Z", kind: "main" }),
        JSON.stringify({ id: "msg-u1", timestamp: "2026-05-10T07:00:01.000Z", type: "user", content: "hi" }),
        JSON.stringify({ id: "msg-g1", timestamp: "2026-05-10T07:00:02.000Z", type: "gemini", content: "hello" }),
      ].join("\n") + "\n",
      "utf8",
    );
    await setStale(real);

    const removed = await sweepGeminiOrphans(dir);
    expect(removed).toBe(0);
    expect(await fileExists(real)).toBe(true);
  });

  test("skips fresh (mtime < 60s) bootstraps to avoid clobbering an in-progress session", async () => {
    // A gemini that just started up will have a bootstrap-only file for a few
    // ms before its first message lands; sweeping it would corrupt that
    // live session. The freshness guard prevents that race.
    const dir = await tmpdir();
    const fresh = path.join(dir, "session-2026-05-10T07-00-cccccccc.jsonl");
    await fs.writeFile(
      fresh,
      JSON.stringify({ sessionId: "cccccccc-3333-4000-8000-000000000003", projectHash: "deadbeef", startTime: "2026-05-10T07:00:00.000Z", lastUpdated: "2026-05-10T07:00:00.000Z", kind: "main" }) + "\n",
      "utf8",
    );
    // mtime is "now" — well within the 60s window.

    const removed = await sweepGeminiOrphans(dir);
    expect(removed).toBe(0);
    expect(await fileExists(fresh)).toBe(true);
  });

  test("ignores files larger than the bootstrap cap even if they have only one line", async () => {
    // Defensive — a degenerate huge single-line file isn't our orphan shape;
    // refuse to delete it rather than risking data loss.
    const dir = await tmpdir();
    const big = path.join(dir, "session-2026-05-10T07-00-dddddddd.jsonl");
    const huge = "x".repeat(5000);
    await fs.writeFile(big, JSON.stringify({ sessionId: "dddddddd-4444-4000-8000-000000000004", projectHash: "deadbeef", note: huge }) + "\n", "utf8");
    await setStale(big);

    const removed = await sweepGeminiOrphans(dir);
    expect(removed).toBe(0);
    expect(await fileExists(big)).toBe(true);
  });

  test("returns 0 when the chats dir doesn't exist", async () => {
    const removed = await sweepGeminiOrphans("/tmp/this-path-should-not-exist-x9q3");
    expect(removed).toBe(0);
  });

  test("ignores non-session files in the directory", async () => {
    const dir = await tmpdir();
    const stranger = path.join(dir, "random-thing.txt");
    await fs.writeFile(stranger, "not mine", "utf8");
    await setStale(stranger);

    const removed = await sweepGeminiOrphans(dir);
    expect(removed).toBe(0);
    expect(await fileExists(stranger)).toBe(true);
  });
});

async function fileExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}
