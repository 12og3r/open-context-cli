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
};

describe("SettingsPanel source rows", () => {
  test("Claude row shows green badge when status is ok", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "missing" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Claude Code sessions");
    expect(out).toContain("Sessions found");
    expect(out).toContain("Default: /home/u/.claude/projects");
  });

  test("Codex row shows red badge when status is missing", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "missing" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Codex sessions");
    expect(out).toContain("No valid session found");
  });

  test("source row shows Hidden badge when toggle is off", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={{ ...DEFAULT_SETTINGS, showCodex: false }}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "hidden" }}
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
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");
    const claudeTitleLine = lines.find(l => l.includes("Claude Code sessions"));
    expect(claudeTitleLine).toBeDefined();
    expect(claudeTitleLine!).toContain("On");
    expect(claudeTitleLine!).toContain("Off");
    const codexTitleLine = lines.find(l => l.includes("Codex sessions"));
    expect(codexTitleLine).toBeDefined();
    expect(codexTitleLine!).toContain("On");
    expect(codexTitleLine!).toContain("Off");
  });

  test("standalone show-source rows are gone", () => {
    const { lastFrame } = render(
      <SettingsPanel
        {...PROPS}
        settings={DEFAULT_SETTINGS}
        sessionStatusBySource={{ "claude-code": "ok", "codex": "ok" }}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).not.toContain("Show Claude Code sessions");
    expect(out).not.toContain("Show Codex sessions");
  });
});
