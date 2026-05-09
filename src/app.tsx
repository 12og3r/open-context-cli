// src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { getProvider } from "./providers/index.ts";
import type { SessionMeta } from "./providers/types.ts";
import { SessionBrowser } from "./components/session-browser.tsx";
import { LangProvider } from "./hooks/use-lang.ts";
import { useSettings } from "./hooks/use-settings.ts";
import { t } from "./lib/i18n.ts";
import type { ContinueRequest } from "./lib/continue-types.ts";
import { trace } from "./lib/debug-trace.ts";

export type SessionStatus = "ok" | "missing";

type AppState =
  | { kind: "scanning"; root: string }
  | {
      kind: "browser";
      root: string;
      sessions: SessionMeta[];
      sessionStatus: SessionStatus;
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
  const provider = useMemo(() => getProvider(), []);
  const { exit } = useApp();
  const { settings, update: updateSetting } = useSettings();
  const lang = settings.language;

  // Resolution order: explicit CLI flag > saved setting > provider default.
  // The saved setting is treated as a soft preference — empty string means
  // "fall back to default", and any non-empty value is taken at face value
  // (validation is the scanner's job, not ours).
  const effectiveRoot = useMemo(() => {
    const raw = initialPath || settings.sessionsDir || provider.defaultPaths[0]!;
    return expandHome(raw);
  }, [initialPath, settings.sessionsDir, provider]);

  const [state, setState] = useState<AppState>(() => {
    return { kind: "scanning", root: effectiveRoot };
  });

  // Re-scan when the resolved root changes (e.g. user edits sessionsDir in
  // the settings panel). We only restart if it's actually a different root —
  // settings load asynchronously, so the same path arriving twice during
  // hydration shouldn't tear down a freshly-loaded list.
  useEffect(() => {
    setState(prev => {
      if (prev.kind === "scanning" && prev.root === effectiveRoot) return prev;
      if (prev.kind === "browser" && prev.root === effectiveRoot) return prev;
      return { kind: "scanning", root: effectiveRoot };
    });
  }, [effectiveRoot]);

  useEffect(() => {
    if (state.kind !== "scanning") return;
    let cancelled = false;
    (async () => {
      const root = state.root;
      const ok = await directoryHasJsonl(root);
      if (cancelled) return;
      if (!ok) {
        setState({ kind: "browser", root, sessions: [], sessionStatus: "missing" });
        return;
      }
      try {
        const sessions = await provider.listSessions(root);
        if (cancelled) return;
        setState({
          kind: "browser",
          root,
          sessions,
          sessionStatus: sessions.length === 0 ? "missing" : "ok",
        });
      } catch {
        if (cancelled) return;
        setState({ kind: "browser", root, sessions: [], sessionStatus: "missing" });
      }
    })();
    return () => { cancelled = true; };
  }, [state, provider]);

  if (state.kind === "scanning") {
    return (
      <LangProvider value={lang}>
        <Box>
          <Spinner /><Text> {t(lang, "loading.scanning", { root: state.root })}</Text>
        </Box>
      </LangProvider>
    );
  }
  return (
    <LangProvider value={lang}>
      <SessionBrowser
        provider={provider}
        sessions={state.sessions}
        sessionStatus={state.sessionStatus}
        emoji={emoji}
        settings={settings}
        updateSetting={updateSetting}
        onQuit={() => exit()}
        onSessionRemoved={(id) => {
          setState(prev => {
            if (prev.kind !== "browser") return prev;
            const next = prev.sessions.filter(s => s.id !== id);
            return {
              ...prev,
              sessions: next,
              sessionStatus: next.length === 0 ? "missing" : "ok",
            };
          });
        }}
        onRequestContinue={(req) => {
          trace("app", `onRequestContinue mode=${req.launchMode} role=${req.targetRole}`);
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

async function directoryHasJsonl(root: string): Promise<boolean> {
  try {
    const stat = await fs.stat(root);
    if (stat.isFile()) return root.endsWith(".jsonl");
    if (!stat.isDirectory()) return false;
    const entries = await fs.readdir(root);
    for (const e of entries) {
      const full = path.join(root, e);
      const s = await fs.stat(full);
      if (s.isFile() && e.endsWith(".jsonl")) return true;
      if (s.isDirectory()) {
        const inner = await fs.readdir(full);
        if (inner.some(x => x.endsWith(".jsonl"))) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
