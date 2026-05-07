import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SessionPreview } from "../../src/components/session-preview.tsx";
import type { Message } from "../../src/providers/types.ts";

const MESSAGES: Message[] = [
  { role: "user", content: "first user", timestamp: new Date(0), raw: {} },
  { role: "assistant", content: "first assistant", timestamp: new Date(0), raw: {} },
  { role: "user", content: "the most recent user", timestamp: new Date(0), raw: {} },
];

describe("SessionPreview", () => {
  test("starts scrolled to the bottom (most recent visible)", () => {
    const { lastFrame } = render(
      <SessionPreview messages={MESSAGES} focused={false} height={6} width={40} emoji={false} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("the most recent user");
  });

  test("renders an empty placeholder when there are no messages", () => {
    const { lastFrame } = render(
      <SessionPreview messages={[]} focused={false} height={6} width={40} emoji={false} />
    );
    expect(lastFrame() ?? "").toContain("(no messages)");
  });
});
