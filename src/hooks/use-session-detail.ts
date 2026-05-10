import { useEffect, useState } from "react";
import type { Message, SessionMeta, SessionProvider } from "../providers/types.ts";

type State =
  | { status: "loading"; partial: Message[] }
  | { status: "ready"; messages: Message[] }
  | { status: "error"; error: Error };

const detailCache = new Map<string, { mtimeMs: number; messages: Message[] }>();
const MAX_CACHED = 50;

// Yield to the macrotask queue every N messages so terminal input handlers
// (keyboard navigation, cancellation) get a chance to run while a session
// loads. Without this, the parsing loop monopolizes the event loop.
const YIELD_EVERY = 64;

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export function useSessionDetail(provider: SessionProvider | null, meta: SessionMeta | null): State {
  const [state, setState] = useState<State>({ status: "loading", partial: [] });

  useEffect(() => {
    if (!meta || !provider) return;
    let cancelled = false;

    const cached = detailCache.get(meta.filePath);
    if (cached && cached.mtimeMs === meta.modifiedAt.getTime()) {
      setState({ status: "ready", messages: cached.messages });
      return () => { cancelled = true; };
    }

    setState({ status: "loading", partial: [] });

    (async () => {
      try {
        const acc: Message[] = [];
        for await (const m of provider.loadSession(meta.filePath)) {
          if (cancelled) return;
          acc.push(m);
          // Yield periodically so navigation keys and the cleanup-driven
          // `cancelled` flag get to run between batches.
          if (acc.length % YIELD_EVERY === 0) {
            await yieldToEventLoop();
            if (cancelled) return;
          }
        }
        if (cancelled) return;
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
