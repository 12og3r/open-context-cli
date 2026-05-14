import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stampSourceSummary } from "../../src/lib/gemini-source-summary.ts";

async function tmpfile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-stamp-test-"));
  return path.join(dir, "session.jsonl");
}

async function readAllLines(p: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(p, "utf8");
  return raw.split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
}

function bootstrap(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: "11111111-2222-4000-8000-000000000001",
    projectHash: "deadbeef",
    startTime: "2026-05-10T07:00:00.000Z",
    lastUpdated: "2026-05-10T07:00:00.000Z",
    kind: "main",
    ...extra,
  };
}

function userMsg(text: string, id = "msg-u1"): Record<string, unknown> {
  return { id, timestamp: "2026-05-10T07:00:01.000Z", type: "user", content: text };
}

describe("stampSourceSummary", () => {
  test("appends summary + memoryScratchpad when source has neither", async () => {
    const p = await tmpfile();
    await fs.writeFile(
      p,
      [JSON.stringify(bootstrap()), JSON.stringify(userMsg("Add dark mode to the settings page"))].join("\n") + "\n",
      "utf8",
    );
    const written = await stampSourceSummary(p);
    expect(written).toBe("Add dark mode to the settings page");
    const entries = await readAllLines(p);
    const lastSet = (entries.at(-1) as { $set?: Record<string, unknown> }).$set!;
    expect(lastSet.summary).toBe("Add dark mode to the settings page");
    // Default scratchpad stub is fine — gemini's freshness check just
    // needs a truthy value present.
    expect(lastSet.memoryScratchpad).toEqual({ version: 1 });
  });

  test("truncates a long first user message to gemini's 80-char ceiling", async () => {
    const p = await tmpfile();
    const long = "Refactor the entire authentication subsystem to use the new OAuth flow and migrate all existing sessions over without dropping anyone";
    await fs.writeFile(
      p,
      [JSON.stringify(bootstrap()), JSON.stringify(userMsg(long))].join("\n") + "\n",
      "utf8",
    );
    const written = await stampSourceSummary(p);
    expect(written).not.toBeNull();
    expect(written!.length).toBeLessThanOrEqual(80);
    // Should end with the truncation marker so the user sees the cut.
    expect(written!.endsWith("…")).toBe(true);
  });

  test("falls back to a generic label when there's no user message text", async () => {
    const p = await tmpfile();
    await fs.writeFile(p, JSON.stringify(bootstrap()) + "\n", "utf8");
    const written = await stampSourceSummary(p);
    expect(written).toBe("Forked conversation");
  });

  test("preserves existing memoryScratchpad value when refreshing", async () => {
    // The source had a real scratchpad written by a previous gemini run.
    // We must NOT clobber its contents — only refresh its freshness so
    // gemini's auto-summary skips this file.
    const p = await tmpfile();
    const realScratchpad = { version: 1, plan: "investigate auth", notes: ["check oauth"] };
    await fs.writeFile(
      p,
      [
        JSON.stringify(bootstrap()),
        JSON.stringify(userMsg("Debug the auth flow")),
        JSON.stringify({ $set: { memoryScratchpad: realScratchpad } }),
        // A message after the scratchpad makes it stale — this is the
        // condition that triggers gemini's overwrite.
        JSON.stringify({ id: "msg-u2", timestamp: "2026-05-10T07:01:00.000Z", type: "user", content: "follow up" }),
      ].join("\n") + "\n",
      "utf8",
    );
    await stampSourceSummary(p);
    const entries = await readAllLines(p);
    const lastSet = (entries.at(-1) as { $set?: Record<string, unknown> }).$set!;
    expect(lastSet.memoryScratchpad).toEqual(realScratchpad);
    expect(lastSet.summary).toBe("Debug the auth flow");
  });

  test("doesn't write a duplicate line when source already has summary + fresh scratchpad", async () => {
    // Idempotency matters because the user may fork the same source
    // multiple times; appending on every fork would balloon the file.
    const p = await tmpfile();
    await fs.writeFile(
      p,
      [
        JSON.stringify(bootstrap()),
        JSON.stringify(userMsg("hi")),
        // Note: scratchpad is fresh because no message/rewind follows it.
        JSON.stringify({ $set: { summary: "existing summary", memoryScratchpad: { version: 1 } } }),
      ].join("\n") + "\n",
      "utf8",
    );
    const sizeBefore = (await fs.stat(p)).size;
    const written = await stampSourceSummary(p);
    expect(written).toBeNull();
    const sizeAfter = (await fs.stat(p)).size;
    expect(sizeAfter).toBe(sizeBefore);
  });

  test("refreshes when scratchpad is present but stale (messages after the $set)", async () => {
    // This is the common case the user hit: source had a scratchpad once,
    // but more conversation happened after, so it's stale → gemini would
    // overwrite. Stamp must re-refresh.
    const p = await tmpfile();
    await fs.writeFile(
      p,
      [
        JSON.stringify(bootstrap()),
        JSON.stringify(userMsg("first")),
        JSON.stringify({ $set: { memoryScratchpad: { version: 1 } } }),
        JSON.stringify({ id: "msg-u2", timestamp: "2026-05-10T07:01:00.000Z", type: "user", content: "second" }),
        JSON.stringify({ id: "msg-g1", timestamp: "2026-05-10T07:01:02.000Z", type: "gemini", content: "ok" }),
      ].join("\n") + "\n",
      "utf8",
    );
    await stampSourceSummary(p);
    const entries = await readAllLines(p);
    const lastSet = (entries.at(-1) as { $set?: Record<string, unknown> }).$set!;
    expect(lastSet.memoryScratchpad).toBeDefined();
    expect(lastSet.summary).toBe("first");
  });

  test("recognizes content as array of text parts (gemini's real wire format)", async () => {
    const p = await tmpfile();
    await fs.writeFile(
      p,
      [
        JSON.stringify(bootstrap()),
        JSON.stringify({ id: "msg-u1", timestamp: "2026-05-10T07:00:01.000Z", type: "user", content: [{ text: "explain the routing" }] }),
      ].join("\n") + "\n",
      "utf8",
    );
    const written = await stampSourceSummary(p);
    expect(written).toBe("explain the routing");
  });
});
