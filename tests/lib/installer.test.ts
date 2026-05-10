import { describe, expect, test } from "bun:test";
import {
  detectInstaller,
  installCommand,
  type Installer,
} from "../../src/lib/installer.ts";

// detectInstaller takes an already-realpath'd absolute path so the
// classifier itself stays pure (no filesystem hits in the unit test).
// The caller in update.ts is responsible for resolving symlinks first.
describe("detectInstaller", () => {
  const cases: Array<[string, Installer]> = [
    // npm — covers /usr/local, nvm, homebrew, volta-style paths.
    ["/usr/local/lib/node_modules/@12og3r/openctx/dist/cli.js", "npm"],
    ["/Users/foo/.nvm/versions/node/v20.0.0/lib/node_modules/@12og3r/openctx/dist/cli.js", "npm"],
    ["/opt/homebrew/lib/node_modules/@12og3r/openctx/dist/cli.js", "npm"],
    ["/Users/foo/.volta/tools/image/node/20.0.0/lib/node_modules/@12og3r/openctx/dist/cli.js", "npm"],
    // bun
    ["/Users/foo/.bun/install/global/node_modules/@12og3r/openctx/dist/cli.js", "bun"],
    // pnpm — both the ~/.local/share/pnpm and Linux /pnpm-store layouts
    // share the literal /pnpm/ segment after realpath resolution.
    ["/Users/foo/.local/share/pnpm/global/5/node_modules/@12og3r/openctx/dist/cli.js", "pnpm"],
    // yarn 1 global
    ["/Users/foo/.config/yarn/global/node_modules/@12og3r/openctx/dist/cli.js", "yarn"],
  ];
  for (const [path, expected] of cases) {
    test(`classifies ${path} as ${expected}`, () => {
      expect(detectInstaller(path)).toBe(expected);
    });
  }
});

describe("installCommand", () => {
  const PKG = "@12og3r/openctx";

  test("npm without version uses bare specifier", () => {
    expect(installCommand("npm", undefined)).toEqual({
      exe: "npm",
      args: ["install", "-g", PKG],
    });
  });
  test("npm with version appends @<ver>", () => {
    expect(installCommand("npm", "0.2.0")).toEqual({
      exe: "npm",
      args: ["install", "-g", `${PKG}@0.2.0`],
    });
  });
  test("bun uses `add -g`", () => {
    expect(installCommand("bun", undefined)).toEqual({
      exe: "bun",
      args: ["add", "-g", PKG],
    });
    expect(installCommand("bun", "0.2.0")).toEqual({
      exe: "bun",
      args: ["add", "-g", `${PKG}@0.2.0`],
    });
  });
  test("pnpm uses `add -g`", () => {
    expect(installCommand("pnpm", undefined)).toEqual({
      exe: "pnpm",
      args: ["add", "-g", PKG],
    });
    expect(installCommand("pnpm", "0.2.0")).toEqual({
      exe: "pnpm",
      args: ["add", "-g", `${PKG}@0.2.0`],
    });
  });
  test("yarn uses `global add`", () => {
    expect(installCommand("yarn", undefined)).toEqual({
      exe: "yarn",
      args: ["global", "add", PKG],
    });
    expect(installCommand("yarn", "0.2.0")).toEqual({
      exe: "yarn",
      args: ["global", "add", `${PKG}@0.2.0`],
    });
  });
});
