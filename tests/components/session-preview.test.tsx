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

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

describe("SessionPreview", () => {
  test("starts scrolled to the bottom (most recent visible)", async () => {
    const { lastFrame } = render(
      <SessionPreview messages={MESSAGES} sessionId="a" focused={false} height={6} width={40} emoji={false} />
    );
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("the most recent user");
  });

  test("renders an empty placeholder when there are no messages", () => {
    const { lastFrame } = render(
      <SessionPreview messages={[]} sessionId={null} focused={false} height={6} width={40} emoji={false} />
    );
    expect(lastFrame() ?? "").toContain("(no messages)");
  });

  test("Ctrl+F sets matchIndex to the first match at or after current cursor", async () => {
    const messages = [
      { role: "assistant", content: "no match", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "useState here", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "another useState", timestamp: new Date(0), raw: {} },
    ] as const as Message[];

    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={20} width={60} emoji={false} />
    );
    await tick();
    // pinned to bottom = cursor on msg[2]; open search and type
    stdin.write("\x06"); // Ctrl+F
    await tick();
    stdin.write("useState");
    await tick();
    // counter should be "2 / 2" because cursor is on msg[2] and the second match is in msg[2]
    expect(lastFrame() ?? "").toContain("2 / 2");
  });
});
