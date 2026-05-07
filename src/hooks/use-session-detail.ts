// src/hooks/use-session-detail.ts
import { useEffect, useState } from "react";
import type { Message, SessionMeta, SessionProvider } from "../providers/types.ts";

type State =
  | { status: "loading"; partial: Message[] }
  | { status: "ready"; messages: Message[] }
  | { status: "error"; error: Error };

const detailCache = new Map<string, { mtimeMs: number; messages: Message[] }>();
const MAX_CACHED = 50;

export function useSessionDetail(provider: SessionProvider, meta: SessionMeta | null): State {
  const [state, setState] = useState<State>({ status: "loading", partial: [] });

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;

    const cached = detailCache.get(meta.filePath);
    if (cached && cached.mtimeMs === meta.modifiedAt.getTime()) {
      setState({ status: "ready", messages: cached.messages });
      return () => { cancelled = true; };
    }

    setState({ status: "loading", partial: [] });
    const acc: Message[] = [];
    (async () => {
      try {
        for await (const m of provider.loadSession(meta.filePath)) {
          if (cancelled) return;
          acc.push(m);
          // Update partial state every 16 messages so the UI shows progress.
          if (acc.length % 16 === 0) {
            setState({ status: "loading", partial: [...acc] });
          }
        }
        if (cancelled) return;
        // LRU evict.
        if (detailCache.size >= MAX_CACHED) {
          const oldestKey = detailCache.keys().next().value as string | undefined;
          if (oldestKey) detailCache.delete(oldestKey);
        }
        detailCache.set(meta.filePath, { mtimeMs: meta.modifiedAt.getTime(), messages: acc });
        setState({ status: "ready", messages: acc });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", error: error as Error });
      }
    })();

    return () => { cancelled = true; };
  }, [provider, meta]);

  return state;
}
