import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { ClaudeCodeProvider } from "../../src/providers/claude-code.ts";
import type { Message } from "../../src/providers/types.ts";

const FIXTURES = path.resolve(__dirname, "../fixtures/claude-code");

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-test-"));
  // Mimic Claude Code layout: <root>/<encoded-project>/<uuid>.jsonl
  const sub = path.join(root, "-Users-roger-projects-foo");
  await fs.mkdir(sub, { recursive: true });
  for (const f of [
    "with-summary.jsonl",
    "without-summary.jsonl",
    "with-tools.jsonl",
    "malformed.jsonl",
    "empty.jsonl",
    "with-boilerplate.jsonl",
    "with-slug.jsonl",
    "with-task.jsonl",
  ]) {
    await fs.copyFile(path.join(FIXTURES, f), path.join(sub, f));
  }
  return root;
}

describe("ClaudeCodeProvider.listSessions", () => {
  test("returns metadata for every .jsonl in subdirs", async () => {
    const root = await makeRoot();
    const provider = new ClaudeCodeProvider();
    const list = await provider.listSessions(root);
    // empty.jsonl is filtered out at readMeta (see "(empty session) filter"
    // test below), so the visible count is 7, not 8.
    expect(list).toHaveLength(7);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-summary.jsonl"]!.summary).toBe("Building Ink TUI app");
    expect(byName["without-summary.jsonl"]!.summary).toContain("first user message");
    expect(byName["empty.jsonl"]).toBeUndefined();
    expect(byName["malformed.jsonl"]!.summary).toBe("Has a bad line");
  });

  test("sessions with no derivable summary are filtered out", async () => {
    // empty.jsonl has no `summary` / `custom-title` entries and no
    // user/assistant messages, so there's nothing to label it with.
    // We drop the session at the metadata layer rather than surfacing
    // the "(empty session)" placeholder, since the user can't do
    // anything useful with an empty transcript.
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["empty.jsonl"]).toBeUndefined();
  });

  test("skips slash-command boilerplate when extracting first user text", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-boilerplate.jsonl"]!.summary).toBe("the real prompt the user typed");
  });

  test("uses slug as fallback when no meaningful user text exists", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-slug.jsonl"]!.summary).toBe("drifting-weaving-platypus");
  });

  test("falls back to first TaskCreate subject when user text is boilerplate-only", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-task.jsonl"]!.summary).toBe("Bootstrap project");
  });

  test("decodes projectPath from parent directory", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    expect(list.every(m => m.projectPath === "/Users/roger/projects/foo")).toBe(true);
  });

  test("messageCounts track concise vs full preview counts", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const tools = list.find(m => path.basename(m.filePath) === "with-tools.jsonl")!;
    // with-tools.jsonl: 1 user (text) + 1 assistant (text + tool_use) +
    // 1 user (tool_result only). The preview fans these into
    // user/assistant/tool_use/tool_result rows in full mode (4); concise
    // mode keeps only user/assistant rows (2 — the tool_result entry
    // produces no user row because it has no text).
    expect(tools.messageCounts.full).toBe(4);
    expect(tools.messageCounts.concise).toBe(2);
  });

  test("captures cwd from the first user/assistant entry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cwd-fixture-"));
    const slugDir = path.join(root, "-Users-roger-projects-context-cli");
    await fs.mkdir(slugDir, { recursive: true });
    const jsonl = [
      JSON.stringify({ type: "summary", summary: "test" }),
      JSON.stringify({
        type: "user",
        uuid: "u1",
        cwd: "/Users/roger/projects/context-cli",
        message: { content: "hi" },
        timestamp: "2026-01-01T00:00:00Z",
      }),
    ].join("\n") + "\n";
    await fs.writeFile(path.join(slugDir, "abc-def.jsonl"), jsonl);
    const list = await new ClaudeCodeProvider().listSessions(root);
    expect(list[0]?.cwd).toBe("/Users/roger/projects/context-cli");
  });

  test("cwd is undefined when entries lack the field (backward compat)", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    // Existing fixtures don't carry cwd, so undefined is the expected shape.
    expect(list.every(m => m.cwd === undefined)).toBe(true);
  });
});

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("ClaudeCodeProvider.loadSession", () => {
  test("yields user, assistant, tool_use, and tool_result messages", async () => {
    const root = await makeRoot();
    const provider = new ClaudeCodeProvider();
    const list = await provider.listSessions(root);
    const tools = list.find(m => path.basename(m.filePath) === "with-tools.jsonl")!;
    const messages = await collect<Message>(provider.loadSession(tools.filePath));
    const roles = messages.map(m => m.role);
    expect(roles).toEqual(["user", "assistant", "tool_use", "tool_result"]);
    const toolUse = messages.find(m => m.role === "tool_use")!;
    expect(toolUse.toolName).toBe("Bash");
    expect(toolUse.content).toContain("ls -la");
    const toolResult = messages.find(m => m.role === "tool_result")!;
    expect(toolResult.content).toContain("file1");
  });

  test("skips malformed lines and yields surrounding messages", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const bad = list.find(m => path.basename(m.filePath) === "malformed.jsonl")!;
    const messages = await collect<Message>(new ClaudeCodeProvider().loadSession(bad.filePath));
    expect(messages.map(m => m.role)).toEqual(["user"]);
  });

  test("empty file yields zero messages", async () => {
    // listSessions filters empty.jsonl out (no derivable summary), so we
    // call loadSession directly against the fixture path — the loader
    // contract is still that an empty JSONL produces zero messages.
    const root = await makeRoot();
    const emptyPath = path.join(root, "-Users-roger-projects-foo", "empty.jsonl");
    const messages = await collect<Message>(new ClaudeCodeProvider().loadSession(emptyPath));
    expect(messages).toHaveLength(0);
  });
});
