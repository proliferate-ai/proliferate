import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openCleanupLedger } from "../local-workspace/cleanup-ledger.js";
import { SelfHostCleanupStack, type SelfHostCleanupResourceKind } from "./cleanup-kinds.js";

async function stackInTemp(): Promise<{ stack: SelfHostCleanupStack; runDir: string }> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-cleanup-"));
  const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
  return { stack: new SelfHostCleanupStack({ ledger }), runDir };
}

/** One entry per kind a complete green self-host run creates, in registration order. */
async function registerFullGreenRun(stack: SelfHostCleanupStack, order: string[]): Promise<void> {
  const kinds: SelfHostCleanupResourceKind[] = [
    "run_directory",
    "port_registration",
    "runtime_home",
    "extracted_artifacts",
    "key_pair",
    "security_group",
    "ec2_instance",
    "route53_record",
    "anyharness_process",
    "renderer_process",
    "browser",
  ];
  for (const kind of kinds) {
    const id = await stack.register(kind, async () => {
      order.push(kind);
    });
    await stack.acquired(id, `${kind}-id`);
  }
}

test("runAll releases in reverse order and reports a fully-clean self-host summary", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const order: string[] = [];
    await registerFullGreenRun(stack, order);
    const evidence = await stack.runAll();

    // Reverse order: browser (registered last) first, run_directory last.
    assert.equal(order[0], "browser");
    assert.equal(order[order.length - 1], "run_directory");

    assert.equal(evidence.failed, 0);
    assert.equal(evidence.registered, 11);
    assert.equal(evidence.reconciled, 11);
    assert.equal(evidence.ec2Terminated, true);
    assert.equal(evidence.securityGroupDeleted, true);
    assert.equal(evidence.keyPairDeleted, true);
    assert.equal(evidence.route53RecordDeleted, true);
    assert.equal(evidence.browserClosed, true);
    assert.equal(evidence.processesStopped, true);
    assert.equal(evidence.localPathsRemoved, true);
    assert.match(evidence.ledgerIdHash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("the AWS teardown order releases the instance before the security group and key pair", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const order: string[] = [];
    for (const kind of ["key_pair", "security_group", "ec2_instance", "route53_record"] as SelfHostCleanupResourceKind[]) {
      const id = await stack.register(kind, async () => {
        order.push(kind);
      });
      await stack.acquired(id, `${kind}-id`);
    }
    await stack.runAll();
    // Registered key_pair→sg→ec2→route53, so reverse teardown is route53→ec2→sg→key_pair:
    // the record and instance go before the SG (ENI-detach lag) and key pair.
    assert.deepEqual(order, ["route53_record", "ec2_instance", "security_group", "key_pair"]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("processesStopped needs BOTH the anyharness and renderer processes reconciled", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const okId = await stack.register("anyharness_process", async () => undefined);
    await stack.acquired(okId, "pid:1");
    const badId = await stack.register("renderer_process", async () => {
      throw new Error("renderer would not stop");
    });
    await stack.acquired(badId, "pid:2");

    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 1);
    assert.equal(evidence.processesStopped, false); // one of the two failed
    // Categories with no registered entry cannot be green (an incomplete run).
    assert.equal(evidence.ec2Terminated, false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a failed AWS releaser preserves the run directory (and its ledger) for replay-by-run", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const order: string[] = [];
    const runDirId = await stack.register("run_directory", async () => {
      order.push("run_directory");
    });
    await stack.acquired(runDirId, runDir);

    const badId = await stack.register("security_group", async () => {
      order.push("security_group");
      throw new Error("DependencyViolation: SG still has a network interface");
    });
    await stack.acquired(badId, "sg-name");

    const evidence = await stack.runAll();

    // run_directory must NOT run: it would delete the ledger the replay needs.
    assert.deepEqual(order, ["security_group"]);
    assert.equal(evidence.failed, 2); // the SG failure + the deliberate run_directory skip
    assert.equal(evidence.securityGroupDeleted, false);
    assert.equal(evidence.localPathsRemoved, false);

    const persisted = JSON.parse(await readFile(path.join(runDir, "cleanup-ledger.json"), "utf8")) as {
      entries: Array<{ kind: string; phase: string }>;
    };
    const sgEntry = persisted.entries.find((entry) => entry.kind === "security_group");
    assert.ok(sgEntry);
    assert.notEqual(sgEntry!.phase, "reconciled");
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
