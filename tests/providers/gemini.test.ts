import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { GeminiProvider } from "../../src/providers/gemini.ts";
import type { Message } from "../../src/providers/types.ts";

const FIXTURES = path.resolve(__dirname, "../fixtures/gemini");

// The real layout is `<root>/<projectId>/chats/session-*.jsonl` with
// `<root>/../projects.json` mapping projectId → absolute path. We
// reproduce that under a tmpdir so the provider's reverse-lookup works
// and we don't touch the developer's real ~/.gemini.
async function makeRoot(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-test-"));
  const root = path.join(home, "tmp");
  const projectFooChats = path.join(root, "abcd1234ef56", "chats");
  const projectBarChats = path.join(root, "9876fedc1234", "chats");
  await fs.mkdir(projectFooChats, { recursive: true });
  await fs.mkdir(projectBarChats, { recursive: true });
  await fs.copyFile(
    path.join(FIXTURES, "projects.json"),
    path.join(home, "projects.json"),
  );
  // Project foo gets the bulk of the fixtures; project bar exercises the
  // multi-project aggregation path with a single session.
  const fooPairs: Array<[string, string]> = [
    ["basic.jsonl",      "session-2026-05-10T07-00-019e10b0.jsonl"],
    ["with-tools.jsonl", "session-2026-05-10T08-00-019e10b1.jsonl"],
    ["with-rewind.jsonl","session-2026-05-10T09-00-019e10b2.jsonl"],
    ["empty.jsonl",      "session-2026-05-10T10-00-019e10b3.jsonl"],
    ["malformed.jsonl",  "session-2026-05-10T11-00-019e10b4.jsonl"],
    ["subagent.jsonl",   "session-2026-05-10T12-00-019e10b5.jsonl"],
  ];
  for (const [src, dst] of fooPairs) {
    await fs.copyFile(path.join(FIXTURES, src), path.join(projectFooChats, dst));
  }
  // Use a fresh sessionId for the bar-project session so the foo-project
  // basic.jsonl id stays unique to its file. Without this the two sessions
  // both report sessionId 019e10b0-1111-... and `list.find(byId)` could
  // return either one, hiding the multi-project aggregation we want to
  // exercise.
  const barBasic = (await fs.readFile(path.join(FIXTURES, "basic.jsonl"), "utf8"))
    .replace(
      /"sessionId":"019e10b0-1111-4000-8000-aaa000000001"/g,
      `"sessionId":"019e10c0-0001-4000-8000-bbb000000001"`,
    );
  await fs.writeFile(
    path.join(projectBarChats, "session-2026-05-10T07-30-019e10c0.jsonl"),
    barBasic,
    "utf8",
  );
  return root;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("GeminiProvider.listSessions", () => {
  test("returns one SessionMeta per session-*.jsonl, aggregating across projects", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    // Project foo: basic + with-tools + with-rewind + empty + malformed = 5
    // (subagent kind is filtered out).
    // Project bar: 1.
    // Total: 6.
    expect(list).toHaveLength(6);
    expect(list.every(m => m.source === "gemini")).toBe(true);
  });

  test("uses the bootstrap sessionId as the session id", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const basic = list.find(m => m.id === "019e10b0-1111-4000-8000-aaa000000001")!;
    expect(basic).toBeDefined();
    expect(basic.filePath.endsWith(".jsonl")).toBe(true);
  });

  test("resolves projectPath via projects.json reverse-lookup", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const basic = list.find(m => m.id === "019e10b0-1111-4000-8000-aaa000000001")!;
    expect(basic.cwd).toBe("/Users/roger/projects/foo");
    expect(basic.projectPath).toBe("/Users/roger/projects/foo");

    // The session under projectId 9876fedc1234 should resolve to the
    // other project; otherwise the registry parse silently dropped it.
    const otherProject = list.filter(
      m => m.projectPath === "/Users/roger/projects/bar",
    );
    expect(otherProject).toHaveLength(1);
  });

  test("$set summary updates surface as the SessionMeta summary", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const basic = list.find(m => m.id === "019e10b0-1111-4000-8000-aaa000000001")!;
    expect(basic.summary).toBe("intro chat");
  });

  test("first user text becomes the summary when no $set summary exists", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const tools = list.find(m => m.id === "019e10b0-2222-4000-8000-aaa000000002")!;
    expect(tools.summary).toBe("please list the files");
  });

  test("rewind records pop messages before the count is tallied", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const rewind = list.find(m => m.id === "019e10b0-3333-4000-8000-aaa000000003")!;
    // After applying $rewindTo on msg-u2, the surviving messages are
    // msg-u1, msg-g1, msg-u3, msg-g3 → 4 visible rows in both display
    // modes (no tool calls in this fixture).
    expect(rewind.messageCounts).toEqual({ concise: 4, full: 4 });
    expect(rewind.summary).toBe("first question");
  });

  test("full count includes tool_use/tool_result rows; concise count omits them", async () => {
    // The with-tools fixture has 1 user, 1 gemini assistant with one
    // toolCalls entry. messagesFromRecord fans the gemini line into
    // [assistant text, tool_use, tool_result] — 4 rows for "full",
    // 2 (user + assistant) for "concise".
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const tools = list.find(m => m.id === "019e10b0-2222-4000-8000-aaa000000002")!;
    expect(tools.messageCounts).toEqual({ concise: 2, full: 4 });
  });

  test("empty session falls back to the (empty session) sentinel", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const empty = list.find(m => m.id === "019e10b0-4444-4000-8000-aaa000000004")!;
    expect(empty.summary).toBe("(empty session)");
    expect(empty.messageCounts).toEqual({ concise: 0, full: 0 });
  });

  test("malformed JSON lines are skipped without aborting the file", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    const bad = list.find(m => m.id === "019e10b0-5555-4000-8000-aaa000000005")!;
    expect(bad.summary).toBe("survives malformed lines");
  });

  test("subagent transcripts are filtered out of the browse view", async () => {
    const root = await makeRoot();
    const list = await new GeminiProvider().listSessions(root);
    expect(list.find(m => m.id === "019e10b0-6666-4000-8000-aaa000000006")).toBeUndefined();
  });

  test("returns empty list when the gemini root doesn't exist", async () => {
    const list = await new GeminiProvider().listSessions("/does/not/exist/anywhere");
    expect(list).toEqual([]);
  });
});

