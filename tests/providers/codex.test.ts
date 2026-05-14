import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { CodexProvider } from "../../src/providers/codex.ts";
import type { Message } from "../../src/providers/types.ts";

const FIXTURES = path.resolve(__dirname, "../fixtures/codex");

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-test-"));
  // Mimic Codex layout: <root>/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
  const day = path.join(root, "2026", "05", "10");
  await fs.mkdir(day, { recursive: true });
  const pairs: Array<[string, string]> = [
    ["basic.jsonl",      "rollout-2026-05-10T06-53-26-019e10a9-883c-7652-ba9b-3b36dc9face3.jsonl"],
    ["with-tools.jsonl", "rollout-2026-05-10T07-00-00-019e10b0-1111-7000-aaaa-000000000001.jsonl"],
    ["empty.jsonl",      "rollout-2026-05-10T08-00-00-019e10c0-2222-7000-aaaa-000000000002.jsonl"],
    ["malformed.jsonl",  "rollout-2026-05-10T09-00-00-019e10d0-3333-7000-aaaa-000000000003.jsonl"],
  ];
  for (const [src, dst] of pairs) {
    await fs.copyFile(path.join(FIXTURES, src), path.join(day, dst));
  }
  return root;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("CodexProvider.listSessions", () => {
  test("returns metadata for every rollout-*.jsonl in the date tree", async () => {
    const root = await makeRoot();
    const list = await new CodexProvider().listSessions(root);
    // basic + with-tools + malformed = 3. The empty fixture is filtered
    // out by readMeta — see "(empty session) filter" below.
    expect(list).toHaveLength(3);
    expect(list.every(m => m.source === "codex")).toBe(true);
  });

  test("uses session_meta.id as the session id and session_meta.cwd as projectPath", async () => {
    const root = await makeRoot();
    const list = await new CodexProvider().listSessions(root);
    const basic = list.find(m => m.id === "019e10a9-883c-7652-ba9b-3b36dc9face3")!;
    expect(basic.cwd).toBe("/Users/roger/projects/foo");
    expect(basic.projectPath).toBe("/Users/roger/projects/foo");
  });

  test("first user text becomes the summary, skipping boilerplate-wrapped turns", async () => {
    const root = await makeRoot();
    const list = await new CodexProvider().listSessions(root);
    const basic = list.find(m => m.id === "019e10a9-883c-7652-ba9b-3b36dc9face3")!;
    expect(basic.summary).toBe("hello there codex");
  });

  test("sessions with no derivable summary are filtered out", async () => {
    // Rollouts that landed on disk before any user/assistant message
    // showed up have no firstUserText / firstAssistantText to derive a
    // summary from. We'd otherwise label them "(empty session) · 0 msgs"
    // and leave the user with nothing to do — filter at readMeta instead.
    const root = await makeRoot();
    const list = await new CodexProvider().listSessions(root);
    expect(list.find(m => m.id === "019e10c0-2222-7000-aaaa-000000000002")).toBeUndefined();
  });

  test("returns empty list when the codex root doesn't exist", async () => {
    const list = await new CodexProvider().listSessions("/does/not/exist/anywhere");
    expect(list).toEqual([]);
  });

  test("malformed JSON lines are skipped without aborting the file", async () => {
    const root = await makeRoot();
    const list = await new CodexProvider().listSessions(root);
    const bad = list.find(m => m.id === "019e10d0-3333-7000-aaaa-000000000003")!;
    expect(bad.summary).toBe("survives malformed lines");
  });
});

describe("CodexProvider.loadSession", () => {
  test("yields user, assistant, tool_use, tool_result", async () => {
    const root = await makeRoot();
    const provider = new CodexProvider();
    const list = await provider.listSessions(root);
    const tools = list.find(m => m.id === "019e10b0-1111-7000-aaaa-000000000001")!;
    const messages = await collect<Message>(provider.loadSession(tools.filePath));
    const roles = messages.map(m => m.role);
    expect(roles).toEqual(["user", "assistant", "tool_use", "tool_result"]);
    const toolUse = messages.find(m => m.role === "tool_use")!;
    expect(toolUse.toolName).toBe("shell");
    expect(toolUse.content).toContain("ls");
    const toolResult = messages.find(m => m.role === "tool_result")!;
    expect(toolResult.content).toContain("file1");
  });

  test("hides the boilerplate-only first user turn from the rendered conversation", async () => {
    const root = await makeRoot();
    const provider = new CodexProvider();
    const list = await provider.listSessions(root);
    const basic = list.find(m => m.id === "019e10a9-883c-7652-ba9b-3b36dc9face3")!;
    const messages = await collect<Message>(provider.loadSession(basic.filePath));
    // The first response_item user message is wrapped in <environment_context>;
    // the boilerplate-strip removes it. The visible user message is "hello…".
    const userMessages = messages.filter(m => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]!.content).toBe("hello there codex");
  });

  test("developer-role messages surface as system role", async () => {
    const root = await makeRoot();
    const provider = new CodexProvider();
    const list = await provider.listSessions(root);
    const basic = list.find(m => m.id === "019e10a9-883c-7652-ba9b-3b36dc9face3")!;
    const messages = await collect<Message>(provider.loadSession(basic.filePath));
    expect(messages.some(m => m.role === "system")).toBe(true);
  });

  test("every yielded message has a string uuid even when the rollout omits payload.id", async () => {
    // Real Codex rollouts don't put `id` on response_item.payload — only
    // session_meta has one. The session-preview Enter handler gates the
    // continue-conversation footer on `typeof msg.uuid === "string"`, so
    // the provider has to synthesize a stable per-entry id, otherwise
    // pressing Enter on a Codex message does nothing.
    const root = await makeRoot();
    const provider = new CodexProvider();
    const list = await provider.listSessions(root);
    const basic = list.find(m => m.id === "019e10a9-883c-7652-ba9b-3b36dc9face3")!;
    const messages = await collect<Message>(provider.loadSession(basic.filePath));
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(typeof m.uuid).toBe("string");
      expect(m.uuid!.length).toBeGreaterThan(0);
    }
    // uuids are unique across the session so the cursor footer can
    // distinguish messages.
    const ids = messages.map(m => m.uuid!);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
