// src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { getProvider } from "./providers/index.ts";
import type { SessionMeta } from "./providers/types.ts";
import { PathInput } from "./components/path-input.tsx";
import { SessionBrowser } from "./components/session-browser.tsx";
import { LangProvider } from "./hooks/use-lang.ts";
import { useSettings } from "./hooks/use-settings.ts";
import { t } from "./lib/i18n.ts";
import type { ContinueRequest } from "./lib/continue-types.ts";
import { trace } from "./lib/debug-trace.ts";

type AppState =
  | { kind: "scanning"; root: string }
  | { kind: "path-input"; reason: "no-default-path" | "user-requested"; error?: string }
  | { kind: "browser"; root: string; sessions: SessionMeta[] };

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
  const [state, setState] = useState<AppState>(() => {
    const root = initialPath ?? provider.defaultPaths[0]!;
    return { kind: "scanning", root: expandHome(root) };
  });

  useEffect(() => {
    if (state.kind !== "scanning") return;
    let cancelled = false;
    (async () => {
      const root = state.root;
      const ok = await directoryHasJsonl(root);
      if (cancelled) return;
      if (!ok) {
        setState({ kind: "path-input", reason: "no-default-path" });
        return;
      }
      try {
        const sessions = await provider.listSessions(root);
        if (cancelled) return;
        if (sessions.length === 0) {
          setState({ kind: "path-input", reason: "no-default-path" });
        } else {
          setState({ kind: "browser", root, sessions });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: "path-input", reason: "no-default-path", error: (e as Error).message });
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
  if (state.kind === "path-input") {
    return (
      <LangProvider value={lang}>
        <PathInput
          reason={state.reason}
          error={state.error}
          onSubmit={(p) => {
            const root = expandHome(p);
            setState({ kind: "scanning", root });
          }}
        />
      </LangProvider>
    );
  }
  return (
    <LangProvider value={lang}>
      <SessionBrowser
        provider={provider}
        sessions={state.sessions}
        emoji={emoji}
        settings={settings}
        updateSetting={updateSetting}
        onRequestPathInput={() => setState({ kind: "path-input", reason: "user-requested" })}
        onQuit={() => exit()}
        onSessionRemoved={(id) => {
          setState(prev => {
            if (prev.kind !== "browser") return prev;
            return { ...prev, sessions: prev.sessions.filter(s => s.id !== id) };
          });
        }}
        onRequestContinue={(req) => {
          // Surface up to the host (cli.tsx) and unmount Ink so the launcher
          // can take over the terminal cleanly.
          trace("app", `onRequestContinue mode=${req.launchMode} role=${req.targetRole}`);
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
