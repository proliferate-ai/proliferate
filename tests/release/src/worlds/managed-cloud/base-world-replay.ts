import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FetchLike, HttpResponseLike } from "../../services/qualification-litellm.js";
import {
  loadCleanupLedger,
  type CleanupHandler,
  type CleanupLedger,
  type CleanupLedgerEntry,
  type CleanupResourceKind,
} from "../local-workspace/cleanup-ledger.js";
import type { AwsCliExec } from "./ec2.js";
import { deleteLiteLlmSubject } from "./base-world-litellm-replay.js";
import {
  decodeHostProcessCustody,
  RENDERER_PROCESS_INTENT_PREFIX,
  stopHostProcessFromCustody,
  type HostProcessCustodyDeps,
} from "./host-process-custody.js";
import {
  loadSharedTemplateCustody,
  sharedTemplateCustodyPath,
} from "./shared-template-custody.js";

export const BASE_WORLD_REPLAY_KINDS: ReadonlySet<CleanupResourceKind> = new Set([
  "route53_record",
  "ec2_instance",
  "security_group",
  "key_pair",
  "litellm_virtual_key",
  "litellm_user",
  "litellm_team",
  "renderer_process",
  "browser",
  "browser_context",
  "secret_env_file",
  "port_registration",
  "run_directory",
  // Provider deletion stays owned by the parent custody CLI. This executor may
  // only reconcile after loading that exact journal in terminal released state.
  "e2b_template",
]);

export interface BaseWorldReplayInputs {
  runDir: string;
  runId: string;
  shardId: string;
  region: string;
  hostedZoneId: string;
  litellmBaseUrl: string;
  litellmMasterKey: string;
}

export interface BaseWorldReplayDeps {
  awsExec: AwsCliExec;
  fetch: FetchLike;
  process?: HostProcessCustodyDeps;
  sleep?: (ms: number) => Promise<void>;
}

export interface BaseWorldReplayReportV1 {
  kind: "managed_cloud_base_world_cleanup_replay";
  schema_version: 1;
  status: "not_needed" | "reconciled";
  run_id: string;
  shard_id: string;
  world_dir: string;
  selected_entries: number;
  reconciled_entries: number;
  remaining_entries: number;
  removed_run_directory: boolean;
}

const TERMINAL_INSTANCE_STATES = new Set(["terminated", "shutting-down"]);
const REPLAY_ORDER: Readonly<Partial<Record<CleanupResourceKind, number>>> = {
  renderer_process: 10,
  browser_context: 11,
  browser: 12,
  litellm_virtual_key: 20,
  litellm_user: 21,
  litellm_team: 22,
  route53_record: 30,
  e2b_template: 40,
  ec2_instance: 50,
  security_group: 60,
  key_pair: 70,
  secret_env_file: 80,
  port_registration: 90,
};

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} returned a malformed object.`);
  }
  return value as Record<string, unknown>;
}

function arrayField(value: unknown, field: string, where: string): unknown[] {
  const rows = record(value, where)[field];
  if (!Array.isArray(rows)) {
    throw new Error(`${where} returned no ${field} array.`);
  }
  return rows;
}

function exactTags(value: unknown, runId: string, shardId: string): void {
  const rows = arrayField(value, "Tags", "AWS resource");
  const tags = new Map<string, string>();
  for (const raw of rows) {
    const row = record(raw, "AWS tag");
    if (typeof row.Key !== "string" || typeof row.Value !== "string" || tags.has(row.Key)) {
      throw new Error("AWS resource returned malformed or duplicate tags.");
    }
    tags.set(row.Key, row.Value);
  }
  if (
    tags.get("Purpose") !== "managed-cloud-qualification" ||
    tags.get("RunId") !== runId ||
    tags.get("ShardId") !== shardId
  ) {
    throw new Error("AWS resource is outside the exact run/shard ownership boundary.");
  }
}

function awsFilters(runId: string, shardId: string): string[] {
  return [
    "--filters",
    "Name=tag:Purpose,Values=managed-cloud-qualification",
    `Name=tag:RunId,Values=${runId}`,
    `Name=tag:ShardId,Values=${shardId}`,
  ];
}

function safeAwsId(value: string | null, pattern: RegExp, label: string): void {
  if (value !== null && !pattern.test(value)) {
    throw new Error(`${label} cleanup identity is malformed.`);
  }
}

function requiredValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required for this cleanup domain.`);
  return normalized;
}

