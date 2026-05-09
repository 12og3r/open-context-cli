import { describe, expect, test } from "bun:test";
import { findMatches } from "../../src/lib/matches.ts";
import type { Message } from "../../src/providers/types.ts";

const msg = (content: string): Message => ({
  role: "user", content, timestamp: new Date(0), raw: {},
});

describe("findMatches", () => {
  test("returns empty array when query is empty", () => {
    expect(findMatches([msg("hello")], "")).toEqual([]);
  });

  test("finds single occurrence", () => {
    const out = findMatches([msg("hello world")], "world");
    expect(out).toEqual([{ msgIndex: 0, contentOffset: 6, length: 5 }]);
  });

  test("finds multiple occurrences in same message in order", () => {
    const out = findMatches([msg("aa bb aa cc aa")], "aa");
    expect(out.map(m => m.contentOffset)).toEqual([0, 6, 12]);
  });

  test("matches across messages preserve msgIndex", () => {
    const out = findMatches(
      [msg("first useState"), msg("no match"), msg("useState here")],
      "useState",
    );
    expect(out).toEqual([
      { msgIndex: 0, contentOffset: 6, length: 8 },
      { msgIndex: 2, contentOffset: 0, length: 8 },
    ]);
  });

  test("is case-insensitive", () => {
    const out = findMatches([msg("UseState use_state useState")], "useState");
    expect(out.map(m => m.contentOffset)).toEqual([0, 19]);
  });

  test("escapes regex metacharacters in query", () => {
    const out = findMatches([msg("a.b a.b")], ".");
    expect(out.length).toBe(2);
    const reMeta = findMatches([msg("a.b acb")], "a.b");
    expect(reMeta).toEqual([{ msgIndex: 0, contentOffset: 0, length: 3 }]);
  });

  test("handles overlapping query without infinite loop", () => {
    const out = findMatches([msg("aaaa")], "aa");
    expect(out.map(m => m.contentOffset)).toEqual([0, 2]);
  });

  test("skips tool_use, tool_result, and system messages", () => {
    const messages: Message[] = [
      { role: "user",        content: "needle in user",        timestamp: new Date(0), raw: {} },
      { role: "tool_use",    content: "needle in tool_use",    timestamp: new Date(0), raw: {} },
      { role: "tool_result", content: "needle in tool_result", timestamp: new Date(0), raw: {} },
      { role: "system",      content: "needle in system",      timestamp: new Date(0), raw: {} },
      { role: "assistant",   content: "needle in assistant",   timestamp: new Date(0), raw: {} },
    ];
    const out = findMatches(messages, "needle");
    expect(out.map(m => m.msgIndex)).toEqual([0, 4]);
  });
});
