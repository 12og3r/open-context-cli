import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "../lib/settings.ts";

export interface UseSettings {
  settings: Settings;
  loaded: boolean;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/**
 * Loads settings from disk on mount, then writes back to disk on every change.
 * Writes are best-effort and fire-and-forget; UI does not block on them.
 */
export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  // Skip the very first save (which would overwrite the file with defaults
  // before we've read it) and the save triggered by the hydration setState.
  const skipNextWrite = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSettings();
      if (cancelled) return;
      skipNextWrite.current = true;
      setSettings(s);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    void saveSettings(settings).catch(() => { /* best-effort */ });
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  return { settings, loaded, update };
}
