import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const REGION = "us-east-1";
const ZONE = "Z123ABC";
const CLEANUP_SHA = "b".repeat(40);

function cleanupInputs() {
  return {
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  };
}

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

function leakedCurrentState() {
  return {
    runId: CURRENT_RUN,
    instances: [{
      InstanceId: "i-01909dda54ee942a9",
      State: { Name: "running" },
      PublicIpAddress: "3.89.194.215",
      Tags: tags(CURRENT_RUN),
    }],
    securityGroups: [{
      GroupId: "sg-0dd6430c343e930b7",
      GroupName: `mcq-${CURRENT_RUN}-1-sg`,
      Tags: tags(CURRENT_RUN),
    }],
    keyPairs: [{
      KeyName: `mcq-${CURRENT_RUN}-1-key`,
      Tags: tags(CURRENT_RUN),
    }],
    dnsRecords: [{
      Name: `${CURRENT_RUN}-f85c.qualification.proliferate.com.`,
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

function qualificationRunPrefix(startName) {
  const labels = startName.replace(/\.$/, "").split(".");
  if (labels.length !== 4) return null;
  const [runLabel, ...zoneLabels] = labels;
  if (zoneLabels.join(".") !== "qualification.proliferate.com") return null;
  if (!runLabel.endsWith("-0000")) return null;
  return runLabel.slice(0, -"0000".length);
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
      assert.ok(args.includes("--no-paginate"));
      assert.equal(args.includes("--page-size"), false);
      assert.equal(args.includes("--starting-token"), false);
      const request = JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
      const candidates = [...states.values()].flatMap((entry) => entry.dnsRecords);
      if (options.malformedDnsPage) {
        return {
          stdout: JSON.stringify({
            ResourceRecordSets: [],
            IsTruncated: true,
            NextRecordName: 42,
            NextRecordType: "A",
          }),
          stderr: "",
        };
      }
      if (options.nonProgressDns) {
        return {
          stdout: JSON.stringify({
            ResourceRecordSets: [],
            IsTruncated: true,
            NextRecordName: request.StartRecordName,
            NextRecordType: request.StartRecordType ?? "A",
            ...(request.StartRecordIdentifier
              ? { NextRecordIdentifier: request.StartRecordIdentifier }
              : {}),
          }),
          stderr: "",
        };
      }
      const start = request.StartRecordName.replace(/\.$/, "");
      const prefix = qualificationRunPrefix(start);
      const matching = candidates.filter((record) => {
        const name = record.Name.replace(/\.$/, "");
        if (prefix !== null) {
          const labels = name.split(".");
          return labels.length === 4 &&
            labels.slice(1).join(".") === "qualification.proliferate.com" &&
            labels[0].startsWith(prefix);
        }
        return name === start;
      });
      if (options.paginateDns && matching.length > 0 && request.StartRecordType === undefined) {
        return {
          stdout: JSON.stringify({
            ResourceRecordSets: [],
            IsTruncated: true,
            NextRecordName: matching[0].Name,
            NextRecordType: matching[0].Type,
            ...(options.paginateDnsIdentifier
              ? { NextRecordIdentifier: "weighted-1" }
              : {}),
          }),
          stderr: "",
        };
      }
      return {
        stdout: JSON.stringify({
          ResourceRecordSets: matching,
          IsTruncated: false,
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

test("derives only the exact run identity the workflow creates", () => {
  assert.deepEqual(managedCloudRunIdentities(WORKFLOW_RUN_ID, WORKFLOW_ATTEMPT), [CURRENT_RUN]);
  assert.throws(() => managedCloudRunIdentities("../../prod", "1"), /workflow run id is malformed/);
  assert.throws(() => managedCloudRunIdentities("123", "0"), /workflow run attempt is malformed/);
});

test("reaps the exact AWS resources leaked by the cancelled managed-cloud run", async () => {
  const fake = fakeAws([leakedCurrentState()]);
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });

  assert.equal(report.status, "reconciled");
  assert.equal(report.cleanup_sha, CLEANUP_SHA);
  assert.deepEqual(report.covered_domains, ["aws", "candidate_box_processes"]);
  assert.deepEqual(report.delegated_domains, ["e2b", "stripe", "litellm"]);
  const run = report.runs.find((row) => row.run_id === CURRENT_RUN);
  assert.deepEqual(run.discovered, { instances: 1, security_groups: 1, key_pairs: 1, dns_records: 1 });
  assert.equal(run.remaining, 0);
  assert.ok(fake.calls.some((args) => args[0] === "ec2" && args[1] === "terminate-instances"));
  assert.ok(fake.calls.some((args) => args[0] === "route53" && args[1] === "change-resource-record-sets"));
});

test("is idempotent when the exact run identity is already pristine", async () => {
  const fake = fakeAws([emptyState(CURRENT_RUN)]);
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });
  assert.equal(report.status, "not_needed");
  assert.equal(fake.calls.some((args) => args[1]?.startsWith("delete") || args[1] === "terminate-instances"), false);
});

test("requires cleanup revision custody and preserves it in a top-level failed receipt", async () => {
  const { cleanupSha: _omitted, ...withoutCleanupSha } = cleanupInputs();
  await assert.rejects(
    () => reapManagedCloudAwsForWorkflowAttempt(withoutCleanupSha, {
      exec: fakeAws([emptyState(CURRENT_RUN)]).exec,
      sleep: async () => {},
    }),
    /cleanup sha is malformed/,
  );

  const scriptPath = fileURLToPath(new URL("./reap-managed-cloud-aws.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--workflow-run-id", WORKFLOW_RUN_ID,
    "--workflow-run-attempt", WORKFLOW_ATTEMPT,
    "--cleanup-sha", CLEANUP_SHA,
  ], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      RELEASE_E2E_CLOUD_AWS_REGION: "",
      RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: "",
    },
  });
  assert.equal(result.status, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.workflow_run_id, WORKFLOW_RUN_ID);
  assert.equal(receipt.workflow_run_attempt, Number(WORKFLOW_ATTEMPT));
  assert.equal(receipt.cleanup_sha, CLEANUP_SHA);
  assert.equal(receipt.status, "failed");
  assert.match(receipt.reason, /AWS region is malformed/);
});

test("the command preserves structured per-run evidence when one AWS category fails", (t) => {
  const fakeBin = mkdtempSync(path.join(tmpdir(), "managed-cloud-aws-"));
  t.after(() => rmSync(fakeBin, { recursive: true, force: true }));
  const aws = path.join(fakeBin, "aws");
  writeFileSync(aws, `#!/bin/sh
case "$1 $2" in
  "ec2 describe-instances") printf '{"Reservations":[]}' ;;
  "ec2 describe-security-groups") printf '{"SecurityGroups":[]}' ;;
  "ec2 describe-key-pairs") printf '{"KeyPairs":[]}' ;;
  "route53 list-resource-record-sets") echo 'Route53 unavailable' >&2; exit 2 ;;
  *) echo "unexpected command: $1 $2" >&2; exit 3 ;;
esac
`);
  chmodSync(aws, 0o700);
  const scriptPath = fileURLToPath(new URL("./reap-managed-cloud-aws.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--workflow-run-id", WORKFLOW_RUN_ID,
    "--workflow-run-attempt", WORKFLOW_ATTEMPT,
    "--cleanup-sha", CLEANUP_SHA,
  ], {
    encoding: "utf8",
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      RELEASE_E2E_CLOUD_AWS_REGION: REGION,
      RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: ZONE,
    },
  });
  assert.equal(result.status, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.workflow_run_id, WORKFLOW_RUN_ID);
  assert.equal(receipt.workflow_run_attempt, Number(WORKFLOW_ATTEMPT));
  assert.equal(receipt.cleanup_sha, CLEANUP_SHA);
  assert.equal(receipt.status, "failed");
  assert.match(receipt.reason, /managed-cloud AWS hard-cancel cleanup failed/);
  assert.equal(receipt.runs.length, 1);
  assert.match(receipt.runs[0].failures.join("\n"), /dns-discovery: Command failed/);
  assert.doesNotMatch(result.stdout, /missing or malformed/);
});

test("refuses a run-tagged resource with missing positive-ownership tags before mutation", async () => {
  const leaked = leakedCurrentState();
  leaked.instances[0].Tags = tags(CURRENT_RUN, { Purpose: "production" });
  const fake = fakeAws([leaked]);
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /exact managed-cloud run ownership tags/);
  assert.equal(fake.calls.some((args) => args[1] === "terminate-instances"), false);
});

