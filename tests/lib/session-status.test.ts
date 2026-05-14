import { describe, expect, test } from "bun:test";
import { deriveSessionStatusBySource } from "../../src/lib/session-status.ts";
import type { SessionMeta, Source } from "../../src/providers/types.ts";

const NOW = new Date("2026-05-10T12:00:00Z");

function meta(id: string, source: Source): SessionMeta {
  return {
    id,
    filePath: `/${id}.jsonl`,
    summary: id,
    projectPath: "/p",
    modifiedAt: NOW,
    messageCount: 1,
    source,
  };
}

describe("deriveSessionStatusBySource", () => {
  test("every source enabled with sessions → all ok", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true, "gemini": true },
      [meta("a", "claude-code"), meta("b", "codex"), meta("c", "gemini")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "ok", "gemini": "ok" });
  });

  test("enabled but no sessions for codex/gemini → those marked missing", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true, "gemini": true },
      [meta("a", "claude-code")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "missing", "gemini": "missing" });
  });

  test("disabled source is hidden regardless of sessions", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": false, "gemini": true },
      [meta("a", "claude-code"), meta("b", "codex"), meta("c", "gemini")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "hidden", "gemini": "ok" });
  });

  test("all disabled → all hidden", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": false, "codex": false, "gemini": false },
      [],
    );
    expect(status).toEqual({ "claude-code": "hidden", "codex": "hidden", "gemini": "hidden" });
  });

  test("all enabled, no sessions → all missing", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true, "gemini": true },
      [],
    );
    expect(status).toEqual({ "claude-code": "missing", "codex": "missing", "gemini": "missing" });
  });
});