describe("GeminiProvider.loadSession", () => {
  test("yields user, assistant, tool_use, tool_result in source order", async () => {
    const root = await makeRoot();
    const provider = new GeminiProvider();
    const list = await provider.listSessions(root);
    const tools = list.find(m => m.id === "019e10b0-2222-4000-8000-aaa000000002")!;
    const messages = await collect<Message>(provider.loadSession(tools.filePath));
    const roles = messages.map(m => m.role);
    expect(roles).toEqual(["user", "assistant", "tool_use", "tool_result"]);
    const toolUse = messages.find(m => m.role === "tool_use")!;
    // displayName "Shell" wins over the raw name "run_shell_command".
    expect(toolUse.toolName).toBe("Shell");
    expect(toolUse.content).toContain("ls -la");
    const toolResult = messages.find(m => m.role === "tool_result")!;
    expect(toolResult.content).toContain("file1");
  });

  test("$rewindTo records drop the messages they target before emit", async () => {
    const root = await makeRoot();
    const provider = new GeminiProvider();
    const list = await provider.listSessions(root);
    const rewind = list.find(m => m.id === "019e10b0-3333-4000-8000-aaa000000003")!;
    const messages = await collect<Message>(provider.loadSession(rewind.filePath));
    const roles = messages.map(m => m.role);
    const contents = messages.map(m => m.content);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
    expect(contents).toEqual([
      "first question",
      "first answer",
      "replacement question",
      "replacement answer",
    ]);
    // The "second question (will be rewound)" message must NOT appear,
    // otherwise the rewind machinery isn't being honored.
    expect(contents.some(c => c.includes("rewound"))).toBe(false);
  });

  test("every yielded message has a string uuid (gated by the preview's Enter handler)", async () => {
    const root = await makeRoot();
    const provider = new GeminiProvider();
    const list = await provider.listSessions(root);
    const basic = list.find(m => m.id === "019e10b0-1111-4000-8000-aaa000000001")!;
    const messages = await collect<Message>(provider.loadSession(basic.filePath));
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(typeof m.uuid).toBe("string");
      expect(m.uuid!.length).toBeGreaterThan(0);
    }
  });

  test("malformed lines don't crash loadSession", async () => {
    const root = await makeRoot();
    const provider = new GeminiProvider();
    const list = await provider.listSessions(root);
    const bad = list.find(m => m.id === "019e10b0-5555-4000-8000-aaa000000005")!;
    const messages = await collect<Message>(provider.loadSession(bad.filePath));
    expect(messages.map(m => m.role)).toEqual(["user", "assistant"]);
  });
});
