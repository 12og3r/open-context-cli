#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.tsx";

function parseArgs(argv: string[]): { path?: string; emoji: boolean } {
  let path: string | undefined;
  let emoji = process.env.CLAUDE_HISTORY_NO_EMOJI === "1" ? false : true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") { path = argv[i + 1]; i++; }
    else if (a === "--no-emoji") { emoji = false; }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
  }
  return { path, emoji };
}

function printHelp() {
  process.stdout.write(`open-context — browse local Claude Code session history

Usage:
  open-context [--path <dir-or-file>] [--no-emoji]
  open-context --help

Options:
  --path <p>    Use <p> as the session root instead of ~/.claude/projects.
  --no-emoji    Render plain role labels instead of emoji.
`);
}

const { path: initialPath, emoji } = parseArgs(process.argv);
render(<App initialPath={initialPath} emoji={emoji} />);