test("refuses same-tag security groups whose deterministic name does not match", async () => {
  const leaked = leakedCurrentState();
  leaked.securityGroups[0].GroupName = "proliferate-production";
  const fake = fakeAws([leaked]);
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /unexpected name/);
  assert.equal(fake.calls.some((args) => args[1] === "delete-security-group"), false);
});

test("does not delete unrelated DNS records returned beside the exact run record", async () => {
  const leaked = leakedCurrentState();
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
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });
  const deletes = fake.calls
    .filter((args) => args[0] === "route53" && args[1] === "change-resource-record-sets")
    .map((args) => JSON.parse(args[args.indexOf("--change-batch") + 1]).Changes[0].ResourceRecordSet.Name);
  assert.deepEqual(deletes, [`${CURRENT_RUN}-f85c.qualification.proliferate.com.`]);
});

test("the Route53 fake rejects an extra hostname label before the qualification run label", async () => {
  const leaked = leakedCurrentState();
  leaked.dnsRecords = [{
    ...leaked.dnsRecords[0],
    Name: `extra.${CURRENT_RUN}-f85c.qualification.proliferate.com.`,
  }];
  const fake = fakeAws([leaked]);
  const result = await fake.exec("aws", [
    "route53", "list-resource-record-sets",
    "--cli-input-json", JSON.stringify({
      HostedZoneId: ZONE,
      StartRecordName: `extra.${CURRENT_RUN}-0000.qualification.proliferate.com`,
      MaxItems: "100",
    }),
    "--no-paginate",
    "--output", "json",
  ]);

  assert.deepEqual(JSON.parse(result.stdout).ResourceRecordSets, []);
});

