#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.tsx";
import type { ContinueRequest } from "./lib/continue-types.ts";
import { trace } from "./lib/debug-trace.ts";
import pkg from "../package.json" with { type: "json" };

function parseArgs(argv: string[]): { emoji: boolean } {
  let emoji = process.env.CLAUDE_HISTORY_NO_EMOJI === "1" ? false : true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-emoji") { emoji = false; }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else if (a === "--version" || a === "-v") { process.stdout.write(`${pkg.version}\n`); process.exit(0); }
  }
  return { emoji };
}

function printHelp() {
  process.stdout.write(`openctx ${pkg.version} — browse local Claude Code, Codex, and Gemini session history

Usage:
  openctx [--no-emoji]
  openctx update [<version>]
  openctx --version
  openctx --help

Commands:
  update [<version>]   Reinstall openctx via the package manager that
                       installed it (npm / bun / pnpm / yarn). Pass a
                       version (e.g. \`0.2.0\`) to pin; omit to take latest.

Options:
  --no-emoji         Render plain role labels instead of emoji.
  -v, --version      Print the openctx version and exit.
  -h, --help         Print this help and exit.

Configure session directories per source from the in-app Settings panel.
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

// `openctx __launch <spec-path>` — internal subcommand used by the
// new-window flow. The parent openctx writes a LaunchSpec to disk
// and asks the user's terminal to open a fresh window running this
// subcommand; we read the spec, delete it, and PTY-spawn the target
// (claude/codex) right here. Ink never mounts on this path.
//
// Doing it this way (vs. launching claude/codex directly in the new
// window with the prompt as a positional arg) means the new window
// gets the same prefill-via-bracketed-paste behavior as same-window
// mode: text shows up in the input box but is NOT auto-sent — the
// user reviews and presses Enter.
if (process.argv[2] === "__launch") {
  const specPath = process.argv[3];
  if (!specPath) {
    process.stderr.write("openctx __launch: missing spec path\n");
    process.exit(2);
  }
  const { consumeLaunchSpec } = await import("./lib/launch-spec.ts");
  const { runPty } = await import("./lib/continue-pty.ts");
  try {
    const spec = await consumeLaunchSpec(specPath);
    if (spec.env) {
      for (const [k, v] of Object.entries(spec.env)) process.env[k] = v;
    }
    const code = await runPty({
      cwd: spec.cwd,
      command: spec.command,
      prefillText: spec.prefillText,
    });
    process.exit(code);
  } catch (e) {
    process.stderr.write(`openctx __launch: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

const { emoji } = parseArgs(process.argv);

// Mutable holder so TypeScript doesn't narrow the inner field to its initial
// `null` value when the closure assigns into it asynchronously.
const slot: { req: ContinueRequest | null } = { req: null };
const inkApp = render(
  <App
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