async function jsonExec(exec: AwsCliExec, args: string[]): Promise<unknown> {
  const { stdout } = await exec("aws", args, { timeoutMs: 60_000 });
  return JSON.parse(stdout) as unknown;
}

function assertRecordedId(rows: string[], providerId: string | null, label: string): void {
  if (providerId && rows.length > 0 && !rows.includes(providerId)) {
    throw new Error(`${label} ledger id does not match the exact run-tagged provider inventory.`);
  }
}

function expectedResourceName(runId: string, shardId: string, suffix: string): string {
  return `mcq-${runId}-${shardId}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
}

function expectedRecordName(runId: string, shardId: string): string {
  const label = `mcq-${runId}-${shardId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${label}.qualification.proliferate.com`;
}

async function cleanupInstances(entry: CleanupLedgerEntry, inputs: BaseWorldReplayInputs, exec: AwsCliExec): Promise<void> {
  safeAwsId(entry.providerId, /^i-[A-Za-z0-9]+$/, "EC2 instance");
  const region = requiredValue(inputs.region, "RELEASE_E2E_CLOUD_AWS_REGION");
  const payload = await jsonExec(exec, [
    "ec2", "describe-instances", "--region", region,
    ...awsFilters(inputs.runId, inputs.shardId), "--output", "json",
  ]);
  const owned: Array<{ id: string; state: string }> = [];
  for (const rawReservation of arrayField(payload, "Reservations", "describe-instances")) {
    for (const rawInstance of arrayField(rawReservation, "Instances", "describe-instances reservation")) {
      const instance = record(rawInstance, "EC2 instance");
      exactTags(instance, inputs.runId, inputs.shardId);
      const id = instance.InstanceId;
      const state = record(instance.State, "EC2 instance state").Name;
      if (typeof id !== "string" || !/^i-[A-Za-z0-9]+$/.test(id) || typeof state !== "string") {
        throw new Error("describe-instances returned malformed identity/state.");
      }
      owned.push({ id, state });
    }
  }
  assertRecordedId(owned.map((row) => row.id), entry.providerId, "EC2 instance");
  const live = owned.filter((row) => !TERMINAL_INSTANCE_STATES.has(row.state)).map((row) => row.id);
  if (live.length === 0) return;
  await exec("aws", ["ec2", "terminate-instances", "--region", region, "--instance-ids", ...live], { timeoutMs: 60_000 });
  await exec("aws", ["ec2", "wait", "instance-terminated", "--region", region, "--instance-ids", ...live], { timeoutMs: 10 * 60_000 });
}

async function cleanupSecurityGroups(entry: CleanupLedgerEntry, inputs: BaseWorldReplayInputs, exec: AwsCliExec): Promise<void> {
  safeAwsId(entry.providerId, /^sg-[A-Za-z0-9]+$/, "security group");
  const region = requiredValue(inputs.region, "RELEASE_E2E_CLOUD_AWS_REGION");
  const payload = await jsonExec(exec, [
    "ec2", "describe-security-groups", "--region", region,
    ...awsFilters(inputs.runId, inputs.shardId), "--output", "json",
  ]);
  const ids = arrayField(payload, "SecurityGroups", "describe-security-groups").map((raw) => {
    const group = record(raw, "security group");
    exactTags(group, inputs.runId, inputs.shardId);
    if (typeof group.GroupId !== "string" || !/^sg-[A-Za-z0-9]+$/.test(group.GroupId)) {
      throw new Error("describe-security-groups returned a malformed id.");
    }
    return group.GroupId;
  });
  assertRecordedId(ids, entry.providerId, "security group");
  for (const id of ids) {
    await exec("aws", ["ec2", "delete-security-group", "--region", region, "--group-id", id], { timeoutMs: 60_000 });
  }
}

async function cleanupKeyPairs(entry: CleanupLedgerEntry, inputs: BaseWorldReplayInputs, exec: AwsCliExec): Promise<void> {
  const expected = expectedResourceName(inputs.runId, inputs.shardId, "key");
  if (entry.providerId !== null && entry.providerId !== expected) {
    throw new Error("key-pair cleanup identity is outside the exact run-scoped name.");
  }
  const region = requiredValue(inputs.region, "RELEASE_E2E_CLOUD_AWS_REGION");
  const payload = await jsonExec(exec, [
    "ec2", "describe-key-pairs", "--region", region,
    ...awsFilters(inputs.runId, inputs.shardId), "--output", "json",
  ]);
  const names = arrayField(payload, "KeyPairs", "describe-key-pairs").map((raw) => {
    const key = record(raw, "key pair");
    exactTags(key, inputs.runId, inputs.shardId);
    if (key.KeyName !== expected) {
      throw new Error("run-tagged key pair does not match the exact run-scoped name.");
    }
    return expected;
  });
  for (const name of names) {
    await exec("aws", ["ec2", "delete-key-pair", "--region", region, "--key-name", name], { timeoutMs: 60_000 });
  }
}

function normalizeDns(value: string): string {
  return value.replace(/\.$/, "").toLowerCase();
}

async function cleanupRoute53(entry: CleanupLedgerEntry, inputs: BaseWorldReplayInputs, exec: AwsCliExec): Promise<void> {
  const expected = expectedRecordName(inputs.runId, inputs.shardId);
  if (entry.providerId !== null && entry.providerId !== expected) {
    throw new Error("Route53 cleanup identity is outside the exact run-scoped name.");
  }
  const hostedZoneId = requiredValue(inputs.hostedZoneId, "RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID");
  const list = async (): Promise<Record<string, unknown>[]> => {
    const payload = await jsonExec(exec, [
      "route53", "list-resource-record-sets", "--hosted-zone-id", hostedZoneId,
      "--start-record-name", expected, "--max-items", "5", "--output", "json",
    ]);
    return arrayField(payload, "ResourceRecordSets", "Route53 record list")
      .map((raw) => record(raw, "Route53 record"))
      .filter((row) => typeof row.Name === "string" && normalizeDns(row.Name) === expected && row.Type === "A");
  };
  const matches = await list();
  if (matches.length > 1) throw new Error("Route53 returned duplicate exact run-owned A records.");
  if (matches.length === 0) return;
  const batch = JSON.stringify({ Changes: [{ Action: "DELETE", ResourceRecordSet: matches[0] }] });
  await exec("aws", [
    "route53", "change-resource-record-sets", "--hosted-zone-id", hostedZoneId,
    "--change-batch", batch,
  ], { timeoutMs: 60_000 });
  if ((await list()).length !== 0) throw new Error("Route53 exact run-owned record remains after delete.");
}

function localPath(entry: CleanupLedgerEntry, runDir: string, leaf: string): string {
  const expected = path.join(runDir, leaf);
  if (entry.providerId !== expected) {
    throw new Error(`${entry.kind} path is outside the exact scoped world directory.`);
  }
  return expected;
}

function handlers(inputs: BaseWorldReplayInputs, deps: BaseWorldReplayDeps): Partial<Record<CleanupResourceKind, CleanupHandler>> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    route53_record: (entry) => cleanupRoute53(entry, inputs, deps.awsExec),
    ec2_instance: (entry) => cleanupInstances(entry, inputs, deps.awsExec),
    security_group: (entry) => cleanupSecurityGroups(entry, inputs, deps.awsExec),
    key_pair: (entry) => cleanupKeyPairs(entry, inputs, deps.awsExec),
    litellm_virtual_key: (entry) => deleteLiteLlmSubject(entry, inputs, deps.fetch, sleep),
    litellm_user: (entry) => deleteLiteLlmSubject(entry, inputs, deps.fetch, sleep),
    litellm_team: (entry) => deleteLiteLlmSubject(entry, inputs, deps.fetch, sleep),
    renderer_process: async (entry) => {
      const expectedMarker = path.join(inputs.runDir, "renderer");
      const decoded = decodeHostProcessCustody(entry.providerId ?? "");
      if (
        decoded?.marker !== expectedMarker &&
        entry.providerId !== `${RENDERER_PROCESS_INTENT_PREFIX}${expectedMarker}`
      ) {
        throw new Error("renderer process custody is outside the exact scoped world directory.");
      }
      await stopHostProcessFromCustody(entry.providerId, deps.process);
    },
    browser: (entry) => stopHostProcessFromCustody(entry.providerId, deps.process),
    browser_context: async () => { throw new Error("browser context has no independently replayable identity."); },
    e2b_template: async (entry) => {
      const custody = await loadSharedTemplateCustody(
        sharedTemplateCustodyPath(path.dirname(inputs.runDir)),
      );
      if (
        custody.run_id !== inputs.runId ||
        custody.shard_id !== inputs.shardId ||
        custody.state !== "released" ||
        !custody.receipt ||
        custody.receipt.templateId !== entry.providerId
      ) {
        throw new Error("E2B template ledger entry is not bound to the exact released parent custody receipt.");
      }
    },
    secret_env_file: async (entry) => rm(localPath(entry, inputs.runDir, "secrets"), { recursive: true, force: true }),
    port_registration: async (entry) => {
      if (entry.providerId !== expectedRecordName(inputs.runId, inputs.shardId)) {
        throw new Error("port/subdomain reservation is outside the exact run identity.");
      }
    },
  };
}

async function replaySelected(
  ledger: CleanupLedger,
  selected: CleanupLedgerEntry[],
  ownedHandlers: Partial<Record<CleanupResourceKind, CleanupHandler>>,
): Promise<{ reconciled: number; failures: string[] }> {
  let reconciled = 0;
  const failures: string[] = [];
  const ordered = selected
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftRank = REPLAY_ORDER[left.entry.kind] ?? Number.MAX_SAFE_INTEGER;
      const rightRank = REPLAY_ORDER[right.entry.kind] ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || right.index - left.index;
    })
    .map(({ entry }) => entry);
  for (const entry of ordered) {
    const handler = ownedHandlers[entry.kind];
    if (!handler) {
      failures.push(`${entry.kind}: no base-world replay handler`);
      continue;
    }
    try {
      await handler(entry);
      await ledger.markReconciled(entry.entryId);
      reconciled += 1;
    } catch (error) {
      failures.push(`${entry.kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { reconciled, failures };
}

interface RunDirectoryJournalV1 {
  schema_version: 1;
  run_id: string;
  shard_id: string;
  world_dir: string;
  ledger_id: string;
  state: "intent" | "released";
}

function journalPath(runDir: string): string {
  return path.join(path.dirname(runDir), "cleanup-replay", `${path.basename(runDir)}.json`);
}

async function writeJournal(filePath: string, journal: RunDirectoryJournalV1): Promise<void> {
  const journalDirectory = path.dirname(filePath);
  await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
  await chmod(journalDirectory, 0o700);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function removeRunDirectory(
  inputs: BaseWorldReplayInputs,
  ledger: CleanupLedger,
  entry: CleanupLedgerEntry,
): Promise<void> {
  if (entry.providerId !== inputs.runDir) {
    throw new Error("run-directory cleanup identity is outside the exact scoped world directory.");
  }
  const outstanding = ledger.unreconciled().filter((row) => row.entryId !== entry.entryId);
  if (outstanding.length > 0) {
    throw new Error(`run directory still owns ${outstanding.length} unreconciled non-directory entry/entries.`);
  }
  const filePath = journalPath(inputs.runDir);
  const base: RunDirectoryJournalV1 = {
    schema_version: 1,
    run_id: inputs.runId,
    shard_id: inputs.shardId,
    world_dir: path.basename(inputs.runDir),
    ledger_id: ledger.ledgerId,
    state: "intent",
  };
  await writeJournal(filePath, base);
  await rm(inputs.runDir, { recursive: true, force: true });
  await writeJournal(filePath, { ...base, state: "released" });
}

export async function replayManagedCloudBaseWorld(
  inputs: BaseWorldReplayInputs,
  deps: BaseWorldReplayDeps,
): Promise<BaseWorldReplayReportV1> {
  const runDir = path.resolve(inputs.runDir);
  const worldDir = path.basename(runDir);
  if (worldDir !== "cloud-provision-1" && worldDir !== "fixture-smoke") {
    throw new Error("base-world replay only accepts a known managed-cloud scoped world directory.");
  }
  let ledger: CleanupLedger;
  try {
    ledger = await loadCleanupLedger(runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const filePath = journalPath(runDir);
      try {
        const journal = JSON.parse(await readFile(filePath, "utf8")) as RunDirectoryJournalV1;
        if (
          journal.schema_version === 1 &&
          journal.run_id === inputs.runId &&
          journal.shard_id === inputs.shardId &&
          journal.world_dir === worldDir &&
          journal.ledger_id === `${inputs.runId}:${inputs.shardId}` &&
          journal.state === "intent"
        ) {
          // The intent journal is written only after every other ledger entry
          // is durably reconciled. Finish the exact scoped directory removal
          // before promoting that journal to released; a crash before `rm`
          // must not turn a still-present directory into a false green.
          await rm(runDir, { recursive: true, force: true });
          await writeJournal(filePath, { ...journal, state: "released" });
          return {
            kind: "managed_cloud_base_world_cleanup_replay", schema_version: 1, status: "reconciled",
            run_id: inputs.runId, shard_id: inputs.shardId, world_dir: worldDir,
            selected_entries: 1, reconciled_entries: 1, remaining_entries: 0, removed_run_directory: true,
          };
        }
      } catch (journalError) {
        if ((journalError as NodeJS.ErrnoException).code !== "ENOENT") throw journalError;
      }
      return {
        kind: "managed_cloud_base_world_cleanup_replay", schema_version: 1, status: "not_needed",
        run_id: inputs.runId, shard_id: inputs.shardId, world_dir: worldDir,
        selected_entries: 0, reconciled_entries: 0, remaining_entries: 0, removed_run_directory: false,
      };
    }
    throw error;
  }
  if (ledger.ledgerId !== `${inputs.runId}:${inputs.shardId}`) {
    throw new Error("cleanup ledger identity does not match the requested run/shard.");
  }
  const selected = ledger.unreconciled().filter((entry) => BASE_WORLD_REPLAY_KINDS.has(entry.kind));
  if (selected.length === 0) {
    return {
      kind: "managed_cloud_base_world_cleanup_replay", schema_version: 1, status: "not_needed",
      run_id: inputs.runId, shard_id: inputs.shardId, world_dir: worldDir,
      selected_entries: 0, reconciled_entries: 0, remaining_entries: 0, removed_run_directory: false,
    };
  }
  const replayable = selected.filter((entry) => entry.kind !== "run_directory");
  const replay = await replaySelected(ledger, replayable, handlers({ ...inputs, runDir }, deps));
  const directory = selected.find((entry) => entry.kind === "run_directory");
  let removedRunDirectory = false;
  if (directory && replay.failures.length === 0) {
    try {
      await removeRunDirectory({ ...inputs, runDir }, ledger, directory);
      replay.reconciled += 1;
      removedRunDirectory = true;
    } catch (error) {
      replay.failures.push(`run_directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (replay.failures.length > 0) {
    throw new Error(`base-world cleanup replay failed (${replay.failures.join("; ")})`);
  }
  return {
    kind: "managed_cloud_base_world_cleanup_replay", schema_version: 1, status: "reconciled",
    run_id: inputs.runId, shard_id: inputs.shardId, world_dir: worldDir,
    selected_entries: selected.length, reconciled_entries: replay.reconciled,
    remaining_entries: 0, removed_run_directory: removedRunDirectory,
  };
}

export const defaultBaseWorldReplayDeps: BaseWorldReplayDeps = {
  async awsExec(file, args, options) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const result = await run(file, [...args], { timeout: options?.timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  },
  fetch: (url, init) => fetch(url, init as RequestInit) as unknown as Promise<HttpResponseLike>,
};
