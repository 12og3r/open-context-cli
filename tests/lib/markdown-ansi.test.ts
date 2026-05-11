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

  test("inline code is yellow", () => {
    const out = markdownToAnsi("a `b` c");
    expect(strip(out)).toBe("a b c");
    expect(out).toContain("\x1b[33m");
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

  test("apostrophe is not HTML-encoded", () => {
    expect(strip(markdownToAnsi("It's a test"))).toBe("It's a test");
  });

  test("double quotes are not HTML-encoded", () => {
    expect(strip(markdownToAnsi('He said "hi"'))).toBe('He said "hi"');
  });

  test("angle brackets are not HTML-encoded", () => {
    expect(strip(markdownToAnsi("a < b > c"))).toBe("a < b > c");
  });

  test("ampersand is not HTML-encoded", () => {
    expect(strip(markdownToAnsi("a && b"))).toBe("a && b");
  });

  test("entities inside bold are decoded", () => {
    expect(strip(markdownToAnsi("**It's bold**"))).toBe("It's bold");
  });

  test("entities inside inline code are decoded", () => {
    expect(strip(markdownToAnsi("`it's code`"))).toBe("it's code");
  });

  test("entities inside fenced code are decoded", () => {
    const out = strip(markdownToAnsi("```\nit's code\n```"));
    expect(out).toContain("it's code");
  });

  test("codespan inside list item is rendered", () => {
    const out = markdownToAnsi("- has `code` inside");
    expect(strip(out)).toBe("• has code inside");
    expect(out).toContain("\x1b[33m");
  });

  test("bold inside list item is rendered", () => {
    const out = markdownToAnsi("- **bold** here");
    expect(strip(out)).toBe("• bold here");
    expect(out).toContain("\x1b[1m");
  });

  test("italic inside list item is rendered", () => {
    const out = markdownToAnsi("- *italic* here");
    expect(strip(out)).toBe("• italic here");
    expect(out).toContain("\x1b[3m");
  });
});
