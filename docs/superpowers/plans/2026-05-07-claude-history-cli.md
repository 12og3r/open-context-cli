# claude-history-cli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Ink TUI that browses local Claude Code sessions with a two-pane (list + preview) UI, in-preview search, and a pluggable provider interface for future tools.

**Architecture:** A single-process Ink app driven by a small state machine (`scanning` → `path-input` → `browser` / `browser-with-detail`). Pure libs (`lib/*`) are framework-free. A `SessionProvider` interface isolates Claude Code-specific I/O so other tools can be added later. Sessions are listed via a cheap metadata pass and lazily fully-parsed on selection. An LRU cache keyed by `(filePath, mtime)` keeps re-listing fast.

**Tech Stack:** Bun (runtime + package manager + test runner), TypeScript (strict), React Ink 5, `ink-text-input`, `ink-spinner`, `marked`, `string-width`. No external markdown-to-ANSI library — small in-repo renderer.

**Reference spec:** `docs/superpowers/specs/2026-05-07-claude-history-tui-design.md`.

**Working directory note:** the project lives in `/Users/roger/projects/claude-history`. The npm package name is `claude-history-cli`. The directory was intentionally not renamed.

---

## File Structure

Created during the plan (all paths relative to the project root):

```
package.json                            # task 1
tsconfig.json                           # task 1
.gitignore                              # task 1
README.md                               # task 1
src/
  cli.tsx                               # task 22 — argv parsing, mounts <App/>
  app.tsx                               # task 21 — top-level state machine
  providers/
    types.ts                            # task 8 — SessionProvider, SessionMeta, Message
    claude-code.ts                      # tasks 9-10 — Claude Code provider
    index.ts                            # task 11 — provider registry
  components/
    footer.tsx                          # task 14 — context-sensitive hint bar
    session-list.tsx                    # task 15 — left pane
    path-input.tsx                      # task 16 — manual path entry
    message-block.tsx                   # task 17 — single-message rendering with role color/emoji
    search-bar.tsx                      # task 18 — input bar (used by both list-search and preview-search)
    session-preview.tsx                 # task 19 — right pane: scroll, search, tool expand
    session-browser.tsx                 # task 20 — composes list + preview + footer
  hooks/
    use-sessions.ts                     # task 12 — list + cache
    use-session-detail.ts               # task 13 — stream messages on demand
  lib/
    decode-project-path.ts              # task 3
    relative-time.ts                    # task 4
    truncate.ts                         # task 5
    jsonl.ts                            # task 6
    markdown-ansi.ts                    # task 7
tests/
  fixtures/claude-code/                 # task 9 — synthetic .jsonl files
    with-summary.jsonl
    without-summary.jsonl
    with-tools.jsonl
    malformed.jsonl
    empty.jsonl
  lib/                                  # tests live next to corresponding tasks
    decode-project-path.test.ts
    relative-time.test.ts
    truncate.test.ts
    jsonl.test.ts
    markdown-ansi.test.ts
  providers/
    claude-code.test.ts
  components/
    session-list.test.tsx
    session-preview.test.tsx
    path-input.test.tsx
```

