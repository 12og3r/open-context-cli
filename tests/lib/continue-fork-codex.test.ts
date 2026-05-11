import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { forkCodexSession } from "../../src/lib/continue-fork-codex.ts";

async function tmpFile(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "fork-codex-"));
  return path.join(d, `${crypto.randomUUID()}.jsonl`);
}

// Mirror a real codex rollout structure (verified against
// ~/.codex/sessions/.../rollout-*.jsonl). entryIndex counts each
// non-empty line in load order — that's how CodexProvider derives
// synthetic uuids of the form `codex:<n>`.
//
// Lines in this fixture:
//   0  session_meta
//   1  event_msg            (skipped by provider but counted in index)
//   2  response_item user      → codex:2
//   3  response_item assistant → codex:3
//   4  turn_context         (skipped by provider but counted)
//   5  response_item user      → codex:5
//   6  response_item assistant → codex:6
const SAMPLE = [
  JSON.stringify({ timestamp: "t0", type: "session_meta", payload: { id: "OLD", cwd: "/p", model: "x" } }),
  JSON.stringify({ timestamp: "t1", type: "event_msg",    payload: { type: "boot" } }),
  JSON.stringify({ timestamp: "t2", type: "response_item", payload: { type: "message", role: "user",      content: [{ type: "input_text", text: "hi" }] } }),
  JSON.stringify({ timestamp: "t3", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] } }),
  JSON.stringify({ timestamp: "t4", type: "turn_context", payload: { cfg: 1 } }),
  JSON.stringify({ timestamp: "t5", type: "response_item", payload: { type: "message", role: "user",      content: [{ type: "input_text", text: "again" }] } }),
  JSON.stringify({ timestamp: "t6", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }),
].join("\n") + "\n";

async function readJsonl(p: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(p, "utf8");
  return raw.trim().split("\n").map((l) => JSON.parse(l));
}

describe("forkCodexSession", () => {
  test("user-cut on codex:5 excludes target and keeps everything before", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);

    await forkCodexSession({
      srcPath: src,
      dstPath: dst,
      targetUuid: "codex:5",
      targetRole: "user",
      newSessionId: "NEW",
    });

    const out = await readJsonl(dst);
    // session_meta + event_msg + user + assistant + turn_context. The
    // target line (the second user message) must be absent.
    expect(out.length).toBe(5);
    expect(out[0]!.type).toBe("session_meta");
    expect((out[0]!.payload as Record<string, unknown>).id).toBe("NEW");
    expect(out.at(-1)!.type).toBe("turn_context");
  });

  test("assistant-cut on codex:3 includes target", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);

    await forkCodexSession({
      srcPath: src,
      dstPath: dst,
      targetUuid: "codex:3",
      targetRole: "assistant",
      newSessionId: "NEW",
    });

    const out = await readJsonl(dst);
    // meta + event_msg + user(2) + assistant(3, included).
    expect(out.length).toBe(4);
    expect(out[0]!.type).toBe("session_meta");
    expect((out[0]!.payload as Record<string, unknown>).id).toBe("NEW");
    const last = out.at(-1)!;
    expect(last.type).toBe("response_item");
    expect((last.payload as Record<string, unknown>).role).toBe("assistant");
  });

  test("missing target uuid throws", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await expect(
      forkCodexSession({
        srcPath: src,
        dstPath: dst,
        targetUuid: "codex:999",
        targetRole: "user",
        newSessionId: "NEW",
      }),
    ).rejects.toThrow("target uuid not found");
  });

  test("matches payload.id when the response_item carries one", async () => {
    // Newer codex versions may stamp response_items with a real
    // payload.id. CodexProvider prefers it over the synthetic
    // `codex:<n>` form, so the fork logic must too — otherwise a click
    // on such a message would silently fall through to the
    // not-found error path.
    const src = await tmpFile();
    const dst = await tmpFile();
    const withRealIds = [
      JSON.stringify({ timestamp: "t0", type: "session_meta", payload: { id: "OLD" } }),
      JSON.stringify({ timestamp: "t1", type: "response_item", payload: { id: "msg-a", type: "message", role: "user",      content: [{ type: "input_text", text: "hi" }] } }),
      JSON.stringify({ timestamp: "t2", type: "response_item", payload: { id: "msg-b", type: "message", role: "assistant", content: [{ type: "output_text", text: "hey" }] } }),
      JSON.stringify({ timestamp: "t3", type: "response_item", payload: { id: "msg-c", type: "message", role: "user",      content: [{ type: "input_text", text: "x" }] } }),
    ].join("\n") + "\n";
    await fs.writeFile(src, withRealIds);

    await forkCodexSession({
      srcPath: src,
      dstPath: dst,
      targetUuid: "msg-c",
      targetRole: "user",
      newSessionId: "NEW",
    });

    const out = await readJsonl(dst);
    // session_meta + msg-a + msg-b — msg-c is excluded by user-cut.
    expect(out.length).toBe(3);
    expect((out[1]!.payload as Record<string, unknown>).id).toBe("msg-a");
    expect((out[2]!.payload as Record<string, unknown>).id).toBe("msg-b");
  });

  test("session_meta is preserved with all other fields intact", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);

    await forkCodexSession({
      srcPath: src,
      dstPath: dst,
      targetUuid: "codex:3",
      targetRole: "assistant",
      newSessionId: "NEW",
    });

    const out = await readJsonl(dst);
    const meta = out[0]!;
    expect(meta.type).toBe("session_meta");
    const payload = meta.payload as Record<string, unknown>;
    expect(payload.id).toBe("NEW");
    // cwd and model must survive unchanged — codex relies on them at
    // resume time for project association and model selection.
    expect(payload.cwd).toBe("/p");
    expect(payload.model).toBe("x");
  });
});
