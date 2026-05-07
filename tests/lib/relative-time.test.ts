import { describe, expect, test } from "bun:test";
import { relativeTime } from "../../src/lib/relative-time.ts";

const NOW = new Date("2026-05-07T12:00:00Z");

describe("relativeTime", () => {
  test("under one minute → 'just now'", () => {
    expect(relativeTime(new Date("2026-05-07T11:59:30Z"), NOW)).toBe("just now");
  });

  test("under one hour → 'Nm ago'", () => {
    expect(relativeTime(new Date("2026-05-07T11:45:00Z"), NOW)).toBe("15m ago");
  });

  test("under one day → 'Nh ago'", () => {
    expect(relativeTime(new Date("2026-05-07T10:00:00Z"), NOW)).toBe("2h ago");
  });

  test("yesterday boundary → 'Yesterday'", () => {
    expect(relativeTime(new Date("2026-05-06T23:00:00Z"), NOW)).toBe("Yesterday");
  });

  test("under a week → 'Nd ago'", () => {
    expect(relativeTime(new Date("2026-05-04T12:00:00Z"), NOW)).toBe("3d ago");
  });

  test("older → ISO date", () => {
    expect(relativeTime(new Date("2026-04-12T10:00:00Z"), NOW)).toBe("2026-04-12");
  });
});
