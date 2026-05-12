import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SessionList } from "../../src/components/session-list.tsx";
import type { SessionMeta } from "../../src/providers/types.ts";

const NOW = new Date("2026-05-07T12:00:00Z");
const SESSIONS: SessionMeta[] = [
  {
    id: "a", filePath: "/a.jsonl", summary: "Building Ink TUI app", projectPath: "/p",
    modifiedAt: new Date("2026-05-07T10:00:00Z"), messageCount: 24,
    source: "claude-code",
  },
  {
    id: "b", filePath: "/b.jsonl", summary: "Refactor parser", projectPath: "/p",
    modifiedAt: new Date("2026-05-06T22:00:00Z"), messageCount: 18,
    source: "codex",
  },
];

describe("SessionList", () => {
  test("renders summary, relative time, and message count", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="a" width={60} now={NOW} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Building Ink TUI app");
    expect(out).toContain("2h ago");
    expect(out).toContain("24 msgs");
    expect(out).toContain("Refactor parser");
    expect(out).toContain("18 msgs");
  });

  test("subtitle leads with the bracketed source label", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="a" width={60} now={NOW} />
    );
    const out = lastFrame() ?? "";
    // Full names with brackets, matching the preview-pane chip. A single
    // space (no dot) follows the source chip; the rest of the metadata
    // pieces are still joined by single-space dots.
    expect(out).toMatch(/\[Claude\]\s+2h ago\s+·\s+24 msgs/);
    expect(out).toMatch(/\[Codex\]\s+Yesterday\s+·\s+18 msgs/);
  });

  test("selected rows lead with the ▌ bar in the source color; unselected rows leave that cell blank", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="b" width={60} now={NOW} />
    );
    const out = lastFrame() ?? "";
    // The selected codex row carries the ▌ bar before its title; the
    // source identification still happens on the subtitle (CDX).
    expect(out).toMatch(/▌\s+Refactor parser/);
  });

  test("separates adjacent items with a blank gap row", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="a" width={36} now={NOW} />
    );
    const lines = (lastFrame() ?? "").split("\n");
    // Find the line with the second item's metadata; the line before it should
    // be the blank gap. Item layout: summary / metadata / blank / summary / metadata.
    const idx = lines.findIndex(l => l.includes("Refactor parser"));
    expect(idx).toBeGreaterThan(0);
    expect(lines[idx - 1]?.trim()).toBe("");
  });

  test("marks the selected item with the cyan ▌ bar", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="b" width={36} now={NOW} />
    );
    const lines = (lastFrame() ?? "").split("\n");
    expect(lines.some(l => l.includes("▌") && l.includes("Refactor parser"))).toBe(true);
  });

  test("scrolls only when the selection crosses an edge of the visible window", () => {
    // capacity = floor((height + ROWS_PER_GAP) / ROWS_PER_BLOCK)
    //         = floor((14 + 1) / 3) = 5
    const many: SessionMeta[] = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      filePath: `/${i}.jsonl`,
      summary: `Session ${i}`,
      projectPath: "/p",
      modifiedAt: new Date("2026-05-07T10:00:00Z"),
      messageCount: 1,
      source: "claude-code" as const,
    }));

    const { lastFrame, rerender } = render(
      <SessionList sessions={many} selectedId="s0" width={60} height={14} now={NOW} />
    );
    // Initial window: items 0..4 visible, items 5..9 not.
    let out = lastFrame() ?? "";
    expect(out).toContain("Session 0");
    expect(out).toContain("Session 4");
    expect(out).not.toContain("Session 5");

    // Selecting the last visible row should NOT shift the window.
    rerender(<SessionList sessions={many} selectedId="s4" width={60} height={14} now={NOW} />);
    out = lastFrame() ?? "";
    expect(out).toContain("Session 0");
    expect(out).toContain("Session 4");
    expect(out).not.toContain("Session 5");

    // Crossing past the bottom edge shifts the window down by one only.
    rerender(<SessionList sessions={many} selectedId="s5" width={60} height={14} now={NOW} />);
    out = lastFrame() ?? "";
    expect(out).not.toContain("Session 0");
    expect(out).toContain("Session 1");
    expect(out).toContain("Session 5");
    expect(out).not.toContain("Session 6");

    // Moving back within the window does not shift it.
    rerender(<SessionList sessions={many} selectedId="s2" width={60} height={14} now={NOW} />);
    out = lastFrame() ?? "";
    expect(out).not.toContain("Session 0");
    expect(out).toContain("Session 1");
    expect(out).toContain("Session 5");

    // Crossing past the top edge shifts the window up.
    rerender(<SessionList sessions={many} selectedId="s0" width={60} height={14} now={NOW} />);
    out = lastFrame() ?? "";
    expect(out).toContain("Session 0");
    expect(out).toContain("Session 4");
    expect(out).not.toContain("Session 5");
  });
});
