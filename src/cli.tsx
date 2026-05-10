#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.tsx";
import type { ContinueRequest } from "./lib/continue-types.ts";
import { trace } from "./lib/debug-trace.ts";
import pkg from "../package.json" with { type: "json" };

function parseArgs(argv: string[]): { path?: string; emoji: boolean } {
  let path: string | undefined;
  let emoji = process.env.CLAUDE_HISTORY_NO_EMOJI === "1" ? false : true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") { path = argv[i + 1]; i++; }
    else if (a === "--no-emoji") { emoji = false; }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else if (a === "--version" || a === "-v") { process.stdout.write(`${pkg.version}\n`); process.exit(0); }
  }
  return { path, emoji };
}

function printHelp() {
  process.stdout.write(`openctx ${pkg.version} — browse local Claude Code session history

Usage:
  openctx [--path <dir-or-file>] [--no-emoji]
  openctx --version
  openctx --help

Options:
  --path <p>         Use <p> as the session root instead of ~/.claude/projects.
  --no-emoji         Render plain role labels instead of emoji.
  -v, --version      Print the openctx version and exit.
  -h, --help         Print this help and exit.
`);
}

const { path: initialPath, emoji } = parseArgs(process.argv);

// Mutable holder so TypeScript doesn't narrow the inner field to its initial
// `null` value when the closure assigns into it asynchronously.
const slot: { req: ContinueRequest | null } = { req: null };
const inkApp = render(
  <App
    initialPath={initialPath}
    emoji={emoji}
    onRequestContinue={(req) => { slot.req = req; }}
  />,
);

trace("cli", "awaiting waitUntilExit");
await inkApp.waitUntilExit();
trace("cli", `waitUntilExit resolved; slot.req=${slot.req ? "set" : "null"}`);

const req = slot.req;
if (req) {
  trace("cli", `executing launcher mode=${req.launchMode}`);
  if (process.env.OPEN_CONTEXT_DEBUG) process.stderr.write(`[oc] ink exited; pendingContinue set, mode=${req.launchMode}\n`);
  const { executeContinue } = await import("./lib/continue-launch.ts");
  const result = await executeContinue(req);
  trace("cli", `executeContinue returned ok=${result.ok}`);
  if (process.env.OPEN_CONTEXT_DEBUG) process.stderr.write(`[oc] executeContinue returned: ${JSON.stringify(result)}\n`);
  if (!result.ok) {
    process.stderr.write(`open-context: ${result.error}\n`);
    process.exit(1);
  }
  process.exit(result.childExitCode ?? 0);
}