test("retries dependency-bound security-group deletion and proves the post-sweep", async () => {
  const fake = fakeAws([leakedCurrentState()], { sgFailures: 2 });
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });
  assert.equal(report.status, "reconciled");
  assert.equal(fake.calls.filter((args) => args[1] === "delete-security-group").length, 3);
});

test("one ambiguous provider category stays red without stranding other exact resources", async () => {
  const fake = fakeAws([leakedCurrentState()], { failDnsDiscovery: true });
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /dns-discovery: Route53 unavailable/);
  assert.ok(fake.calls.some((args) => args[1] === "terminate-instances"));
  assert.ok(fake.calls.some((args) => args[1] === "delete-key-pair"));
});

test("exhausts native Route53 pagination and deletes an exact record found on page two", async () => {
  const fake = fakeAws([leakedCurrentState()], {
    paginateDns: true,
    paginateDnsIdentifier: true,
  });
  const report = await reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} });

  assert.equal(report.status, "reconciled");
  assert.equal(report.runs[0].discovered.dns_records, 1);
  const reads = fake.calls.filter((args) => args[1] === "list-resource-record-sets");
  assert.ok(reads.length >= 3);
  const requests = reads.map((args) => JSON.parse(args[args.indexOf("--cli-input-json") + 1]));
  assert.ok(requests.some((request) =>
    request.StartRecordName === `${CURRENT_RUN}-0000.qualification.proliferate.com` &&
    request.MaxItems === "100" &&
    request.StartRecordType === undefined));
  assert.ok(requests.some((request) =>
    request.StartRecordName === `${CURRENT_RUN}-f85c.qualification.proliferate.com.` &&
    request.StartRecordType === "A" &&
    request.StartRecordIdentifier === "weighted-1"));
  for (const args of reads) {
    assert.ok(args.includes("--no-paginate"));
    assert.equal(args.includes("--page-size"), false);
    assert.equal(args.includes("--starting-token"), false);
  }
  assert.ok(fake.calls.some((args) => args[1] === "change-resource-record-sets"));
});

