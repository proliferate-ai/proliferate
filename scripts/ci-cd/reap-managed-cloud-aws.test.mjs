import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  managedCloudRunIdentities,
  reapManagedCloudAwsForWorkflowAttempt,
} from "./reap-managed-cloud-aws.mjs";

const WORKFLOW_RUN_ID = "29568030333";
const WORKFLOW_ATTEMPT = "1";
const CURRENT_RUN = `qlc-ci-${WORKFLOW_RUN_ID}-${WORKFLOW_ATTEMPT}`;
const HISTORICAL_SMOKE_RUN = `${CURRENT_RUN}-smoke`;
const REGION = "us-east-1";
const ZONE = "Z123ABC";

function tags(runId, overrides = {}) {
  return Object.entries({
    Purpose: "managed-cloud-qualification",
    RunId: runId,
    ShardId: "1",
    ...overrides,
  }).map(([Key, Value]) => ({ Key, Value }));
}

function emptyState(runId) {
  return { runId, instances: [], securityGroups: [], keyPairs: [], dnsRecords: [] };
}

function leakedHistoricalState() {
  return {
    runId: HISTORICAL_SMOKE_RUN,
    instances: [{
      InstanceId: "i-01909dda54ee942a9",
      State: { Name: "running" },
      PublicIpAddress: "3.89.194.215",
      Tags: tags(HISTORICAL_SMOKE_RUN),
    }],
    securityGroups: [{
      GroupId: "sg-0dd6430c343e930b7",
      GroupName: `mcq-${HISTORICAL_SMOKE_RUN}-1-sg`,
      Tags: tags(HISTORICAL_SMOKE_RUN),
    }],
    keyPairs: [{
      KeyName: `mcq-${HISTORICAL_SMOKE_RUN}-1-key`,
      Tags: tags(HISTORICAL_SMOKE_RUN),
    }],
    dnsRecords: [{
      Name: `${HISTORICAL_SMOKE_RUN}-f85c.qualification.proliferate.com.`,
      Type: "A",
      TTL: 60,
      ResourceRecords: [{ Value: "3.89.194.215" }],
    }],
  };
}

function runIdFromFilters(args) {
  const value = args.find((arg) => arg.startsWith("Name=tag:RunId,Values="));
  return value?.split("=").at(-1) ?? "";
}

function fakeAws(initialStates, options = {}) {
  const states = new Map(initialStates.map((state) => [state.runId, structuredClone(state)]));
  const calls = [];
  let sgFailuresRemaining = options.sgFailures ?? 0;
  const exec = async (file, args) => {
    assert.equal(file, "aws");
    calls.push([...args]);
    const command = `${args[0]} ${args[1]}`;
    const runId = runIdFromFilters(args);
    const state = runId ? states.get(runId) ?? emptyState(runId) : null;
    if (command === "ec2 describe-instances") {
      return { stdout: JSON.stringify({ Reservations: state.instances.length ? [{ Instances: state.instances }] : [] }), stderr: "" };
    }
    if (command === "ec2 describe-security-groups") {
      return { stdout: JSON.stringify({ SecurityGroups: state.securityGroups }), stderr: "" };
    }
    if (command === "ec2 describe-key-pairs") {
      return { stdout: JSON.stringify({ KeyPairs: state.keyPairs }), stderr: "" };
    }
    if (command === "route53 list-resource-record-sets") {
      if (options.failDnsDiscovery) throw new Error("Route53 unavailable");
      const start = args[args.indexOf("--start-record-name") + 1];
      const candidates = [...states.values()].flatMap((entry) => entry.dnsRecords);
      return {
        stdout: JSON.stringify({
          ResourceRecordSets: candidates.filter((record) => {
            const normalized = record.Name.replace(/\.$/, "");
            const prefix = start.replace(`.${ZONE === "Z123ABC" ? "qualification.proliferate.com" : ""}`, "");
            return normalized.startsWith(prefix.replace(/\.$/, ""));
          }),
        }),
        stderr: "",
      };
    }
    if (command === "ec2 terminate-instances") {
      const ids = args.slice(args.indexOf("--instance-ids") + 1);
      for (const candidate of states.values()) {
        for (const instance of candidate.instances) {
          if (ids.includes(instance.InstanceId)) instance.State.Name = "shutting-down";
        }
      }
      return { stdout: "{}", stderr: "" };
    }
    if (command === "ec2 wait") {
      const ids = args.slice(args.indexOf("--instance-ids") + 1);
      for (const candidate of states.values()) {
        for (const instance of candidate.instances) {
          if (ids.includes(instance.InstanceId)) instance.State.Name = "terminated";
        }
      }
      return { stdout: "", stderr: "" };
    }
    if (command === "ec2 delete-security-group") {
      if (sgFailuresRemaining > 0) {
        sgFailuresRemaining -= 1;
        throw new Error("DependencyViolation");
      }
      const id = args[args.indexOf("--group-id") + 1];
      for (const candidate of states.values()) {
        candidate.securityGroups = candidate.securityGroups.filter((group) => group.GroupId !== id);
      }
      return { stdout: "", stderr: "" };
    }
    if (command === "ec2 delete-key-pair") {
      const name = args[args.indexOf("--key-name") + 1];
      if (!options.keepKeyAfterDelete) {
        for (const candidate of states.values()) {
          candidate.keyPairs = candidate.keyPairs.filter((key) => key.KeyName !== name);
        }
      }
      return { stdout: "", stderr: "" };
    }
    if (command === "route53 change-resource-record-sets") {
      const batch = JSON.parse(args[args.indexOf("--change-batch") + 1]);
      const name = batch.Changes[0].ResourceRecordSet.Name;
      for (const candidate of states.values()) {
        candidate.dnsRecords = candidate.dnsRecords.filter((record) => record.Name !== name);
      }
      return { stdout: "{}", stderr: "" };
    }
    throw new Error(`unexpected AWS command: ${command}`);
  };
  return { exec, calls, states };
}

