# Continue Conversation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users branch from any user/assistant message in the preview into a fresh `claude --resume <new-uuid>` session, optionally pre-filling the user message via PTY + bracketed paste.

**Architecture:** The TUI never speaks PTY directly. SessionPreview surfaces a `ContinueRequest` to App → cli.tsx; cli.tsx captures it in a closure and runs the launcher *after* Ink unmounts. The launcher does fork-JSONL → mode-A (node-pty + bracketed paste, same terminal) or mode-B (pbcopy + osascript, new Terminal.app window).

**Tech Stack:** ink 5, React 18, `bun:test`, `ink-testing-library`, `@lydell/node-pty`, raw ANSI/CSI sequences.

**Spec:** `docs/superpowers/specs/2026-05-09-continue-conversation-design.md`

---

## File Layout

| File | Status | Responsibility |
|---|---|---|
| `src/lib/settings.ts` | Modify | Add `continueLaunchMode` field + sanitize |
| `src/lib/i18n.ts` | Modify | Add new zh/en keys |
| `src/lib/continue-fork.ts` | Create | Pure JSONL slicer (`forkSession`) |
| `src/lib/continue-pty.ts` | Create | Mode A: node-pty + bracketed paste |
| `src/lib/continue-spawn.ts` | Create | Mode B: pbcopy + osascript (macOS) |
| `src/lib/continue-launch.ts` | Create | Dispatcher: pre-flight + fork + mode A/B |
| `src/components/settings-panel.tsx` | Modify | Render new field group |
| `src/components/session-preview.tsx` | Modify | Continue trigger + footer + confirm flow |
| `src/components/session-browser.tsx` | Modify | Pipe `onRequestContinue` |
| `src/app.tsx` | Modify | Pipe `onRequestContinue` |
| `src/cli.tsx` | Modify | Capture request → run launcher after Ink exit |
| `package.json` | Modify | Add `@lydell/node-pty` dep |
| `tests/lib/continue-fork.test.ts` | Create | Slicer behavior |
| `tests/lib/settings.test.ts` | Create | Round-trip + sanitize for new field |
| `tests/components/session-preview.test.tsx` | Modify | Continue-trigger flow |

---

## Constants reused across tasks

```ts
// Bracketed paste — Ink reads this as a paste, not as keystrokes.
const PASTE_START = "\x1b[200~";
const PASTE_END   = "\x1b[201~";
```

---

### Task 1: Add `continueLaunchMode` to settings

**Files:**
- Modify: `src/lib/settings.ts`
- Create: `tests/lib/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/settings.test.ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../../src/lib/settings.ts";

describe("settings continueLaunchMode", () => {
  test("defaults to reuse-current", () => {
    expect(DEFAULT_SETTINGS.continueLaunchMode).toBe("reuse-current");
  });

  test("Settings type accepts both values", () => {
    const a: Settings = { ...DEFAULT_SETTINGS, continueLaunchMode: "reuse-current" };
    const b: Settings = { ...DEFAULT_SETTINGS, continueLaunchMode: "new-window" };
    expect(a.continueLaunchMode).toBe("reuse-current");
    expect(b.continueLaunchMode).toBe("new-window");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
bun test tests/lib/settings.test.ts
```
Expected: type error / property missing.

- [ ] **Step 3: Edit `src/lib/settings.ts`**

Add the type + default + sanitize branch:

```ts
export type ContinueLaunchMode = "reuse-current" | "new-window";

export interface Settings {
  displayMode: DisplayMode;
  showHash: boolean;
  language: Lang;
  continueLaunchMode: ContinueLaunchMode;
}

export const DEFAULT_SETTINGS: Settings = {
  displayMode: "full",
  showHash: true,
  language: DEFAULT_LANG,
  continueLaunchMode: "reuse-current",
};
```

In `sanitize`:

```ts
if (p.continueLaunchMode === "reuse-current" || p.continueLaunchMode === "new-window") {
  out.continueLaunchMode = p.continueLaunchMode;
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
bun test tests/lib/settings.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts tests/lib/settings.test.ts
git commit -m "Add continueLaunchMode setting with reuse-current default"
```

---

### Task 2: Add i18n strings

**Files:**
- Modify: `src/lib/i18n.ts`

