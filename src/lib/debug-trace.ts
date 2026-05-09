import fs from "node:fs";

// Append-only diagnostic trace for the continue-conversation launch path.
// Off by default; set OPEN_CONTEXT_DEBUG=1 to enable. Writes to
// /tmp/open-context-trace.log (or $OPEN_CONTEXT_TRACE if set). Failures are
// swallowed so a misconfigured filesystem can never break the app.
const PATH = process.env.OPEN_CONTEXT_TRACE || "/tmp/open-context-trace.log";

export function trace(scope: string, msg: string): void {
  if (!process.env.OPEN_CONTEXT_DEBUG) return;
  try {
    fs.appendFileSync(PATH, `${new Date().toISOString()} [${scope}] ${msg}\n`);
  } catch { /* ignore */ }
}
