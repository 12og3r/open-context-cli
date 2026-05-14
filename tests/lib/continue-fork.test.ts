import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { forkSession } from "../../src/lib/continue-fork.ts";

async function tmpFile(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "fork-"));
  return path.join(d, `${crypto.randomUUID()}.jsonl`);
}

const SAMPLE = [
  JSON.stringify({ type: "summary", summary: "old" }),
  JSON.stringify({ type: "user",      uuid: "u1", sessionId: "S0", message: { content: "hi" }, timestamp: "2026-01-01T00:00:00Z" }),
  JSON.stringify({ type: "assistant", uuid: "a1", sessionId: "S0", message: { content: "hello" }, timestamp: "2026-01-01T00:00:01Z" }),
  JSON.stringify({ type: "user",      uuid: "u2", sessionId: "S0", message: { content: "again" }, timestamp: "2026-01-01T00:00:02Z" }),
  JSON.stringify({ type: "assistant", uuid: "a2", sessionId: "S0", message: { content: "ok" }, timestamp: "2026-01-01T00:00:03Z" }),
].join("\n") + "\n";

describe("forkSession", () => {
  test("user cut excludes target line, drops summary, rewrites sessionId", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await forkSession({ srcPath: src, dstPath: dst, targetUuid: "u2", targetRole: "user", newSessionId: "NEW" });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out.map(e => e.uuid)).toEqual(["u1", "a1"]);
    expect(out.every(e => e.sessionId === "NEW")).toBe(true);
    expect(out.every(e => e.type !== "summary")).toBe(true);
  });

  test("assistant cut includes target line", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await forkSession({ srcPath: src, dstPath: dst, targetUuid: "a1", targetRole: "assistant", newSessionId: "NEW" });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out.map(e => e.uuid)).toEqual(["u1", "a1"]);
  });

  test("missing target uuid throws", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await expect(
      forkSession({ srcPath: src, dstPath: dst, targetUuid: "missing", targetRole: "user", newSessionId: "NEW" }),
    ).rejects.toThrow();
  });

  test("newCwd rewrites cwd field on every copied entry", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    const withCwd = [
      JSON.stringify({ type: "user",      uuid: "u1", sessionId: "S0", cwd: "/old/path", message: { content: "hi" }, timestamp: "t" }),
      JSON.stringify({ type: "assistant", uuid: "a1", sessionId: "S0", cwd: "/old/path", message: { content: "hi back" }, timestamp: "t" }),
      JSON.stringify({ type: "user",      uuid: "u2", sessionId: "S0", cwd: "/old/path", message: { content: "next" }, timestamp: "t" }),
    ].join("\n") + "\n";
    await fs.writeFile(src, withCwd);
    await forkSession({
      srcPath: src,
      dstPath: dst,
      targetUuid: "u2",
      targetRole: "user",
      newSessionId: "NEW",
      newCwd: "/new/place",
    });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out.map(e => e.uuid)).toEqual(["u1", "a1"]);
    expect(out.every(e => e.cwd === "/new/place")).toBe(true);
    expect(out.every(e => e.sessionId === "NEW")).toBe(true);
  });

  test("without newCwd, original cwd is preserved", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    const withCwd = [
      JSON.stringify({ type: "user", uuid: "u1", sessionId: "S0", cwd: "/keep", message: { content: "hi" }, timestamp: "t" }),
      JSON.stringify({ type: "user", uuid: "u2", sessionId: "S0", cwd: "/keep", message: { content: "x" }, timestamp: "t" }),
    ].join("\n") + "\n";
    await fs.writeFile(src, withCwd);
    await forkSession({ srcPath: src, dstPath: dst, targetUuid: "u2", targetRole: "user", newSessionId: "NEW" });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out[0].cwd).toBe("/keep");
  });

  // Real sessions (claude code 2.x) interleave non-user/assistant entries —
  // `attachment`, `system`, `last-prompt`, `file-history-snapshot`,
  // `queue-operation` — between turns, and user/assistant entries routinely
  // set `parentUuid` to one of those intermediates. Dropping them shreds
  // the chain `claude --resume` walks from the tail, so the resumed UI
  // shows only the contiguous run since the first broken link.
  test("keeps non-allowlisted entries so parentUuid chain stays walkable", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    const sample = [
      JSON.stringify({ type: "summary",     summary: "ignore" }),
      JSON.stringify({ type: "user",        uuid: "u1",   sessionId: "S0", parentUuid: null,   message: { content: "hi" } }),
      JSON.stringify({ type: "system",      uuid: "s1",   sessionId: "S0", parentUuid: "u1",   subtype: "local_command" }),
      JSON.stringify({ type: "attachment",  uuid: "att1", sessionId: "S0", parentUuid: "s1" }),
      JSON.stringify({ type: "user",        uuid: "u2",   sessionId: "S0", parentUuid: "att1", message: { content: "again" } }),
      JSON.stringify({ type: "assistant",   uuid: "a1",   sessionId: "S0", parentUuid: "u2",   message: { content: "ok" } }),
      JSON.stringify({ type: "custom-title", customTitle: "ignore too" }),
    ].join("\n") + "\n";
    await fs.writeFile(src, sample);
    await forkSession({ srcPath: src, dstPath: dst, targetUuid: "a1", targetRole: "assistant", newSessionId: "NEW" });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out.map(e => e.uuid)).toEqual(["u1", "s1", "att1", "u2", "a1"]);
    expect(out.every(e => e.type !== "summary" && e.type !== "custom-title")).toBe(true);
    expect(out.every(e => e.sessionId === "NEW")).toBe(true);
  });
});
