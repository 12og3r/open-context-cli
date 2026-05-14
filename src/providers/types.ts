// src/providers/types.ts

export type Source = "claude-code" | "codex";

export type Role = "user" | "assistant" | "tool_use" | "tool_result" | "system";

export interface Message {
  role: Role;
  content: string;     // raw text; markdown is rendered at the component layer
  timestamp: Date;
  toolName?: string;   // populated when role === "tool_use" or "tool_result"
  uuid?: string;       // uuid of the source JSONL entry; multiple split messages
                       // (text + tool_use + tool_result from one entry) share it
  raw: unknown;        // original parsed JSONL entry, for debugging/expand
}

export interface SessionMeta {
  id: string;            // session uuid (filename without extension)
  filePath: string;      // absolute path to the .jsonl
  summary: string;       // jsonl summary line, or first user message, or "(empty session)"
  projectPath: string;   // decoded from parent dir; "" when not derivable
  modifiedAt: Date;
  // Both display-mode counts, sized to match what the preview pane shows
  // under each mode. `concise` = user+assistant Message rows (text only).
  // `full` = every row the preview renders, including tool_use / tool_result
  // / system. The list picks one based on the user's current displayMode.
  messageCounts: { concise: number; full: number };
  cwd?: string;          // exact cwd from the first user/assistant entry's
                         // `cwd` field — preferred over decoding the slug,
                         // which is lossy when path segments contain "-".
  source: Source;        // which CLI produced this transcript
}

export interface SessionProvider {
  readonly name: string;            // e.g. "claude-code"
  readonly defaultPaths: string[];  // e.g. ["~/.claude/projects"]
  listSessions(root: string): Promise<SessionMeta[]>;
  loadSession(filePath: string): AsyncIterable<Message>;
}
