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

  test("↓ advances matchIndex; wraps at end", async () => {
    const messages = [
      { role: "user", content: "aa bb aa cc aa", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={10} width={40} emoji={false} />
    );
    await tick();
    stdin.write("\x06"); // Ctrl+F
    await tick();
    stdin.write("aa");
    await tick();
    expect(lastFrame() ?? "").toContain("1 / 3");
    stdin.write("\x1b[B"); // ↓
    await tick();
    expect(lastFrame() ?? "").toContain("2 / 3");
    stdin.write("\x1b[B"); // ↓
    await tick();
    expect(lastFrame() ?? "").toContain("3 / 3");
    stdin.write("\x1b[B"); // ↓ wraps
    await tick();
    expect(lastFrame() ?? "").toContain("1 / 3");
  });

  test("↑ goes back; wraps at start", async () => {
    const messages = [
      { role: "user", content: "aa bb aa", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={10} width={40} emoji={false} />
    );
    await tick();
    stdin.write("\x06");
    await tick();
    stdin.write("aa");
    await tick();
    stdin.write("\x1b[A"); // ↑ from initial index wraps to last
    await tick();
    expect(lastFrame() ?? "").toContain("2 / 2");
  });

  test("Enter closes search and sets cursor to current match's message", async () => {
    const messages = [
      { role: "assistant", content: "first", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "match here", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "tail", timestamp: new Date(0), raw: {} },
    ] as Message[];

    // height=8 keeps totalLines > viewportHeight so the "X / total" footer renders.
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={8} width={40} emoji={false} />
    );
    await tick();
    stdin.write("\x06");          // Ctrl+F
    await tick();
    stdin.write("match");
    await tick();
    stdin.write("\r");            // Enter
    await tick();
    // Search bar is gone; counter not shown
    expect(lastFrame() ?? "").not.toContain("1 / 1");
    // Highlight survives — yellow background still in frame
    expect(lastFrame() ?? "").toContain("\x1b[43m");
    // Footer's "X / total" shows cursor on msg index 1 (1-based "2 / 3")
    expect(lastFrame() ?? "").toContain("2 / 3");
  });

  test("Esc behaves the same as Enter", async () => {
    const messages = [
      { role: "assistant", content: "first", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "needle", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "tail", timestamp: new Date(0), raw: {} },
    ] as Message[];
    // height=8 keeps totalLines > viewportHeight so the "X / total" footer renders.
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={8} width={40} emoji={false} />
    );
    await tick();
    stdin.write("\x06");
    await tick();
    stdin.write("needle");
    await tick();
    stdin.write("\x1b");          // Esc
    await tick();
    expect(lastFrame() ?? "").toContain("\x1b[43m");
    expect(lastFrame() ?? "").toContain("2 / 3");
  });

  test("after Enter, pressing j clears highlights and moves cursor", async () => {
    const messages = [
      { role: "assistant", content: "alpha", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "needle", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "omega", timestamp: new Date(0), raw: {} },
    ] as Message[];
    // height=8 keeps totalLines > viewportHeight so the "X / total" footer renders.
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={8} width={40} emoji={false} />
    );
    await tick();
    stdin.write("\x06");
    await tick();
    stdin.write("needle");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame() ?? "").toContain("\x1b[43m"); // yellow current match
    // Now press j (down) — afterglow clears.
    stdin.write("j");
    await tick();
    expect(lastFrame() ?? "").not.toContain("\x1b[43m");
    expect(lastFrame() ?? "").not.toContain("\x1b[7m"); // no INVERSE either
  });

  test("/ opens the search bar", async () => {
    const messages = [
      { role: "user", content: "hello world", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={10} width={40} emoji={false} />
    );
    await tick();
    stdin.write("/");
    await tick();
    expect(lastFrame() ?? "").toContain("🔎");
  });

  test("Ctrl+F in afterglow clears the previous query and reopens with empty input", async () => {
    const messages = [
      { role: "user", content: "aaa bbb", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={10} width={40} emoji={false} />
    );
    await tick();
    stdin.write("\x06");
    await tick();
    stdin.write("aaa");
    await tick();
    stdin.write("\r"); // commit -> afterglow
    await tick();
    expect(lastFrame() ?? "").toContain("\x1b[43m");
    stdin.write("\x06"); // Ctrl+F again
    await tick();
    // Search bar is open with empty query (no counter visible).
    const out = lastFrame() ?? "";
    expect(out).toContain("🔎");
    expect(out).not.toMatch(/\d+ \/ \d+/);
  });

  test("typing more chars within a single message keeps the user at the same offset", async () => {
    const messages = [
      { role: "user", content: "axx-axx-ayy", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={20} width={60} emoji={false} />
    );
    await tick();
    stdin.write("\x06");
    await tick();
    stdin.write("a");        // 3 matches at offsets 0, 4, 8
    await tick();
    expect(lastFrame() ?? "").toContain("1 / 3");
    stdin.write("\x1b[B");    // ↓ → match index 1 (offset 4)
    await tick();
    expect(lastFrame() ?? "").toContain("2 / 3");
    // Narrow: "ax" matches at offsets 0 and 4 (not 8, which is "ayy").
    // User was at offset 4, expects to stay there → counter "2 / 2".
    stdin.write("x");
    await tick();
    expect(lastFrame() ?? "").toContain("2 / 2");
  });
});
