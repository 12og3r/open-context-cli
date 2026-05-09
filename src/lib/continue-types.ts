import type { ContinueLaunchMode } from "./settings.ts";

export interface ContinueRequest {
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
  // Force mode: when set, the original project directory was missing and
  // the user asked to launch in this cwd instead. The launcher uses this
  // path as both the spawn cwd and as the value rewritten into every
  // copied JSONL entry's `cwd` field.
  forceCwd?: string;
}
