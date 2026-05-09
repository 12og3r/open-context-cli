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
}
