import { describe, expect, test } from "bun:test";
import { localTimeOfDay, relativeTime } from "../../src/lib/relative-time.ts";

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

  test("small forward clock skew → 'just now'", () => {
    expect(relativeTime(new Date("2026-05-07T12:00:30Z"), NOW)).toBe("just now");
  });

  test("large future date → ISO date", () => {
    expect(relativeTime(new Date("2030-01-01T00:00:00Z"), NOW)).toBe("2030-01-01");
  });
});

describe("relativeTime · zh", () => {
  test("under a minute → 刚刚", () => {
    expect(relativeTime(new Date("2026-05-07T11:59:30Z"), NOW, "zh")).toBe("刚刚");
  });

  test("minutes ago", () => {
    expect(relativeTime(new Date("2026-05-07T11:45:00Z"), NOW, "zh")).toBe("15 分钟前");
  });

  test("hours ago", () => {
    expect(relativeTime(new Date("2026-05-07T10:00:00Z"), NOW, "zh")).toBe("2 小时前");
  });

  test("yesterday", () => {
    expect(relativeTime(new Date("2026-05-06T23:00:00Z"), NOW, "zh")).toBe("昨天");
  });

  test("days ago", () => {
    expect(relativeTime(new Date("2026-05-04T12:00:00Z"), NOW, "zh")).toBe("3 天前");
  });
});

describe("localTimeOfDay", () => {
  test("formats hours and minutes with zero-padding in the local timezone", () => {
    // Build the date from local components so the test is timezone-independent:
    // whatever zone the runner sits in, 09:05 local should round-trip exactly.
    const d = new Date(2026, 4, 7, 9, 5, 0, 0);
    expect(localTimeOfDay(d)).toBe("09:05");
  });

  test("pads the 24h end of the day", () => {
    const d = new Date(2026, 4, 7, 23, 59, 0, 0);
    expect(localTimeOfDay(d)).toBe("23:59");
  });
});
