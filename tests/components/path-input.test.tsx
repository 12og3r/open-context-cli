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
