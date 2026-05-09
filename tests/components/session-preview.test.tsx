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

  test("showHash appends session and message hash to the count line", async () => {
    const messages: Message[] = [
      { role: "user", content: "hello", timestamp: new Date(0), uuid: "abcdef0123-rest", raw: {} },
    ];
    const { lastFrame } = render(
      <SessionPreview
        messages={messages}
        sessionId="0123456789abcdef-rest"
        focused={false}
        height={4}
        width={60}
        emoji={false}
        showHash={true}
      />
    );
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("session 0123456");  // session prefix + first 7 of sessionId
    expect(out).toContain("msg abcdef0");       // first 7 of message uuid
  });

  test("showHash off keeps the footer free of hash markers", async () => {
    const messages: Message[] = [
      { role: "user", content: "hello", timestamp: new Date(0), uuid: "abcdef0123", raw: {} },
    ];
    const { lastFrame } = render(
      <SessionPreview
        messages={messages}
        sessionId="0123456789"
        focused={false}
        height={4}
        width={60}
        emoji={false}
        showHash={false}
      />
    );
    await tick();
    const out = lastFrame() ?? "";
    expect(out).not.toContain("0123456");
    expect(out).not.toContain("msg ");
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
    // Editable search bar is gone, but the afterglow indicator stays visible
    // so the user can still see which match is current.
    expect(lastFrame() ?? "").toContain("1 / 1");
    // Highlight survives — current-match white background still in frame
    expect(lastFrame() ?? "").toContain("\x1b[31m");
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
    expect(lastFrame() ?? "").toContain("\x1b[31m");
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
    expect(lastFrame() ?? "").toContain("\x1b[31m"); // current match red fg
    // Now press j (down) — afterglow clears.
    stdin.write("j");
    await tick();
    expect(lastFrame() ?? "").not.toContain("\x1b[31m");
    expect(lastFrame() ?? "").not.toContain("\x1b[4m"); // no underline either
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
    expect(lastFrame() ?? "").toContain("SEARCH");
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
    expect(lastFrame() ?? "").toContain("\x1b[31m");
    stdin.write("\x06"); // Ctrl+F again
    await tick();
    // Search bar is open with empty query (no counter visible).
    const out = lastFrame() ?? "";
    expect(out).toContain("SEARCH");
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

  test("full search flow: open / type / navigate / commit / clear", async () => {
    const messages = [
      { role: "user", content: "alpha", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "needle one", timestamp: new Date(0), raw: {} },
      { role: "user", content: "filler", timestamp: new Date(0), raw: {} },
      { role: "assistant", content: "needle two", timestamp: new Date(0), raw: {} },
      { role: "user", content: "tail", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="smoke" focused={true}
                      height={30} width={60} emoji={false} />
    );
    await tick();

    // Open via /
    stdin.write("/");
    await tick();
    expect(lastFrame() ?? "").toContain("SEARCH");

    // Type query
    stdin.write("needle");
    await tick();
    expect(lastFrame() ?? "").toMatch(/[12] \/ 2/);

    // Navigate
    stdin.write("\x1b[B"); // ↓
    await tick();
    stdin.write("\x1b[A"); // ↑
    await tick();

    // Commit — afterglow indicator stays so the user can see the position.
    stdin.write("\r");
    await tick();
    expect(lastFrame() ?? "").toContain("SEARCH");
    expect(lastFrame() ?? "").toContain("\x1b[31m"); // current still red fg

    // Move on with j → afterglow clears (indicator and highlights both gone)
    stdin.write("j");
    await tick();
    expect(lastFrame() ?? "").not.toContain("SEARCH");
    expect(lastFrame() ?? "").not.toContain("\x1b[31m");
    expect(lastFrame() ?? "").not.toContain("\x1b[4m");
  });

  test("Enter doesn't crash when narrowing the query leaves matchIndex stale", async () => {
    // After typing "a" the user navigates to the last (5th) match. Typing "3"
    // narrows the query to "a3" which has only 1 match — but the init effect's
    // lastInitKey guard short-circuits the re-anchor, so matchIndex is left
    // pointing past matches.length. Pressing Enter used to read matches[4]
    // (undefined) and throw on .msgIndex.
    const messages = [
      { role: "user", content: "a1 a2 a3 a4 a5", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="x" focused={true}
                      height={20} width={60} emoji={false} />
    );
    await tick();
    stdin.write("\x06"); // Ctrl+F
    await tick();
    stdin.write("a");
    await tick();
    expect(lastFrame() ?? "").toContain("1 / 5");
    // Walk to the last match.
    for (let i = 0; i < 4; i++) {
      stdin.write("\x1b[B"); // ↓
      await tick();
    }
    expect(lastFrame() ?? "").toContain("5 / 5");
    // Narrow to "a3" — only one match remains.
    stdin.write("3");
    await tick();
    // Now the bug: matchIndex still = 4 in spite of matches.length === 1.
    stdin.write("\r"); // Enter — must not crash
    await tick();
    // After commit the search bar is gone but a current-match highlight remains.
    expect(lastFrame() ?? "").toContain("\x1b[31m");
  });

  test("zero matches show 'no matches' in red", async () => {
    const messages = [
      { role: "user", content: "nothing here", timestamp: new Date(0), raw: {} },
    ] as Message[];
    const { stdin, lastFrame } = render(
      <SessionPreview messages={messages} sessionId="zero" focused={true}
                      height={10} width={40} emoji={false} />
    );
    await tick();
    stdin.write("/");
    await tick();
    stdin.write("zzz");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("no matches");
  });
});
