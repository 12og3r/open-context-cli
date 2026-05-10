// src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import path from "node:path";
import os from "node:os";
import {
  ALL_SOURCES,
  getProviderForSource,
  listAllSessions,
} from "./providers/index.ts";
import type { SessionMeta, Source } from "./providers/types.ts";
import { SessionBrowser } from "./components/session-browser.tsx";
import { LangProvider } from "./hooks/use-lang.ts";
import { useSettings } from "./hooks/use-settings.ts";
import { t } from "./lib/i18n.ts";
import type { ContinueRequest } from "./lib/continue-types.ts";
import { trace } from "./lib/debug-trace.ts";
import { enabledSourcesFromSettings } from "./lib/settings.ts";
import {
  deriveSessionStatusBySource,
  type SessionStatusBySource,
} from "./lib/session-status.ts";
import { claudeProjectsDir } from "./lib/claude-paths.ts";
import { codexSessionsDir } from "./lib/codex-paths.ts";

type Roots = Record<Source, string>;
type Enabled = Record<Source, boolean>;

type AppState =
  | { kind: "scanning"; roots: Roots; enabled: Enabled }
  | {
      kind: "browser";
      roots: Roots;
      enabled: Enabled;
      sessions: SessionMeta[];
      sessionStatusBySource: SessionStatusBySource;
    };

export function App({
  initialPath,
  emoji = true,
  onRequestContinue,
}: {
  initialPath?: string;
  emoji?: boolean;
  onRequestContinue?: (req: ContinueRequest) => void;
}) {
  const { exit } = useApp();
  const { settings, update: updateSetting } = useSettings();
  const lang = settings.language;

  // CLI --path is a Claude-only override (Codex's YYYY/MM/DD layout means
  // an arbitrary `--path` rarely makes sense for it). When set, we point
  // Claude at that path and disable Codex entirely so the user gets the
  // single-path browser they asked for.
  const enabled: Enabled = useMemo(() => {
    if (initialPath) return { "claude-code": true, "codex": false };
    return enabledSourcesFromSettings(settings);
  }, [initialPath, settings.showClaudeCode, settings.showCodex]);

  // Per-source roots. Resolution order: CLI flag (Claude only) > saved
  // setting > provider default.
  const roots: Roots = useMemo(() => ({
    "claude-code": expandHome(
      initialPath || settings.sessionsDir || claudeProjectsDir(),
    ),
    "codex": expandHome(settings.codexSessionsDir || codexSessionsDir()),
  }), [initialPath, settings.sessionsDir, settings.codexSessionsDir]);

  const [state, setState] = useState<AppState>(() => ({
    kind: "scanning", roots, enabled,
  }));

  // Re-scan when the resolved roots or enabled sources change. Settings
  // hydrate asynchronously, so the same shape arriving twice during
  // hydration shouldn't tear down a freshly-loaded list.
  useEffect(() => {
    setState(prev => {
      if (sameRoots(prev.roots, roots) && sameEnabled(prev.enabled, enabled)) {
        return prev;
      }
      return { kind: "scanning", roots, enabled };
    });
  }, [roots, enabled]);

  useEffect(() => {
    if (state.kind !== "scanning") return;
    let cancelled = false;
    (async () => {
      try {
        const sessions = await listAllSessions({
          enabled: state.enabled,
          rootForSource: (s) => state.roots[s],
        });
        if (cancelled) return;
        setState({
          kind: "browser",
          roots: state.roots,
          enabled: state.enabled,
          sessions,
          sessionStatusBySource: deriveSessionStatusBySource(state.enabled, sessions),
        });
      } catch {
        if (cancelled) return;
        setState({
          kind: "browser",
          roots: state.roots,
          enabled: state.enabled,
          sessions: [],
          sessionStatusBySource: deriveSessionStatusBySource(state.enabled, []),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [state]);

  if (state.kind === "scanning") {
    // We can show only one path in the spinner; pick the first enabled root.
    // Consistent with the previous single-path message even when both
    // sources are scanning concurrently.
    const firstRoot = ALL_SOURCES.find(s => state.enabled[s]);
    const root = firstRoot ? state.roots[firstRoot] : "";
    return (
      <LangProvider value={lang}>
        <Box>
          <Spinner /><Text> {t(lang, "loading.scanning", { root })}</Text>
        </Box>
      </LangProvider>
    );
  }
  return (
    <LangProvider value={lang}>
      <SessionBrowser
        sessions={state.sessions}
        sessionStatusBySource={state.sessionStatusBySource}
        emoji={emoji}
        settings={settings}
        updateSetting={updateSetting}
        defaultClaudeDir={claudeProjectsDir()}
        defaultCodexDir={codexSessionsDir()}
        onQuit={() => exit()}
        onSessionRemoved={(id) => {
          setState(prev => {
            if (prev.kind !== "browser") return prev;
            const next = prev.sessions.filter(s => s.id !== id);
            return {
              ...prev,
              sessions: next,
              sessionStatusBySource: deriveSessionStatusBySource(prev.enabled, next),
            };
          });
        }}
        onRequestContinue={(req) => {
          trace("app", `onRequestContinue mode=${req.launchMode} role=${req.targetRole} source=${req.source}`);
          if (req.launchMode === "new-window") {
            // The new window is a separate process — there's no reason to
            // also tear down this CLI. Fire the launch async so the preview
            // can dismiss its footer and the user lands back on the browser,
            // matching what Esc does on the same row.
            void (async () => {
              const { executeContinue } = await import("./lib/continue-launch.ts");
              const result = await executeContinue(req);
              trace("app", `new-window executeContinue returned ok=${result.ok}`);
            })();
            return;
          }
          // reuse-current: hand off to cli.tsx and unmount Ink so the
          // launcher can take over the terminal cleanly.
          onRequestContinue?.(req);
          trace("app", "calling exit()");
          exit();
          trace("app", "exit() returned");
        }}
      />
    </LangProvider>
  );
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function sameRoots(a: Roots, b: Roots): boolean {
  return ALL_SOURCES.every(s => a[s] === b[s]);
}

function sameEnabled(a: Enabled, b: Enabled): boolean {
  return ALL_SOURCES.every(s => a[s] === b[s]);
}

// Re-export so the SessionBrowser can resolve providers per session
// without re-importing from providers/index.ts.
export { getProviderForSource };
