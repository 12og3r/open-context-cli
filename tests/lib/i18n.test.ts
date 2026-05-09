import { describe, expect, test } from "bun:test";
import { t, tList } from "../../src/lib/i18n.ts";

describe("t", () => {
  test("returns English by default", () => {
    expect(t("en", "title.sessions")).toBe("SESSIONS");
  });

  test("returns Chinese for the same key", () => {
    expect(t("zh", "title.sessions")).toBe("会话");
  });

  test("falls back to English when a Chinese key is missing", () => {
    // Brand string is intentionally identical across languages — guard against
    // accidentally translating the wordmark in the future.
    expect(t("zh", "path.brand")).toBe("open-context");
  });

  test("returns the key itself for an unknown id", () => {
    expect(t("en", "this.does.not.exist")).toBe("this.does.not.exist");
  });

  test("interpolates {param} placeholders", () => {
    expect(t("en", "rt.minutes_ago", { n: 5 })).toBe("5m ago");
    expect(t("zh", "rt.minutes_ago", { n: 5 })).toBe("5 分钟前");
  });

  test("leaves unknown placeholders intact so missing params are visible", () => {
    expect(t("en", "loading.scanning")).toBe("Scanning {root}…");
  });
});

describe("tList", () => {
  test("splits pipe-joined hint strings", () => {
    const en = tList("en", "footer.list");
    expect(en[0]).toBe("↑↓ select");
    expect(en).toContain("q quit");
    const zh = tList("zh", "footer.list");
    expect(zh[0]).toBe("↑↓ 选择");
    expect(zh).toContain("q 退出");
  });
});
