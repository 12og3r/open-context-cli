# Session Preview Search Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redo the Ctrl+F session preview search so it shows match counts, lets the user navigate matches with arrow keys, and keeps highlights visible until the user moves on.

**Architecture:** Compute `Match[]` from raw message content (not from rendered ANSI), pass `matchIndex` through `renderConversation`, render the current match with yellow-on-black while the rest stay reverse-video. Replace `ink-text-input` with a custom minimal input so we can intercept ↑↓←→ for match navigation. SessionPreview owns three states (browse / search-open / afterglow) and the transitions between them.

**Tech Stack:** ink 5, React 18, `bun:test`, `ink-testing-library`, `wrap-ansi`, raw ANSI escape codes.

**Spec:** `docs/superpowers/specs/2026-05-08-session-preview-search-design.md`

---

## File Layout

| File | Status | Responsibility |
|---|---|---|
| `src/lib/matches.ts` | Create | `findMatches()` walks raw messages, returns `Match[]` |
| `src/lib/render-message.ts` | Modify | `applyHighlight` accepts `matchIndex` and styles the current match yellow; `renderConversation` returns `matches` and accepts `matchIndex` |
| `src/components/minimal-input.tsx` | Create | One-line text input that exposes `onPrev`/`onNext`/`onSubmit`/`onCancel` and surrenders ↑↓←← to the parent |
| `src/components/search-bar.tsx` | Modify | Hosts `MinimalInput`, shows right-aligned counter, red on zero matches |
| `src/components/session-preview.tsx` | Modify | Adds `matches`/`matchIndex` state, three-state machine, key handling |
| `tests/lib/matches.test.ts` | Create | Tests for `findMatches` |
| `tests/lib/render-message.test.ts` | Create | Tests for highlight styling |
| `tests/components/minimal-input.test.tsx` | Create | Tests for the custom input |
| `tests/components/search-bar.test.tsx` | Create | Tests for counter and zero-state |
| `tests/components/session-preview.test.tsx` | Modify | Adds search-flow integration tests |

---

## ANSI Code Reference

Used throughout the plan. Define once here so every task can refer back.

```ts
const RESET = "\x1b[0m";
const INVERSE = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";
const FG_BLACK = "\x1b[30m";
const FG_DEFAULT = "\x1b[39m";
const BG_YELLOW = "\x1b[43m";
const BG_DEFAULT = "\x1b[49m";
const FG_RED = "\x1b[31m";

const CURRENT_OPEN = BG_YELLOW + FG_BLACK;       // "\x1b[43m\x1b[30m"
const CURRENT_CLOSE = BG_DEFAULT + FG_DEFAULT;   // "\x1b[49m\x1b[39m"
```

Rationale: `BG_DEFAULT`/`FG_DEFAULT` close only the colors we set, leaving any ambient bold/italic intact. Same idempotent property `INVERSE_OFF` already has.

---

### Task 1: Match type and `findMatches` helper

**Files:**
- Create: `src/lib/matches.ts`
- Test: `tests/lib/matches.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/matches.test.ts
import { describe, expect, test } from "bun:test";
import { findMatches } from "../../src/lib/matches.ts";
import type { Message } from "../../src/providers/types.ts";

const msg = (content: string): Message => ({
  role: "user", content, timestamp: new Date(0), raw: {},
});

describe("findMatches", () => {
  test("returns empty array when query is empty", () => {
    expect(findMatches([msg("hello")], "")).toEqual([]);
  });

  test("finds single occurrence", () => {
    const out = findMatches([msg("hello world")], "world");
    expect(out).toEqual([{ msgIndex: 0, contentOffset: 6, length: 5 }]);
  });

  test("finds multiple occurrences in same message in order", () => {
    const out = findMatches([msg("aa bb aa cc aa")], "aa");
    expect(out.map(m => m.contentOffset)).toEqual([0, 6, 12]);
  });

  test("matches across messages preserve msgIndex", () => {
    const out = findMatches(
      [msg("first useState"), msg("no match"), msg("useState here")],
      "useState",
    );
    expect(out).toEqual([
      { msgIndex: 0, contentOffset: 6, length: 8 },
      { msgIndex: 2, contentOffset: 0, length: 8 },
    ]);
  });

  test("is case-insensitive", () => {
    const out = findMatches([msg("UseState use_state useState")], "useState");
    expect(out.map(m => m.contentOffset)).toEqual([0, 19]);
  });

  test("escapes regex metacharacters in query", () => {
    const out = findMatches([msg("a.b a.b")], ".");
    expect(out.length).toBe(2);
    const reMeta = findMatches([msg("a.b acb")], "a.b");
    expect(reMeta).toEqual([{ msgIndex: 0, contentOffset: 0, length: 3 }]);
  });

  test("handles overlapping query without infinite loop", () => {
    const out = findMatches([msg("aaaa")], "aa");
    expect(out.map(m => m.contentOffset)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lib/matches.test.ts`
