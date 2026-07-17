#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);

const PURPOSE = "managed-cloud-qualification";
const SHARD_ID = "1";
const ZONE_NAME = "qualification.proliferate.com";
const TERMINAL_INSTANCE_STATES = new Set(["shutting-down", "terminated"]);
const ROUTE53_PAGE_SIZE = 100;
const MAX_ROUTE53_PAGES = 100;

function defaultExec(file, args, options = {}) {
  return execFile(file, args, {
    timeout: options.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function requiredPositiveInteger(value, label) {
  requiredString(value, label, /^[1-9][0-9]{0,19}$/);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range.`);
  return parsed;
}

function safeRunIdentity(value) {
  return requiredString(value, "managed-cloud run identity", /^[a-z0-9][a-z0-9-]{0,127}$/);
}

function resourceName(runId, suffix) {
  return `mcq-${runId}-${SHARD_ID}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
}

function dnsPrefix(runId) {
  return runId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dnsRecordPattern(runId) {
  const current = `${escapeRegExp(dnsPrefix(runId))}-[0-9a-f]{4}`;
  const fallback = escapeRegExp(`mcq-${runId}-${SHARD_ID}`.slice(0, 50));
  return new RegExp(`^(?:${current}|${fallback})\\.${escapeRegExp(ZONE_NAME)}\\.?$`);
}

/** The single run identity shared by CP1 and fixture-smoke invocations. */
export function managedCloudRunIdentities(workflowRunId, workflowRunAttempt) {
  const runId = requiredPositiveInteger(String(workflowRunId), "workflow run id");
  const attempt = requiredPositiveInteger(String(workflowRunAttempt), "workflow run attempt");
  const root = safeRunIdentity(`qlc-ci-${runId}-${attempt}`);
  return [root];
}

function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array.`);
  return value;
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

function exactTags(resource, runId) {
  const tags = asArray(resource.Tags, "AWS resource Tags");
  const byKey = new Map();
  for (const raw of tags) {
    const tag = asRecord(raw, "AWS resource tag");
    if (typeof tag.Key !== "string" || typeof tag.Value !== "string" || byKey.has(tag.Key)) {
      throw new Error("AWS resource has malformed or duplicate tags.");
    }
    byKey.set(tag.Key, tag.Value);
  }
  if (
    byKey.get("Purpose") !== PURPOSE ||
    byKey.get("RunId") !== runId ||
    byKey.get("ShardId") !== SHARD_ID
  ) {
    throw new Error("AWS resource did not carry the exact managed-cloud run ownership tags.");
  }
}

function tagFilters(runId) {
  return [
    "--filters",
    `Name=tag:Purpose,Values=${PURPOSE}`,
    `Name=tag:RunId,Values=${runId}`,
    `Name=tag:ShardId,Values=${SHARD_ID}`,
  ];
}

async function awsJson(exec, args, label, timeoutMs = 60_000) {
  const result = await exec("aws", args, { timeoutMs });
  return parseJson(result.stdout, label);
}

async function discoverInstances(inputs, exec) {
  const payload = await awsJson(exec, [
    "ec2", "describe-instances", "--region", inputs.region,
    ...tagFilters(inputs.runId), "--output", "json",
  ], "describe-instances");
  const instances = [];
  for (const rawReservation of asArray(asRecord(payload, "describe-instances").Reservations, "Reservations")) {
    const reservation = asRecord(rawReservation, "reservation");
    for (const rawInstance of asArray(reservation.Instances, "reservation Instances")) {
      const instance = asRecord(rawInstance, "instance");
      exactTags(instance, inputs.runId);
      const id = requiredString(instance.InstanceId, "EC2 instance id", /^i-[a-z0-9]+$/);
      const state = requiredString(asRecord(instance.State, "instance State").Name, "EC2 instance state", /^[a-z-]+$/);
      const publicIp = instance.PublicIpAddress;
      if (publicIp !== undefined) requiredString(publicIp, "EC2 public IP", /^\d{1,3}(?:\.\d{1,3}){3}$/);
      instances.push({ id, state, publicIp: publicIp ?? null });
    }
  }
  return instances;
}

async function discoverSecurityGroups(inputs, exec) {
  const payload = await awsJson(exec, [
    "ec2", "describe-security-groups", "--region", inputs.region,
    ...tagFilters(inputs.runId), "--output", "json",
  ], "describe-security-groups");
  const expectedName = resourceName(inputs.runId, "sg");
  return asArray(asRecord(payload, "describe-security-groups").SecurityGroups, "SecurityGroups").map((raw) => {
    const group = asRecord(raw, "security group");
    exactTags(group, inputs.runId);
    const id = requiredString(group.GroupId, "security group id", /^sg-[a-z0-9]+$/);
    if (group.GroupName !== expectedName) throw new Error("run-tagged security group has an unexpected name.");
    return { id };
  });
}

async function discoverKeyPairs(inputs, exec) {
  const payload = await awsJson(exec, [
    "ec2", "describe-key-pairs", "--region", inputs.region,
    ...tagFilters(inputs.runId), "--output", "json",
  ], "describe-key-pairs");
  const expectedName = resourceName(inputs.runId, "key");
  return asArray(asRecord(payload, "describe-key-pairs").KeyPairs, "KeyPairs").map((raw) => {
    const key = asRecord(raw, "key pair");
    exactTags(key, inputs.runId);
    if (key.KeyName !== expectedName) throw new Error("run-tagged key pair has an unexpected name.");
    return { name: expectedName };
  });
}

async function listRoute53Records(inputs, startName, exec) {
  const rows = [];
  const seenCursors = new Set();
  let cursor = { name: startName, type: null, identifier: null };
  for (let page = 1; page <= MAX_ROUTE53_PAGES; page += 1) {
    const request = {
      HostedZoneId: inputs.hostedZoneId,
      StartRecordName: cursor.name,
      MaxItems: String(ROUTE53_PAGE_SIZE),
    };
    if (cursor.type !== null) request.StartRecordType = cursor.type;
    if (cursor.identifier !== null) request.StartRecordIdentifier = cursor.identifier;
    const payload = asRecord(
      await awsJson(exec, [
        "route53", "list-resource-record-sets",
        "--cli-input-json", JSON.stringify(request),
        "--no-paginate",
        "--output", "json",
      ], "list-resource-record-sets"),
      `list-resource-record-sets page ${page}`,
    );
    const pageRows = asArray(payload.ResourceRecordSets, "ResourceRecordSets");
    if (pageRows.length > ROUTE53_PAGE_SIZE) {
      throw new Error(`Route53 page ${page} exceeded its bounded page size.`);
    }
    rows.push(...pageRows);
    if (typeof payload.IsTruncated !== "boolean") {
      throw new Error(`Route53 page ${page} truncation flag is malformed.`);
    }
    if (!payload.IsTruncated) return rows;
    const nextName = payload.NextRecordName;
    const nextType = payload.NextRecordType;
    const nextIdentifier = payload.NextRecordIdentifier;
    if (typeof nextName !== "string" || nextName.length === 0 || nextName.length > 1024) {
      throw new Error(`Route53 page ${page} next record name is malformed.`);
    }
    if (typeof nextType !== "string" || !/^[A-Z][A-Z0-9]{0,31}$/.test(nextType)) {
      throw new Error(`Route53 page ${page} next record type is malformed.`);
    }
    if (
      nextIdentifier !== undefined &&
      (typeof nextIdentifier !== "string" || nextIdentifier.length === 0 || nextIdentifier.length > 1024)
    ) {
      throw new Error(`Route53 page ${page} next record identifier is malformed.`);
    }
    const nextCursor = {
      name: nextName,
      type: nextType,
      identifier: nextIdentifier ?? null,
    };
    const cursorKey = JSON.stringify(nextCursor);
    if (seenCursors.has(cursorKey) || cursorKey === JSON.stringify(cursor)) {
      throw new Error("Route53 pagination cursor did not advance.");
    }
    seenCursors.add(cursorKey);
    cursor = nextCursor;
  }
  throw new Error("Route53 pagination exceeded its safety bound.");
}

async function discoverDnsRecords(inputs, exec) {
  const startNames = [
    `${dnsPrefix(inputs.runId)}-0000.${ZONE_NAME}`,
    `mcq-${inputs.runId}-${SHARD_ID}.${ZONE_NAME}`,
  ];
  const rows = [];
  for (const startName of startNames) {
    rows.push(...await listRoute53Records(inputs, startName, exec));
  }
  const pattern = dnsRecordPattern(inputs.runId);
  const seen = new Set();
  return rows
    .map((raw) => asRecord(raw, "Route53 record"))
    .filter((record) => record.Type === "A" && typeof record.Name === "string" && pattern.test(record.Name))
    .filter((record) => {
      const key = `${record.Name}:${record.Type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((record) => {
      const values = asArray(record.ResourceRecords, "Route53 ResourceRecords");
      if (
        record.TTL !== 60 ||
        values.length !== 1 ||
        !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(asRecord(values[0], "Route53 value").Value)
      ) {
        throw new Error("run-owned Route53 record has an unexpected shape.");
      }
      return record;
    });
}

async function deleteSecurityGroup(inputs, id, exec, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      await exec("aws", [
        "ec2", "delete-security-group", "--region", inputs.region, "--group-id", id,
      ], { timeoutMs: 60_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 12) await sleep(5_000);
    }
  }
  throw lastError;
}

function changeBatch(record) {
  return JSON.stringify({ Changes: [{ Action: "DELETE", ResourceRecordSet: record }] });
}

async function cleanupOneRun(inputs, deps) {
  const failures = [];
  const capture = async (label, task) => {
    try {
      return await task();
    } catch (error) {
      failures.push(`${label}: ${boundedError(error)}`);
      return null;
    }
  };
  // Discovery is independent per provider category. An ambiguous Route53 read
  // must make the cleanup red, but it must not prevent positively attributed
  // EC2/key/SG resources from being reclaimed in the same attempt.
  const instances = await capture("instances-discovery", () => discoverInstances(inputs, deps.exec));
  const securityGroups = await capture("security-groups-discovery", () => discoverSecurityGroups(inputs, deps.exec));
  const keyPairs = await capture("key-pairs-discovery", () => discoverKeyPairs(inputs, deps.exec));
  const dnsRecords = await capture("dns-discovery", () => discoverDnsRecords(inputs, deps.exec));
  const liveInstances = (instances ?? []).filter((row) => !TERMINAL_INSTANCE_STATES.has(row.state));
  if (liveInstances.length > 0) {
    try {
      const ids = liveInstances.map((row) => row.id);
      await deps.exec("aws", [
        "ec2", "terminate-instances", "--region", inputs.region, "--instance-ids", ...ids,
      ], { timeoutMs: 60_000 });
      await deps.exec("aws", [
        "ec2", "wait", "instance-terminated", "--region", inputs.region, "--instance-ids", ...ids,
      ], { timeoutMs: 10 * 60_000 });
    } catch (error) {
      failures.push(`instances: ${boundedError(error)}`);
    }
  }
  for (const record of dnsRecords ?? []) {
    try {
      await deps.exec("aws", [
        "route53", "change-resource-record-sets",
        "--hosted-zone-id", inputs.hostedZoneId,
        "--change-batch", changeBatch(record),
      ], { timeoutMs: 60_000 });
    } catch (error) {
      failures.push(`dns: ${boundedError(error)}`);
    }
  }
  for (const group of securityGroups ?? []) {
    try {
      await deleteSecurityGroup(inputs, group.id, deps.exec, deps.sleep);
    } catch (error) {
      failures.push(`security-group: ${boundedError(error)}`);
    }
  }
  for (const key of keyPairs ?? []) {
    try {
      await deps.exec("aws", [
        "ec2", "delete-key-pair", "--region", inputs.region, "--key-name", key.name,
      ], { timeoutMs: 60_000 });
    } catch (error) {
      failures.push(`key-pair: ${boundedError(error)}`);
    }
  }
  const afterInstances = instances === null
    ? null
    : await capture("instances-post-sweep", () => discoverInstances(inputs, deps.exec));
  const afterSecurityGroups = securityGroups === null
    ? null
    : await capture("security-groups-post-sweep", () => discoverSecurityGroups(inputs, deps.exec));
  const afterKeyPairs = keyPairs === null
    ? null
    : await capture("key-pairs-post-sweep", () => discoverKeyPairs(inputs, deps.exec));
  const afterDnsRecords = dnsRecords === null
    ? null
    : await capture("dns-post-sweep", () => discoverDnsRecords(inputs, deps.exec));
  const remaining =
    (afterInstances === null ? 1 : afterInstances.filter((row) => !TERMINAL_INSTANCE_STATES.has(row.state)).length) +
    (afterSecurityGroups === null ? 1 : afterSecurityGroups.length) +
    (afterKeyPairs === null ? 1 : afterKeyPairs.length) +
    (afterDnsRecords === null ? 1 : afterDnsRecords.length);
  if (remaining > 0) failures.push(`post-sweep: ${remaining} exact run-owned resource(s) remain`);
  return {
    run_id: inputs.runId,
    discovered: {
      instances: liveInstances.length,
      security_groups: securityGroups?.length ?? 0,
      key_pairs: keyPairs?.length ?? 0,
      dns_records: dnsRecords?.length ?? 0,
    },
    remaining,
    failures,
  };
}

function boundedError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
    const value = process.env[name];
    if (value && value.length >= 4) message = message.split(value).join(`[REDACTED_${name}]`);
  }
  return message.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]").slice(0, 300);
}

