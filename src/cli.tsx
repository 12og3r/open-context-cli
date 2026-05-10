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
  process.stdout.write(`openctx ${pkg.version} — browse local Claude Code and Codex session history

Usage:
  openctx [--path <dir-or-file>] [--no-emoji]
  openctx update [<version>]
  openctx --version
  openctx --help

Commands:
  update [<version>]   Reinstall openctx via the package manager that
                       installed it (npm / bun / pnpm / yarn). Pass a
                       version (e.g. \`0.2.0\`) to pin; omit to take latest.

Options:
  --path <p>         Use <p> as the Claude Code session root instead of
                     ~/.claude/projects. Codex is hidden while --path is set;
                     for normal multi-source browsing, omit --path and use
                     the Settings panel to configure each source's directory.
  --no-emoji         Render plain role labels instead of emoji.
  -v, --version      Print the openctx version and exit.
  -h, --help         Print this help and exit.
`);
}

// `openctx update [<version>]` is intercepted before flag parsing so it
// doesn't have to share argument shape with the browser. It dispatches to
// the package manager that installed openctx and exits with the child's
// exit code — Ink is never mounted on this path.
if (process.argv[2] === "update") {
  const { runUpdate } = await import("./lib/update.ts");
  process.exit(await runUpdate({ version: process.argv[3] }));
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
