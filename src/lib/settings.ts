import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_LANG, LANGS, type Lang } from "./i18n.ts";
import type { Source } from "../providers/types.ts";

export type DisplayMode = "concise" | "full";
export type ContinueLaunchMode = "reuse-current" | "new-window";

export interface Settings {
  displayMode: DisplayMode;
  showHash: boolean;
  language: Lang;
  continueLaunchMode: ContinueLaunchMode;
  // Empty string = use the provider's default location. We intentionally
  // accept any non-empty string here without filesystem validation; the
  // app-level scanner is the layer that decides what to do with a missing
  // or empty directory.
  sessionsDir: string;
  // Codex CLI sessions root. Same empty-string-means-default semantics as
  // sessionsDir; the default resolves to `${CODEX_HOME ?? ~/.codex}/sessions`.
  codexSessionsDir: string;
  // Per-source visibility. When a source is disabled, its sessions are
  // skipped during aggregation. Both default true — disabling a source is
  // a deliberate user choice.
  showClaudeCode: boolean;
  showCodex: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  displayMode: "full",
  showHash: true,
  language: DEFAULT_LANG,
  continueLaunchMode: "reuse-current",
  sessionsDir: "",
  codexSessionsDir: "",
  showClaudeCode: true,
  showCodex: true,
};

/**
 * Map the boolean visibility settings to the {source: enabled} record
 * used by the providers/listAllSessions helper.
 */
export function enabledSourcesFromSettings(s: Settings): Record<Source, boolean> {
  return {
    "claude-code": s.showClaudeCode,
    "codex":       s.showCodex,
  };
}

export function settingsDir(): string {
  return path.join(os.homedir(), "openctx");
}

export function settingsPath(): string {
  return path.join(settingsDir(), "settings.json");
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...sanitize(parsed) };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // First-run: materialize defaults so the user can find/edit the file.
      // Best-effort; if the write fails (e.g. read-only HOME) we still return
      // the in-memory defaults so the app keeps working.
      const defaults = { ...DEFAULT_SETTINGS };
      await saveSettings(defaults).catch(() => { /* ignore */ });
      return defaults;
    }
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await fs.mkdir(settingsDir(), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2) + "\n", "utf8");
}

function sanitize(p: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (p.displayMode === "concise" || p.displayMode === "full") {
    out.displayMode = p.displayMode;
  }
  if (typeof p.showHash === "boolean") {
    out.showHash = p.showHash;
  }
  if (typeof p.language === "string" && (LANGS as readonly string[]).includes(p.language)) {
    out.language = p.language as Lang;
  }
  if (p.continueLaunchMode === "reuse-current" || p.continueLaunchMode === "new-window") {
    out.continueLaunchMode = p.continueLaunchMode;
  }
  if (typeof p.sessionsDir === "string") {
    out.sessionsDir = p.sessionsDir;
  }
  if (typeof p.codexSessionsDir === "string") {
    out.codexSessionsDir = p.codexSessionsDir;
  }
  if (typeof p.showClaudeCode === "boolean") {
    out.showClaudeCode = p.showClaudeCode;
  }
  if (typeof p.showCodex === "boolean") {
    out.showCodex = p.showCodex;
  }
  return out;
}
