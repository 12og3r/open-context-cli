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

type AppState =
  | { kind: "scanning"; root: string }
  | { kind: "path-input"; reason: "no-default-path" | "user-requested"; error?: string }
  | { kind: "browser"; root: string; sessions: SessionMeta[] };

export function App({
  initialPath,
  emoji = true,
}: {
  initialPath?: string;
  emoji?: boolean;
}) {
  const provider = useMemo(() => getProvider(), []);
  const { exit } = useApp();
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
      <Box>
        <Spinner /><Text> Scanning {state.root}…</Text>
      </Box>
    );
  }
  if (state.kind === "path-input") {
    return (
      <PathInput
        reason={state.reason}
        error={state.error}
        onSubmit={(p) => {
          const root = expandHome(p);
          setState({ kind: "scanning", root });
        }}
      />
    );
  }
  return (
    <SessionBrowser
      provider={provider}
      sessions={state.sessions}
      emoji={emoji}
      onRequestPathInput={() => setState({ kind: "path-input", reason: "user-requested" })}
      onQuit={() => exit()}
    />
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
