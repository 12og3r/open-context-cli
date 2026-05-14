import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SettingsPanel } from "../../src/components/settings-panel.tsx";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.ts";

const PROPS = {
  onChange: () => {},
  focused: false,
  width: 80,
  height: 30,
  defaultClaudeDir: "/home/u/.claude/projects",
  defaultCodexDir: "/home/u/.codex/sessions",
  defaultGeminiDir: "/home/u/.gemini/tmp",
};

describe("SettingsPanel source rows", () => {
  test("Claude row shows green badge when status is ok", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "missing", "gemini": "missing" }}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");
    // The status badge sits on the row directly above the Default path
    // for each source. A cross-wired lookup would land the wrong badge
    // on top of the wrong default path; checking the relative position
    // catches that.
    const claudeDefaultIdx = lines.findIndex(l =>
      l.includes("Default: /home/u/.claude/projects"),
    );
    expect(claudeDefaultIdx).toBeGreaterThanOrEqual(1);
    expect(lines[claudeDefaultIdx - 1]!).toContain("Sessions found");
  });

  test("Gemini row shows status badge above the default-path line", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok", "gemini": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");
    const geminiDefaultIdx = lines.findIndex(l =>
      l.includes("Default: /home/u/.gemini/tmp"),
    );
    expect(geminiDefaultIdx).toBeGreaterThanOrEqual(1);
    // Title row carries the badge; finding the row a few above the
    // default-path line keeps the check robust against the toggle row
    // landing between the title and the path input.
    const titleIdx = lines.findIndex(l => l.includes("Gemini path"));
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeLessThan(geminiDefaultIdx);
    expect(lines[titleIdx]!).toContain("Sessions found");
    expect(lines[titleIdx]!).toContain("On");
    expect(lines[titleIdx]!).toContain("Off");
  });

  test("Codex row shows red badge when status is missing", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "missing", "gemini": "missing" }}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");
    const codexDefaultIdx = lines.findIndex(l =>
      l.includes("Default: /home/u/.codex/sessions"),
    );
    expect(codexDefaultIdx).toBeGreaterThanOrEqual(1);
    expect(lines[codexDefaultIdx - 1]!).toContain("No valid session found");
  });

  test("source row shows Hidden badge when toggle is off", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={{ ...DEFAULT_SETTINGS, showCodex: false }}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "hidden", "gemini": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Hidden");
  });

  test("toggle renders inline on the source title line", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok", "gemini": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");
    const claudeTitleLine = lines.find(l => l.includes("Claude Code path"));
    expect(claudeTitleLine).toBeDefined();
    expect(claudeTitleLine!).toContain("On");
    expect(claudeTitleLine!).toContain("Off");
    const codexTitleLine = lines.find(l => l.includes("Codex path"));
    expect(codexTitleLine).toBeDefined();
    expect(codexTitleLine!).toContain("On");
    expect(codexTitleLine!).toContain("Off");
  });

  test("standalone show-source rows are gone", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok", "gemini": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).not.toContain("Show Claude Code sessions");
    expect(out).not.toContain("Show Codex sessions");
  });

  test("typing into the focused Claude path input updates the rendered value", async () => {
    // Regression: at typical pane dimensions the input row used to get
    // squashed by Ink's flex-shrink, leaving the user unable to focus or
    // type into the path field. flexShrink={0} on the source-row's
    // critical sub-boxes pins them so they survive layout overflow.
    const tick = () => new Promise(r => setTimeout(r, 30));
    const { stdin, lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        width={64}
        height={28}
        focused
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "missing", "codex": "missing", "gemini": "missing" }}
      />,
    );
    await tick();
    stdin.write("abc");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("abc");
    // Caret + typed value must both be on a row that survives layout.
    const inputLine = out.split("\n").find(l => l.includes("abc"));
    expect(inputLine).toBeDefined();
    expect(inputLine!).toContain("│");
  });

  test("after the Tab cycle returns to input, typing still works", async () => {
    // Tab cycle is input → restore → toggle → input. Press Tab three times
    // to land back on input, then type. The keystrokes must reach the
    // TextInput, not get eaten by the parent useInput as toggle/restore.
    const tick = () => new Promise(r => setTimeout(r, 30));
    const { stdin, lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        focused
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "missing", "codex": "missing", "gemini": "missing" }}
      />,
    );
    await tick();
    stdin.write("\t"); // input → restore
    await tick();
    stdin.write("\t"); // restore → toggle
    await tick();
    stdin.write("\t"); // toggle → input
    await tick();
    stdin.write("xyz");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("xyz");
  });

  test("navigating down then back to Claude row, typing works", async () => {
    // Down-arrow to Codex row, then up-arrow back to Claude. Sub-cursor
    // should reset to "input" on field change. Typing should work.
    const tick = () => new Promise(r => setTimeout(r, 30));
    const { stdin, lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        focused
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "missing", "codex": "missing", "gemini": "missing" }}
      />,
    );
    await tick();
    stdin.write("\x1b[B"); // down arrow
    await tick();
    stdin.write("\x1b[A"); // up arrow
    await tick();
    stdin.write("hello");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("hello");
  });
});
