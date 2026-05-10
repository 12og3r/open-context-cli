import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  enabledSourcesFromSettings,
  type Settings,
} from "../../src/lib/settings.ts";

describe("settings continueLaunchMode", () => {
  test("defaults to reuse-current", () => {
    expect(DEFAULT_SETTINGS.continueLaunchMode).toBe("reuse-current");
  });

  test("Settings type accepts both values", () => {
    const a: Settings = { ...DEFAULT_SETTINGS, continueLaunchMode: "reuse-current" };
    const b: Settings = { ...DEFAULT_SETTINGS, continueLaunchMode: "new-window" };
    expect(a.continueLaunchMode).toBe("reuse-current");
    expect(b.continueLaunchMode).toBe("new-window");
  });
});

describe("settings codex/source fields", () => {
  test("codex defaults: dir empty, both sources visible", () => {
    expect(DEFAULT_SETTINGS.codexSessionsDir).toBe("");
    expect(DEFAULT_SETTINGS.showClaudeCode).toBe(true);
    expect(DEFAULT_SETTINGS.showCodex).toBe(true);
  });

  test("enabledSourcesFromSettings reflects show* booleans", () => {
    const all = enabledSourcesFromSettings(DEFAULT_SETTINGS);
    expect(all).toEqual({ "claude-code": true, "codex": true });

    const onlyCodex = enabledSourcesFromSettings({
      ...DEFAULT_SETTINGS,
      showClaudeCode: false,
    });
    expect(onlyCodex).toEqual({ "claude-code": false, "codex": true });
  });
});
