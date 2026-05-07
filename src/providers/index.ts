// src/providers/index.ts
import { ClaudeCodeProvider } from "./claude-code.ts";
import type { SessionProvider } from "./types.ts";

const providers: Record<string, SessionProvider> = {
  "claude-code": new ClaudeCodeProvider(),
};

export const DEFAULT_PROVIDER = "claude-code";

export function getProvider(name: string = DEFAULT_PROVIDER): SessionProvider {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export function listProviderNames(): string[] {
  return Object.keys(providers);
}