/**
 * Reaps only the exact managed-cloud run identity derived from one
 * completed Release E2E workflow attempt. AWS tags are the durable external
 * custody record: cancellation can destroy the runner filesystem without
 * destroying these provider-owned tags.
 */
export async function reapManagedCloudAwsForWorkflowAttempt(inputs, deps = {}) {
  const exec = deps.exec ?? defaultExec;
  const sleep = deps.sleep ?? defaultSleep;
  const region = requiredString(inputs.region, "AWS region", /^[a-z]{2}-[a-z]+-[1-9][0-9]?$/);
  const hostedZoneId = requiredString(inputs.hostedZoneId, "Route53 hosted zone id", /^Z[A-Z0-9]+$/);
  const cleanupSha = requiredString(inputs.cleanupSha, "cleanup sha", /^[0-9a-f]{40}$/);
  const reports = [];
  for (const runId of managedCloudRunIdentities(inputs.workflowRunId, inputs.workflowRunAttempt)) {
    reports.push(await cleanupOneRun({ runId, region, hostedZoneId }, { exec, sleep }));
  }
  const failures = reports.flatMap((report) => report.failures.map((failure) => `${report.run_id}: ${failure}`));
  const receipt = {
    kind: "managed_cloud_aws_hard_cancel_cleanup",
    schema_version: 1,
    workflow_run_id: String(inputs.workflowRunId),
    workflow_run_attempt: Number(inputs.workflowRunAttempt),
    cleanup_sha: cleanupSha,
    status: failures.length > 0
      ? "failed"
      : reports.some((report) => Object.values(report.discovered).some((count) => count > 0))
        ? "reconciled"
        : "not_needed",
    runs: reports,
    covered_domains: ["aws", "candidate_box_processes"],
    delegated_domains: ["e2b", "stripe", "litellm"],
  };
  if (failures.length > 0) {
    const error = new Error(`managed-cloud AWS hard-cancel cleanup failed (${failures.join("; ")})`);
    receipt.reason = boundedError(error);
    error.cleanupReceipt = receipt;
    throw error;
  }
  return receipt;
}

