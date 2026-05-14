// src/providers/index.ts
import { ClaudeCodeProvider } from "./claude-code.ts";
import { CodexProvider } from "./codex.ts";
import { GeminiProvider } from "./gemini.ts";
import type { SessionMeta, SessionProvider, Source } from "./types.ts";

export const ALL_SOURCES: readonly Source[] = ["claude-code", "codex", "gemini"] as const;

const providers: Record<Source, SessionProvider> = {
  "claude-code": new ClaudeCodeProvider(),
  "codex":       new CodexProvider(),
  "gemini":      new GeminiProvider(),
};

// Kept for the (rare) caller that still wants the canonical default.
export const DEFAULT_PROVIDER: Source = "claude-code";

export function getProvider(name: Source = DEFAULT_PROVIDER): SessionProvider {
  return providers[name];
}

export function getProviderForSource(source: Source): SessionProvider {
  return providers[source];
}

export function listProviderNames(): Source[] {
  return [...ALL_SOURCES];
}

/**
 * Aggregate sessions across every enabled source. Each source can be
 * enabled/disabled and given its own root path independently. A failure in
 * one provider doesn't kill the others — the failing source contributes an
 * empty list and its error is forwarded via `onSourceError` so the caller
 * can surface it.
 */
export async function listAllSessions(opts: {
  enabled: Record<Source, boolean>;
  rootForSource: (s: Source) => string;
  onSourceError?: (source: Source, error: Error) => void;
}): Promise<SessionMeta[]> {
  const tasks = ALL_SOURCES.filter(s => opts.enabled[s]).map(async (source) => {
    const provider = providers[source];
    try {
      return await provider.listSessions(opts.rootForSource(source));
    } catch (err) {
      opts.onSourceError?.(source, err as Error);
      return [];
    }
  });
  const results = await Promise.all(tasks);
  const merged = results.flat();
  merged.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return merged;
}
