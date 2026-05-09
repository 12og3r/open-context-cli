// tests/components/minimal-input.test.tsx
import { describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { MinimalInput } from "../../src/components/minimal-input.tsx";

const tick = () => new Promise(r => setTimeout(r, 30));

function Harness({ onSubmit, onCancel, onPrev, onNext }: {
  onSubmit?: () => void; onCancel?: () => void;
  onPrev?: () => void; onNext?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <MinimalInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit ?? (() => {})}
      onCancel={onCancel ?? (() => {})}
      onPrev={onPrev ?? (() => {})}
      onNext={onNext ?? (() => {})}
    />
  );
}

describe("MinimalInput", () => {
  test("appends typed characters and renders them", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    await tick(); // let useInput's useEffect register the handler
    stdin.write("abc");
    await tick();
    expect(lastFrame() ?? "").toContain("abc");
  });

  test("Backspace removes the last character", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    await tick(); // let useInput's useEffect register the handler
    stdin.write("abc");
    await tick();
    stdin.write("\x7f"); // DEL is what most terminals send for backspace
    await tick();
    expect(lastFrame() ?? "").toContain("ab");
    expect(lastFrame() ?? "").not.toMatch(/abc/);
  });

  test("Enter calls onSubmit", async () => {
    let submitted = false;
    const { stdin } = render(<Harness onSubmit={() => { submitted = true; }} />);
    await tick(); // let useInput's useEffect register the handler
    stdin.write("\r");
    await tick();
    expect(submitted).toBe(true);
  });

  test("Esc calls onCancel", async () => {
    let cancelled = false;
    const { stdin } = render(<Harness onCancel={() => { cancelled = true; }} />);
    await tick(); // let useInput's useEffect register the handler
    stdin.write("\x1b");
    await tick();
    expect(cancelled).toBe(true);
  });

  test("up arrow and left arrow both call onPrev", async () => {
    let prev = 0;
    const { stdin } = render(<Harness onPrev={() => { prev++; }} />);
    await tick(); // let useInput's useEffect register the handler
    stdin.write("\x1b[A"); // up
    await tick();
    stdin.write("\x1b[D"); // left
    await tick();
    expect(prev).toBe(2);
  });

  test("down arrow and right arrow both call onNext", async () => {
    let nxt = 0;
    const { stdin } = render(<Harness onNext={() => { nxt++; }} />);
    await tick(); // let useInput's useEffect register the handler
    stdin.write("\x1b[B"); // down
    await tick();
    stdin.write("\x1b[C"); // right
    await tick();
    expect(nxt).toBe(2);
  });

  test("CJK characters render alongside the cursor", async () => {
    // Regression: nesting <Text inverse> inside the value <Text> blanks the
    // whole element when the value contains CJK. The cursor now lives in a
    // sibling <Text> inside a <Box>, so the value stays visible.
    const { stdin, lastFrame } = render(<Harness />);
    await tick();
    stdin.write("你好");
    await tick();
    expect(lastFrame() ?? "").toContain("你好");
    stdin.write("世界");
    await tick();
    expect(lastFrame() ?? "").toContain("你好世界");
  });

  test("Backspace removes one CJK code point at a time", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    await tick();
    stdin.write("你好");
    await tick();
    stdin.write("\x7f");
    await tick();
    expect(lastFrame() ?? "").toContain("你");
    expect(lastFrame() ?? "").not.toMatch(/你好/);
  });
});