Expected: FAIL with import error (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/matches.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/matches.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/matches.ts tests/lib/matches.test.ts
git commit -m "Add findMatches helper for query-to-Match[] mapping"
```

---

### Task 2: Style current match yellow, others reverse-video

**Files:**
- Modify: `src/lib/render-message.ts` (replace `applyHighlight`)
- Test: `tests/lib/render-message.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/render-message.test.ts
import { describe, expect, test } from "bun:test";
import { applyHighlight } from "../../src/lib/render-message.ts";
import type { Message } from "../../src/providers/types.ts";

const msg = (content: string): Message => ({
  role: "user", content, timestamp: new Date(0), raw: {},
});

describe("applyHighlight", () => {
  test("returns messages unchanged when query is empty", () => {
    const ms = [msg("hello")];
    const r = applyHighlight(ms, "", -1);
    expect(r.messages[0]?.content).toBe("hello");
    expect(r.matches).toEqual([]);
  });

  test("wraps non-current matches in INVERSE", () => {
    const r = applyHighlight([msg("aa bb aa")], "aa", 1);
    // current is index 1 (second occurrence) → yellow; first stays INVERSE
    expect(r.messages[0]?.content).toContain("\x1b[7maa\x1b[27m");
    expect(r.messages[0]?.content).toContain("\x1b[43m\x1b[30maa\x1b[49m\x1b[39m");
  });

  test("wraps current match in yellow-on-black", () => {
    const r = applyHighlight([msg("hello world hello")], "hello", 0);
    expect(r.messages[0]?.content.indexOf("\x1b[43m\x1b[30mhello\x1b[49m\x1b[39m")).toBe(0);
  });

  test("matchIndex of -1 makes every match reverse-video", () => {
    const r = applyHighlight([msg("aa aa")], "aa", -1);
    expect(r.messages[0]?.content).not.toContain("\x1b[43m");
    expect((r.messages[0]?.content.match(/\x1b\[7m/g) ?? []).length).toBe(2);
  });

  test("returns matches with stable indices across messages", () => {
    const ms = [msg("hi hi"), msg("hi")];
    const r = applyHighlight(ms, "hi", 2);
    expect(r.matches).toEqual([
      { msgIndex: 0, contentOffset: 0, length: 2 },
      { msgIndex: 0, contentOffset: 3, length: 2 },
      { msgIndex: 1, contentOffset: 0, length: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lib/render-message.test.ts`
Expected: FAIL — `applyHighlight` is not exported, signature mismatch.

- [ ] **Step 3: Replace `applyHighlight` in `src/lib/render-message.ts`**

Replace the bottom block (`INVERSE`, `INVERSE_OFF`, `applyHighlight`, `escapeRegex`) with:

```ts
const INVERSE = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";
const CURRENT_OPEN = "\x1b[43m\x1b[30m";   // yellow bg, black fg
const CURRENT_CLOSE = "\x1b[49m\x1b[39m";  // default bg, default fg

import { findMatches, type Match } from "./matches.ts";

export function applyHighlight(
  messages: Message[],
  query: string,
  matchIndex: number,
): { messages: Message[]; matches: Match[] } {
  if (!query) return { messages, matches: [] };
  const matches = findMatches(messages, query);
  if (matches.length === 0) return { messages, matches };

  // Group matches by msgIndex for one pass per affected message.
  const byMsg = new Map<number, Array<{ m: Match; globalIdx: number }>>();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    let arr = byMsg.get(m.msgIndex);
    if (!arr) { arr = []; byMsg.set(m.msgIndex, arr); }
    arr.push({ m, globalIdx: i });
  }

  const newMessages = messages.map((m, i) => {
    const list = byMsg.get(i);
    if (!list) return m;
    let result = "";
    let cursor = 0;
    for (const { m: match, globalIdx } of list) {
      result += m.content.slice(cursor, match.contentOffset);
      const isCurrent = globalIdx === matchIndex;
      const open = isCurrent ? CURRENT_OPEN : INVERSE;
      const close = isCurrent ? CURRENT_CLOSE : INVERSE_OFF;
      result +=
        open +
        m.content.slice(match.contentOffset, match.contentOffset + match.length) +
        close;
      cursor = match.contentOffset + match.length;
    }
    result += m.content.slice(cursor);
    return { ...m, content: result };
  });

  return { messages: newMessages, matches };
}
```

Also export `applyHighlight` (it's already exported per current call site? Verify — currently it's local, used by `renderConversation`. Mark it `export` so the test can import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/render-message.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run full test suite to make sure nothing else broke**

Run: `bun test`
Expected: All previous tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render-message.ts tests/lib/render-message.test.ts
git commit -m "Style current match yellow-on-black, others reverse-video"
```

---

### Task 3: Plumb `matches` and `matchIndex` through `renderConversation`

**Files:**
- Modify: `src/lib/render-message.ts` (`renderConversation`)
- Modify: `src/components/session-preview.tsx` (call site — minimal change to keep compiling)

- [ ] **Step 1: Update `renderConversation` signature and body**

Change in `src/lib/render-message.ts`:

```ts
export function renderConversation(
  messages: Message[],
  opts: {
    width: number;
    expanded: Set<number>;
    emoji: boolean;
    now: Date;
    query: string;
    matchIndex: number;          // NEW
  },
): {
  lines: string[];
  startLine: number[];
  endLine: number[];
  matches: Match[];              // NEW
} {
  const { messages: hl, matches } = applyHighlight(messages, opts.query, opts.matchIndex);
  const lines: string[] = [];
  const startLine: number[] = new Array(hl.length);
  const endLine: number[] = new Array(hl.length);
  for (let i = 0; i < hl.length; i++) {
    startLine[i] = lines.length;
    const msgLines = renderMessageLines(hl[i]!, {
      width: opts.width,
      current: false,
      expanded: opts.expanded.has(i),
      emoji: opts.emoji,
      now: opts.now,
    });
    for (const ml of msgLines) lines.push(ml);
    endLine[i] = lines.length;
  }
  return { lines, startLine, endLine, matches };
}
```

- [ ] **Step 2: Update the only call site in `session-preview.tsx`**

Find the `useMemo` block that calls `renderConversation` (around line 52) and add `matchIndex: -1`:

```ts
const buffer = useMemo(
  () =>
    renderConversation(messages, {
      width,
      expanded,
      emoji,
      now: new Date(),
      query,
      matchIndex: -1,         // overwritten in later tasks
    }),
  [messages, width, expanded, emoji, query],
);
```

- [ ] **Step 3: Run typecheck and tests**

Run: `bun run typecheck && bun test`
Expected: No type errors; all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/render-message.ts src/components/session-preview.tsx
git commit -m "Thread matchIndex into renderConversation, return matches"
```

---

### Task 4: `MinimalInput` component

**Files:**
- Create: `src/components/minimal-input.tsx`
- Test: `tests/components/minimal-input.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/minimal-input.test.tsx
import { describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { MinimalInput } from "../../src/components/minimal-input.tsx";

const tick = () => new Promise(r => setTimeout(r, 30));

function Harness({ onSubmit, onCancel, onPrev, onNext }: {
  onSubmit?: () => void; onCancel?: () => void;
  onPrev?: () => void; onNext?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <MinimalInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit ?? (() => {})}
      onCancel={onCancel ?? (() => {})}
      onPrev={onPrev ?? (() => {})}
      onNext={onNext ?? (() => {})}
    />
  );
}

describe("MinimalInput", () => {
  test("appends typed characters and renders them", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write("abc");
    await tick();
    expect(lastFrame() ?? "").toContain("abc");
  });

  test("Backspace removes the last character", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write("abc");
    await tick();
    stdin.write("\x7f"); // DEL is what most terminals send for backspace
    await tick();
    expect(lastFrame() ?? "").toContain("ab");
    expect(lastFrame() ?? "").not.toMatch(/abc/);
  });

  test("Enter calls onSubmit", async () => {
    let submitted = false;
    const { stdin } = render(<Harness onSubmit={() => { submitted = true; }} />);
    stdin.write("\r");
    await tick();
    expect(submitted).toBe(true);
  });

  test("Esc calls onCancel", async () => {
    let cancelled = false;
    const { stdin } = render(<Harness onCancel={() => { cancelled = true; }} />);
    stdin.write("\x1b");
    await tick();
    expect(cancelled).toBe(true);
  });

  test("up arrow and left arrow both call onPrev", async () => {
    let prev = 0;
    const { stdin } = render(<Harness onPrev={() => { prev++; }} />);
    stdin.write("\x1b[A"); // up
    await tick();
    stdin.write("\x1b[D"); // left
    await tick();
    expect(prev).toBe(2);
  });

  test("down arrow and right arrow both call onNext", async () => {
    let nxt = 0;
    const { stdin } = render(<Harness onNext={() => { nxt++; }} />);
    stdin.write("\x1b[B"); // down
    await tick();
    stdin.write("\x1b[C"); // right
    await tick();
    expect(nxt).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/components/minimal-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/minimal-input.tsx
import React from "react";
import { Text, useInput } from "ink";

export function MinimalInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  onPrev,
  onNext,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useInput((input, key) => {
    if (key.return) onSubmit();
    else if (key.escape) onCancel();
    else if (key.upArrow || key.leftArrow) onPrev();
    else if (key.downArrow || key.rightArrow) onNext();
    else if (key.backspace || key.delete) onChange(value.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) onChange(value + input);
  });

  return (
    <Text>
      {value}
      <Text inverse> </Text>
    </Text>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/components/minimal-input.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/minimal-input.tsx tests/components/minimal-input.test.tsx
git commit -m "Add MinimalInput surrendering arrows/Enter/Esc to parent"
```

---

### Task 5: Update `SearchBar` to host `MinimalInput` and a counter

**Files:**
- Modify: `src/components/search-bar.tsx`
- Test: `tests/components/search-bar.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/search-bar.test.tsx
import { describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { SearchBar } from "../../src/components/search-bar.tsx";

const tick = () => new Promise(r => setTimeout(r, 30));

function Harness(props: {
  matchIndex?: number;
  matchCount?: number;
}) {
  const [value, setValue] = useState("useState");
  return (
    <SearchBar
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      onCancel={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
      matchIndex={props.matchIndex ?? 0}
      matchCount={props.matchCount ?? 0}
    />
  );
}

describe("SearchBar", () => {
  test("renders the magnifying glass and the typed query", () => {
    const { lastFrame } = render(<Harness matchCount={5} matchIndex={2} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("🔎");
    expect(out).toContain("useState");
  });

  test("shows the counter when there are matches", () => {
    const { lastFrame } = render(<Harness matchIndex={2} matchCount={5} />);
    expect(lastFrame() ?? "").toContain("3 / 5");
  });

  test("shows 0 / 0 in red when there are zero matches", () => {
    const { lastFrame } = render(<Harness matchIndex={-1} matchCount={0} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("0 / 0");
    expect(out).toContain("\x1b[31m"); // FG_RED
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/components/search-bar.test.tsx`
Expected: FAIL — `SearchBar` props mismatch.

- [ ] **Step 3: Replace `src/components/search-bar.tsx`**

```tsx
// src/components/search-bar.tsx
import React from "react";
import { Box, Text } from "ink";
import { MinimalInput } from "./minimal-input.tsx";

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  onPrev,
  onNext,
  matchIndex,
  matchCount,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
  matchIndex: number;
  matchCount: number;
}) {
  const hasQuery = value.length > 0;
  const zero = hasQuery && matchCount === 0;
  const counterText = !hasQuery
    ? ""
    : matchCount === 0
      ? "0 / 0"
      : `${matchIndex + 1} / ${matchCount}`;

  return (
    <Box>
      <Text color={zero ? "red" : "cyan"}>🔎 </Text>
      <Box flexGrow={1}>
        <MinimalInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          onPrev={onPrev}
          onNext={onNext}
        />
      </Box>
      <Box marginLeft={1}>
        <Text color={zero ? "red" : "gray"}>{counterText}</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/components/search-bar.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run full suite**

Run: `bun test && bun run typecheck`
Expected: All passing. (`session-preview.tsx` will fail typecheck because it still passes the old `label` prop — fix in Task 6.)

If typecheck fails on `session-preview.tsx`, that's expected; do not commit yet — proceed to Task 6 to fix it in the same logical change.

- [ ] **Step 6: Defer commit**

Don't commit yet — `session-preview.tsx` consumes `SearchBar` with the old props. Task 6 fixes that, and we commit together to keep the repo green at every commit.

---

### Task 6: Wire `matches`/`matchIndex` state into `SessionPreview` (no behavior changes yet)

**Files:**
- Modify: `src/components/session-preview.tsx`

This task only adds state plumbing and updates the SearchBar call site so the project compiles again. Search-flow behavior comes in Task 7+.

- [ ] **Step 1: Add state declarations**

Just below the existing `useState` declarations in `SessionPreview`, add:

```ts
const [matchIndex, setMatchIndex] = useState<number>(-1);
```

In the `useEffect` that resets state on `[sessionId]` change, add:

```ts
setMatchIndex(-1);
```

- [ ] **Step 2: Pass `matchIndex` to `renderConversation` and read `matches` back**

Replace the existing `useMemo`:

```ts
const buffer = useMemo(
  () =>
    renderConversation(messages, {
      width,
      expanded,
      emoji,
      now: new Date(),
      query,
      matchIndex,
    }),
  [messages, width, expanded, emoji, query, matchIndex],
);
const matches = buffer.matches;
const matchCount = matches.length;
```

- [ ] **Step 3: Update SearchBar usage**

Replace the existing `<SearchBar … />` JSX with:

```tsx
{searchOpen && (
  <SearchBar
    value={searchValue}
    onChange={setSearchValue}
    onSubmit={() => { /* Task 9 */ setCommittedQuery(searchValue); setSearchOpen(false); }}
    onCancel={() => { /* Task 9 */ setCommittedQuery(searchValue); setSearchOpen(false); }}
    onPrev={() => { /* Task 8 */ }}
    onNext={() => { /* Task 8 */ }}
    matchIndex={matchIndex}
    matchCount={matchCount}
  />
)}
```

- [ ] **Step 4: Verify project compiles**

Run: `bun run typecheck && bun test`
Expected: All previously-passing tests still pass.

- [ ] **Step 5: Commit (combined with Task 5)**

```bash
git add src/components/search-bar.tsx tests/components/search-bar.test.tsx \
        src/components/session-preview.tsx
git commit -m "SearchBar with counter and zero-state; SessionPreview matchIndex state"
```

---

### Task 7: Open-search initial `matchIndex` lands at-or-after current cursor

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `tests/components/session-preview.test.tsx`:

```tsx
test("Ctrl+F sets matchIndex to the first match at or after current cursor", async () => {
  const messages = [
    { role: "assistant", content: "no match", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "useState here", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "another useState", timestamp: new Date(0), raw: {} },
  ] as const as Message[];

  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={20} width={60} emoji={false} />
  );
  await tick();
  // pinned to bottom = cursor on msg[2]; open search and type
  stdin.write("\x06"); // Ctrl+F
  await tick();
  stdin.write("useState");
  await tick();
  // counter should be "2 / 2" because cursor is on msg[2] and the second match is in msg[2]
  expect(lastFrame() ?? "").toContain("2 / 2");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL — counter shows `1 / 2` because matchIndex starts at 0.

- [ ] **Step 3: Define `scrollMatchIntoView` helper and the initial-index effect**

Add `import type { Match } from "../lib/matches.ts";` near the other imports.

Inside `SessionPreview` (after `maxScroll` / `actualScrollLine` are in scope), define:

```ts
const scrollMatchIntoView = (m: Match) => {
  const msgStart = buffer.startLine[m.msgIndex] ?? 0;
  const msgEnd = buffer.endLine[m.msgIndex] ?? totalLines;
  const msgHeight = Math.max(1, msgEnd - msgStart);
  const content = messages[m.msgIndex]?.content ?? "";
  const fraction = content.length > 0 ? m.contentOffset / content.length : 0;
  const approxLine = msgStart + Math.floor(fraction * msgHeight);
  if (approxLine < actualScrollLine || approxLine >= actualScrollLine + viewportHeight) {
    setScrollLine(clampToRange(approxLine - 2, 0, maxScroll));
  }
};
```

Then the effect:

```ts
useEffect(() => {
  if (!searchOpen) return;
  if (matches.length === 0) { setMatchIndex(-1); return; }
  // First match at or after current cursor; wrap to 0 if none.
  const startCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);
  const firstAfter = matches.findIndex(m => m.msgIndex >= startCursor);
  const idx = firstAfter >= 0 ? firstAfter : 0;
  setMatchIndex(idx);
  // Sync conversation cursor and viewport to the chosen match.
  const target = matches[idx]!;
  setCursor(target.msgIndex);
  setPinToBottom(false);
  scrollMatchIntoView(target);
  // Run only when query/messages change while search is open — not on every matchIndex shuffle.
}, [searchOpen, query, messages]);
```

Note: the dep on `matches` would cause a loop since matchIndex change re-renders, which re-derives matches identity. Depend on `query` and `messages` instead — both stable.

- [ ] **Step 4: Run test**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "Initial matchIndex lands at-or-after current cursor on search open"
```

---

### Task 8: Arrow-key navigation in search-open state

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("↓ advances matchIndex; wraps at end", async () => {
  const messages = [
    { role: "user", content: "aa bb aa cc aa", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={10} width={40} emoji={false} />
  );
  await tick();
  stdin.write("\x06"); // Ctrl+F
  await tick();
  stdin.write("aa");
  await tick();
  expect(lastFrame() ?? "").toContain("1 / 3");
  stdin.write("\x1b[B"); // ↓
  await tick();
  expect(lastFrame() ?? "").toContain("2 / 3");
  stdin.write("\x1b[B"); // ↓
  await tick();
  expect(lastFrame() ?? "").toContain("3 / 3");
  stdin.write("\x1b[B"); // ↓ wraps
  await tick();
  expect(lastFrame() ?? "").toContain("1 / 3");
});

test("↑ goes back; wraps at start", async () => {
  const messages = [
    { role: "user", content: "aa bb aa", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={10} width={40} emoji={false} />
  );
  await tick();
  stdin.write("\x06");
  await tick();
  stdin.write("aa");
  await tick();
  stdin.write("\x1b[A"); // ↑ from index 0 wraps to last
  await tick();
  expect(lastFrame() ?? "").toContain("2 / 2");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL — onPrev/onNext are no-ops.

- [ ] **Step 3: Add `goToMatch` helper plus `onPrev` / `onNext`**

`scrollMatchIntoView` and the `Match` import already exist from Task 7. In `SessionPreview`, add:

```ts
const goToMatch = (idx: number) => {
  if (idx < 0 || idx >= matches.length) return;
  const m = matches[idx]!;
  setMatchIndex(idx);
  setCursor(m.msgIndex);
  setPinToBottom(false);
  scrollMatchIntoView(m);
};

const onNext = () => {
  if (matches.length === 0) return;
  goToMatch((Math.max(0, matchIndex) + 1) % matches.length);
};

const onPrev = () => {
  if (matches.length === 0) return;
  goToMatch((Math.max(0, matchIndex) - 1 + matches.length) % matches.length);
};
```

Update SearchBar JSX:

```tsx
<SearchBar
  value={searchValue}
  onChange={setSearchValue}
  onSubmit={() => { setCommittedQuery(searchValue); setSearchOpen(false); }}
  onCancel={() => { setCommittedQuery(searchValue); setSearchOpen(false); }}
  onPrev={onPrev}
  onNext={onNext}
  matchIndex={matchIndex}
  matchCount={matchCount}
/>
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "↑↓←→ navigate matches in search-open state with viewport follow"
```

---

### Task 9: Enter/Esc commits, cursor lands on match

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("Enter closes search and sets cursor to current match's message", async () => {
  const messages = [
    { role: "assistant", content: "first", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "match here", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "tail", timestamp: new Date(0), raw: {} },
  ] as Message[];

  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={20} width={40} emoji={false} />
  );
  await tick();
  stdin.write("\x06");          // Ctrl+F
  await tick();
  stdin.write("match");
  await tick();
  stdin.write("\r");            // Enter
  await tick();
  // Search bar is gone; counter not shown
  expect(lastFrame() ?? "").not.toContain("1 / 1");
  // Highlight survives — yellow background still in frame
  expect(lastFrame() ?? "").toContain("\x1b[43m");
  // Cursor (›) is on the matched message (msg index 1)
  // The msg-2 row that previously had the cursor should not.
  // We assert by looking at footer "X / total"
  expect(lastFrame() ?? "").toContain("2 / 3");
});

test("Esc behaves the same as Enter", async () => {
  const messages = [
    { role: "assistant", content: "first", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "needle", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "tail", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={20} width={40} emoji={false} />
  );
  await tick();
  stdin.write("\x06");
  await tick();
  stdin.write("needle");
  await tick();
  stdin.write("\x1b");          // Esc
  await tick();
  expect(lastFrame() ?? "").toContain("\x1b[43m");
  expect(lastFrame() ?? "").toContain("2 / 3");
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL — cursor footer is still `3 / 3`.

- [ ] **Step 3: Implement onSubmit/onCancel as a single `commitSearch` helper**

In `SessionPreview`:

```ts
const commitSearch = () => {
  setSearchOpen(false);
  setCommittedQuery(searchValue);
  if (matches.length > 0 && matchIndex >= 0) {
    const target = matches[matchIndex]!;
    setCursor(target.msgIndex);
    setPinToBottom(target.msgIndex === lastIdx);
  }
};
```

Update SearchBar usage:

```tsx
<SearchBar
  value={searchValue}
  onChange={setSearchValue}
  onSubmit={commitSearch}
  onCancel={commitSearch}
  onPrev={onPrev}
  onNext={onNext}
  matchIndex={matchIndex}
  matchCount={matchCount}
/>
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "Enter/Esc commit search; cursor lands on current match"
```

---

### Task 10: Afterglow clears on first ordinary navigation key

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("after Enter, pressing j clears highlights and moves cursor", async () => {
  const messages = [
    { role: "assistant", content: "alpha", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "needle", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "omega", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={20} width={40} emoji={false} />
  );
  await tick();
  stdin.write("\x06");
  await tick();
  stdin.write("needle");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame() ?? "").toContain("\x1b[43m");
  // Now press j (or down arrow) — afterglow clears.
  stdin.write("j");
  await tick();
  expect(lastFrame() ?? "").not.toContain("\x1b[43m");
  expect(lastFrame() ?? "").not.toContain("\x1b[7m"); // no INVERSE either
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL — `committedQuery` keeps highlights alive across `j`.

- [ ] **Step 3: Add afterglow-clearing branch at the top of `useInput`**

Inside `SessionPreview`'s `useInput((input, key) => { … })`, **before** any other branches but after the early-returns (`if (!focused) return;`, `if (searchOpen) return;`):

```ts
const inAfterglow = !searchOpen && committedQuery !== "";
const isOrdinaryNav =
  key.upArrow || key.downArrow || key.leftArrow || key.rightArrow ||
  input === "j" || input === "k" || input === "g" || input === "G" ||
  key.pageUp || key.pageDown ||
  (key.ctrl && (input === "d" || input === "u")) ||
  (key.tab && !key.shift);

if (inAfterglow && isOrdinaryNav) {
  setCommittedQuery("");
  setMatchIndex(-1);
  // Fall through — the key still performs its normal action below.
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "Clear search highlights on first ordinary nav key in afterglow"
```

---

### Task 11: `/` opens search; Ctrl+F in afterglow restarts cleanly

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("/ opens the search bar", async () => {
  const messages = [
    { role: "user", content: "hello world", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={10} width={40} emoji={false} />
  );
  await tick();
  stdin.write("/");
  await tick();
  expect(lastFrame() ?? "").toContain("🔎");
});

test("Ctrl+F in afterglow clears the previous query and reopens with empty input", async () => {
  const messages = [
    { role: "user", content: "aaa bbb", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={10} width={40} emoji={false} />
  );
  await tick();
  stdin.write("\x06");
  await tick();
  stdin.write("aaa");
  await tick();
  stdin.write("\r"); // commit -> afterglow
  await tick();
  expect(lastFrame() ?? "").toContain("\x1b[43m");
  stdin.write("\x06"); // Ctrl+F again
  await tick();
  // Search bar is open with empty query (no counter visible).
  const out = lastFrame() ?? "";
  expect(out).toContain("🔎");
  expect(out).not.toMatch(/\d+ \/ \d+/);
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL — `/` does nothing in browse state; Ctrl+F retains old query.

- [ ] **Step 3: Update the `useInput` branches in `SessionPreview`**

Modify the existing Ctrl+F branch and add `/`:

```ts
const openSearchFresh = () => {
  setCommittedQuery("");
  setSearchValue("");
  setMatchIndex(-1);
  setSearchOpen(true);
};

if (!searchOpen) {
  if ((key.ctrl && (input === "f" || input === "F")) || input === "/") {
    openSearchFresh();
    return;
  }
}
```

Replace the existing `if (key.ctrl && (input === "f" || input === "F"))` block with this.

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "/ opens search; Ctrl+F in afterglow starts a fresh query"
```

---

### Task 12: Stable `matchIndex` repositioning while typing

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

The Task 7 effect reset `matchIndex` to "first match at or after current cursor" *every time the query changes*. That's fine for the first character, but when the user keeps typing — narrowing the result set — the matchIndex jumps back. Fix: only run the cursor-anchor logic on the *first* recompute after opening; subsequent typing reuses the previous `(msgIndex, contentOffset)` to find the closest still-valid match.

- [ ] **Step 1: Write the failing test**

The test must use a **single message with multiple matches at different offsets** — that's the only scenario where the cursor-anchored implementation from Task 7 actually fails. Multi-message scenarios already work because Task 8's `goToMatch` updates `cursor` on every navigate.

```tsx
test("typing more chars within a single message keeps the user at the same offset", async () => {
  const messages = [
    { role: "user", content: "axx-axx-ayy", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="x" focused={true}
                    height={20} width={60} emoji={false} />
  );
  await tick();
  stdin.write("\x06");
  await tick();
  stdin.write("a");        // 3 matches at offsets 0, 4, 8
  await tick();
  expect(lastFrame() ?? "").toContain("1 / 3");
  stdin.write("\x1b[B");    // ↓ → match index 1 (offset 4)
  await tick();
  expect(lastFrame() ?? "").toContain("2 / 3");
  // Narrow: "ax" matches at offsets 0 and 4 (not 8, which is "ayy").
  // User was at offset 4, expects to stay there → counter "2 / 2".
  stdin.write("x");
  await tick();
  expect(lastFrame() ?? "").toContain("2 / 2");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/components/session-preview.test.tsx`
Expected: FAIL — without the ref-anchor, the effect re-anchors to `cursor` (which is still `msg=0`, no offset info), so `firstAfter` returns the offset-0 match, yielding `1 / 2`.

- [ ] **Step 3: Implement stable repositioning via a ref-based anchor**

Add `import { useRef } from "react"` if not already present. Inside `SessionPreview`, add the ref:

```ts
const lastAnchorRef = useRef<{ msgIndex: number; contentOffset: number } | null>(null);
```

Replace the Task 7 effect with:

```ts
useEffect(() => {
  if (!searchOpen) {
    lastAnchorRef.current = null;
    return;
  }
  if (matches.length === 0) { setMatchIndex(-1); return; }
  // First open: anchor to current cursor. Subsequent re-renders during typing:
  // anchor to the user's last visited match.
  let anchor: { msgIndex: number; contentOffset: number };
  if (lastAnchorRef.current) {
    anchor = lastAnchorRef.current;
  } else {
    const startCursor = pinToBottom ? lastIdx : Math.min(cursor, lastIdx);
    anchor = { msgIndex: startCursor, contentOffset: 0 };
  }
  let idx = matches.findIndex(
    m => m.msgIndex > anchor.msgIndex ||
        (m.msgIndex === anchor.msgIndex && m.contentOffset >= anchor.contentOffset),
  );
  if (idx < 0) idx = 0;
  goToMatch(idx);
}, [searchOpen, query, messages]);
```

Update `goToMatch` (defined in Task 8) to also write the anchor. Replace its body:

```ts
const goToMatch = (idx: number) => {
  if (idx < 0 || idx >= matches.length) return;
  const m = matches[idx]!;
  setMatchIndex(idx);
  setCursor(m.msgIndex);
  setPinToBottom(false);
  scrollMatchIntoView(m);
  lastAnchorRef.current = { msgIndex: m.msgIndex, contentOffset: m.contentOffset };
};
```

Reset the anchor inside `commitSearch` (defined in Task 9) for cleanliness — so the next search opens fresh:

```ts
const commitSearch = () => {
  setSearchOpen(false);
  setCommittedQuery(searchValue);
  if (matches.length > 0 && matchIndex >= 0) {
    const target = matches[matchIndex]!;
    setCursor(target.msgIndex);
    setPinToBottom(target.msgIndex === lastIdx);
  }
  lastAnchorRef.current = null;
};
```

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "Anchor matchIndex repositioning to the user's last match while typing"
```

---

### Task 13: End-to-end smoke test for the full flow

**Files:**
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Write the smoke test**

```tsx
test("full search flow: open / type / navigate / commit / clear", async () => {
  const messages = [
    { role: "user", content: "alpha", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "needle one", timestamp: new Date(0), raw: {} },
    { role: "user", content: "filler", timestamp: new Date(0), raw: {} },
    { role: "assistant", content: "needle two", timestamp: new Date(0), raw: {} },
    { role: "user", content: "tail", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="smoke" focused={true}
                    height={30} width={60} emoji={false} />
  );
  await tick();

  // Open via /
  stdin.write("/");
  await tick();
  expect(lastFrame() ?? "").toContain("🔎");

  // Type query
  stdin.write("needle");
  await tick();
  expect(lastFrame() ?? "").toMatch(/[12] \/ 2/);

  // Navigate
  stdin.write("\x1b[B"); // ↓
  await tick();
  stdin.write("\x1b[A"); // ↑
  await tick();

  // Commit
  stdin.write("\r");
  await tick();
  expect(lastFrame() ?? "").not.toContain("🔎");
  expect(lastFrame() ?? "").toContain("\x1b[43m"); // current still yellow

  // Move on with j → afterglow clears
  stdin.write("j");
  await tick();
  expect(lastFrame() ?? "").not.toContain("\x1b[43m");
  expect(lastFrame() ?? "").not.toContain("\x1b[7m");
});

test("zero matches show 0 / 0 in red", async () => {
  const messages = [
    { role: "user", content: "nothing here", timestamp: new Date(0), raw: {} },
  ] as Message[];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="zero" focused={true}
                    height={10} width={40} emoji={false} />
  );
  await tick();
  stdin.write("/");
  await tick();
  stdin.write("zzz");
  await tick();
  const out = lastFrame() ?? "";
  expect(out).toContain("0 / 0");
  expect(out).toContain("\x1b[31m"); // red
});
```

- [ ] **Step 2: Run all tests**

Run: `bun test && bun run typecheck`
Expected: All passing.

- [ ] **Step 3: Manual verification**

Run: `bun run dev <path-to-a-real-session>` (or however the dev entry expects it)
Manually try: `/`, `Ctrl+F`, type a query, navigate ↑↓←→, Enter, Esc, j to clear, `Ctrl+F` again to confirm fresh start, search a word with no matches.

Watch for: yellow current-match contrast in your terminal theme; any flicker; CJK input behavior (try typing Chinese in the search bar — if your IME fails, fall back per the spec's "未决" section by re-introducing `ink-text-input` for character input only and intercepting only ↑↓←→/Enter/Esc at the SessionPreview layer).

- [ ] **Step 4: Final commit**

```bash
git add tests/components/session-preview.test.tsx
git commit -m "Add end-to-end smoke tests for the search flow"
```

---

## Self-Review Notes

- **Spec coverage:** Every section in the spec maps to a task — the state machine (Tasks 7, 9, 10, 11), the keys table (Tasks 8, 11, 10), the visual rules (Tasks 2, 5), `Match` data structure (Task 1), `findMatches` / `applyHighlight` / `renderConversation` plumbing (Tasks 1, 2, 3), `MinimalInput` (Task 4), edge cases (Tasks 9 — empty matches, 13 — zero matches red), stable matchIndex while typing (Task 12).
- **Type consistency:** `Match` defined in Task 1 (`{ msgIndex, contentOffset, length }`) is used unchanged in Tasks 2, 3, 8. `commitSearch` defined in Task 9 is referenced in Task 12 only by name.
- **Risk note from spec:** CJK / IME behavior with the custom `MinimalInput` is called out in Task 13's manual verification, with the spec's own fallback (revert to `ink-text-input`) flagged. If the manual test reveals breakage, that fallback would replace Task 4's component, while Tasks 7–12 stay valid because the IPC surface (key handling at the SessionPreview layer) doesn't change.
