import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { reapManagedCloudAwsForWorkflowAttempt } from "./reap-managed-cloud-aws.mjs";

const WORKFLOW_RUN_ID = "29568030333";
const WORKFLOW_ATTEMPT = "1";
const RUN_ID = `qlc-ci-${WORKFLOW_RUN_ID}-${WORKFLOW_ATTEMPT}`;
const CLEANUP_SHA = "b".repeat(40);
const REGION = "us-east-1";
const ZONE = "Z123ABC";
const SCRIPT = fileURLToPath(new URL("./reap-managed-cloud-aws.mjs", import.meta.url));

function exactTags() {
  return [
    { Key: "Purpose", Value: "managed-cloud-qualification" },
    { Key: "RunId", Value: RUN_ID },
    { Key: "ShardId", Value: "1" },
  ];
}

function delayedAws(visibleAt = {}, failures = {}) {
  const calls = [];
  const deleted = { instance: false, securityGroup: false, keyPair: false, dns: false };
  let generation = 0;
  const visible = (kind) => generation >= (visibleAt[kind] ?? Number.POSITIVE_INFINITY) && !deleted[kind];
  const exec = async (file, args) => {
    assert.equal(file, "aws");
    calls.push([...args]);
    const command = `${args[0]} ${args[1]}`;
    if (command === "ec2 describe-instances") {
      generation += 1;
      if (failures.instances) throw new Error("EC2 unavailable");
      return {
        stdout: JSON.stringify({
          Reservations: visible("instance") ? [{ Instances: [{
            InstanceId: "i-late123",
            State: { Name: "running" },
            PublicIpAddress: "192.0.2.4",
            Tags: exactTags(),
          }] }] : [],
        }),
        stderr: "",
      };
    }
    if (command === "ec2 describe-security-groups") {
      return {
        stdout: JSON.stringify({ SecurityGroups: visible("securityGroup") ? [{
          GroupId: "sg-late123",
          GroupName: `mcq-${RUN_ID}-1-sg`,
          Tags: exactTags(),
        }] : [] }),
        stderr: "",
      };
    }
    if (command === "ec2 describe-key-pairs") {
      return {
        stdout: JSON.stringify({ KeyPairs: visible("keyPair") ? [{
          KeyName: `mcq-${RUN_ID}-1-key`,
          Tags: exactTags(),
        }] : [] }),
        stderr: "",
      };
    }
    if (command === "route53 list-resource-record-sets") {
      if (failures.dns) throw new Error("Route53 unavailable");
      return {
        stdout: JSON.stringify({
          ResourceRecordSets: visible("dns") ? [{
            Name: `${RUN_ID}-f85c.qualification.proliferate.com.`,
            Type: "A",
            TTL: 60,
            ResourceRecords: [{ Value: "192.0.2.4" }],
          }] : [],
          IsTruncated: false,
        }),
        stderr: "",
      };
    }
    if (command === "ec2 terminate-instances") deleted.instance = true;
    else if (command === "ec2 delete-security-group") deleted.securityGroup = true;
    else if (command === "ec2 delete-key-pair") deleted.keyPair = true;
    else if (command === "route53 change-resource-record-sets") deleted.dns = true;
    else if (command !== "ec2 wait") throw new Error(`unexpected AWS command: ${command}`);
    return { stdout: "{}", stderr: "" };
  };
  return { calls, deleted, exec, get generation() { return generation; } };
}

function cleanupInputs() {
  return {
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  };
}

test("late EC2 and Route53 visibility cannot produce not_needed", async () => {
  const fake = delayedAws({ instance: 6, securityGroup: 6, keyPair: 6, dns: 6 });
  const sleeps = [];
  const report = await reapManagedCloudAwsForWorkflowAttempt(cleanupInputs(), {
    exec: fake.exec,
    sleep: async (ms) => sleeps.push(ms),
  });

  assert.equal(report.status, "reconciled");
  assert.deepEqual(report.runs[0].discovered, {
    instances: 1,
    security_groups: 1,
    key_pairs: 1,
    dns_records: 1,
  });
  assert.deepEqual(fake.deleted, { instance: true, securityGroup: true, keyPair: true, dns: true });
  assert.deepEqual(sleeps, [5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000, 60_000]);
});

