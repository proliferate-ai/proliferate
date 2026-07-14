import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { LocalWorldCleanupStack } from "./cleanup.js";
import { openCleanupLedger } from "./cleanup-ledger.js";

async function stackInTemp(): Promise<{ stack: LocalWorldCleanupStack; runDir: string }> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "cleanup-stack-"));
  const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
  return { stack: new LocalWorldCleanupStack({ ledger }), runDir };
}

/** Registers one entry per kind that a complete green run creates. */
async function registerFullGreenRun(stack: LocalWorldCleanupStack, order: string[]): Promise<void> {
  const kinds = [
    "run_directory",
    "port_registration",
    "runtime_home",
    "extracted_artifacts",
    "docker_network",
    "postgres_container",
    "redis_container",
    "server_container",
    "anyharness_process",
    "renderer_process",
    "browser",
    "litellm_team",
    "litellm_user",
    "litellm_virtual_key",
  ] as const;
  for (const kind of kinds) {
    const id = await stack.register(kind, async () => {
      order.push(kind);
    });
    await stack.acquired(id, `${kind}-id`);
  }
}

test("runAll releases in reverse registration order and reports a fully-clean summary", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const order: string[] = [];
    await registerFullGreenRun(stack, order);
    const evidence = await stack.runAll();

    // Reverse order: litellm subjects first (registered last), run_directory last.
    assert.equal(order[0], "litellm_virtual_key");
    assert.equal(order[order.length - 1], "run_directory");

    assert.equal(evidence.failed, 0);
    assert.equal(evidence.registered, 14);
    assert.equal(evidence.reconciled, 14);
    assert.equal(evidence.virtualKeyDeleted, true);
    assert.equal(evidence.litellmSubjectsDeleted, true);
    assert.equal(evidence.browserClosed, true);
    assert.equal(evidence.processesStopped, true);
    assert.equal(evidence.containersRemoved, true);
    assert.equal(evidence.localPathsRemoved, true);
    assert.match(evidence.ledgerIdHash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a releaser failure is counted (not thrown) and flips its category boolean", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const okId = await stack.register("browser", async () => undefined);
    await stack.acquired(okId, "chromium");
    const badId = await stack.register("server_container", async () => {
      throw new Error("docker rm failed");
    });
    await stack.acquired(badId, "srv");

    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 1);
    assert.equal(evidence.reconciled, 1);
    assert.equal(evidence.containersRemoved, false); // server_container failed
    assert.equal(evidence.browserClosed, true);
    // Categories with no registered entry are false (an incomplete run cannot be green).
    assert.equal(evidence.virtualKeyDeleted, false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a category with a missing sub-kind still passes when its other kinds all reconcile", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    // localPathsRemoved needs ≥1 of its kinds; register only run_directory.
    const id = await stack.register("run_directory", async () => undefined);
    await stack.acquired(id, "rundir");
    const evidence = await stack.runAll();
    assert.equal(evidence.localPathsRemoved, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