function parseArgValues(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) {
      throw new Error(
        "Usage: reap-managed-cloud-aws --workflow-run-id <id> " +
        "--workflow-run-attempt <n> --cleanup-sha <sha>",
      );
    }
    values.set(key, value);
  }
  const allowed = new Set(["--workflow-run-id", "--workflow-run-attempt", "--cleanup-sha"]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown argument ${key}.`);
  return values;
}

function commandIdentity(values) {
  const workflowRunId = values.get("--workflow-run-id") ?? "";
  const workflowRunAttempt = values.get("--workflow-run-attempt") ?? "";
  const cleanupSha = values.get("--cleanup-sha") ?? "";
  requiredPositiveInteger(workflowRunId, "workflow run id");
  requiredPositiveInteger(workflowRunAttempt, "workflow run attempt");
  requiredString(cleanupSha, "cleanup sha", /^[0-9a-f]{40}$/);
  return { workflowRunId, workflowRunAttempt, cleanupSha };
}

function inputsFromValues(values, env) {
  const identity = commandIdentity(values);
  return {
    ...identity,
    region: env.RELEASE_E2E_CLOUD_AWS_REGION ?? "",
    hostedZoneId: env.RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID ?? "",
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const cleanupIndex = argv.indexOf("--cleanup-sha");
  const rawCleanupSha = cleanupIndex >= 0 ? argv[cleanupIndex + 1] : undefined;
  const cleanupSha = typeof rawCleanupSha === "string" && /^[0-9a-f]{40}$/.test(rawCleanupSha)
    ? rawCleanupSha
    : null;
  let identity = null;
  try {
    const values = parseArgValues(argv);
    identity = commandIdentity(values);
    console.log(JSON.stringify(await reapManagedCloudAwsForWorkflowAttempt(inputsFromValues(values, process.env))));
  } catch (error) {
    const receipt = error?.cleanupReceipt ?? {
      kind: "managed_cloud_aws_hard_cancel_cleanup",
      schema_version: 1,
      ...(identity ? {
        workflow_run_id: identity.workflowRunId,
        workflow_run_attempt: Number(identity.workflowRunAttempt),
      } : {}),
      cleanup_sha: cleanupSha,
      status: "failed",
      reason: boundedError(error),
    };
    console.log(JSON.stringify(receipt));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
