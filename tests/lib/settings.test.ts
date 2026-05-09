import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../../src/lib/settings.ts";

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