(No test — adding strings is read by other components' tests.)

- [ ] **Step 1: Edit `src/lib/i18n.ts`** — append to both tables

```ts
// English additions
"continue.footer_label": "↪ Continue conversation",
"continue.confirm_hint": "Enter=confirm  Esc=cancel",
"continue.error_no_claude": "claude not found in PATH",
"continue.error_not_tty": "current stdout is not a TTY",
"continue.error_unsupported": "\"new window\" mode is not supported on this platform",
"continue.error_fork_failed": "failed to fork session: {detail}",
"continue.error_launch_failed": "failed to launch claude: {detail}",
"continue.spawn_new_window_hint": "A new Terminal window has opened — paste with Cmd+V if a message was prepared.",
"settings.launch_mode.title": "Continue-conversation launch mode",
"settings.launch_mode.option_reuse": "Reuse current terminal",
"settings.launch_mode.option_new_window": "Open in new terminal window",
"settings.launch_mode.option_reuse_desc": "Hand the current terminal over to claude. PTY-based prefill works here.",
"settings.launch_mode.option_new_window_desc": "Spawn a new Terminal.app window (macOS only); user message is copied to the clipboard for manual paste.",
"settings.launch_mode.unsupported_note": "macOS only",
```

```ts
// Chinese additions
"continue.footer_label": "↪ 继续对话",
"continue.confirm_hint": "Enter=确认  Esc=取消",
"continue.error_no_claude": "在 PATH 中未找到 claude 命令",
"continue.error_not_tty": "当前 stdout 不是 TTY",
"continue.error_unsupported": "当前平台不支持「弹出新终端窗口」",
"continue.error_fork_failed": "分叉会话失败：{detail}",
"continue.error_launch_failed": "启动 claude 失败：{detail}",
"continue.spawn_new_window_hint": "新终端窗口已打开 —— 如有预填消息，请在新窗口里 Cmd+V 粘贴。",
"settings.launch_mode.title": "继续对话启动方式",
"settings.launch_mode.option_reuse": "复用当前终端",
"settings.launch_mode.option_new_window": "弹出新终端窗口",
"settings.launch_mode.option_reuse_desc": "把当前终端交给 claude；可用 PTY 自动预填用户消息。",
"settings.launch_mode.option_new_window_desc": "弹出一个新的 Terminal.app 窗口（仅 macOS）；用户消息会复制到剪贴板，由你手动粘贴。",
"settings.launch_mode.unsupported_note": "仅 macOS 支持",
```

- [ ] **Step 2: Quick smoke check**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "Add zh/en strings for continue-conversation feature"
```

---

### Task 3: Fork algorithm (`continue-fork.ts`)

**Files:**
- Create: `src/lib/continue-fork.ts`
- Create: `tests/lib/continue-fork.test.ts`
- Possibly create: `tests/fixtures/claude-code/fork-source.jsonl`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/continue-fork.test.ts
import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { forkSession } from "../../src/lib/continue-fork.ts";

async function tmpFile(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "fork-"));
  return path.join(d, `${crypto.randomUUID()}.jsonl`);
}

const SAMPLE = [
  JSON.stringify({ type: "summary", summary: "old" }),
  JSON.stringify({ type: "user",      uuid: "u1", sessionId: "S0", message: { content: "hi" }, timestamp: "2026-01-01T00:00:00Z" }),
  JSON.stringify({ type: "assistant", uuid: "a1", sessionId: "S0", message: { content: "hello" }, timestamp: "2026-01-01T00:00:01Z" }),
  JSON.stringify({ type: "user",      uuid: "u2", sessionId: "S0", message: { content: "again" }, timestamp: "2026-01-01T00:00:02Z" }),
  JSON.stringify({ type: "assistant", uuid: "a2", sessionId: "S0", message: { content: "ok" }, timestamp: "2026-01-01T00:00:03Z" }),
].join("\n") + "\n";

describe("forkSession", () => {
  test("user cut excludes target line, drops summary, rewrites sessionId", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await forkSession({ srcPath: src, dstPath: dst, targetUuid: "u2", targetRole: "user", newSessionId: "NEW" });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out.map(e => e.uuid)).toEqual(["u1", "a1"]);
    expect(out.every(e => e.sessionId === "NEW")).toBe(true);
    expect(out.every(e => e.type !== "summary")).toBe(true);
  });

  test("assistant cut includes target line", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await forkSession({ srcPath: src, dstPath: dst, targetUuid: "a1", targetRole: "assistant", newSessionId: "NEW" });
    const out = (await fs.readFile(dst, "utf8")).trim().split("\n").map(l => JSON.parse(l));
    expect(out.map(e => e.uuid)).toEqual(["u1", "a1"]);
  });

  test("missing target uuid throws", async () => {
    const src = await tmpFile();
    const dst = await tmpFile();
    await fs.writeFile(src, SAMPLE);
    await expect(
      forkSession({ srcPath: src, dstPath: dst, targetUuid: "missing", targetRole: "user", newSessionId: "NEW" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect fail (module missing)**

```bash
bun test tests/lib/continue-fork.test.ts
```

- [ ] **Step 3: Implement `src/lib/continue-fork.ts`**

```ts
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";

export interface ForkSpec {
  srcPath: string;
  dstPath: string;
  targetUuid: string;
  targetRole: "user" | "assistant";
  newSessionId: string;
}

/**
 * Stream the source JSONL, copy contiguous user/assistant entries up to (and
 * possibly including) the entry whose uuid matches `targetUuid`. Drops
 * summary / custom-title lines. Rewrites each entry's sessionId to
 * newSessionId. Throws if the target uuid is never seen.
 */
export async function forkSession(spec: ForkSpec): Promise<void> {
  const { srcPath, dstPath, targetUuid, targetRole, newSessionId } = spec;
  const lines: string[] = [];
  let found = false;

  const rl = readline.createInterface({
    input: createReadStream(srcPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    if (type !== "user" && type !== "assistant") continue;

    const isTarget = typeof entry.uuid === "string" && entry.uuid === targetUuid;
    if (isTarget) {
      found = true;
      if (targetRole === "assistant") {
        entry.sessionId = newSessionId;
        lines.push(JSON.stringify(entry));
      }
      // For user-cut: target line is excluded.
      break;
    }

    entry.sessionId = newSessionId;
    lines.push(JSON.stringify(entry));
  }

  if (!found) throw new Error(`target uuid not found in source: ${targetUuid}`);
  await fs.writeFile(dstPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}
```

- [ ] **Step 4: Run, expect pass**

```bash
bun test tests/lib/continue-fork.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/continue-fork.ts tests/lib/continue-fork.test.ts
git commit -m "Add forkSession: slice JSONL by target uuid + role"
```

---

### Task 4: Settings panel UI shows the new field

**Files:**
- Modify: `src/components/settings-panel.tsx`

(Existing component already iterates `buildFields(lang)` — just append a new field def. Tests for SettingsPanel are not in the repo today, so we keep this task non-TDD.)

- [ ] **Step 1: Edit `buildFields` in `settings-panel.tsx`**

Append after the `language` field:

```ts
{
  key: "continueLaunchMode",
  title: t(lang, "settings.launch_mode.title"),
  options: [
    {
      value: "reuse-current",
      label: t(lang, "settings.launch_mode.option_reuse"),
      description: t(lang, "settings.launch_mode.option_reuse_desc"),
    },
    {
      value: "new-window",
      label: t(lang, "settings.launch_mode.option_new_window") +
        (process.platform === "darwin"
          ? ""
          : ` (${t(lang, "settings.launch_mode.unsupported_note")})`),
      description: t(lang, "settings.launch_mode.option_new_window_desc"),
    },
  ],
},
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Smoke-test in dev**

```bash
bun run dev &
# verify Settings panel shows the new field group
kill %1 2>/dev/null
```
(Best-effort manual verification.)

- [ ] **Step 4: Commit**

```bash
git add src/components/settings-panel.tsx
git commit -m "Show continue-launch-mode field in SettingsPanel"
```

---

### Task 5: SessionPreview — Enter trigger + confirm footer

**Files:**
- Modify: `src/components/session-preview.tsx`
- Modify: `tests/components/session-preview.test.tsx`

- [ ] **Step 1: Add the failing test (append to existing file)**

```tsx
test("Enter on a user message opens the continue footer; second Enter calls onRequestContinue", async () => {
  const onRequest = mock(() => {});
  const messages: Message[] = [
    { role: "user", content: "msg one", timestamp: new Date(0), uuid: "u1", raw: {} },
    { role: "assistant", content: "reply one", timestamp: new Date(0), uuid: "a1", raw: {} },
  ];
  const { stdin, lastFrame } = render(
    <SessionPreview
      messages={messages}
      sessionId="s"
      focused={true}
      height={8}
      width={50}
      emoji={false}
      onRequestContinue={onRequest}
    />
  );
  await tick();
  stdin.write("\r");                 // first Enter — open footer
  await tick();
  expect(lastFrame() ?? "").toContain("Continue conversation");
  stdin.write("\r");                 // confirm
  await tick();
  expect(onRequest).toHaveBeenCalledTimes(1);
  expect(onRequest.mock.calls[0]?.[0]).toMatchObject({
    targetUuid: "a1",                // pin-to-bottom => last message
    targetRole: "assistant",
  });
});

test("Esc closes the continue footer without firing the request", async () => {
  const onRequest = mock(() => {});
  const messages: Message[] = [
    { role: "user", content: "hi", timestamp: new Date(0), uuid: "u1", raw: {} },
  ];
  const { stdin, lastFrame } = render(
    <SessionPreview messages={messages} sessionId="s" focused={true} height={6} width={40} emoji={false} onRequestContinue={onRequest} />
  );
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame() ?? "").toContain("Continue conversation");
  stdin.write("");             // Esc
  await tick();
  expect(lastFrame() ?? "").not.toContain("Continue conversation");
  expect(onRequest).not.toHaveBeenCalled();
});
```

(Also add `import { mock } from "bun:test";` at the top if missing.)

- [ ] **Step 2: Run, expect fail**

```bash
bun test tests/components/session-preview.test.tsx
```

- [ ] **Step 3: Modify `SessionPreview`**

  - Add prop `onRequestContinue?: (req: { targetUuid: string; targetRole: "user" | "assistant"; userText?: string }) => void`.
  - Add state `const [continueOpen, setContinueOpen] = useState(false);`
  - Reset in the per-session `useEffect` to `false`.
  - In `useInput`:
    - If `continueOpen`:
      - `key.return` → call `onRequestContinue(...)` with current message's uuid/role and (for user-role) content; setContinueOpen(false).
      - `key.escape` → setContinueOpen(false).
      - Else: ignore (no nav).
      - `return` early.
    - Else for `key.return`, BEFORE the existing `(key.tab || key.return)` block:
      - Compute `target = pinToBottom ? lastIdx : effectiveCursor;`
      - `role = messages[target]?.role`
      - If `role === "user" || role === "assistant"`: `setContinueOpen(true); return;`
      - Else: fall through to existing tool-expand branch.
  - Render the footer when `continueOpen`: a 2-line block above the existing overflow hint, dimmed line + label/hint with current accent.

  Sketch (insert in JSX, just before the trailing overflow-hint Box):

```tsx
{continueOpen && (
  <Box flexDirection="column" flexShrink={0}>
    <Text dimColor>{"─".repeat(width)}</Text>
    <Box>
      <Text color="cyan" bold>{t(lang, "continue.footer_label")}</Text>
      <Text>   </Text>
      <Text dimColor>{t(lang, "continue.confirm_hint")}</Text>
    </Box>
  </Box>
)}
```

  Also: subtract 2 from `viewportHeight` when `continueOpen` is true so the footer doesn't push lines off-screen.

  Update the existing search-row computation to share a single "extra rows" count:

```ts
const extraRows = (showSearchRow ? 2 : 0) + (continueOpen ? 2 : 0);
const viewportHeight = Math.max(1, height - 1 - extraRows);
```

- [ ] **Step 4: Run, expect pass**

```bash
bun test tests/components/session-preview.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/session-preview.tsx tests/components/session-preview.test.tsx
git commit -m "Add Enter-triggered continue-conversation footer to preview"
```

---

### Task 6: Plumb `onRequestContinue` through SessionBrowser → App → cli.tsx

**Files:**
- Modify: `src/components/session-browser.tsx`, `src/app.tsx`, `src/cli.tsx`
- Create: `src/lib/continue-types.ts` (the shared `ContinueRequest` type)

- [ ] **Step 1: Create `src/lib/continue-types.ts`**

```ts
import type { ContinueLaunchMode } from "./settings.ts";

export interface ContinueRequest {
  /** Path to the source JSONL — used to locate project dir + read entries */
  sourcePath: string;
  /** Cursor message uuid */
  targetUuid: string;
  /** Cursor message role — drives whether target line is included */
  targetRole: "user" | "assistant";
  /** For user-role only: the message content to prefill into claude's input */
  userText?: string;
  /** Resolved at request time so cli.tsx doesn't need to read settings again */
  launchMode: ContinueLaunchMode;
}
```

- [ ] **Step 2: Modify `SessionPreview` signature** to surface enough info to the parent

Change `onRequestContinue` to take only the cursor info (no path/launchMode):

```ts
onRequestContinue?: (info: { targetUuid: string; targetRole: "user" | "assistant"; userText?: string }) => void;
```

- [ ] **Step 3: Modify `SessionBrowser`**

Accept a parent prop:

```ts
onRequestContinue: (req: ContinueRequest) => void;
```

When the preview fires, build the full `ContinueRequest`:

```tsx
<SessionPreview
  ...existing props...
  onRequestContinue={(info) => {
    if (!selected) return;
    onRequestContinue({
      sourcePath: selected.filePath,
      targetUuid: info.targetUuid,
      targetRole: info.targetRole,
      userText: info.userText,
      launchMode: settings.continueLaunchMode,
    });
  }}
/>
```

- [ ] **Step 4: Modify `App`**

Add prop:

```ts
onRequestContinue: (req: ContinueRequest) => void;
```

Pipe into `<SessionBrowser onRequestContinue={...} />`. Also, after firing, call `useApp().exit()` so Ink unmounts and cli.tsx can take over.

```tsx
import { useApp } from "ink";
const { exit } = useApp();
...
<SessionBrowser
  ...existing props...
  onRequestContinue={(req) => {
    onRequestContinue(req);
    exit();
  }}
/>
```

- [ ] **Step 5: Modify `cli.tsx`**

```tsx
import { render } from "ink";
import type { ContinueRequest } from "./lib/continue-types.ts";

let pendingContinue: ContinueRequest | null = null;

const inkApp = render(
  <App
    initialPath={initialPath}
    emoji={emoji}
    onRequestContinue={(req) => { pendingContinue = req; }}
  />
);

await inkApp.waitUntilExit();

if (pendingContinue) {
  const { executeContinue } = await import("./lib/continue-launch.ts");
  await executeContinue(pendingContinue);
}
```

(`executeContinue` ships in Task 10; until then, keep `cli.tsx` compiling by stubbing the import to an inline noop or guarding the import behind a feature flag — but since we'll ship Task 10 in the same plan we can just leave the dynamic import in place and run the cli only after Task 10.)

- [ ] **Step 6: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/continue-types.ts src/components/session-preview.tsx src/components/session-browser.tsx src/app.tsx src/cli.tsx
git commit -m "Plumb continue-conversation request from preview to cli"
```

---

### Task 7: Add `@lydell/node-pty` dependency

- [ ] **Step 1: Install**

```bash
bun add @lydell/node-pty
```

- [ ] **Step 2: Confirm prebuilt binary loads**

```bash
node -e "require('@lydell/node-pty'); console.log('ok')"
```
Expected: `ok`. If it errors mentioning `node-gyp`/`make`, downgrade to plain `node-pty` and re-run, then continue.

- [ ] **Step 3: Confirm `bun build` does not bundle it**

```bash
bun run build
grep -q "lydell" dist/cli.js && echo "BUNDLED" || echo "EXTERNAL"
```
Expected: `EXTERNAL` (the `--packages external` build flag handles this automatically).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "Add @lydell/node-pty dependency"
```

---

### Task 8: PTY launcher (mode A)

**Files:**
- Create: `src/lib/continue-pty.ts`

(No automated test — depends on real `claude` binary. Manual smoke covered in Task 11.)

- [ ] **Step 1: Implement `src/lib/continue-pty.ts`**

```ts
import process from "node:process";

const PASTE_START = "\x1b[200~";
const PASTE_END   = "\x1b[201~";

export interface PtyRunSpec {
  cwd: string;
  resumeId: string;
  prefillText?: string;
}

/**
 * Spawn `claude --resume <id>` via node-pty, attach stdio, optionally inject
 * `prefillText` as a bracketed paste after the first stdout chunk + 80ms.
 * Resolves with the child's exit code.
 */
export async function runPty(spec: PtyRunSpec): Promise<number> {
  const { spawn } = await import("@lydell/node-pty") as typeof import("@lydell/node-pty");
  const cols = process.stdout.columns ?? 100;
  const rows = process.stdout.rows ?? 30;
  const env = { ...process.env, TERM: process.env.TERM ?? "xterm-256color" };

  const child = spawn("claude", ["--resume", spec.resumeId], {
    name: env.TERM,
    cols, rows,
    cwd: spec.cwd,
    env: env as { [k: string]: string },
  });

  let injected = false;
  const inject = () => {
    if (injected || !spec.prefillText) return;
    injected = true;
    child.write(PASTE_START + spec.prefillText + PASTE_END);
  };

  child.onData((data) => {
    process.stdout.write(data);
    if (!injected && spec.prefillText) {
      // Wait one paint after the first byte, then inject.
      setTimeout(inject, 80);
    }
  });

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  const onStdin = (buf: Buffer) => child.write(buf.toString("utf8"));
  process.stdin.on("data", onStdin);

  const onResize = () => {
    const c = process.stdout.columns ?? 100;
    const r = process.stdout.rows ?? 30;
    try { child.resize(c, r); } catch { /* ignore */ }
  };
  process.stdout.on("resize", onResize);

  return await new Promise<number>((resolve) => {
    child.onExit(({ exitCode }) => {
      process.stdin.off("data", onStdin);
      process.stdout.off("resize", onResize);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve(exitCode ?? 0);
    });
  });
}
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/continue-pty.ts
git commit -m "Add PTY launcher with bracketed-paste prefill"
```

---

### Task 9: macOS spawn launcher (mode B)

**Files:**
- Create: `src/lib/continue-spawn.ts`

- [ ] **Step 1: Implement `src/lib/continue-spawn.ts`**

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";

export interface SpawnNewWindowSpec {
  cwd: string;            // project directory (may be empty string)
  resumeId: string;
  clipboardText?: string; // user message text to pre-stage on clipboard
}

/**
 * macOS-only: pre-load `clipboardText` into the system clipboard, then ask
 * Terminal.app to open a fresh window running `cd <cwd> && claude --resume <id>`.
 */
export async function spawnNewWindow(spec: SpawnNewWindowSpec): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("spawnNewWindow is only supported on macOS");
  }

  if (spec.clipboardText) {
    await pbcopy(spec.clipboardText);
  }

  const cdSeg = spec.cwd ? `cd ${shellQuote(spec.cwd)} && ` : "";
  const cmd = `${cdSeg}claude --resume ${shellQuote(spec.resumeId)}`;
  const osa = `tell application "Terminal" to do script ${appleScriptString(cmd)}`;
  const child = spawn("osascript", ["-e", osa], { stdio: "ignore" });
  const [code] = await once(child, "exit") as [number];
  if (code !== 0) throw new Error(`osascript exited with code ${code}`);
}

async function pbcopy(text: string): Promise<void> {
  const child = spawn("pbcopy");
  child.stdin.write(text);
  child.stdin.end();
  const [code] = await once(child, "exit") as [number];
  if (code !== 0) throw new Error(`pbcopy exited with code ${code}`);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/continue-spawn.ts
git commit -m "Add macOS spawn launcher (pbcopy + osascript)"
```

---

### Task 10: Launcher dispatcher (`continue-launch.ts`)

**Files:**
- Create: `src/lib/continue-launch.ts`

- [ ] **Step 1: Implement `src/lib/continue-launch.ts`**

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import type { ContinueRequest } from "./continue-types.ts";
import { forkSession } from "./continue-fork.ts";
import { runPty } from "./continue-pty.ts";
import { spawnNewWindow } from "./continue-spawn.ts";

export interface ContinueResult {
  ok: boolean;
  /** Set when ok=false; printed before the process exits. */
  error?: string;
  /** When mode-A successfully ran, the child's exit code propagates here. */
  childExitCode?: number;
}

export async function executeContinue(req: ContinueRequest): Promise<ContinueResult> {
  // Pre-flight 1: claude on PATH
  if (!hasClaudeOnPath()) {
    return { ok: false, error: "claude not found in PATH" };
  }

  // Pre-flight 2: TTY (for mode A only)
  if (req.launchMode === "reuse-current" && !process.stdout.isTTY) {
    return { ok: false, error: "current stdout is not a TTY" };
  }

  // Pre-flight 3: platform support
  if (req.launchMode === "new-window" && process.platform !== "darwin") {
    return { ok: false, error: "\"new window\" mode is only supported on macOS" };
  }

  const newUuid = randomUUID();
  const dir = path.dirname(req.sourcePath);
  const dstPath = path.join(dir, `${newUuid}.jsonl`);

  try {
    await forkSession({
      srcPath: req.sourcePath,
      dstPath,
      targetUuid: req.targetUuid,
      targetRole: req.targetRole,
      newSessionId: newUuid,
    });
  } catch (e) {
    return { ok: false, error: `failed to fork session: ${(e as Error).message}` };
  }

  const cwd = await detectProjectCwd(req.sourcePath);

  if (req.launchMode === "reuse-current") {
    try {
      const code = await runPty({ cwd, resumeId: newUuid, prefillText: req.userText });
      return { ok: true, childExitCode: code };
    } catch (e) {
      await silentRemove(dstPath);
      return { ok: false, error: `failed to launch claude: ${(e as Error).message}` };
    }
  }

  // mode === "new-window"
  try {
    await spawnNewWindow({ cwd, resumeId: newUuid, clipboardText: req.userText });
    return { ok: true };
  } catch (e) {
    await silentRemove(dstPath);
    return { ok: false, error: `failed to launch claude: ${(e as Error).message}` };
  }
}

function hasClaudeOnPath(): boolean {
  // bun.which would be nice but we want this to work under plain Node too.
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

async function detectProjectCwd(sourcePath: string): Promise<string> {
  // The session lives in ~/.claude/projects/<slug>/<uuid>.jsonl. Decode the
  // slug back to a real path; if the directory doesn't exist anymore, fall
  // back to process.cwd() so claude at least starts somewhere.
  const slug = path.basename(path.dirname(sourcePath));
  const decoded = "/" + slug.replace(/^-/, "").replace(/-/g, "/");
  try {
    const stat = await fs.stat(decoded);
    if (stat.isDirectory()) return decoded;
  } catch { /* fall through */ }
  return process.cwd();
}

async function silentRemove(p: string): Promise<void> {
  try { await fs.unlink(p); } catch { /* ignore */ }
}
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/continue-launch.ts
git commit -m "Add continue launcher dispatcher"
```

---

### Task 11: Wire launcher into cli.tsx and end-to-end smoke

**Files:**
- Modify: `src/cli.tsx` (already partly done in Task 6 — finalize)

- [ ] **Step 1: Finalize cli.tsx**

```tsx
#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.tsx";
import type { ContinueRequest } from "./lib/continue-types.ts";

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

function printHelp() { /* unchanged */ }

const { path: initialPath, emoji } = parseArgs(process.argv);

let pendingContinue: ContinueRequest | null = null;
const inkApp = render(
  <App
    initialPath={initialPath}
    emoji={emoji}
    onRequestContinue={(req) => { pendingContinue = req; }}
  />
);

await inkApp.waitUntilExit();

if (pendingContinue) {
  const { executeContinue } = await import("./lib/continue-launch.ts");
  const result = await executeContinue(pendingContinue);
  if (!result.ok) {
    process.stderr.write(`open-context: ${result.error}\n`);
    process.exit(1);
  }
  process.exit(result.childExitCode ?? 0);
}
```

- [ ] **Step 2: typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 3: Smoke test (manual, requires real claude + at least one session)**

```bash
bun run dev
# 1. focus a session, enter preview
# 2. cursor on a user message → Enter → footer shows "Continue conversation"
# 3. Enter again → open-context exits, claude --resume opens in same terminal,
#    and the user message text appears in the input box, ready to edit/send.
# 4. Quit claude (Ctrl+D / /exit) → process returns to shell.
```

(If the prefill doesn't appear, raise the 80ms delay in `continue-pty.ts` to 200ms and retry.)

- [ ] **Step 4: Commit**

```bash
git add src/cli.tsx
git commit -m "Run continue launcher after Ink unmounts"
```

---

### Task 12: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Edit README**

  - Add a "Continue conversation" subsection under "Key bindings → Preview pane":
    "Enter on a user/assistant message → confirm footer → forks the conversation into a fresh `claude --resume` session."
  - Mention the new setting in a "Settings" paragraph.
  - Add a sentence near "Develop": "Native dependency: `@lydell/node-pty` ships prebuilt binaries; if your platform is unsupported, install Python 3 + a C++ toolchain so `node-gyp` can compile."

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document continue-conversation feature in README"
```

---

## Final verification

```bash
bun run typecheck
bun test
bun run build
```

All three should pass. Manual smoke from Task 11 covers the runtime path that tests can't.
