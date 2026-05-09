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
    expect(list).toHaveLength(8);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-summary.jsonl"]!.summary).toBe("Building Ink TUI app");
    expect(byName["without-summary.jsonl"]!.summary).toContain("first user message");
    expect(byName["empty.jsonl"]!.summary).toBe("(empty session)");
    expect(byName["malformed.jsonl"]!.summary).toBe("Has a bad line");
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

  test("counts user+assistant lines only", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const tools = list.find(m => path.basename(m.filePath) === "with-tools.jsonl")!;
    // user + assistant (the tool_result is wrapped in a user line per Claude Code)
    expect(tools.messageCount).toBe(3);
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
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const empty = list.find(m => path.basename(m.filePath) === "empty.jsonl")!;
    const messages = await collect<Message>(new ClaudeCodeProvider().loadSession(empty.filePath));
    expect(messages).toHaveLength(0);
  });
});