test("fails closed on a non-advancing or malformed Route53 page", async () => {
  const nonProgress = fakeAws([emptyState(CURRENT_RUN)], { nonProgressDns: true });
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: nonProgress.exec, sleep: async () => {} }), /cursor did not advance/);

  const malformed = fakeAws([emptyState(CURRENT_RUN)], { malformedDnsPage: true });
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: malformed.exec, sleep: async () => {} }), /next record name is malformed/);
});

test("fails closed when a delete call returns but the exact resource remains", async () => {
  const fake = fakeAws([leakedCurrentState()], { keepKeyAfterDelete: true });
  await assert.rejects(() => reapManagedCloudAwsForWorkflowAttempt({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunAttempt: WORKFLOW_ATTEMPT,
    cleanupSha: CLEANUP_SHA,
    region: REGION,
    hostedZoneId: ZONE,
  }, { exec: fake.exec, sleep: async () => {} }), /exact run-owned resource\(s\) remain/);
});

test("the independent workflow runs after Release E2E completion from default-branch code", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflow = readFileSync(path.join(repoRoot, ".github/workflows/release-e2e-hard-cancel-cleanup.yml"), "utf8");
  const sourceWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/release-e2e.yml"), "utf8");
  const classifier = workflow.slice(
    workflow.indexOf("  classify-source:"),
    workflow.indexOf("  managed-cloud-aws:"),
  );
  const aws = workflow.slice(
    workflow.indexOf("  managed-cloud-aws:"),
    workflow.indexOf("  managed-cloud-providers:"),
  );
  const providers = workflow.slice(workflow.indexOf("  managed-cloud-providers:"));
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \["Release E2E \(tier 3\)"\]\s*\n\s*types: \[completed\]/);
  assert.equal(sourceWorkflow.match(/name: cloud-provision-1 \(manual, strict\)/g)?.length, 1);
  assert.doesNotMatch(workflow, /workflow_dispatch|inputs\.workflow_run/);
  assert.equal(workflow.match(/ref: \$\{\{ github\.sha \}\}/g)?.length, 1);
  assert.equal(workflow.match(/ref: \$\{\{ needs\.classify-source\.outputs\.cleanup_sha \}\}/g)?.length, 2);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /ref: .*github\.ref/);
  assert.equal(workflow.match(/persist-credentials: false/g)?.length, 3);
  assert.equal(workflow.match(/git rev-parse HEAD/g)?.length, 3);
  assert.match(classifier, /cleanup_sha: \$\{\{ steps\.policy\.outputs\.cleanup_sha \}\}/);
  assert.match(classifier, /row\.source_sha !== process\.env\.TARGET_SOURCE_SHA/);
  assert.match(classifier, /row\?\.source_sha === process\.env\.TARGET_SOURCE_SHA/);
  assert.equal(workflow.match(/--cleanup-sha /g)?.length, 3);
  assert.match(workflow, /environment: Qualification/);
  assert.match(workflow, /reap-managed-cloud-aws\.mjs/);
  assert.match(workflow, /reap-managed-cloud-providers\.ts/);
  assert.match(workflow, /detect-managed-cloud-litellm-attribution\.mjs/);
  assert.match(workflow, /Reconcile exact run-owned E2B, Stripe, and LiteLLM resources/);
  assert.match(workflow, /RELEASE_E2E_E2B_API_KEY/);
  assert.match(workflow, /STRIPE_TEST_SECRET_KEY/);
  assert.match(workflow, /AGENT_GATEWAY_LITELLM_MASTER_KEY/);
  assert.match(workflow, /classify-release-e2e-managed-cloud\.mjs/);
  assert.match(workflow, /cleanup_required: \$\{\{ steps\.classify\.outputs\.cleanup_required \|\| steps\.policy\.outputs\.cleanup_required \}\}/);
  assert.match(classifier, /echo "cleanup_required=true" >> "\$\{GITHUB_OUTPUT\}"/);
  assert.match(classifier, /`cleanup_required=\$\{row\.managed_cloud_started\}\\njob_conclusion=/);
  assert.doesNotMatch(workflow, /managed_cloud_started=.*event === "workflow_dispatch"/);
  assert.match(workflow, /pnpm\/action-setup@b0f76dfb45f55f8421693e4803ac7bb65143bd34/);
  assert.match(workflow, /timeout --kill-after=30s 5m pnpm install --frozen-lockfile/);
  assert.match(workflow, /timeout --kill-after=30s 2m npm install -g @e2b\/cli@2\.13\.3/);
  assert.match(workflow, /timeout --kill-after=30s 5m node scripts\/ci-cd\/classify-release-e2e-managed-cloud\.mjs/);
  assert.match(workflow, /timeout --kill-after=30s 15m node scripts\/ci-cd\/reap-managed-cloud-aws\.mjs/);
  assert.match(workflow, /timeout --kill-after=30s 20m pnpm exec tsx src\/cli\/reap-managed-cloud-providers\.ts/);
  assert.match(classifier, /timeout-minutes: 15/);
  assert.match(aws, /timeout-minutes: 30/);
  assert.match(providers, /timeout-minutes: 45/);
  assert.equal(workflow.match(/Initialize bounded failed /g)?.length, 3);
  assert.equal(workflow.match(/Finalize bounded /g)?.length, 3);
  assert.match(aws, /const structured = common && Array\.isArray\(row\.runs\)/);
  assert.match(aws, /typeof row\.reason === "string"/);
  assert.equal(workflow.match(/if-no-files-found: error/g)?.length, 3);
  assert.equal(workflow.match(/process\.exitCode = 2/g)?.length, 3);
  for (const job of [classifier, aws, providers]) {
    assert.ok(job.indexOf("Initialize bounded failed") < job.indexOf("actions/checkout@"));
    assert.match(job, /Finalize bounded [^\n]+ receipt\s*\n\s*if: always\(\)/);
    assert.match(job, /Upload bounded [^\n]+ receipt\s*\n\s*if: always\(\)/);
  }
  const awsHeader = aws.slice(0, aws.indexOf("    steps:"));
  const providerHeader = providers.slice(0, providers.indexOf("    steps:"));
  assert.doesNotMatch(awsHeader, /secrets\.|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(providerHeader, /secrets\.|RELEASE_E2E_E2B_API_KEY|STRIPE_TEST_SECRET_KEY|LITELLM_MASTER_KEY/);
  for (const secret of [
    "RELEASE_E2E_CLOUD_AWS_ACCESS_KEY_ID",
    "RELEASE_E2E_CLOUD_AWS_SECRET_ACCESS_KEY",
    "RELEASE_E2E_E2B_API_KEY",
    "STRIPE_TEST_SECRET_KEY",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  ]) {
    assert.equal(
      workflow.match(new RegExp(`secrets\\.${secret}`, "g"))?.length,
      1,
      `${secret} must be exposed to one step only`,
    );
  }
  assert.equal(workflow.split("GH_TOKEN:").length - 1, 1);
  assert.ok(classifier.indexOf("GH_TOKEN:") > classifier.indexOf("Inspect the exact attempt"));
  for (const downstream of [aws, providers]) {
    assert.match(downstream, /if: >-\s*\n\s*always\(\) &&/);
    assert.match(downstream, /needs\.classify-source\.result != 'success'/);
    assert.match(downstream, /needs\.classify-source\.outputs\.cleanup_required == 'true'/);
    assert.match(downstream, /needs\.classify-source\.outputs\.cleanup_sha != ''/);
  }
  assert.match(providers, /needs\.classify-source\.outputs\.source_sha != ''/);
  assert.doesNotMatch(workflow, /pnpm\/action-setup@v/);
  assert.doesNotMatch(workflow, /setup-uv|setup-python/);
  for (const match of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(match[1], /@[0-9a-f]{40}$/, `workflow action is not commit-pinned: ${match[1]}`);
  }
  // `workflow_run: completed` fires for success, failure, timeout, and
  // cancellation. A conclusion filter would reintroduce the hard-cancel gap.
  assert.doesNotMatch(workflow, /workflow_run\.conclusion/);
  assert.equal(workflow.match(/github\.event\.workflow_run\.head_sha/g)?.length, 1);
});
