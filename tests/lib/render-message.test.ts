import { describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import { applyCursorOverlay, applyHighlight, renderMessageLines } from "../../src/lib/render-message.ts";
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

describe("body emoji stripping", () => {
  // Apple Color Emoji renders some glyphs taller than the monospace cell —
  // visibly ✅ in Warp / Ghostty — and we have no way to control terminal row
  // height from inside Ink, so we never let the terminal reach for the emoji
  // font: we replace each emoji match with width-preserving whitespace before
  // the content reaches markdown / wrap / render.
  const opts = { width: 60, current: false, expanded: false, emoji: false, now: new Date(0) };

  test("body emoji is replaced by whitespace of the same cell width", () => {
    const lines = renderMessageLines(msg("都清干净了 ✅"), opts);
    const body = stripAnsi(lines[1] ?? "");
    expect(body).not.toContain("✅");
    // ✅ is 2 cells wide → two spaces stand in. Combined with the leading 4
    // indent and the original space before ✅, the body looks like
    // "    都清干净了   " (5 ASCII spaces + content + 2-space stand-in).
    expect(body).toMatch(/^ {4}都清干净了 {3}$/);
  });

  test("works for emoji whose Unicode form spans multiple JS code units", () => {
    // 🤖 is U+1F916, two UTF-16 code units, but one 2-cell glyph.
    // Original "hi 🤖 there" has 1 space before and 1 space after the emoji;
    // the emoji itself becomes 2 spaces → 4 spaces total between "hi" and
    // "there".
    const lines = renderMessageLines(msg("hi 🤖 there"), opts);
    const body = stripAnsi(lines[1] ?? "");
    expect(body).not.toContain("🤖");
    expect(body).toMatch(/^ {4}hi {4}there$/);
  });

  test("plain text bodies are untouched", () => {
    const lines = renderMessageLines(msg("just normal text"), opts);
    const body = stripAnsi(lines[1] ?? "");
    expect(body).toBe("    just normal text");
  });

  test("tool bodies also strip emoji so the disclosure icon ▸ stays aligned", () => {
    // Multi-line tool body uses the "▸ first-line  (N lines)" collapsed form.
    // The ✅ inside the first line should be gone, replaced by 2 spaces, so
    // "first ✅ line" becomes "first    line" (the original surrounding
    // spaces plus the 2-space stand-in).
    const lines = renderMessageLines(tool("first ✅ line\nsecond line"), opts);
    const body = stripAnsi(lines[1] ?? "");
    expect(body).not.toContain("✅");
    expect(body).toContain("▸ first    line");
    expect(body).toContain("(2 lines)");
  });

  test("the bug-report message renders all body lines without emoji glyphs", () => {
    const dense =
      "都清干净了 ✅\n\n" +
      "- CLAUDE.md：迁移历史那一段删掉了\n" +
      "- `docs/plans/...` 三处全部改成新路径";
    const lines = renderMessageLines(msg(dense), { ...opts, emoji: true });
    for (const ln of lines) {
      expect(stripAnsi(ln)).not.toMatch(/✅/);
    }
  });
});

describe("cursor-overlay width safety (CJK ambiguous-width terminals)", () => {
  // Regression: the cursor stripe `▏` (U+258F) is East-Asian-Width Ambiguous.
  // CJK-configured terminals render it as 2 cells, so the cursor body prefix
  // "  ▏ " visually occupies 5 cells instead of the 4 that string-width
  // reports. Body lines must wrap with at least 1 cell of slack so the
  // overlay never overflows the pane and triggers a terminal auto-wrap.
  const denseCJK =
    "都清干净了 ✅\n\n" +
    "- CLAUDE.md：迁移历史那一段删掉了，现在只保留一句 `Lives at ~/.openctx/settings.json.`\n" +
    "- `docs/plans/...` 三处、`docs/specs/...` 一处全部改成新路径\n" +
    "- `grep` 验证：仓库里所有出现的 settings 路径都是 `~/.openctx/settings.json`，旧路径完全消失";

  for (const width of [44, 56, 60, 72, 100]) {
    test(`every cursor-overlaid body line fits in width=${width}`, () => {
      const lines = renderMessageLines(msg(denseCJK), {
        width, current: false, expanded: false, emoji: false, now: new Date(0),
      });
      // Skip the header (idx 0) and the trailing margin row (last); the
      // remaining lines are body lines that get the "body" overlay applied.
      for (let i = 1; i < lines.length - 1; i++) {
        const overlaid = applyCursorOverlay(lines[i]!, "body");
        const visualWidth = stringWidth(stripAnsi(overlaid));
        // The overlay prefix is "  ▏ " (4 cells per string-width, possibly 5
        // in CJK-ambiguous terminals). Allow up to width - 1 here so the
        // worst-case 5-cell prefix still fits in `width` cells of pane.
        expect(visualWidth).toBeLessThanOrEqual(width - 1);
      }
    });
  }
});