test("an all-empty run requires a spaced three-minute stability window", async () => {
  const fake = delayedAws();
  const sleeps = [];
  const report = await reapManagedCloudAwsForWorkflowAttempt(cleanupInputs(), {
    exec: fake.exec,
    sleep: async (ms) => sleeps.push(ms),
  });

  assert.equal(report.status, "not_needed");
  assert.equal(fake.generation, 7);
  assert.deepEqual(sleeps, [5_000, 10_000, 20_000, 30_000, 60_000, 60_000]);
});

test("a resource first visible on the final probe remains failed after deletion", async () => {
  const fake = delayedAws({ keyPair: 3, securityGroup: 6, instance: 9, dns: 10 });
  await assert.rejects(
    () => reapManagedCloudAwsForWorkflowAttempt(cleanupInputs(), {
      exec: fake.exec,
      sleep: async () => {},
    }),
    (error) => {
      assert.equal(error.cleanupReceipt.status, "failed");
      assert.equal(error.cleanupReceipt.runs[0].discovered.instances, 1);
      assert.equal(error.cleanupReceipt.runs[0].discovered.dns_records, 1);
      assert.match(error.message, /lack post-delete absence proof/);
      return true;
    },
  );
  assert.equal(fake.deleted.instance, true);
  assert.equal(fake.deleted.dns, true);
});

test("one ambiguous category stays red while late independent siblings are reclaimed", async () => {
  const dnsFailed = delayedAws({ instance: 3 }, { dns: true });
  await assert.rejects(
    () => reapManagedCloudAwsForWorkflowAttempt(cleanupInputs(), {
      exec: dnsFailed.exec,
      sleep: async () => {},
    }),
    (error) => {
      assert.equal(error.cleanupReceipt.runs[0].discovered.instances, 1);
      assert.match(error.message, /dns-discovery: Route53 unavailable/);
      return true;
    },
  );
  assert.equal(dnsFailed.deleted.instance, true);

  const ec2Failed = delayedAws({ dns: 3 }, { instances: true });
  await assert.rejects(
    () => reapManagedCloudAwsForWorkflowAttempt(cleanupInputs(), {
      exec: ec2Failed.exec,
      sleep: async () => {},
    }),
    (error) => {
      assert.equal(error.cleanupReceipt.runs[0].discovered.dns_records, 1);
      assert.match(error.message, /instances-discovery: EC2 unavailable/);
      return true;
    },
  );
  assert.equal(ec2Failed.deleted.dns, true);
});

function runCli(extraArgs, env = {}) {
  return spawnSync(process.execPath, [
    SCRIPT,
    "--workflow-run-id", WORKFLOW_RUN_ID,
    "--workflow-run-attempt", WORKFLOW_ATTEMPT,
    "--cleanup-sha", CLEANUP_SHA,
    ...extraArgs,
  ], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      RELEASE_E2E_CLOUD_AWS_REGION: "",
      RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: "",
      ...env,
    },
  });
}

test("unknown and duplicate flags preserve only unambiguous safe receipt identity", () => {
  const unknown = runCli(["--unexpected", "value"]);
  assert.equal(unknown.status, 2);
  assert.deepEqual(JSON.parse(unknown.stdout), {
    kind: "managed_cloud_aws_hard_cancel_cleanup",
    schema_version: 1,
    workflow_run_id: WORKFLOW_RUN_ID,
    workflow_run_attempt: 1,
    cleanup_sha: CLEANUP_SHA,
    status: "failed",
    reason: "Unknown argument --unexpected.",
  });

  const duplicate = runCli(["--workflow-run-attempt", WORKFLOW_ATTEMPT]);
  const duplicateRow = JSON.parse(duplicate.stdout);
  assert.equal(duplicate.status, 2);
  assert.equal(duplicateRow.workflow_run_attempt, 1);
  assert.equal(duplicateRow.reason, "Duplicate argument --workflow-run-attempt.");

  const conflicting = runCli(["--workflow-run-attempt", "2"]);
  const conflictingRow = JSON.parse(conflicting.stdout);
  assert.equal(conflicting.status, 2);
  assert.equal("workflow_run_attempt" in conflictingRow, false);
  assert.equal(conflictingRow.reason, "Duplicate argument --workflow-run-attempt.");
});

