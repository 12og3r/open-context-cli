import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runUpdate } from "../../src/lib/update.ts";

// A minimal stand-in for ChildProcess: emits "exit" or "error" once a
// listener has subscribed, mimicking what node:child_process.spawn returns.
function makeFakeChild() {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, { kill: () => {} });
  return {
    child,
    emitExit(code: number) { setImmediate(() => emitter.emit("exit", code)); },
    emitError(err: NodeJS.ErrnoException) { setImmediate(() => emitter.emit("error", err)); },
  };
}

describe("runUpdate", () => {
  test("spawns the resolved package-manager command and resolves with its exit code", async () => {
    const fake = makeFakeChild();
    const spawn = mock((_exe: string, _args: string[], _opts: object) => {
      fake.emitExit(0);
      return fake.child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    });
    const stderr: string[] = [];
    const code = await runUpdate(
      { version: "0.2.0" },
      {
        spawn: spawn as never,
        scriptPath: "/Users/foo/.bun/install/global/node_modules/@12og3r/openctx/dist/cli.js",
        stderr: (s) => stderr.push(s),
      },
    );
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [exe, args] = spawn.mock.calls[0]!;
    expect(exe).toBe("bun");
    expect(args).toEqual(["add", "-g", "@12og3r/openctx@0.2.0"]);
    // The "Running: ..." preview should make it to stderr so the user
    // sees what's about to happen even though stdio: "inherit" hands the
    // child's own output through.
    expect(stderr.join("")).toContain("bun add -g @12og3r/openctx@0.2.0");
  });

  test("falls back to npm and uses the bare spec when no version is given", async () => {
    const fake = makeFakeChild();
    const spawn = mock((_exe: string, _args: string[], _opts: object) => {
      fake.emitExit(0);
      return fake.child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    });
    const code = await runUpdate(
      {},
      {
        spawn: spawn as never,
        scriptPath: "/usr/local/lib/node_modules/@12og3r/openctx/dist/cli.js",
        stderr: () => {},
      },
    );
    expect(code).toBe(0);
    const [exe, args] = spawn.mock.calls[0]!;
    expect(exe).toBe("npm");
    expect(args).toEqual(["install", "-g", "@12og3r/openctx"]);
  });

  test("returns 1 with a friendly message when the package manager is missing from PATH", async () => {
    const fake = makeFakeChild();
    const spawn = mock((_exe: string, _args: string[], _opts: object) => {
      const err: NodeJS.ErrnoException = new Error("spawn npm ENOENT");
      err.code = "ENOENT";
      fake.emitError(err);
      return fake.child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    });
    const stderr: string[] = [];
    const code = await runUpdate(
      {},
      {
        spawn: spawn as never,
        scriptPath: "/usr/local/lib/node_modules/@12og3r/openctx/dist/cli.js",
        stderr: (s) => stderr.push(s),
      },
    );
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("npm not found in PATH");
  });
});
