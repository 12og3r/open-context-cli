import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_LANG, LANGS, type Lang } from "./i18n.ts";

export type DisplayMode = "concise" | "full";
export type ContinueLaunchMode = "reuse-current" | "new-window";

export interface Settings {
  displayMode: DisplayMode;
  showHash: boolean;
  language: Lang;
  continueLaunchMode: ContinueLaunchMode;
}

export const DEFAULT_SETTINGS: Settings = {
  displayMode: "full",
  showHash: true,
  language: DEFAULT_LANG,
  continueLaunchMode: "reuse-current",
};

export function settingsDir(): string {
  return path.join(os.homedir(), ".context-cli");
}

export function settingsPath(): string {
  return path.join(settingsDir(), ".settings.json");
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
  return out;
}