function initialReceipt() {
  return {
    kind: "managed_cloud_aws_hard_cancel_cleanup",
    schema_version: 1,
    workflow_run_id: WORKFLOW_RUN_ID,
    workflow_run_attempt: 1,
    cleanup_sha: CLEANUP_SHA,
    status: "failed",
    reason: "AWS cleanup process did not emit a terminal receipt (timeout, crash, or runner interruption).",
  };
}

async function waitForFile(file) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${file}`);
}

test("SIGKILL leaves the initialized identity-bound receipt intact", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "managed-cloud-aws-kill-"));
  const receiptPath = path.join(directory, "report.json");
  const readyPath = path.join(directory, "ready");
  const fakeAws = path.join(directory, "aws");
  const expected = `${JSON.stringify(initialReceipt())}\n`;
  writeFileSync(receiptPath, expected, { mode: 0o600 });
  writeFileSync(fakeAws, "#!/bin/sh\n: > \"$FAKE_AWS_READY\"\nexec sleep 30\n", { mode: 0o700 });
  chmodSync(fakeAws, 0o700);
  const child = spawn(process.execPath, [
    SCRIPT,
    "--workflow-run-id", WORKFLOW_RUN_ID,
    "--workflow-run-attempt", WORKFLOW_ATTEMPT,
    "--cleanup-sha", CLEANUP_SHA,
  ], {
    detached: true,
    stdio: "ignore",
    env: {
      PATH: `${directory}:${process.env.PATH}`,
      FAKE_AWS_READY: readyPath,
      RELEASE_E2E_CLOUD_AWS_REGION: REGION,
      RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: ZONE,
      RELEASE_E2E_CLOUD_AWS_RECEIPT_PATH: receiptPath,
    },
  });
  try {
    await waitForFile(readyPath);
    process.kill(-child.pid, "SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    assert.equal(readFileSync(receiptPath, "utf8"), expected);
    assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a completed CLI failure atomically replaces the initialized receipt", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "managed-cloud-aws-terminal-"));
  const receiptPath = path.join(directory, "report.json");
  writeFileSync(receiptPath, `${JSON.stringify(initialReceipt())}\n`, { mode: 0o600 });
  try {
    const result = runCli([], { RELEASE_E2E_CLOUD_AWS_RECEIPT_PATH: receiptPath });
    const row = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(result.status, 2);
    assert.equal(row.reason, "AWS region is malformed.");
    assert.equal(row.workflow_run_id, WORKFLOW_RUN_ID);
    assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the workflow never truncates the initialized receipt before terminal promotion", () => {
  const root = path.resolve(path.dirname(SCRIPT), "../..");
  const workflow = readFileSync(path.join(root, ".github/workflows/release-e2e-hard-cancel-cleanup.yml"), "utf8");
  const aws = workflow.slice(
    workflow.indexOf("  managed-cloud-aws:"),
    workflow.indexOf("  managed-cloud-providers:"),
  );
  assert.match(aws, /RELEASE_E2E_CLOUD_AWS_RECEIPT_PATH:/);
  assert.doesNotMatch(aws, /\|\s*tee [^\n]*managed-cloud-cleanup\/report\.json/);
  assert.match(aws, /AWS cleanup process did not emit a terminal receipt \(timeout, crash, or runner interruption\)/);
  assert.match(aws, /fs\.renameSync\(temporary, receipt\)/);
  assert.match(readFileSync(SCRIPT, "utf8"), /renameSync\(temporary, receiptPath\)/);
});
