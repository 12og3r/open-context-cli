// src/hooks/use-sessions.ts
import { useEffect, useState } from "react";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";

type State =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionMeta[] }
  | { status: "error"; error: Error };

const metaCache = new Map<string, { mtimeMs: number; meta: SessionMeta }>();

export function useSessions(provider: SessionProvider, root: string): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    provider.listSessions(root).then(
      (raw) => {
        if (cancelled) return;
        const sessions = raw.map(m => {
          const cached = metaCache.get(m.filePath);
          if (cached && cached.mtimeMs === m.modifiedAt.getTime()) return cached.meta;
          metaCache.set(m.filePath, { mtimeMs: m.modifiedAt.getTime(), meta: m });
          return m;
        });
        // Bound cache.
        if (metaCache.size > 200) {
          const remove = metaCache.size - 200;
          let i = 0;
          for (const k of metaCache.keys()) {
            if (i++ >= remove) break;
            metaCache.delete(k);
          }
        }
        setState({ status: "ready", sessions });
      },
      (error: Error) => {
        if (cancelled) return;
        setState({ status: "error", error });
      },
    );
    return () => { cancelled = true; };
  }, [provider, root]);

  return state;
}
