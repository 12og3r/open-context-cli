import type { ContinueLaunchMode } from "./settings.ts";
import type { Source } from "../providers/types.ts";

export interface ContinueRequest {
  // Which CLI produced this transcript — drives launcher dispatch (claude
  // vs codex) and which pre-flight checks apply.
  source: Source;
  // Session id (for codex this is the resume target; for claude it's the
  // original session and a new uuid is minted by the launcher for the fork).
  sessionId: string;
  // Path to the source JSONL — used to locate project dir + read entries.
  sourcePath: string;
  // Cursor message uuid.
  targetUuid: string;
  // Cursor message role — drives whether the target line is included.
  targetRole: "user" | "assistant";
  // For user-role only: the message content to prefill into claude's input.
  userText?: string;
  // Resolved at request time so cli.tsx doesn't need to re-read settings.
  launchMode: ContinueLaunchMode;
  // The session's recorded cwd from the source JSONL — preferred over
  // decoding the slug, which is lossy. Used as the launch cwd when force
  // mode is off.
  sourceCwd?: string;
  // Force mode: when set, the original project directory was missing and
  // the user asked to launch in this cwd instead. The launcher uses this
  // path as both the spawn cwd and as the value rewritten into every
  // copied JSONL entry's `cwd` field. Only applies to claude-source
  // sessions; the codex launcher does not fork or rewrite cwd.
  forceCwd?: string;
}
