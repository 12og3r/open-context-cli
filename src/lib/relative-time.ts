const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function utcDayIndex(d: Date): number {
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY,
  );
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function relativeTime(when: Date, now: Date = new Date()): string {
  const rawDelta = now.getTime() - when.getTime();
  // Small forward clock skew (when slightly in the future): treat as "just now".
  // Large future timestamps (e.g. corrupt logs): fall through to ISO date so
  // we don't lie about the present.
  if (rawDelta < 0) {
    if (-rawDelta < MIN) return "just now";
    return isoDate(when);
  }
  const delta = rawDelta;
  if (delta < MIN) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m ago`;
  const dayDiff = utcDayIndex(now) - utcDayIndex(when);
  if (dayDiff === 0) return `${Math.floor(delta / HOUR)}h ago`;
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff}d ago`;
  return isoDate(when);
}
