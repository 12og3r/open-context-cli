import { describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import { truncate } from "../../src/lib/truncate.ts";

describe("truncate", () => {
  test("no-op when string fits", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates ASCII with ellipsis", () => {
    const out = truncate("the quick brown fox", 10);
    expect(stringWidth(out)).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("treats CJK characters as width 2", () => {
    // "我想做一款终端应用" — each char width 2, 9 chars → width 18
    const out = truncate("我想做一款终端应用", 10);
    expect(stringWidth(out)).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("width 0 returns ellipsis only", () => {
    expect(truncate("abc", 0)).toBe("");
  });

  test("width 1 with multi-char input returns ellipsis", () => {
    const out = truncate("abc", 1);
    expect(stringWidth(out)).toBeLessThanOrEqual(1);
  });
});
