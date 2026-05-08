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
  },
  {
    id: "b", filePath: "/b.jsonl", summary: "Refactor parser", projectPath: "/p",
    modifiedAt: new Date("2026-05-06T22:00:00Z"), messageCount: 18,
  },
];

describe("SessionList", () => {
  test("renders summary, relative time, and message count", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="a" width={36} now={NOW} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Building Ink TUI app");
    expect(out).toContain("2h ago");
    expect(out).toContain("24 msgs");
    expect(out).toContain("Refactor parser");
    expect(out).toContain("18 msgs");
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
});
