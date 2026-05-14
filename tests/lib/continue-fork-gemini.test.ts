import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { forkGeminiSession } from "../../src/lib/continue-fork-gemini.ts";

const FIXTURES = path.resolve(__dirname, "../fixtures/gemini");

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "gemini-fork-test-"));
}

async function readJsonl(p: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(p, "utf8");
  return raw.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

describe("forkGeminiSession", () => {
  test("user-cut writes a new transcript that stops before the cursor", async () => {
    const dir = await tmpdir();
    const dst = path.join(dir, "session-2026-05-10T07-00-019e10b0.jsonl");
    // Use the with-rewind fixture so we also confirm that surviving
    // rewinds aren't double-applied on the destination side.
    await forkGeminiSession({
      srcPath: path.join(FIXTURES, "with-rewind.jsonl"),
      dstPath: dst,
      targetUuid: "msg-u3",
      targetRole: "user",
      newSessionId: "new-session-uuid-1111-2222-3333",
    });
    const entries = await readJsonl(dst);
    // Bootstrap line first, then messages msg-u1, msg-g1 (msg-u3 excluded
    // because it's the cursor target on a user-cut). msg-u2 / msg-g2
    // were rewound away in the source and must not reappear.
    expect(entries[0]!.sessionId).toBe("new-session-uuid-1111-2222-3333");
    expect(entries[0]!.projectHash).toBe("deadbeef");
    const ids = entries.slice(1).map(e => e.id);
    expect(ids).toEqual(["msg-u1", "msg-g1"]);
    // Rewind records themselves should be stripped — they've already
    // been applied at fork time, replaying them would clobber the
    // surviving messages on resume.
    expect(entries.some(e => typeof e.$rewindTo === "string")).toBe(false);
  });

  test("assistant-cut includes the cursor line", async () => {
    const dir = await tmpdir();
    const dst = path.join(dir, "session-2026-05-10T08-00-019e10b1.jsonl");
    await forkGeminiSession({
      srcPath: path.join(FIXTURES, "with-rewind.jsonl"),
      dstPath: dst,
      targetUuid: "msg-g1",
      targetRole: "assistant",
      newSessionId: "new-session-uuid-aaaa-bbbb-cccc",
    });
    const entries = await readJsonl(dst);
    expect(entries[0]!.sessionId).toBe("new-session-uuid-aaaa-bbbb-cccc");
    const ids = entries.slice(1).filter(e => typeof e.id === "string").map(e => e.id);
    expect(ids).toEqual(["msg-u1", "msg-g1"]);
  });

  test("preserves $set lines from the source", async () => {
    const dir = await tmpdir();
    const dst = path.join(dir, "session-2026-05-10T09-00-019e10b2.jsonl");
    await forkGeminiSession({
      srcPath: path.join(FIXTURES, "basic.jsonl"),
      dstPath: dst,
      targetUuid: "msg-g1",
      targetRole: "assistant",
      newSessionId: "new-session-uuid-dddd-eeee-ffff",
    });
    const entries = await readJsonl(dst);
    // basic.jsonl ends with a `{"$set":{"summary":"intro chat"}}` line.
    const setEntry = entries.find(e => (e as { $set?: { summary?: string } }).$set?.summary === "intro chat");
    expect(setEntry).toBeDefined();
  });

  test("throws when the cursor uuid isn't present", async () => {
    const dir = await tmpdir();
    const dst = path.join(dir, "missing.jsonl");
    let err: Error | null = null;
    try {
      await forkGeminiSession({
        srcPath: path.join(FIXTURES, "basic.jsonl"),
        dstPath: dst,
        targetUuid: "does-not-exist",
        targetRole: "user",
        newSessionId: "x",
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("does-not-exist");
  });
});
