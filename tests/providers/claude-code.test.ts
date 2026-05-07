import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { ClaudeCodeProvider } from "../../src/providers/claude-code.ts";

const FIXTURES = path.resolve(__dirname, "../fixtures/claude-code");

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-test-"));
  // Mimic Claude Code layout: <root>/<encoded-project>/<uuid>.jsonl
  const sub = path.join(root, "-Users-roger-projects-foo");
  await fs.mkdir(sub, { recursive: true });
  for (const f of ["with-summary.jsonl", "without-summary.jsonl", "with-tools.jsonl", "malformed.jsonl", "empty.jsonl"]) {
    await fs.copyFile(path.join(FIXTURES, f), path.join(sub, f));
  }
  return root;
}

describe("ClaudeCodeProvider.listSessions", () => {
  test("returns metadata for every .jsonl in subdirs", async () => {
    const root = await makeRoot();
    const provider = new ClaudeCodeProvider();
    const list = await provider.listSessions(root);
    expect(list).toHaveLength(5);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-summary.jsonl"]!.summary).toBe("Building Ink TUI app");
    expect(byName["without-summary.jsonl"]!.summary).toContain("first user message");
    expect(byName["empty.jsonl"]!.summary).toBe("(empty session)");
    expect(byName["malformed.jsonl"]!.summary).toBe("Has a bad line");
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
});
