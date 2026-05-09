import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { DeleteConfirm } from "../../src/components/delete-confirm.tsx";
import type { SessionMeta } from "../../src/providers/types.ts";

const session: SessionMeta = {
  id: "01234567-89ab-cdef-0123-456789abcdef",
  filePath: "/tmp/claude/.../01234567-89ab-cdef-0123-456789abcdef.jsonl",
  summary: "测试会话 example",
  projectPath: "/tmp/proj",
  modifiedAt: new Date(0),
  messageCount: 12,
};

describe("DeleteConfirm", () => {
  test("shows the session summary and the danger copy", () => {
    const { lastFrame } = render(
      <DeleteConfirm session={session} cursor="cancel" width={80} height={16} />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Delete this session?");
    expect(out).toContain("测试会话 example");
    expect(out).toContain("cannot be undone");
  });

  test("highlights the cursor target", () => {
    // Cancel cursor: the Cancel pill is highlighted; Delete is plain.
    const cancelOut = render(
      <DeleteConfirm session={session} cursor="cancel" width={80} height={16} />
    ).lastFrame() ?? "";
    expect(cancelOut).toMatch(/Cancel/);
    expect(cancelOut).toMatch(/Delete/);

    // Delete cursor: the Delete pill is highlighted.
    const deleteOut = render(
      <DeleteConfirm session={session} cursor="delete" width={80} height={16} />
    ).lastFrame() ?? "";
    expect(deleteOut).toMatch(/Delete/);
  });

  test("shows the busy line while a deletion is in flight", () => {
    const { lastFrame } = render(
      <DeleteConfirm session={session} cursor="delete" width={80} height={16} busy={true} />
    );
    expect(lastFrame() ?? "").toContain("deleting");
  });

  test("surfaces an error message instead of the hint when the unlink fails", () => {
    const { lastFrame } = render(
      <DeleteConfirm
        session={session}
        cursor="delete"
        width={80}
        height={16}
        error="EACCES: permission denied"
      />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("EACCES: permission denied");
    expect(out).not.toContain("⏎ confirm");
  });
});
