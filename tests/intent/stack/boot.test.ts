import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isRuntimeRequired,
  REPO_ROOT,
  resolveAnyharnessRuntimeBin,
  terminateTracked,
  terminateTrackedChildren,
} from "./boot.ts";

test("ordinary browser stacks require AnyHarness; only explicit targeted postures omit it", () => {
  for (const mode of ["desktop-web", "hosted-web", "both"] as const) {
    assert.equal(isRuntimeRequired(mode, false), true);
    assert.equal(isRuntimeRequired(mode, true), false);
  }
  assert.equal(isRuntimeRequired(null, false), false);
});

test("teardown SIGKILLs a SIGTERM-stubborn process group before releasing its lock", async (context) => {
  if (process.platform === "win32") {
    context.skip("detached POSIX process-group semantics");
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), "intent-stubborn-child-"));
  const lock = path.join(directory, "run.lock");
  writeFileSync(lock, "owned\n");
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)"],
    { detached: true, stdio: "ignore" },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await terminateTrackedChildren(
      [child],
      lock,
      (tracked) => terminateTracked(tracked, { gracefulTimeoutMs: 50, killTimeoutMs: 2_000 }),
    );
    assert.equal(existsSync(lock), false);
    assert.throws(() => process.kill(-(child.pid as number), 0), { code: "ESRCH" });
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already proven gone.
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a teardown failure stays red and retains the profile lock", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "intent-teardown-failure-"));
  const lock = path.join(directory, "run.lock");
  writeFileSync(lock, "owned\n");
  try {
    await assert.rejects(
      terminateTrackedChildren(
        [{} as import("node:child_process").ChildProcess],
        lock,
        async () => {
          throw new Error("stubborn process group remains alive");
        },
      ),
      /retaining .*run\.lock/,
    );
    assert.equal(existsSync(lock), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an explicit AnyHarness binary must exist, be executable, and belong to this checkout", () => {
  const prior = process.env.ANYHARNESS_DEV_RUNTIME_BIN;
  const repoTarget = path.join(REPO_ROOT, "target");
  mkdirSync(repoTarget, { recursive: true });
  const inside = mkdtempSync(path.join(repoTarget, "intent-runtime-test-"));
  const outside = mkdtempSync(path.join(tmpdir(), "intent-runtime-test-"));
  try {
    const insideBin = executableFixture(inside);
    process.env.ANYHARNESS_DEV_RUNTIME_BIN = insideBin;
    assert.equal(resolveAnyharnessRuntimeBin(), insideBin);

    process.env.ANYHARNESS_DEV_RUNTIME_BIN = path.join(inside, "missing");
    assert.throws(resolveAnyharnessRuntimeBin, /does not exist/);

    const nonExecutableBin = path.join(inside, "not-executable");
    writeFileSync(nonExecutableBin, "not executable\n", { mode: 0o600 });
    process.env.ANYHARNESS_DEV_RUNTIME_BIN = nonExecutableBin;
    assert.throws(resolveAnyharnessRuntimeBin, { code: "EACCES" });

    const outsideBin = executableFixture(outside);
    process.env.ANYHARNESS_DEV_RUNTIME_BIN = outsideBin;
    assert.throws(resolveAnyharnessRuntimeBin, /must belong to the candidate checkout/);
  } finally {
    if (prior === undefined) {
      delete process.env.ANYHARNESS_DEV_RUNTIME_BIN;
    } else {
      process.env.ANYHARNESS_DEV_RUNTIME_BIN = prior;
    }
    rmSync(inside, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

function executableFixture(directory: string): string {
  const file = path.join(directory, "anyharness");
  writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}
