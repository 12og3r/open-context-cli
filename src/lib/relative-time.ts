const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function utcDayIndex(d: Date): number {
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY,
  );
}

export function relativeTime(when: Date, now: Date = new Date()): string {
  const delta = now.getTime() - when.getTime();
  if (delta < MIN) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m ago`;
  const dayDiff = utcDayIndex(now) - utcDayIndex(when);
  if (dayDiff === 0) return `${Math.floor(delta / HOUR)}h ago`;
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff}d ago`;
  // older: ISO YYYY-MM-DD
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  const d = String(when.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
