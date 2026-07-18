import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  clearCancellationFinalizersForTest,
  finalizeRegisteredForSignal,
  registerCancellationFinalizer,
} from "./cancellation-finalizer.js";
import type { RunIdentityV1 } from "../runner/identity.js";

const SHA = "a".repeat(40);

afterEach(() => clearCancellationFinalizersForTest());

function run(runId: string, shardId = "1"): RunIdentityV1 {
  return {
    run_id: runId,
    shard_id: shardId,
    attempt: 2,
    source_sha: SHA,
    origin: { kind: "github_actions", github_run_id: "123", github_job: "qualification" },
  };
}

test("SIGTERM uses the same memoized world finalizers in reverse registration order", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qualification-cancel-"));
  try {
    const calls: string[] = [];
    registerCancellationFinalizer({
      world: "managed-cloud",
      run: run("qlc-123"),
      runDir: path.join(dir, "managed", "1"),
      finalize: async () => {
        calls.push("managed-cloud");
        return { failed: 0 };
      },
    });
    registerCancellationFinalizer({
      world: "self-host",
      run: run("qs-123"),
      runDir: path.join(dir, "self-host", "1"),
      finalize: async () => {
        calls.push("self-host");
        return { failed: 0 };
      },
    });

    await finalizeRegisteredForSignal("SIGTERM");
    await finalizeRegisteredForSignal("SIGTERM");
    assert.deepEqual(calls, ["self-host", "managed-cloud"]);

    const managed = JSON.parse(await readFile(path.join(dir, "managed", "1-cancellation-finalization.json"), "utf8"));
    assert.deepEqual(managed.run, { run_id: "qlc-123", shard_id: "1", attempt: 2, source_sha: SHA });
    assert.equal(managed.world, "managed-cloud");
    assert.equal(managed.signal, "SIGTERM");
    assert.equal(managed.status, "reconciled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normal close and cancellation share one finalizer invocation", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qualification-cancel-once-"));
  try {
    let calls = 0;
    const handle = registerCancellationFinalizer({
      world: "local",
      run: run("ql-123"),
      runDir: path.join(dir, "local", "1"),
      finalize: async () => {
        calls += 1;
        return { failed: 0 };
      },
    });
    await Promise.all([handle.run(), handle.run()]);
    await finalizeRegisteredForSignal("SIGINT");
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a cancellation cleanup failure remains identity-bound and red", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qualification-cancel-failed-"));
  try {
    registerCancellationFinalizer({
      world: "self-host",
      run: run("qs-failed"),
      runDir: path.join(dir, "self-host", "1"),
      finalize: async () => {
        throw new Error("secret provider payload must not escape");
      },
    });
    await finalizeRegisteredForSignal("SIGINT");
    const raw = await readFile(path.join(dir, "self-host", "1-cancellation-finalization.json"), "utf8");
    const receipt = JSON.parse(raw);
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.run.run_id, "qs-failed");
    assert.doesNotMatch(raw, /secret provider payload/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-throwing cleanup summary with failed resources stays red", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qualification-cancel-summary-failed-"));
  try {
    registerCancellationFinalizer({
      world: "managed-cloud",
      run: run("qlc-summary-failed"),
      runDir: path.join(dir, "managed", "1"),
      finalize: async () => ({ reconciled: 2, failed: 1 }),
    });
    await finalizeRegisteredForSignal("SIGTERM");
    const raw = await readFile(path.join(dir, "managed", "1-cancellation-finalization.json"), "utf8");
    const receipt = JSON.parse(raw);
    assert.equal(receipt.status, "failed");
    assert.match(receipt.reason, /reported failures/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
