import { describe, expect, test } from "bun:test";
import { applyHighlight, renderMessageLines } from "../../src/lib/render-message.ts";
import type { Message } from "../../src/providers/types.ts";

const msg = (content: string): Message => ({
  role: "user", content, timestamp: new Date(0), raw: {},
});

const tool = (content: string, toolName = "Read"): Message => ({
  role: "tool_use", content, toolName, timestamp: new Date(0), raw: {},
});

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

describe("applyHighlight", () => {
  test("returns messages unchanged when query is empty", () => {
    const ms = [msg("hello")];
    const r = applyHighlight(ms, "", -1);
    expect(r.messages[0]?.content).toBe("hello");
    expect(r.matches).toEqual([]);
  });

  test("wraps non-current matches in underline only (outline style)", () => {
    const r = applyHighlight([msg("aa bb aa")], "aa", 1);
    // current is index 1 (second occurrence) → red underline; first stays plain underline
    expect(r.messages[0]?.content).toContain("\x1b[4maa\x1b[24m");
    expect(r.messages[0]?.content).toContain("\x1b[4m\x1b[31maa\x1b[24m\x1b[39m");
  });

  test("wraps current match in red underline", () => {
    const r = applyHighlight([msg("hello world hello")], "hello", 0);
    expect(r.messages[0]?.content.indexOf("\x1b[4m\x1b[31mhello\x1b[24m\x1b[39m")).toBe(0);
  });

  test("matchIndex of -1 makes every match underline-only without color", () => {
    const r = applyHighlight([msg("aa aa")], "aa", -1);
    expect(r.messages[0]?.content).not.toContain("\x1b[31m");
    expect((r.messages[0]?.content.match(/\x1b\[4m/g) ?? []).length).toBe(2);
  });

  test("returns matches with stable indices across messages", () => {
    const ms = [msg("hi hi"), msg("hi")];
    const r = applyHighlight(ms, "hi", 2);
    expect(r.matches).toEqual([
      { msgIndex: 0, contentOffset: 0, length: 2 },
      { msgIndex: 0, contentOffset: 3, length: 2 },
      { msgIndex: 1, contentOffset: 0, length: 2 },
    ]);
  });
});

describe("tool body disclosure icon", () => {
  const opts = { width: 80, current: false, expanded: false, emoji: false, now: new Date(0) };

  test("multi-line collapsed body uses ▸", () => {
    const out = joinLines(renderMessageLines(tool("alpha\nbeta\ngamma"), opts));
    expect(out).toContain("▸ alpha");
    expect(out).not.toContain("▾");
  });

  test("multi-line expanded body keeps an icon — switches to ▾", () => {
    const out = joinLines(
      renderMessageLines(tool("alpha\nbeta\ngamma"), { ...opts, expanded: true }),
    );
    expect(out).toContain("▾ alpha");
    expect(out).toContain("beta");
    expect(out).toContain("gamma");
    expect(out).not.toContain("▸");
  });

  test("single-line body shows no disclosure icon at all", () => {
    const collapsed = joinLines(renderMessageLines(tool("just one line"), opts));
    const expanded = joinLines(
      renderMessageLines(tool("just one line"), { ...opts, expanded: true }),
    );
    expect(collapsed).not.toContain("▸");
    expect(collapsed).not.toContain("▾");
    expect(expanded).not.toContain("▸");
    expect(expanded).not.toContain("▾");
    expect(collapsed).toContain("just one line");
  });
});