test("derives only the current and historical exact run identities", () => {
  assert.deepEqual(managedCloudRunIdentities(WORKFLOW_RUN_ID, WORKFLOW_ATTEMPT), [
    CURRENT_RUN,
    HISTORICAL_SMOKE_RUN,
  ]);
  assert.throws(() => managedCloudRunIdentities("../../prod", "1"), /workflow run id is malformed/);
  assert.throws(() => managedCloudRunIdentities("123", "0"), /workflow run attempt is malformed/);
});

test("reaps the exact AWS resources leaked by the cancelled fixture-smoke run", async () => {
  const fake = fakeAws([emptyState(CURRENT_RUN), leakedHistoricalState()]);
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });

  assert.equal(report.status, "reconciled");
  assert.deepEqual(report.covered_domains, ["aws", "candidate_box_processes"]);
  assert.deepEqual(report.uncovered_domains, ["e2b", "stripe", "litellm"]);
  const smoke = report.runs.find((row) => row.run_id === HISTORICAL_SMOKE_RUN);
  assert.deepEqual(smoke.discovered, { instances: 1, security_groups: 1, key_pairs: 1, dns_records: 1 });
  assert.equal(smoke.remaining, 0);
  assert.ok(fake.calls.some((args) => args[0] === "ec2" && args[1] === "terminate-instances"));
  assert.ok(fake.calls.some((args) => args[0] === "route53" && args[1] === "change-resource-record-sets"));
});

test("is idempotent when both exact run identities are already pristine", async () => {
  const fake = fakeAws([emptyState(CURRENT_RUN), emptyState(HISTORICAL_SMOKE_RUN)]);
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });
  assert.equal(report.status, "not_needed");
  assert.equal(fake.calls.some((args) => args[1]?.startsWith("delete") || args[1] === "terminate-instances"), false);
});

test("refuses a run-tagged resource with missing positive-ownership tags before mutation", async () => {
  const leaked = leakedHistoricalState();
  leaked.instances[0].Tags = tags(HISTORICAL_SMOKE_RUN, { Purpose: "production" });
  const fake = fakeAws([emptyState(CURRENT_RUN), leaked]);
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /exact managed-cloud run ownership tags/);
  assert.equal(fake.calls.some((args) => args[1] === "terminate-instances"), false);
});

test("refuses same-tag security groups whose deterministic name does not match", async () => {
  const leaked = leakedHistoricalState();
  leaked.securityGroups[0].GroupName = "proliferate-production";
  const fake = fakeAws([emptyState(CURRENT_RUN), leaked]);
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /unexpected name/);
  assert.equal(fake.calls.some((args) => args[1] === "delete-security-group"), false);
});

test("does not delete unrelated DNS records returned beside the exact run record", async () => {
  const leaked = leakedHistoricalState();
  leaked.dnsRecords.push({
    Name: "production.qualification.proliferate.com.",
    Type: "A",
    TTL: 60,
    ResourceRecords: [{ Value: "192.0.2.10" }],
  });
  const fake = fakeAws([emptyState(CURRENT_RUN), leaked]);
  await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });
  const deletes = fake.calls
    .filter((args) => args[0] === "route53" && args[1] === "change-resource-record-sets")
    .map((args) => JSON.parse(args[args.indexOf("--change-batch") + 1]).Changes[0].ResourceRecordSet.Name);
  assert.deepEqual(deletes, [`${HISTORICAL_SMOKE_RUN}-f85c.qualification.proliferate.com.`]);
});

test("retries dependency-bound security-group deletion and proves the post-sweep", async () => {
  const fake = fakeAws([emptyState(CURRENT_RUN), leakedHistoricalState()], { sgFailures: 2 });
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });
  assert.equal(report.status, "reconciled");
  assert.equal(fake.calls.filter((args) => args[1] === "delete-security-group").length, 3);
});

test("one ambiguous provider category stays red without stranding other exact resources", async () => {
  const fake = fakeAws([emptyState(CURRENT_RUN), leakedHistoricalState()], { failDnsDiscovery: true });
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /dns-discovery: Route53 unavailable/);
  assert.ok(fake.calls.some((args) => args[1] === "terminate-instances"));
  assert.ok(fake.calls.some((args) => args[1] === "delete-key-pair"));
});

test("fails closed when a delete call returns but the exact resource remains", async () => {
  const fake = fakeAws([emptyState(CURRENT_RUN), leakedHistoricalState()], { keepKeyAfterDelete: true });
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /exact run-owned resource\(s\) remain/);
});

test("the independent workflow runs after Release E2E completion from default-branch code", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflow = readFileSync(path.join(repoRoot, ".github/workflows/release-e2e-hard-cancel-cleanup.yml"), "utf8");
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \["Release E2E \(tier 3\)"\]\s*\n\s*types: \[completed\]/);
  assert.match(workflow, /github\.event_name == 'workflow_run' && github\.event\.repository\.default_branch \|\| github\.ref/);
  assert.match(workflow, /environment: Qualification/);
  assert.match(workflow, /status.*completed/);
  assert.match(workflow, /reap-managed-cloud-aws\.mjs/);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.head_sha/);
});
