import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  openCleanupLedger,
  type CleanupLedger,
  type CleanupLedgerEntry,
} from "../local-workspace/cleanup-ledger.js";
import { ManagedCloudCleanupStack, type ManagedCloudCleanupKind } from "./cleanup-kinds.js";

async function stackInTemp(): Promise<{ stack: ManagedCloudCleanupStack; runDir: string }> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-cleanup-"));
  const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
  return { stack: new ManagedCloudCleanupStack({ ledger }), runDir };
}

/** Registers one entry per kind that a complete green cloud cell creates. */
async function registerFullGreenRun(stack: ManagedCloudCleanupStack, order: string[]): Promise<void> {
  const kinds: ManagedCloudCleanupKind[] = [
    "run_directory",
    "port_registration",
    "secret_env_file",
    "key_pair",
    "security_group",
    "ec2_instance",
    "route53_record",
    "e2b_template",
    "renderer_process",
    "browser",
    "litellm_team",
    "litellm_user",
    "litellm_virtual_key",
    "e2b_sandbox",
  ];
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

    // Reverse order: the scenario-registered sandbox first, run_directory last.
    assert.equal(order[0], "e2b_sandbox");
    assert.equal(order[order.length - 1], "run_directory");

    assert.equal(evidence.failed, 0);
    assert.equal(evidence.registered, 14);
    assert.equal(evidence.reconciled, 14);
    assert.equal(evidence.sandboxesDeleted, true);
    assert.equal(evidence.templateDeleted, true);
    assert.equal(evidence.dnsRecordDeleted, true);
    assert.equal(evidence.ec2Terminated, true);
    assert.equal(evidence.securityGroupDeleted, true);
    assert.equal(evidence.keyPairDeleted, true);
    assert.equal(evidence.virtualKeyDeleted, true);
    assert.equal(evidence.litellmSubjectsDeleted, true);
    assert.equal(evidence.localPathsRemoved, true);
    assert.match(evidence.ledgerIdHash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a releaser failure is counted (not thrown) and flips its category boolean", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const okId = await stack.register("route53_record", async () => undefined);
    await stack.acquired(okId, "sub.example");
    const badId = await stack.register("ec2_instance", async () => {
      throw new Error("terminate-instances failed");
    });
    await stack.acquired(badId, "i-123");

    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 1);
    assert.equal(evidence.reconciled, 1);
    assert.equal(evidence.ec2Terminated, false); // ec2_instance failed
    assert.equal(evidence.dnsRecordDeleted, true);
    // Categories with no registered entry are vacuously clean (true): a category
    // this run never touched cannot itself be evidence of a failure.
    assert.equal(evidence.templateDeleted, true);
    assert.equal(evidence.localPathsRemoved, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a failed releaser preserves the run directory (and its ledger) instead of letting run_directory delete it", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const order: string[] = [];
    // Registered first ⇒ released LAST (reverse order), same as the real world.
    const runDirId = await stack.register("run_directory", async () => {
      order.push("run_directory");
    });
    await stack.acquired(runDirId, runDir);

    const badId = await stack.register("ec2_instance", async () => {
      order.push("ec2_instance");
      throw new Error("instance still has a dependent ENI");
    });
    await stack.acquired(badId, "i-abc");

    const evidence = await stack.runAll();

    // The run_directory releaser must never have run: it would have deleted the
    // directory (and the ledger inside it) before a replay-by-run command could
    // find the unreconciled ec2_instance entry.
    assert.deepEqual(order, ["ec2_instance"]);
    assert.equal(evidence.failed, 2); // the instance failure + the deliberate run_directory skip
    assert.equal(evidence.reconciled, 0);
    assert.equal(evidence.ec2Terminated, false);
    assert.equal(evidence.localPathsRemoved, false);

    const ledgerPath = path.join(runDir, "cleanup-ledger.json");
    const persisted = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      entries: Array<{ kind: string; phase: string }>;
    };
    const instanceEntry = persisted.entries.find((entry) => entry.kind === "ec2_instance");
    assert.ok(instanceEntry);
    assert.notEqual(instanceEntry!.phase, "reconciled");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a category with a missing sub-kind still passes when its other kinds all reconcile", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    // litellmSubjectsDeleted needs ≥1 of {litellm_user, litellm_team}; register only the team.
    const id = await stack.register("litellm_team", async () => undefined);
    await stack.acquired(id, "team-1");
    const evidence = await stack.runAll();
    assert.equal(evidence.litellmSubjectsDeleted, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a ledger reconcile-write failure is non-green and preserves run_directory for replay", async () => {
  const entries: CleanupLedgerEntry[] = [];
  const ledger: CleanupLedger = {
    ledgerId: "run-1:shard-0",
    async registerIntent(kind, entryId) {
      const entry: CleanupLedgerEntry = {
        entryId,
        kind,
        phase: "intent",
        providerId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      entries.push(entry);
      return { ...entry };
    },
    async markAcquired(entryId, providerId) {
      const entry = entries.find((candidate) => candidate.entryId === entryId)!;
      entry.phase = "acquired";
      entry.providerId = providerId;
    },
    async markReconciled() {
      throw new Error("simulated durable ledger write failure");
    },
    entries: () => entries.map((entry) => ({ ...entry })),
    unreconciled: () => entries.filter((entry) => entry.phase !== "reconciled").map((entry) => ({ ...entry })).reverse(),
  };
  const order: string[] = [];
  const stack = new ManagedCloudCleanupStack({ ledger });
  const runDirId = await stack.register("run_directory", async () => { order.push("run_directory"); });
  await stack.acquired(runDirId, "/tmp/run");
  const instanceId = await stack.register("ec2_instance", async () => { order.push("ec2_instance"); });
  await stack.acquired(instanceId, "i-1");

  const evidence = await stack.runAll();
  assert.deepEqual(order, ["ec2_instance"], "run_directory must be preserved after reconcile persistence fails");
  assert.equal(evidence.failed, 2);
  assert.equal(evidence.reconciled, 0);
  assert.equal(evidence.ec2Terminated, false);
  assert.equal(evidence.localPathsRemoved, false);
});
