import { describe, expect, test } from "bun:test";
import { markdownToAnsi } from "../../src/lib/markdown-ansi.ts";

// Strip ANSI for substring assertions.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("markdownToAnsi", () => {
  test("plain paragraph passes through", () => {
    expect(strip(markdownToAnsi("hello world"))).toBe("hello world");
  });

  test("bold contains ANSI escape", () => {
    const out = markdownToAnsi("**bold**");
    expect(strip(out)).toBe("bold");
    expect(out).toContain("\x1b[1m");
  });

  test("inline code is dim", () => {
    const out = markdownToAnsi("a `b` c");
    expect(strip(out)).toBe("a b c");
    expect(out).toContain("\x1b[2m");
  });

  test("fenced code block is indented", () => {
    const md = "```\nfoo\nbar\n```";
    const out = markdownToAnsi(md);
    const lines = strip(out).split("\n");
    expect(lines.some(l => l.startsWith("  foo"))).toBe(true);
    expect(lines.some(l => l.startsWith("  bar"))).toBe(true);
  });

  test("unordered list uses bullet", () => {
    const out = markdownToAnsi("- one\n- two");
    expect(strip(out)).toContain("• one");
    expect(strip(out)).toContain("• two");
  });

  test("h1 is bold", () => {
    const out = markdownToAnsi("# hi");
    expect(strip(out)).toBe("hi");
    expect(out).toContain("\x1b[1m");
  });
});
