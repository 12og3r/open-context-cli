import { describe, expect, test } from "bun:test";
import { deriveSessionStatusBySource } from "../../src/lib/session-status.ts";
import type { SessionMeta } from "../../src/providers/types.ts";

const NOW = new Date("2026-05-10T12:00:00Z");

function meta(id: string, source: "claude-code" | "codex"): SessionMeta {
  return {
    id,
    filePath: `/${id}.jsonl`,
    summary: id,
    projectPath: "/p",
    modifiedAt: NOW,
    messageCounts: { concise: 1, full: 1 },
    source,
  };
}

describe("deriveSessionStatusBySource", () => {
  test("both sources enabled with sessions → both ok", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true },
      [meta("a", "claude-code"), meta("b", "codex")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "ok" });
  });

  test("both enabled but only claude has sessions → codex missing", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true },
      [meta("a", "claude-code")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "missing" });
  });

  test("disabled source is hidden regardless of sessions", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": false },
      [meta("a", "claude-code"), meta("b", "codex")],
    );
    expect(status).toEqual({ "claude-code": "ok", "codex": "hidden" });
  });

  test("all disabled → all hidden", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": false, "codex": false },
      [],
    );
    expect(status).toEqual({ "claude-code": "hidden", "codex": "hidden" });
  });

  test("all enabled, no sessions → all missing", () => {
    const status = deriveSessionStatusBySource(
      { "claude-code": true, "codex": true },
      [],
    );
    expect(status).toEqual({ "claude-code": "missing", "codex": "missing" });
  });
});
