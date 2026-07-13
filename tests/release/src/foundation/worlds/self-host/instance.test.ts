import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reserveDisposableInstance } from "./instance.js";
import { LocalFileLedger } from "./local-ledger.js";
import { RUN_TAG_KEY, type ExecFn } from "./aws-cli.js";

async function tmpLedgerPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "instance-test-"));
  return join(dir, "ledger.json");
}

/** Records every invocation in order and returns a scripted response per command shape. */
function fakeExec(log: string[]): ExecFn {
  return async (cmd, args) => {
    const joined = `${cmd} ${args.join(" ")}`;
    log.push(joined);
    if (cmd === "curl") return "203.0.113.9";
    if (cmd === "aws") {
      if (joined.includes("ssm get-parameters")) {
        return JSON.stringify({ Parameters: [{ Value: "ami-0123456789abcdef0" }] });
      }
      if (joined.includes("create-key-pair")) return JSON.stringify("-----BEGIN KEY-----\nfake\n-----END KEY-----");
      if (joined.includes("create-security-group")) return JSON.stringify("sg-0abc123");
      if (joined.includes("authorize-security-group-ingress")) return "";
      if (joined.includes("run-instances")) return JSON.stringify("i-0abc123");
      if (joined.includes("wait instance-running")) return "";
      if (joined.includes("wait instance-status-ok")) return "";
      if (joined.includes("describe-instances")) return JSON.stringify("198.51.100.5");
      if (joined.includes("terminate-instances")) return "";
      if (joined.includes("wait instance-terminated")) return "";
      if (joined.includes("delete-security-group")) return "";
      if (joined.includes("delete-key-pair")) return "";
      throw new Error(`fakeExec: unhandled aws command: ${joined}`);
    }
    throw new Error(`fakeExec: unhandled command: ${joined}`);
  };
}

test("reserveDisposableInstance registers every AWS resource in the ledger before creating the next one", async () => {
  const calls: string[] = [];
  const exec = fakeExec(calls);
  const ledger = new LocalFileLedger(await tmpLedgerPath());

  const { instance, readiness } = await reserveDisposableInstance({
    exec,
    ledger,
    owningWorld: "self-host",
    runId: "run-abc",
    shardId: "shard-1",
    skipReadinessPoll: true,
  });

  assert.equal(instance.instanceId, "i-0abc123");
  assert.equal(instance.sgId, "sg-0abc123");
  assert.equal(instance.publicIp, "198.51.100.5");
  assert.equal(instance.dnsName, "198.51.100.5.sslip.io");

  const entries = await ledger.entries();
  const resourceTypesInOrder = entries.map((e) => e.resourceType);
  assert.deepEqual(resourceTypesInOrder, ["key-pair", "security-group", "instance"]);
  for (const entry of entries) {
    assert.equal(entry.state, "registered");
    assert.equal(entry.runId, "run-abc");
    assert.equal(entry.shardId, "shard-1");
  }

  // The key pair must be registered (ledgered) before the security group is
  // even created, and the security group before the instance — "ledgered
  // immediately... before it is handed to another operation".
  const keyPairCreateIdx = calls.findIndex((c) => c.includes("create-key-pair"));
  const sgCreateIdx = calls.findIndex((c) => c.includes("create-security-group"));
  const runInstancesIdx = calls.findIndex((c) => c.includes("run-instances"));
  assert.ok(keyPairCreateIdx < sgCreateIdx, "key pair must be created (and ledgered) before the security group");
  assert.ok(sgCreateIdx < runInstancesIdx, "security group must be created (and ledgered) before the instance");

  // Every created resource carries the TTL/run tag so an abandoned-run
  // janitor can find it even if this process never reaches teardown.
  const runInstancesCall = calls.find((c) => c.includes("run-instances")) ?? "";
  assert.match(runInstancesCall, new RegExp(RUN_TAG_KEY));
  assert.match(runInstancesCall, /run-abc/);

  assert.ok(readiness.some((r) => r.check === "instance-running" && r.ok));
  assert.ok(readiness.some((r) => r.check === "instance-status-ok" && r.ok));
});

test("reserveDisposableInstance never mutates proliferate-prod*: every named resource is dedicated and run-scoped", async () => {
  const calls: string[] = [];
  const exec = fakeExec(calls);
  const ledger = new LocalFileLedger(await tmpLedgerPath());

  await reserveDisposableInstance({
    exec,
    ledger,
    owningWorld: "self-host",
    runId: "run-xyz",
    skipReadinessPoll: true,
  });

  for (const call of calls) {
    assert.doesNotMatch(call, /proliferate-prod/);
  }
  const keyPairCall = calls.find((c) => c.includes("create-key-pair")) ?? "";
  assert.match(keyPairCall, /selfhost-e2e-run-xyz/);
});

test("teardown terminates the instance, deletes the security group, then the key pair — reverse of creation order", async () => {
  const calls: string[] = [];
  const exec = fakeExec(calls);
  const ledger = new LocalFileLedger(await tmpLedgerPath());

  await reserveDisposableInstance({
    exec,
    ledger,
    owningWorld: "self-host",
    runId: "run-teardown",
    skipReadinessPoll: true,
  });

  const teardownCallsBefore = calls.length;
  const reconciliation = await ledger.reconcile();
  assert.equal(reconciliation.complete, true);
  assert.equal(reconciliation.cleaned, 3);

  const teardownCalls = calls.slice(teardownCallsBefore);
  const terminateIdx = teardownCalls.findIndex((c) => c.includes("terminate-instances"));
  const deleteSgIdx = teardownCalls.findIndex((c) => c.includes("delete-security-group"));
  const deleteKeyIdx = teardownCalls.findIndex((c) => c.includes("delete-key-pair"));
  assert.ok(terminateIdx < deleteSgIdx, "instance must be terminated before the security group is deleted");
  assert.ok(deleteSgIdx < deleteKeyIdx, "security group must be deleted before the key pair");
});

test("SSH/docker readiness poll failure throws a named error rather than returning a half-ready instance", async () => {
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args) => {
    if (cmd === "ssh") {
      calls.push("ssh-probe");
      throw new Error("ssh: connection refused"); // sshProbe swallows this into "" per its contract
    }
    return fakeExec(calls)(cmd, args);
  };
  const ledger = new LocalFileLedger(await tmpLedgerPath());

  await assert.rejects(
    () =>
      reserveDisposableInstance({
        exec,
        ledger,
        owningWorld: "self-host",
        runId: "run-fail",
        skipReadinessPoll: false,
        readinessPollAttempts: 2,
        readinessPollIntervalMs: 1,
      }),
    /SSH\/docker never came up/,
  );

  // The instance and its dependencies were still ledgered before the failed
  // readiness poll — a crash here must not orphan the box silently.
  const entries = await ledger.entries();
  assert.equal(entries.length, 3);
});
