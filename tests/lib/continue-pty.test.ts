import { describe, expect, test } from "bun:test";
import { ptyTuningFor } from "../../src/lib/continue-pty.ts";

describe("ptyTuningFor", () => {
  test("gemini gets the OSC-title Ready signal and a tighter deadline", async () => {
    const tuning = ptyTuningFor("gemini");
    expect(tuning.readinessPattern).toBeDefined();
    expect(tuning.hardDeadlineMs).toBe(2500);
  });

  test("gemini's pattern matches the real OSC title gemini emits", async () => {
    // Captured from a live PTY probe of `gemini -r <id>`: chunk #2 carries
    // an OSC title indicating the Ink UI is ready and the input box is
    // about to paint. This is the moment we want to start the idle timer.
    const { readinessPattern } = ptyTuningFor("gemini");
    expect(readinessPattern).toBeDefined();
    const realChunk = "\x1b]0;◇  Ready (openctx)                                \x07";
    expect(readinessPattern!.test(realChunk)).toBe(true);
  });

  test("gemini's pattern doesn't match unrelated terminal capability probes", async () => {
    // The first chunk of gemini's output is a flurry of capability queries
    // — DEC version, primary device attrs, foreground color, cursor pos.
    // Matching any of these would inject during negotiation, before the
    // input box exists.
    const { readinessPattern } = ptyTuningFor("gemini");
    const capProbe = "\x1b[8m\x1b[?u\x1b]11;?\x1b\\\x1b[>q\x1b[>4;?m\x1b[c\x1b[2K";
    expect(readinessPattern!.test(capProbe)).toBe(false);
  });

  test("gemini's pattern doesn't match a generic title without the Ready keyword", async () => {
    // Titles for other states ("Working", "Thinking", whatever else gemini
    // sets later in the session) shouldn't fire the readiness signal again
    // — though in practice only the FIRST match is acted on.
    const { readinessPattern } = ptyTuningFor("gemini");
    expect(readinessPattern!.test("\x1b]0;Working on it\x07")).toBe(false);
  });

  test("codex gets a fixed hard deadline only (no readiness signal)", async () => {
    // Codex's TUI renders fast (~500ms) but its input handler isn't armed
    // for bracketed paste until later. Without a reliable "input ready"
    // marker we can detect from output, we fall back to a fixed deadline.
    // The alt-screen default pattern never matches codex's stream, so the
    // inject fires deterministically at hardDeadlineMs after first chunk.
    const tuning = ptyTuningFor("codex");
    expect(tuning.readinessPattern).toBeUndefined();
    expect(tuning.hardDeadlineMs).toBe(2500);
  });

  test("claude falls back to the runPty defaults (no tuning)", async () => {
    expect(ptyTuningFor("claude")).toEqual({});
  });

  test("unknown CLIs also get default tuning, not gemini's or codex's", async () => {
    expect(ptyTuningFor("totally-made-up-cli")).toEqual({});
  });
});