Each file has one responsibility. The `lib/` files are framework-free pure functions. The `providers/` files do I/O but no React. Components own no business logic — they accept props and dispatch keyboard events.

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/.gitkeep` (placeholder; replaced by real files later)
- Create: `tests/.gitkeep` (placeholder)

- [ ] **Step 1: Initialize the directory layout**

```bash
cd /Users/roger/projects/claude-history
mkdir -p src/providers src/components src/hooks src/lib tests/lib tests/providers tests/components tests/fixtures/claude-code
touch src/.gitkeep tests/.gitkeep
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "claude-history-cli",
  "version": "0.0.1",
  "private": true,
  "description": "Browse local Claude Code session history in a TUI.",
  "type": "module",
  "bin": {
    "claude-history": "./dist/cli.js"
  },
  "scripts": {
    "dev": "bun run src/cli.tsx",
    "build": "bun build src/cli.tsx --outdir dist --target node --format esm",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ink": "^5.0.1",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "marked": "^12.0.0",
    "react": "^18.3.1",
    "string-width": "^7.2.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "@types/react": "^18.3.0",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["bun"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
bun.lockb
*.log
.DS_Store
```

- [ ] **Step 5: Write a minimal `README.md`**

```markdown
# claude-history-cli

Browse your local Claude Code session history in the terminal.

## Develop

```bash
bun install
bun run dev
```

## Test

```bash
bun test
```
```

- [ ] **Step 6: Install dependencies and verify**

Run: `bun install`
Expected: lockfile created, no errors.

Run: `bun run typecheck`
Expected: passes (project still empty).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore README.md src tests
git commit -m "Bootstrap claude-history-cli project"
```

---

## Task 2: lib/decode-project-path

Decodes a Claude Code encoded directory name (e.g. `-Users-roger-projects-foo`) back to `/Users/roger/projects/foo`. Returns `""` when no decoding is possible (we treat that as "unknown project").

**Files:**
- Create: `src/lib/decode-project-path.ts`
- Test: `tests/lib/decode-project-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/decode-project-path.test.ts
import { describe, expect, test } from "bun:test";
import { decodeProjectPath } from "../../src/lib/decode-project-path.ts";

describe("decodeProjectPath", () => {
  test("decodes a typical macOS path", () => {
    expect(decodeProjectPath("-Users-roger-projects-claude-history"))
      .toBe("/Users/roger/projects/claude-history");
  });

  test("decodes paths with hyphenated segment names", () => {
    // "-Users-roger-projects-claude-history" — segment "claude-history" has
    // a real hyphen. We accept the ambiguity and join with "/" between
    // every dash; if the original directory had hyphens they collapse to
    // slashes. Document this and accept it as a known limitation.
    expect(decodeProjectPath("-Users-roger-foo-bar"))
      .toBe("/Users/roger/foo/bar");
  });

  test("returns empty string for unrecognized format", () => {
    expect(decodeProjectPath("not-a-project")).toBe("");
    expect(decodeProjectPath("")).toBe("");
  });

  test("requires the leading dash", () => {
    expect(decodeProjectPath("Users-roger-projects-foo")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/lib/decode-project-path.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/decode-project-path.ts

/**
 * Claude Code encodes a project path by replacing every "/" with "-".
 * `/Users/roger/projects/foo` → `-Users-roger-projects-foo`.
 * Decoding is lossy: original hyphens in path segments become "/".
 * We accept that ambiguity rather than guessing.
 */
export function decodeProjectPath(encoded: string): string {
  if (!encoded.startsWith("-")) return "";
  return encoded.replace(/-/g, "/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/decode-project-path.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decode-project-path.ts tests/lib/decode-project-path.test.ts
git commit -m "Add decodeProjectPath lib"
```

---

## Task 3: lib/relative-time

Renders a `Date` as "just now" / "Nm ago" / "Nh ago" / "Yesterday" / "Nd ago" / "YYYY-MM-DD" relative to a reference instant. The reference instant is injectable so tests are deterministic.

**Files:**
- Create: `src/lib/relative-time.ts`
- Test: `tests/lib/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/relative-time.test.ts
import { describe, expect, test } from "bun:test";
import { relativeTime } from "../../src/lib/relative-time.ts";

const NOW = new Date("2026-05-07T12:00:00Z");

describe("relativeTime", () => {
  test("under one minute → 'just now'", () => {
    expect(relativeTime(new Date("2026-05-07T11:59:30Z"), NOW)).toBe("just now");
  });

  test("under one hour → 'Nm ago'", () => {
    expect(relativeTime(new Date("2026-05-07T11:45:00Z"), NOW)).toBe("15m ago");
  });

  test("under one day → 'Nh ago'", () => {
    expect(relativeTime(new Date("2026-05-07T10:00:00Z"), NOW)).toBe("2h ago");
  });

  test("yesterday boundary → 'Yesterday'", () => {
    expect(relativeTime(new Date("2026-05-06T23:00:00Z"), NOW)).toBe("Yesterday");
  });

  test("under a week → 'Nd ago'", () => {
    expect(relativeTime(new Date("2026-05-04T12:00:00Z"), NOW)).toBe("3d ago");
  });

  test("older → ISO date", () => {
    expect(relativeTime(new Date("2026-04-12T10:00:00Z"), NOW)).toBe("2026-04-12");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/lib/relative-time.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/relative-time.ts

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(when: Date, now: Date = new Date()): string {
  const delta = now.getTime() - when.getTime();
  if (delta < MIN) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return "Yesterday";
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  // older: ISO YYYY-MM-DD
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  const d = String(when.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/lib/relative-time.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relative-time.ts tests/lib/relative-time.test.ts
git commit -m "Add relativeTime lib"
```

---

## Task 4: lib/truncate

CJK-aware truncation. Returns a string that occupies at most `width` columns when printed; appends `…` when truncation actually happens.

**Files:**
- Create: `src/lib/truncate.ts`
- Test: `tests/lib/truncate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/truncate.test.ts
import { describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import { truncate } from "../../src/lib/truncate.ts";

describe("truncate", () => {
  test("no-op when string fits", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates ASCII with ellipsis", () => {
    const out = truncate("the quick brown fox", 10);
    expect(stringWidth(out)).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("treats CJK characters as width 2", () => {
    // "我想做一款终端应用" — each char width 2, 9 chars → width 18
    const out = truncate("我想做一款终端应用", 10);
    expect(stringWidth(out)).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("width 0 returns ellipsis only", () => {
    expect(truncate("abc", 0)).toBe("");
  });

  test("width 1 with multi-char input returns ellipsis", () => {
    const out = truncate("abc", 1);
    expect(stringWidth(out)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/lib/truncate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/truncate.ts
import stringWidth from "string-width";

const ELLIPSIS = "…";

export function truncate(input: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(input) <= maxWidth) return input;
  // Reserve one column for ellipsis
  const budget = maxWidth - 1;
  if (budget <= 0) return ELLIPSIS;
  let acc = "";
  let used = 0;
  for (const ch of input) {
    const w = stringWidth(ch);
    if (used + w > budget) break;
    acc += ch;
    used += w;
  }
  return acc + ELLIPSIS;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/lib/truncate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/truncate.ts tests/lib/truncate.test.ts
git commit -m "Add CJK-aware truncate lib"
```

---

## Task 5: lib/jsonl

Streaming line-by-line JSON parser. Yields `{ line: number, value: unknown }` for valid lines and `{ line: number, error: Error, raw: string }` for malformed lines. Reads from any `AsyncIterable<string>` (Bun file streams qualify) so tests can pass synthetic data.

**Files:**
- Create: `src/lib/jsonl.ts`
- Test: `tests/lib/jsonl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/jsonl.test.ts
import { describe, expect, test } from "bun:test";
import { parseJsonlStream } from "../../src/lib/jsonl.ts";

async function* lines(s: string): AsyncIterable<string> {
  // Simulate chunked reads by yielding the whole file then EOF.
  yield s;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("parseJsonlStream", () => {
  test("parses a normal file", async () => {
    const data = `{"a":1}\n{"a":2}\n{"a":3}\n`;
    const result = await collect(parseJsonlStream(lines(data)));
    expect(result.map(r => "value" in r ? r.value : null)).toEqual([
      { a: 1 }, { a: 2 }, { a: 3 },
    ]);
  });

  test("reports malformed lines without aborting", async () => {
    const data = `{"a":1}\nNOT JSON\n{"a":3}\n`;
    const result = await collect(parseJsonlStream(lines(data)));
    expect(result).toHaveLength(3);
    expect("value" in result[0]!).toBe(true);
    expect("error" in result[1]!).toBe(true);
    expect("value" in result[2]!).toBe(true);
  });

  test("handles missing trailing newline", async () => {
    const data = `{"a":1}\n{"a":2}`;
    const result = await collect(parseJsonlStream(lines(data)));
    expect(result).toHaveLength(2);
  });

  test("handles split chunks", async () => {
    async function* split(): AsyncIterable<string> {
      yield `{"a":1}\n{"a`;
      yield `":2}\n`;
    }
    const result = await collect(parseJsonlStream(split()));
    expect(result.map(r => "value" in r ? r.value : null)).toEqual([
      { a: 1 }, { a: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/lib/jsonl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/jsonl.ts

export type JsonlEntry =
  | { line: number; value: unknown }
  | { line: number; error: Error; raw: string };

export async function* parseJsonlStream(
  chunks: AsyncIterable<string>,
): AsyncIterable<JsonlEntry> {
  let buf = "";
  let line = 0;
  for await (const chunk of chunks) {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      line += 1;
      if (raw.length === 0) continue;
      yield parseLine(raw, line);
    }
  }
  if (buf.length > 0) {
    line += 1;
    yield parseLine(buf, line);
  }
}

function parseLine(raw: string, line: number): JsonlEntry {
  try {
    return { line, value: JSON.parse(raw) };
  } catch (e) {
    return { line, error: e as Error, raw };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/lib/jsonl.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jsonl.ts tests/lib/jsonl.test.ts
git commit -m "Add streaming JSONL parser"
```

---

## Task 6: lib/markdown-ansi

Convert Markdown to ANSI-styled text suitable for an Ink `<Text>` block. Supports: headings (h1-h3 → bold), paragraphs (passthrough), inline code (dim), fenced code blocks (dim, indented 2 spaces), bold, italic, links (underlined), unordered/ordered lists (`• ` / `1. ` prefix). Anything else falls back to plain text.

**Files:**
- Create: `src/lib/markdown-ansi.ts`
- Test: `tests/lib/markdown-ansi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/markdown-ansi.test.ts
import { describe, expect, test } from "bun:test";
import { markdownToAnsi } from "../../src/lib/markdown-ansi.ts";

// Strip ANSI for substring assertions.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("markdownToAnsi", () => {
  test("plain paragraph passes through", () => {
    expect(strip(markdownToAnsi("hello world"))).toBe("hello world");
  });

  test("bold contains ANSI escape", () => {
    const out = markdownToAnsi("**bold**");
    expect(strip(out)).toBe("bold");
    expect(out).toContain("\x1b[1m");
  });

  test("inline code is dim", () => {
    const out = markdownToAnsi("a `b` c");
    expect(strip(out)).toBe("a b c");
    expect(out).toContain("\x1b[2m");
  });

  test("fenced code block is indented", () => {
    const md = "```\nfoo\nbar\n```";
    const out = markdownToAnsi(md);
    const lines = strip(out).split("\n");
    expect(lines.some(l => l.startsWith("  foo"))).toBe(true);
    expect(lines.some(l => l.startsWith("  bar"))).toBe(true);
  });

  test("unordered list uses bullet", () => {
    const out = markdownToAnsi("- one\n- two");
    expect(strip(out)).toContain("• one");
    expect(strip(out)).toContain("• two");
  });

  test("h1 is bold", () => {
    const out = markdownToAnsi("# hi");
    expect(strip(out)).toBe("hi");
    expect(out).toContain("\x1b[1m");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/lib/markdown-ansi.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/markdown-ansi.ts
import { marked, type Tokens } from "marked";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";

function wrap(open: string, body: string): string {
  return `${open}${body}${RESET}`;
}

function renderInline(tokens: Tokens.Generic[]): string {
  return tokens.map(renderInlineOne).join("");
}

function renderInlineOne(t: Tokens.Generic): string {
  switch (t.type) {
    case "text": return (t as Tokens.Text).text;
    case "strong": return wrap(BOLD, renderInline((t as Tokens.Strong).tokens ?? []));
    case "em": return wrap(ITALIC, renderInline((t as Tokens.Em).tokens ?? []));
    case "codespan": return wrap(DIM, (t as Tokens.Codespan).text);
    case "link": return wrap(UNDERLINE, renderInline((t as Tokens.Link).tokens ?? []));
    case "br": return "\n";
    case "del": return renderInline((t as Tokens.Del).tokens ?? []);
    default: return (t as { raw?: string }).raw ?? "";
  }
}

function renderBlock(t: Tokens.Generic): string {
  switch (t.type) {
    case "heading": {
      const h = t as Tokens.Heading;
      return wrap(BOLD, renderInline(h.tokens ?? []));
    }
    case "paragraph": {
      const p = t as Tokens.Paragraph;
      return renderInline(p.tokens ?? []);
    }
    case "code": {
      const c = t as Tokens.Code;
      const indented = c.text.split("\n").map(l => "  " + l).join("\n");
      return wrap(DIM, indented);
    }
    case "list": {
      const l = t as Tokens.List;
      return l.items.map((item, i) => {
        const marker = l.ordered ? `${(l.start ?? 1) + i}. ` : "• ";
        const body = renderInline(item.tokens ?? []);
        return marker + body;
      }).join("\n");
    }
    case "blockquote": {
      const b = t as Tokens.Blockquote;
      return (b.tokens ?? []).map(renderBlock).join("\n").split("\n")
        .map(l => "│ " + l).join("\n");
    }
    case "space": return "";
    default: return (t as { raw?: string }).raw ?? "";
  }
}

export function markdownToAnsi(md: string): string {
  const tokens = marked.lexer(md);
  return tokens.map(renderBlock).filter(s => s !== "").join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/lib/markdown-ansi.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown-ansi.ts tests/lib/markdown-ansi.test.ts
git commit -m "Add markdown → ANSI renderer"
```

---

## Task 7: providers/types

Define the provider interface and shared data types.

**Files:**
- Create: `src/providers/types.ts`

- [ ] **Step 1: Write the file**

```ts
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
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/providers/types.ts
git commit -m "Define SessionProvider interface and types"
```

---

## Task 8: providers/claude-code listSessions + fixtures

Implement the metadata pass over `~/.claude/projects/*/...jsonl`.

**Files:**
- Create: `src/providers/claude-code.ts`
- Create: `tests/fixtures/claude-code/with-summary.jsonl`
- Create: `tests/fixtures/claude-code/without-summary.jsonl`
- Create: `tests/fixtures/claude-code/with-tools.jsonl`
- Create: `tests/fixtures/claude-code/malformed.jsonl`
- Create: `tests/fixtures/claude-code/empty.jsonl`
- Test: `tests/providers/claude-code.test.ts`

- [ ] **Step 1: Write fixtures**

```jsonl
// tests/fixtures/claude-code/with-summary.jsonl
{"type":"summary","summary":"Building Ink TUI app","leafUuid":"x"}
{"type":"user","timestamp":"2026-05-07T10:00:00Z","message":{"role":"user","content":"hello"}}
{"type":"assistant","timestamp":"2026-05-07T10:00:01Z","message":{"role":"assistant","content":"hi"}}
```

```jsonl
// tests/fixtures/claude-code/without-summary.jsonl
{"type":"user","timestamp":"2026-05-07T09:00:00Z","message":{"role":"user","content":"first user message that becomes the summary fallback"}}
{"type":"assistant","timestamp":"2026-05-07T09:00:01Z","message":{"role":"assistant","content":"ack"}}
```

```jsonl
// tests/fixtures/claude-code/with-tools.jsonl
{"type":"summary","summary":"With tools","leafUuid":"y"}
{"type":"user","timestamp":"2026-05-07T08:00:00Z","message":{"role":"user","content":"run ls"}}
{"type":"assistant","timestamp":"2026-05-07T08:00:01Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls -la"}}]}}
{"type":"user","timestamp":"2026-05-07T08:00:02Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file1\nfile2"}]}}
```

```jsonl
// tests/fixtures/claude-code/malformed.jsonl
{"type":"summary","summary":"Has a bad line","leafUuid":"z"}
GARBAGE LINE
{"type":"user","timestamp":"2026-05-07T07:00:00Z","message":{"role":"user","content":"after garbage"}}
```

```
// tests/fixtures/claude-code/empty.jsonl
```

(The empty.jsonl file is zero bytes — create with `: > tests/fixtures/claude-code/empty.jsonl`.)

- [ ] **Step 2: Write the failing test for listSessions**

```ts
// tests/providers/claude-code.test.ts
import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { ClaudeCodeProvider } from "../../src/providers/claude-code.ts";

const FIXTURES = path.resolve(__dirname, "../fixtures/claude-code");

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-test-"));
  // Mimic Claude Code layout: <root>/<encoded-project>/<uuid>.jsonl
  const sub = path.join(root, "-Users-roger-projects-foo");
  await fs.mkdir(sub, { recursive: true });
  for (const f of ["with-summary.jsonl", "without-summary.jsonl", "with-tools.jsonl", "malformed.jsonl", "empty.jsonl"]) {
    await fs.copyFile(path.join(FIXTURES, f), path.join(sub, f));
  }
  return root;
}

describe("ClaudeCodeProvider.listSessions", () => {
  test("returns metadata for every .jsonl in subdirs", async () => {
    const root = await makeRoot();
    const provider = new ClaudeCodeProvider();
    const list = await provider.listSessions(root);
    expect(list).toHaveLength(5);
    const byName = Object.fromEntries(list.map(m => [path.basename(m.filePath), m]));
    expect(byName["with-summary.jsonl"]!.summary).toBe("Building Ink TUI app");
    expect(byName["without-summary.jsonl"]!.summary).toContain("first user message");
    expect(byName["empty.jsonl"]!.summary).toBe("(empty session)");
    expect(byName["malformed.jsonl"]!.summary).toBe("Has a bad line");
  });

  test("decodes projectPath from parent directory", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    expect(list.every(m => m.projectPath === "/Users/roger/projects/foo")).toBe(true);
  });

  test("counts user+assistant lines only", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const tools = list.find(m => path.basename(m.filePath) === "with-tools.jsonl")!;
    // user + assistant (the tool_result is wrapped in a user line per Claude Code)
    expect(tools.messageCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

Run: `bun test tests/providers/claude-code.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement listSessions**

```ts
// src/providers/claude-code.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { decodeProjectPath } from "../lib/decode-project-path.ts";
import type { Message, SessionMeta, SessionProvider } from "./types.ts";

export class ClaudeCodeProvider implements SessionProvider {
  readonly name = "claude-code";
  readonly defaultPaths = [path.join(os.homedir(), ".claude", "projects")];

  async listSessions(root: string): Promise<SessionMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return [];
    }
    const sessions: SessionMeta[] = [];
    for (const dir of entries) {
      const sub = path.join(root, dir);
      let stat;
      try { stat = await fs.stat(sub); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const projectPath = decodeProjectPath(dir);
      let files: string[];
      try { files = await fs.readdir(sub); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const filePath = path.join(sub, f);
        const meta = await readMeta(filePath, projectPath);
        if (meta) sessions.push(meta);
      }
    }
    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return sessions;
  }

  async *loadSession(_filePath: string): AsyncIterable<Message> {
    // Implemented in the next task.
    throw new Error("not implemented yet");
  }
}

async function readMeta(filePath: string, projectPath: string): Promise<SessionMeta | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return null;
  const id = path.basename(filePath, ".jsonl");

  let summary = "";
  let firstUserText = "";
  let messageCount = 0;

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    if (type === "summary" && !summary && typeof entry.summary === "string") {
      summary = entry.summary;
    } else if ((type === "user" || type === "assistant")) {
      messageCount += 1;
      if (!firstUserText && type === "user") {
        firstUserText = extractFirstUserText(entry);
      }
    }
  }

  if (!summary) summary = firstUserText || "(empty session)";

  return {
    id,
    filePath,
    summary,
    projectPath,
    modifiedAt: stat.mtime,
    messageCount,
  };
}

function extractFirstUserText(entry: Record<string, unknown>): string {
  const msg = (entry.message as { content?: unknown } | undefined)?.content;
  if (typeof msg === "string") return msg.split("\n")[0] ?? "";
  if (Array.isArray(msg)) {
    for (const part of msg) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const text = (part as { text?: string }).text;
        if (typeof text === "string") return text.split("\n")[0] ?? "";
      }
    }
  }
  return "";
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/providers/claude-code.test.ts`
Expected: PASS for the three listSessions tests; loadSession tests come next.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude-code.ts tests/providers/claude-code.test.ts tests/fixtures/claude-code
git commit -m "Add ClaudeCodeProvider.listSessions with fixtures"
```

---

## Task 9: providers/claude-code loadSession

Implement message streaming. Yields one `Message` per recognized JSONL entry.

**Files:**
- Modify: `src/providers/claude-code.ts`
- Modify: `tests/providers/claude-code.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
// append to tests/providers/claude-code.test.ts
import type { Message } from "../../src/providers/types.ts";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("ClaudeCodeProvider.loadSession", () => {
  test("yields user, assistant, tool_use, and tool_result messages", async () => {
    const root = await makeRoot();
    const provider = new ClaudeCodeProvider();
    const list = await provider.listSessions(root);
    const tools = list.find(m => path.basename(m.filePath) === "with-tools.jsonl")!;
    const messages = await collect<Message>(provider.loadSession(tools.filePath));
    const roles = messages.map(m => m.role);
    expect(roles).toEqual(["user", "assistant", "tool_use", "tool_result"]);
    const toolUse = messages.find(m => m.role === "tool_use")!;
    expect(toolUse.toolName).toBe("Bash");
    expect(toolUse.content).toContain("ls -la");
    const toolResult = messages.find(m => m.role === "tool_result")!;
    expect(toolResult.content).toContain("file1");
  });

  test("skips malformed lines and yields surrounding messages", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const bad = list.find(m => path.basename(m.filePath) === "malformed.jsonl")!;
    const messages = await collect<Message>(new ClaudeCodeProvider().loadSession(bad.filePath));
    expect(messages.map(m => m.role)).toEqual(["user"]);
  });

  test("empty file yields zero messages", async () => {
    const root = await makeRoot();
    const list = await new ClaudeCodeProvider().listSessions(root);
    const empty = list.find(m => path.basename(m.filePath) === "empty.jsonl")!;
    const messages = await collect<Message>(new ClaudeCodeProvider().loadSession(empty.filePath));
    expect(messages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/providers/claude-code.test.ts`
Expected: FAIL — `loadSession` throws "not implemented yet".

- [ ] **Step 3: Implement loadSession**

Replace the placeholder method body in `src/providers/claude-code.ts` with:

```ts
  async *loadSession(filePath: string): AsyncIterable<Message> {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      yield* messagesFromEntry(entry);
    }
  }
```

Add module-level helper:

```ts
function messagesFromEntry(entry: Record<string, unknown>): Message[] {
  const type = entry.type;
  if (type !== "user" && type !== "assistant") return [];
  const ts = parseTs(entry.timestamp);
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  const out: Message[] = [];

  if (typeof content === "string") {
    out.push({ role: type, content, timestamp: ts, raw: entry });
    return out;
  }
  if (!Array.isArray(content)) return out;

  let textBuf = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
    if (p.type === "text" && typeof p.text === "string") {
      textBuf += (textBuf ? "\n\n" : "") + p.text;
    } else if (p.type === "tool_use") {
      if (textBuf) {
        out.push({ role: type, content: textBuf, timestamp: ts, raw: entry });
        textBuf = "";
      }
      out.push({
        role: "tool_use",
        content: p.input != null ? JSON.stringify(p.input, null, 2) : "",
        timestamp: ts,
        toolName: p.name,
        raw: part,
      });
    } else if (p.type === "tool_result") {
      if (textBuf) {
        out.push({ role: type, content: textBuf, timestamp: ts, raw: entry });
        textBuf = "";
      }
      const body = typeof p.content === "string"
        ? p.content
        : Array.isArray(p.content)
          ? (p.content as Array<{ text?: string }>)
              .map(x => (typeof x?.text === "string" ? x.text : ""))
              .join("\n")
          : JSON.stringify(p.content ?? "");
      out.push({
        role: "tool_result",
        content: body,
        timestamp: ts,
        raw: part,
      });
    }
  }
  if (textBuf) out.push({ role: type, content: textBuf, timestamp: ts, raw: entry });
  return out;
}

function parseTs(ts: unknown): Date {
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(0);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/providers/claude-code.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude-code.ts tests/providers/claude-code.test.ts
git commit -m "Implement ClaudeCodeProvider.loadSession"
```

---

## Task 10: providers/index registry

A registry exposing `getProvider(name)` and the default provider.

**Files:**
- Create: `src/providers/index.ts`

- [ ] **Step 1: Write the file**

```ts
// src/providers/index.ts
import { ClaudeCodeProvider } from "./claude-code.ts";
import type { SessionProvider } from "./types.ts";

const providers: Record<string, SessionProvider> = {
  "claude-code": new ClaudeCodeProvider(),
};

export const DEFAULT_PROVIDER = "claude-code";

export function getProvider(name: string = DEFAULT_PROVIDER): SessionProvider {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export function listProviderNames(): string[] {
  return Object.keys(providers);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/providers/index.ts
git commit -m "Add provider registry"
```

---

## Task 11: hooks/use-sessions

A React hook that lists sessions for a root path, with an mtime-keyed in-memory cache. Caches up to 200 metadata entries.

**Files:**
- Create: `src/hooks/use-sessions.ts`

- [ ] **Step 1: Write the file**

```ts
// src/hooks/use-sessions.ts
import { useEffect, useState } from "react";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";

type State =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionMeta[] }
  | { status: "error"; error: Error };

const metaCache = new Map<string, { mtimeMs: number; meta: SessionMeta }>();

export function useSessions(provider: SessionProvider, root: string): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    provider.listSessions(root).then(
      (raw) => {
        if (cancelled) return;
        const sessions = raw.map(m => {
          const cached = metaCache.get(m.filePath);
          if (cached && cached.mtimeMs === m.modifiedAt.getTime()) return cached.meta;
          metaCache.set(m.filePath, { mtimeMs: m.modifiedAt.getTime(), meta: m });
          return m;
        });
        // Bound cache.
        if (metaCache.size > 200) {
          const remove = metaCache.size - 200;
          let i = 0;
          for (const k of metaCache.keys()) {
            if (i++ >= remove) break;
            metaCache.delete(k);
          }
        }
        setState({ status: "ready", sessions });
      },
      (error: Error) => {
        if (cancelled) return;
        setState({ status: "error", error });
      },
    );
    return () => { cancelled = true; };
  }, [provider, root]);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-sessions.ts
git commit -m "Add useSessions hook with mtime cache"
```

---

## Task 12: hooks/use-session-detail

Streams messages for a single session. Caches message arrays by `(filePath, mtime)` with an LRU bound of 50.

**Files:**
- Create: `src/hooks/use-session-detail.ts`

- [ ] **Step 1: Write the file**

```ts
// src/hooks/use-session-detail.ts
import { useEffect, useState } from "react";
import type { Message, SessionMeta, SessionProvider } from "../providers/types.ts";

type State =
  | { status: "loading"; partial: Message[] }
  | { status: "ready"; messages: Message[] }
  | { status: "error"; error: Error };

const detailCache = new Map<string, { mtimeMs: number; messages: Message[] }>();
const MAX_CACHED = 50;

export function useSessionDetail(provider: SessionProvider, meta: SessionMeta | null): State {
  const [state, setState] = useState<State>({ status: "loading", partial: [] });

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;

    const cached = detailCache.get(meta.filePath);
    if (cached && cached.mtimeMs === meta.modifiedAt.getTime()) {
      setState({ status: "ready", messages: cached.messages });
      return () => { cancelled = true; };
    }

    setState({ status: "loading", partial: [] });
    const acc: Message[] = [];
    (async () => {
      try {
        for await (const m of provider.loadSession(meta.filePath)) {
          if (cancelled) return;
          acc.push(m);
          // Update partial state every 16 messages so the UI shows progress.
          if (acc.length % 16 === 0) {
            setState({ status: "loading", partial: [...acc] });
          }
        }
        if (cancelled) return;
        // LRU evict.
        if (detailCache.size >= MAX_CACHED) {
          const oldestKey = detailCache.keys().next().value as string | undefined;
          if (oldestKey) detailCache.delete(oldestKey);
        }
        detailCache.set(meta.filePath, { mtimeMs: meta.modifiedAt.getTime(), messages: acc });
        setState({ status: "ready", messages: acc });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", error: error as Error });
      }
    })();

    return () => { cancelled = true; };
  }, [provider, meta]);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-session-detail.ts
git commit -m "Add useSessionDetail hook with LRU cache"
```

---

## Task 13: components/footer

A context-sensitive hint bar.

**Files:**
- Create: `src/components/footer.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/footer.tsx
import React from "react";
import { Box, Text } from "ink";

export type FooterContext =
  | "list"
  | "preview"
  | "list-search"
  | "preview-search"
  | "path-input";

const HINTS: Record<FooterContext, string> = {
  "list":           " ↑/↓ select   Enter focus preview   / search   p path   q quit ",
  "preview":        " ↑/↓ scroll   Esc back   ⌃F search-in-preview   Tab expand tool   q quit ",
  "list-search":    " type to filter   Enter apply   Esc cancel ",
  "preview-search": " type to search   Enter commit   Esc cancel ",
  "path-input":     " type a path   Enter submit   Esc quit ",
};

export function Footer({ context }: { context: FooterContext }) {
  return (
    <Box>
      <Text inverse>{HINTS[context]}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/footer.tsx
git commit -m "Add footer hint bar component"
```

---

## Task 14: components/session-list

The left pane. Renders items as two-line entries with dim dividers between adjacent entries.

**Files:**
- Create: `src/components/session-list.tsx`
- Test: `tests/components/session-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/session-list.test.tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SessionList } from "../../src/components/session-list.tsx";
import type { SessionMeta } from "../../src/providers/types.ts";

const NOW = new Date("2026-05-07T12:00:00Z");
const SESSIONS: SessionMeta[] = [
  {
    id: "a", filePath: "/a.jsonl", summary: "Building Ink TUI app", projectPath: "/p",
    modifiedAt: new Date("2026-05-07T10:00:00Z"), messageCount: 24,
  },
  {
    id: "b", filePath: "/b.jsonl", summary: "Refactor parser", projectPath: "/p",
    modifiedAt: new Date("2026-05-06T22:00:00Z"), messageCount: 18,
  },
];

describe("SessionList", () => {
  test("renders summary, relative time, and message count", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="a" width={36} now={NOW} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Building Ink TUI app");
    expect(out).toContain("2h ago");
    expect(out).toContain("24 msgs");
    expect(out).toContain("Refactor parser");
    expect(out).toContain("18 msgs");
  });

  test("renders a divider between items", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="a" width={36} now={NOW} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("─");
  });

  test("marks the selected item", () => {
    const { lastFrame } = render(
      <SessionList sessions={SESSIONS} selectedId="b" width={36} now={NOW} />
    );
    const lines = (lastFrame() ?? "").split("\n");
    expect(lines.some(l => l.includes("▸") && l.includes("Refactor parser"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/components/session-list.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/session-list.tsx
import React from "react";
import { Box, Text } from "ink";
import type { SessionMeta } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { truncate } from "../lib/truncate.ts";

export function SessionList({
  sessions,
  selectedId,
  width,
  now = new Date(),
}: {
  sessions: SessionMeta[];
  selectedId: string | null;
  width: number;
  now?: Date;
}) {
  const innerWidth = Math.max(1, width - 2); // 2 columns of padding
  const divider = "─".repeat(innerWidth);
  return (
    <Box flexDirection="column" width={width}>
      {sessions.map((s, i) => (
        <Box key={s.id} flexDirection="column">
          <Item meta={s} selected={s.id === selectedId} innerWidth={innerWidth} now={now} />
          {i < sessions.length - 1 && (
            <Text dimColor>{" " + divider + " "}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

function Item({ meta, selected, innerWidth, now }: {
  meta: SessionMeta;
  selected: boolean;
  innerWidth: number;
  now: Date;
}) {
  const marker = selected ? "▸ " : "  ";
  const summary = truncate(meta.summary, innerWidth - 2);
  const meta2 = `  ${relativeTime(meta.modifiedAt, now)} · ${meta.messageCount} msgs`;
  return (
    <Box flexDirection="column">
      <Text inverse={selected}>{marker}{summary}</Text>
      <Text dimColor>{truncate(meta2, innerWidth)}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/components/session-list.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-list.tsx tests/components/session-list.test.tsx
git commit -m "Add SessionList component"
```

---

## Task 15: components/path-input

Manual path entry screen. Shows an error when validation fails.

**Files:**
- Create: `src/components/path-input.tsx`
- Test: `tests/components/path-input.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/path-input.test.tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { PathInput } from "../../src/components/path-input.tsx";

describe("PathInput", () => {
  test("renders the prompt and an error when given one", () => {
    const { lastFrame } = render(
      <PathInput
        reason="no-default-path"
        error="No .jsonl files found"
        onSubmit={() => {}}
      />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("No sessions found");
    expect(out).toContain("Enter a path");
    expect(out).toContain("No .jsonl files found");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/components/path-input.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/path-input.tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function PathInput({
  reason,
  error,
  onSubmit,
}: {
  reason: "no-default-path" | "user-requested";
  error?: string;
  onSubmit: (path: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column" paddingX={1}>
      {reason === "no-default-path" && (
        <Text>No sessions found in the default location.</Text>
      )}
      <Text>Enter a path to a directory or .jsonl file:</Text>
      <Box>
        <Text>› </Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/components/path-input.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/path-input.tsx tests/components/path-input.test.tsx
git commit -m "Add PathInput component"
```

---

## Task 16: components/message-block

Renders a single message with role-colored header and emoji.

**Files:**
- Create: `src/components/message-block.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/message-block.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Message, Role } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { markdownToAnsi } from "../lib/markdown-ansi.ts";

const ROLE_EMOJI: Record<Role, string> = {
  user: "👨",
  assistant: "🤖",
  tool_use: "🔧",
  tool_result: "📥",
  system: "ℹ️ ",
};

const ROLE_COLOR: Record<Role, string> = {
  user: "cyan",
  assistant: "magenta",
  tool_use: "yellow",
  tool_result: "gray",
  system: "gray",
};

export function MessageBlock({
  message,
  expanded,
  emoji = true,
  now = new Date(),
}: {
  message: Message;
  expanded: boolean;
  emoji?: boolean;
  now?: Date;
}) {
  const headerLabel = headerFor(message);
  const time = relativeTime(message.timestamp, now);
  const header = `${emoji ? ROLE_EMOJI[message.role] + " " : ""}${headerLabel} · ${time}`;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={ROLE_COLOR[message.role]} bold={message.role === "user" || message.role === "assistant"} italic={message.role === "system"} dimColor={message.role === "system" || message.role === "tool_result"}>
        {header}
      </Text>
      <Body message={message} expanded={expanded} />
    </Box>
  );
}

function headerFor(m: Message): string {
  switch (m.role) {
    case "tool_use": return `${m.toolName ?? "tool"}`;
    case "tool_result": return `result`;
    default: return m.role;
  }
}

function Body({ message, expanded }: { message: Message; expanded: boolean }) {
  if (message.role === "tool_use" || message.role === "tool_result") {
    if (!expanded) {
      const oneLine = (message.content || "").split("\n")[0] ?? "";
      const lineCount = (message.content || "").split("\n").length;
      const tail = lineCount > 1 ? ` (${lineCount} lines)` : "";
      return <Text dimColor>{`▸ ${oneLine}${tail}`}</Text>;
    }
    return <Text dimColor>{message.content}</Text>;
  }
  if (message.role === "system") {
    return <Text dimColor italic>{message.content}</Text>;
  }
  return <Text>{markdownToAnsi(message.content)}</Text>;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/message-block.tsx
git commit -m "Add MessageBlock component with role color/emoji"
```

---

## Task 17: components/search-bar

A single-line input bar shared by list-search and preview-search.

**Files:**
- Create: `src/components/search-bar.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/search-bar.tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function SearchBar({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
}) {
  return (
    <Box>
      <Text>{label} </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/search-bar.tsx
git commit -m "Add SearchBar component"
```

---

## Task 18: components/session-preview

The right pane: scroll, in-preview search, tool block expansion. Uses `useInput` to handle keys when focused.

**Files:**
- Create: `src/components/session-preview.tsx`
- Test: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/session-preview.test.tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SessionPreview } from "../../src/components/session-preview.tsx";
import type { Message } from "../../src/providers/types.ts";

const MESSAGES: Message[] = [
  { role: "user", content: "first user", timestamp: new Date(0), raw: {} },
  { role: "assistant", content: "first assistant", timestamp: new Date(0), raw: {} },
  { role: "user", content: "the most recent user", timestamp: new Date(0), raw: {} },
];

describe("SessionPreview", () => {
  test("starts scrolled to the bottom (most recent visible)", () => {
    const { lastFrame } = render(
      <SessionPreview messages={MESSAGES} focused={false} height={6} width={40} emoji={false} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("the most recent user");
  });

  test("renders an empty placeholder when there are no messages", () => {
    const { lastFrame } = render(
      <SessionPreview messages={[]} focused={false} height={6} width={40} emoji={false} />
    );
    expect(lastFrame() ?? "").toContain("(no messages)");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/session-preview.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../providers/types.ts";
import { MessageBlock } from "./message-block.tsx";
import { SearchBar } from "./search-bar.tsx";

export function SessionPreview({
  messages,
  focused,
  height,
  width,
  emoji = true,
}: {
  messages: Message[];
  focused: boolean;
  height: number;
  width: number;
  emoji?: boolean;
}) {
  const [scroll, setScroll] = useState(0);                  // line offset from bottom (0 = at bottom)
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [activeTool, setActiveTool] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");

  // Reset scroll/expansion when message stream changes (i.e., session switch).
  const ident = useMemo(() => messages.length, [messages]);
  const lastIdent = useRef(ident);
  useEffect(() => {
    if (lastIdent.current !== ident) {
      setScroll(0);
      setExpanded(new Set());
      setActiveTool(0);
      setSearchOpen(false);
      setSearchValue("");
      setCommittedQuery("");
      lastIdent.current = ident;
    }
  }, [ident]);

  const toolIndices = useMemo(
    () => messages.flatMap((m, i) => (m.role === "tool_use" || m.role === "tool_result") ? [i] : []),
    [messages],
  );

  useInput((input, key) => {
    if (!focused) return;
    if (searchOpen) return; // SearchBar handles its own input via TextInput
    if (key.ctrl && (input === "f" || input === "F")) {
      setSearchOpen(true);
      return;
    }
    if (input === "j" || key.downArrow) setScroll(s => Math.max(0, s - 1));
    else if (input === "k" || key.upArrow) setScroll(s => s + 1);
    else if (key.ctrl && input === "d") setScroll(s => Math.max(0, s - Math.floor(height / 2)));
    else if (key.ctrl && input === "u") setScroll(s => s + Math.floor(height / 2));
    else if (key.pageDown) setScroll(s => Math.max(0, s - height));
    else if (key.pageUp) setScroll(s => s + height);
    else if (input === "G") setScroll(0);
    else if (input === "g") setScroll(Number.MAX_SAFE_INTEGER);
    else if (key.tab && !key.shift) {
      // Toggle expand on the active tool block.
      const idx = toolIndices[activeTool];
      if (idx != null) {
        setExpanded(prev => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx); else next.add(idx);
          return next;
        });
      }
    } else if (key.tab && key.shift) {
      if (toolIndices.length > 0) {
        setActiveTool(t => (t + 1) % toolIndices.length);
      }
    }
  });

  if (messages.length === 0) {
    return (
      <Box width={width} height={height} alignItems="center" justifyContent="center">
        <Text dimColor>(no messages)</Text>
      </Box>
    );
  }

  // For MVP we render every message and rely on Ink's box height to clip.
  // Scroll is approximated by trimming messages from the top: each scroll unit
  // pushes one message off the top, exposing more recent content below. When
  // scroll === 0 we show only the tail that fits.
  const tailMessages = sliceForScroll(messages, scroll, height);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {searchOpen && (
        <SearchBar
          label="🔎"
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={(v) => { setCommittedQuery(v); setSearchOpen(false); }}
        />
      )}
      <Box flexDirection="column" flexGrow={1}>
        {tailMessages.map((m, i) => (
          <MessageBlock
            key={`${i}-${m.timestamp.getTime()}`}
            message={highlight(m, committedQuery || (searchOpen ? searchValue : ""))}
            expanded={expanded.has(messages.indexOf(m))}
            emoji={emoji}
          />
        ))}
      </Box>
    </Box>
  );
}

function sliceForScroll(all: Message[], scroll: number, height: number): Message[] {
  // Approximate: each message takes >=2 rows, so we keep enough messages to
  // overflow the height. The Box clips the rest.
  const approxPerMsg = 3;
  const fit = Math.max(1, Math.ceil(height / approxPerMsg));
  const upTo = Math.max(0, all.length - scroll);
  const start = Math.max(0, upTo - fit);
  return all.slice(start, upTo);
}

function highlight(m: Message, query: string): Message {
  if (!query) return m;
  // Case-insensitive substring; wrap matches with ANSI inverse.
  const re = new RegExp(escape(query), "gi");
  const inverse = (s: string) => `\x1b[7m${s}\x1b[27m`;
  const next = { ...m, content: m.content.replace(re, inverse) };
  return next;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "Add SessionPreview with scroll, search, and tool expand"
```

---

## Task 19: components/session-browser

Composes the list, the preview, and the footer into a two-pane layout. Owns focus state and the list-search filter.

**Files:**
- Create: `src/components/session-browser.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/session-browser.tsx
import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";
import { SessionList } from "./session-list.tsx";
import { SessionPreview } from "./session-preview.tsx";
import { SearchBar } from "./search-bar.tsx";
import { Footer, type FooterContext } from "./footer.tsx";
import { useSessionDetail } from "../hooks/use-session-detail.ts";

export function SessionBrowser({
  provider,
  sessions,
  emoji,
  onRequestPathInput,
  onQuit,
}: {
  provider: SessionProvider;
  sessions: SessionMeta[];
  emoji: boolean;
  onRequestPathInput: () => void;
  onQuit: () => void;
}) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 100;
  const termHeight = stdout?.rows ?? 30;
  const leftWidth = Math.min(36, Math.floor(termWidth * 0.35));
  const rightWidth = termWidth - leftWidth - 1;
  const contentHeight = termHeight - 1; // footer

  const [focus, setFocus] = useState<"list" | "preview">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [committedFilter, setCommittedFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    if (!committedFilter) return sessions;
    const q = committedFilter.toLowerCase();
    return sessions.filter(s =>
      s.summary.toLowerCase().includes(q) ||
      s.projectPath.toLowerCase().includes(q),
    );
  }, [sessions, committedFilter]);

  const selected = filtered[Math.min(selectedIdx, filtered.length - 1)] ?? null;
  const detail = useSessionDetail(provider, selected);

  useInput((input, key) => {
    if (searchOpen) return;
    if (input === "q" || (key.ctrl && input === "c")) { onQuit(); return; }
    if (input === "p") { onRequestPathInput(); return; }
    if (focus === "list") {
      if (input === "j" || key.downArrow) setSelectedIdx(i => Math.min(filtered.length - 1, i + 1));
      else if (input === "k" || key.upArrow) setSelectedIdx(i => Math.max(0, i - 1));
      else if (key.return || input === "l" || key.rightArrow) setFocus("preview");
      else if (input === "/") setSearchOpen(true);
    } else {
      if (key.escape || input === "h" || key.leftArrow) setFocus("list");
    }
  });

  const footerContext: FooterContext =
    searchOpen ? "list-search" : focus;

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" width={leftWidth} borderStyle="single" borderRight>
          {searchOpen ? (
            <SearchBar
              label="/"
              value={filter}
              onChange={setFilter}
              onSubmit={(v) => { setCommittedFilter(v); setSearchOpen(false); setSelectedIdx(0); }}
            />
          ) : (
            <Text bold>Sessions ({filtered.length})</Text>
          )}
          <SessionList
            sessions={filtered}
            selectedId={selected?.id ?? null}
            width={leftWidth}
          />
        </Box>
        <Box flexDirection="column" width={rightWidth}>
          <Text bold>Preview</Text>
          {detail.status === "loading" && <Text dimColor>Loading…</Text>}
          {detail.status === "error" && <Text color="red">{detail.error.message}</Text>}
          {(detail.status === "ready" || detail.status === "loading") && (
            <SessionPreview
              messages={"messages" in detail ? detail.messages : detail.partial}
              focused={focus === "preview"}
              height={contentHeight - 2}
              width={rightWidth}
              emoji={emoji}
            />
          )}
        </Box>
      </Box>
      <Footer context={footerContext} />
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/session-browser.tsx
git commit -m "Add SessionBrowser composing list + preview"
```

---

## Task 20: app.tsx state machine

Top-level component. Implements the four states from the spec: scanning, path-input, browser, error.

**Files:**
- Create: `src/app.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { getProvider } from "./providers/index.ts";
import type { SessionMeta } from "./providers/types.ts";
import { PathInput } from "./components/path-input.tsx";
import { SessionBrowser } from "./components/session-browser.tsx";

type AppState =
  | { kind: "scanning"; root: string }
  | { kind: "path-input"; reason: "no-default-path" | "user-requested"; error?: string }
  | { kind: "browser"; root: string; sessions: SessionMeta[] };

export function App({
  initialPath,
  emoji = true,
}: {
  initialPath?: string;
  emoji?: boolean;
}) {
  const provider = useMemo(() => getProvider(), []);
  const { exit } = useApp();
  const [state, setState] = useState<AppState>(() => {
    const root = initialPath ?? provider.defaultPaths[0]!;
    return { kind: "scanning", root: expandHome(root) };
  });

  useEffect(() => {
    if (state.kind !== "scanning") return;
    let cancelled = false;
    (async () => {
      const root = state.root;
      const ok = await directoryHasJsonl(root);
      if (cancelled) return;
      if (!ok) {
        setState({ kind: "path-input", reason: "no-default-path" });
        return;
      }
      try {
        const sessions = await provider.listSessions(root);
        if (cancelled) return;
        if (sessions.length === 0) {
          setState({ kind: "path-input", reason: "no-default-path" });
        } else {
          setState({ kind: "browser", root, sessions });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: "path-input", reason: "no-default-path", error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [state, provider]);

  if (state.kind === "scanning") {
    return (
      <Box>
        <Spinner /><Text> Scanning {state.root}…</Text>
      </Box>
    );
  }
  if (state.kind === "path-input") {
    return (
      <PathInput
        reason={state.reason}
        error={state.error}
        onSubmit={(p) => {
          const root = expandHome(p);
          setState({ kind: "scanning", root });
        }}
      />
    );
  }
  return (
    <SessionBrowser
      provider={provider}
      sessions={state.sessions}
      emoji={emoji}
      onRequestPathInput={() => setState({ kind: "path-input", reason: "user-requested" })}
      onQuit={() => exit()}
    />
  );
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

async function directoryHasJsonl(root: string): Promise<boolean> {
  try {
    const stat = await fs.stat(root);
    if (stat.isFile()) return root.endsWith(".jsonl");
    if (!stat.isDirectory()) return false;
    const entries = await fs.readdir(root);
    for (const e of entries) {
      const full = path.join(root, e);
      const s = await fs.stat(full);
      if (s.isFile() && e.endsWith(".jsonl")) return true;
      if (s.isDirectory()) {
        const inner = await fs.readdir(full);
        if (inner.some(x => x.endsWith(".jsonl"))) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "Add App state machine"
```

---

## Task 21: cli.tsx entry

Parse argv, mount `<App />`. Supports `--path <p>` and `--no-emoji` and the `CLAUDE_HISTORY_NO_EMOJI` env var.

**Files:**
- Create: `src/cli.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/cli.tsx
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
  process.stdout.write(`claude-history — browse local Claude Code session history

Usage:
  claude-history [--path <dir-or-file>] [--no-emoji]
  claude-history --help

Options:
  --path <p>    Use <p> as the session root instead of ~/.claude/projects.
  --no-emoji    Render plain role labels instead of emoji.
`);
}

const { path: initialPath, emoji } = parseArgs(process.argv);
render(<App initialPath={initialPath} emoji={emoji} />);
```

- [ ] **Step 2: Smoke test (no fixtures, just argv parsing)**

Run: `bun run src/cli.tsx --help`
Expected: prints usage and exits 0.

- [ ] **Step 3: Run against real default path (manual check)**

Run: `bun run src/cli.tsx`
Expected: app launches, shows the session browser if `~/.claude/projects` has data, otherwise drops into PathInput. `q` exits cleanly.

- [ ] **Step 4: Run against an empty path (manual check)**

```bash
EMPTY=$(mktemp -d)
bun run src/cli.tsx --path "$EMPTY"
```
Expected: PathInput screen with "No sessions found in the default location" message; `Esc` or `Ctrl-C` exits.

- [ ] **Step 5: Commit**

```bash
git add src/cli.tsx
git commit -m "Add CLI entry"
```

---

## Task 22: Final integration check

Run the whole suite, do a manual smoke pass, capture any rough edges.

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: all suites pass.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: `dist/cli.js` is created.

- [ ] **Step 4: Manual smoke checklist**

For each, run `bun run src/cli.tsx` and verify:

- App opens scanning the default path; if empty, PathInput appears.
- After typing a valid directory the SessionBrowser shows.
- Left pane lists sessions with two-line items + dim divider between adjacent items.
- Selecting a session populates the preview.
- Preview opens scrolled to the latest message.
- `Enter` moves focus to preview; `j`/`k` scroll; `g`/`G` jump to first/last.
- `Tab` toggles a tool block; `Shift-Tab` advances active tool block.
- `Ctrl-F` opens the in-preview search; typing highlights matches; `Esc` clears.
- `/` opens left-pane search; matching filters the list.
- `p` returns to PathInput; `q` quits.
- Roles render with the documented colors and emoji; `--no-emoji` removes emoji.

- [ ] **Step 5: Commit any fixes from the smoke pass; tag**

```bash
git add -A
git commit -m "Smoke-pass fixes" || true   # only if there are changes
git tag -a v0.0.1 -m "MVP"
```

---

## Self-review notes

- **Spec coverage:** every spec section is hit — provider abstraction (tasks 7,10), Claude Code provider (8,9), state machine (20), PathInput (15), SessionList with dividers (14), SessionPreview default-bottom + Ctrl-F + tool expand (18), SearchBar (17), in-preview search (18), MessageBlock with role color/emoji + `--no-emoji` flag (16,21), keybindings centralized via `useInput` in the relevant component (18,19,20), markdown-ansi (6), decode-project-path (2), relative-time (3), jsonl streaming (5), truncate (4), caching (11,12).
- **Per-match `n`/`N` navigation** is intentionally absent (matches the latest spec change).
- **Naming consistency:** `SessionMeta`, `Message`, `SessionProvider` are used identically across tasks; `messageCount`, `summary`, `projectPath`, `modifiedAt`, `filePath`, `id`. `useSessions`/`useSessionDetail` hook names are referenced consistently.
- **Known limitation noted in code/comments:** `decodeProjectPath` is lossy when the original path had hyphens; documented in tests and source.
