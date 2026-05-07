import { describe, expect, test } from "bun:test";
import { decodeProjectPath } from "../../src/lib/decode-project-path.ts";

describe("decodeProjectPath", () => {
  test("decodes a typical macOS path", () => {
    expect(decodeProjectPath("-Users-roger-projects-foo"))
      .toBe("/Users/roger/projects/foo");
  });

  test("decodes paths with hyphenated segment names", () => {
    // "-Users-roger-projects-claude-history" — segment "claude-history" has
    // a real hyphen. We accept the ambiguity and join with "/" between
    // every dash; if the original directory had hyphens they collapse to
    // slashes. Document this and accept it as a known limitation.
    expect(decodeProjectPath("-Users-roger-projects-claude-history"))
      .toBe("/Users/roger/projects/claude/history");
  });

  test("returns empty string for unrecognized format", () => {
    expect(decodeProjectPath("not-a-project")).toBe("");
    expect(decodeProjectPath("")).toBe("");
  });

  test("requires the leading dash", () => {
    expect(decodeProjectPath("Users-roger-projects-foo")).toBe("");
  });
});
