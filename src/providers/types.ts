// src/providers/types.ts

export type Role = "user" | "assistant" | "tool_use" | "tool_result" | "system";

export interface Message {
  role: Role;
  content: string;     // raw text; markdown is rendered at the component layer
  timestamp: Date;
  toolName?: string;   // populated when role === "tool_use" or "tool_result"
  raw: unknown;        // original parsed JSONL entry, for debugging/expand
}

export interface SessionMeta {
  id: string;            // session uuid (filename without extension)
  filePath: string;      // absolute path to the .jsonl
  summary: string;       // jsonl summary line, or first user message, or "(empty session)"
  projectPath: string;   // decoded from parent dir; "" when not derivable
  modifiedAt: Date;
  messageCount: number;  // count of user+assistant lines (other types don't count)
}

export interface SessionProvider {
  readonly name: string;            // e.g. "claude-code"
  readonly defaultPaths: string[];  // e.g. ["~/.claude/projects"]
  listSessions(root: string): Promise<SessionMeta[]>;
  loadSession(filePath: string): AsyncIterable<Message>;
}
