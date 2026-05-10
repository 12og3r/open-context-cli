import { ALL_SOURCES } from "../providers/index.ts";
import type { SessionMeta, Source } from "../providers/types.ts";

export type SourceStatus = "ok" | "missing" | "hidden";
export type SessionStatusBySource = Record<Source, SourceStatus>;

/**
 * Compute per-source status from the merged sessions list and the
 * `enabled` map. A disabled source is always "hidden" — we don't scan
 * disabled sources, so we have nothing to count for them.
 */
export function deriveSessionStatusBySource(
  enabled: Record<Source, boolean>,
  sessions: readonly SessionMeta[],
): SessionStatusBySource {
  const out = {} as SessionStatusBySource;
  for (const s of ALL_SOURCES) {
    if (!enabled[s]) {
      out[s] = "hidden";
      continue;
    }
    const count = sessions.filter(m => m.source === s).length;
    out[s] = count > 0 ? "ok" : "missing";
  }
  return out;
}
