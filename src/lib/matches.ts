import type { Message } from "../providers/types.ts";

export type Match = {
  msgIndex: number;
  contentOffset: number;
  length: number;
};

export function findMatches(messages: Message[], query: string): Match[] {
  if (!query) return [];
  const re = new RegExp(escapeRegex(query), "gi");
  const out: Match[] = [];
  for (let i = 0; i < messages.length; i++) {
    const content = messages[i]?.content ?? "";
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      out.push({ msgIndex: i, contentOffset: m.index, length: m[0].length });
      if (m[0].length === 0) re.lastIndex++; // safety against zero-width matches
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
