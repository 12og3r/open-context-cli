import { DEFAULT_LANG, t, type Lang } from "./i18n.ts";

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

/** "HH:MM" in the viewer's local timezone — used as a precise companion to the
 * relative-time string so users can see exactly when a message landed without
 * computing it themselves. */
export function localTimeOfDay(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function relativeTime(
  when: Date,
  now: Date = new Date(),
  lang: Lang = DEFAULT_LANG,
): string {
  const rawDelta = now.getTime() - when.getTime();
  // Small forward clock skew (when slightly in the future): treat as "just now".
  // Large future timestamps (e.g. corrupt logs): fall through to ISO date so
  // we don't lie about the present.
  if (rawDelta < 0) {
    if (-rawDelta < MIN) return t(lang, "rt.just_now");
    return isoDate(when);
  }
  const delta = rawDelta;
  if (delta < MIN) return t(lang, "rt.just_now");
  if (delta < HOUR) return t(lang, "rt.minutes_ago", { n: Math.floor(delta / MIN) });
  const dayDiff = utcDayIndex(now) - utcDayIndex(when);
  if (dayDiff === 0) return t(lang, "rt.hours_ago", { n: Math.floor(delta / HOUR) });
  if (dayDiff === 1) return t(lang, "rt.yesterday");
  if (dayDiff < 7) return t(lang, "rt.days_ago", { n: dayDiff });
  return isoDate(when);
}
