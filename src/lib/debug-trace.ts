import fs from "node:fs";

// Append-only trace log written unconditionally to /tmp/open-context-trace.log.
// Used during the continue-conversation rollout to pinpoint where the launch
// path stalls. Failures are swallowed so the trace can never break the app.
const PATH = "/tmp/open-context-trace.log";

export function trace(scope: string, msg: string): void {
  try {
    fs.appendFileSync(PATH, `${new Date().toISOString()} [${scope}] ${msg}\n`);
  } catch { /* ignore */ }
}
