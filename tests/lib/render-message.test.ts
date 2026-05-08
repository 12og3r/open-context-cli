import { describe, expect, test } from "bun:test";
import { applyHighlight } from "../../src/lib/render-message.ts";
import type { Message } from "../../src/providers/types.ts";

const msg = (content: string): Message => ({
  role: "user", content, timestamp: new Date(0), raw: {},
});

describe("applyHighlight", () => {
  test("returns messages unchanged when query is empty", () => {
    const ms = [msg("hello")];
    const r = applyHighlight(ms, "", -1);
    expect(r.messages[0]?.content).toBe("hello");
    expect(r.matches).toEqual([]);
  });

  test("wraps non-current matches in INVERSE", () => {
    const r = applyHighlight([msg("aa bb aa")], "aa", 1);
    // current is index 1 (second occurrence) → yellow; first stays INVERSE
    expect(r.messages[0]?.content).toContain("\x1b[7maa\x1b[27m");
    expect(r.messages[0]?.content).toContain("\x1b[43m\x1b[30maa\x1b[49m\x1b[39m");
  });

  test("wraps current match in yellow-on-black", () => {
    const r = applyHighlight([msg("hello world hello")], "hello", 0);
    expect(r.messages[0]?.content.indexOf("\x1b[43m\x1b[30mhello\x1b[49m\x1b[39m")).toBe(0);
  });

  test("matchIndex of -1 makes every match reverse-video", () => {
    const r = applyHighlight([msg("aa aa")], "aa", -1);
    expect(r.messages[0]?.content).not.toContain("\x1b[43m");
    expect((r.messages[0]?.content.match(/\x1b\[7m/g) ?? []).length).toBe(2);
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
