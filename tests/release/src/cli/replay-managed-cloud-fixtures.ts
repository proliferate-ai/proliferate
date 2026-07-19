import { lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_REPLAY_KINDS,
  managedCloudFixtureReplayHandlers,
  replayManagedCloudFixtureEntries,
  type FixtureReplayProviderDeps,
} from "../fixtures/managed-cloud-fixture-replay.js";
import {
  defaultStripeHttp,
  isLiveModeSecretKey,
  type StripeHttp,
} from "../fixtures/stripe-test-clock.js";
import { isSafeId } from "../runner/identity.js";
import { createBoxExec } from "../worlds/managed-cloud/box-exec.js";
import type { AwsCliExec } from "../worlds/managed-cloud/ec2.js";
import { defaultSshExec, type SshExec } from "../worlds/managed-cloud/ingress.js";
import {
  loadCleanupLedger,
  type CleanupLedgerEntry,
  type CleanupResourceKind,
} from "../worlds/local-workspace/cleanup-ledger.js";

export interface ReplayManagedCloudFixturesArgs {
  runDir: string;
  runId: string;
  shardId: string;
}

export interface RunningManagedCloudIngress {
  instanceId: string;
  publicIp: string;
}

export interface ReplayManagedCloudFixturesDeps {
  awsExec: AwsCliExec;
  ssh: SshExec;
  stripeHttp: StripeHttp;
  providers?: FixtureReplayProviderDeps;
}

export interface ManagedCloudFixtureReplayReportV1 {
  kind: "managed_cloud_fixture_cleanup_replay";
  schema_version: 1;
  status: "not_needed" | "reconciled";
  run_id: string;
  shard_id: string;
  selected_fixture_entries: number;
  reconciled_fixture_entries: number;
  selected_fixture_kinds: CleanupResourceKind[];
  reconciled_fixture_kinds: CleanupResourceKind[];
  reconciled_domains: FixtureReplayDomain[];
  untouched_non_fixture_entries: number;
  ingress_instance_id: string | null;
}

export type FixtureReplayDomain = "box" | "stripe" | "e2b";

export interface FixtureReplayChildExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBufferBytes: number;
}

export type FixtureReplayChildExec = (
  file: string,
  args: readonly string[],
  options: FixtureReplayChildExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

const BOX_KINDS: ReadonlySet<CleanupResourceKind> = new Set([
  "billing_fixture_adjustment",
  "callback_relay_process",
  "callback_relay_spool",
]);
const STRIPE_KINDS: ReadonlySet<CleanupResourceKind> = new Set([
  "stripe_test_clock",
  "stripe_customer",
  "stripe_webhook_endpoint",
  "stripe_product_price",
]);
const E2B_KINDS: ReadonlySet<CleanupResourceKind> = new Set(["e2b_sandbox"]);
const FIXTURE_REPLAY_DOMAINS: Readonly<Record<FixtureReplayDomain, ReadonlySet<CleanupResourceKind>>> = {
  box: BOX_KINDS,
  stripe: STRIPE_KINDS,
  e2b: E2B_KINDS,
};

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

const defaultAwsExec: AwsCliExec = async (file, args, options) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout, stderr } = await run(file, [...args], {
    timeout: options?.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

const DEFAULT_DEPS: ReplayManagedCloudFixturesDeps = {
  awsExec: defaultAwsExec,
  ssh: defaultSshExec,
  stripeHttp: defaultStripeHttp,
};

const defaultChildExec: FixtureReplayChildExec = async (file, args, options) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const result = await run(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBufferBytes,
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};

/**
 * Executes this CLI in a new OS process. Cell E uses this boundary to prove
 * recovery from persisted identity rather than accidentally retaining any
 * create-time closures or in-memory provider controllers.
 */
export async function replayManagedCloudFixturesInFreshProcess(
  args: ReplayManagedCloudFixturesArgs,
  env: NodeJS.ProcessEnv = process.env,
  exec: FixtureReplayChildExec = defaultChildExec,
): Promise<ManagedCloudFixtureReplayReportV1> {
  validateIdentity(args);
  const cliPath = fileURLToPath(import.meta.url);
  const releaseRoot = path.resolve(path.dirname(cliPath), "../..");
  let stdout: string;
  try {
    ({ stdout } = await exec(
      "pnpm",
      [
        "exec", "tsx", cliPath,
        "--run-dir", path.resolve(args.runDir),
        "--run-id", args.runId,
        "--shard-id", args.shardId,
      ],
      {
        cwd: releaseRoot,
        env: { ...env },
        timeoutMs: 10 * 60_000,
        maxBufferBytes: 1024 * 1024,
      },
    ));
  } catch (error) {
    const output = childOutput(error);
    throw new Error(
      `fresh fixture cleanup executor exited nonzero${output ? `: ${boundedReason(output, env)}` : ""}`,
    );
  }
  return parseChildReport(stdout, args);
}

function childOutput(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }
  const row = error as { stdout?: unknown; stderr?: unknown };
  return [row.stdout, row.stderr]
    .filter((value): value is string | Buffer => typeof value === "string" || Buffer.isBuffer(value))
    .map((value) => value.toString())
    .join("\n");
}

function parseChildReport(
  stdout: string,
  expected: ReplayManagedCloudFixturesArgs,
): ManagedCloudFixtureReplayReportV1 {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line ?? "");
  } catch {
    throw new Error("fresh fixture cleanup executor returned no valid bounded report.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("fresh fixture cleanup executor returned a malformed report.");
  }
  const report = parsed as Record<string, unknown>;
  const selected = report.selected_fixture_entries;
  const reconciled = report.reconciled_fixture_entries;
  const untouched = report.untouched_non_fixture_entries;
  const selectedKinds = validatedStringArray(report.selected_fixture_kinds, FIXTURE_REPLAY_KINDS);
  const reconciledKinds = validatedStringArray(report.reconciled_fixture_kinds, FIXTURE_REPLAY_KINDS);
  const reconciledDomains = validatedStringArray(
    report.reconciled_domains,
    new Set<FixtureReplayDomain>(["box", "stripe", "e2b"]),
  );
  if (
    report.kind !== "managed_cloud_fixture_cleanup_replay" ||
    report.schema_version !== 1 ||
    (report.status !== "reconciled" && report.status !== "not_needed") ||
    report.run_id !== expected.runId ||
    report.shard_id !== expected.shardId ||
    !Number.isSafeInteger(selected) || (selected as number) < 0 ||
    !Number.isSafeInteger(reconciled) || (reconciled as number) < 0 ||
    (reconciled as number) > (selected as number) ||
    !Number.isSafeInteger(untouched) || (untouched as number) < 0 ||
    (report.ingress_instance_id !== null && typeof report.ingress_instance_id !== "string") ||
    !selectedKinds ||
    !reconciledKinds ||
    !reconciledDomains ||
    reconciledKinds.some((kind) => !selectedKinds.includes(kind))
  ) {
    throw new Error("fresh fixture cleanup executor report failed identity/schema validation.");
  }
  return report as unknown as ManagedCloudFixtureReplayReportV1;
}

function validatedStringArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !allowed.has(entry as T))) {
    return null;
  }
  const sorted = sortedUnique(value as T[]);
  return sorted.length === value.length && sorted.every((entry, index) => entry === value[index])
    ? sorted
    : null;
}

function tagsFrom(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) {
    throw new Error("AWS ingress instance has no Tags array.");
  }
  const tags = new Map<string, string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("AWS ingress instance has a malformed tag row.");
    }
    const record = row as Record<string, unknown>;
    if (typeof record.Key !== "string" || typeof record.Value !== "string") {
      throw new Error("AWS ingress instance has a malformed tag key/value.");
    }
    if (tags.has(record.Key)) {
      throw new Error(`AWS ingress instance repeats tag ${record.Key}.`);
    }
    tags.set(record.Key, record.Value);
  }
  return tags;
}

/** Read-only exact-tag lookup; ambiguity is never resolved by choosing first. */
export async function discoverRunningManagedCloudIngress(
  inputs: { region: string; runId: string; shardId: string },
  exec: AwsCliExec = defaultAwsExec,
): Promise<RunningManagedCloudIngress> {
  const { stdout } = await exec(
    "aws",
    [
      "ec2",
      "describe-instances",
      "--region",
      inputs.region,
      "--filters",
      "Name=tag:Purpose,Values=managed-cloud-qualification",
      `Name=tag:RunId,Values=${inputs.runId}`,
      `Name=tag:ShardId,Values=${inputs.shardId}`,
      "Name=instance-state-name,Values=running",
      "--output",
      "json",
    ],
    { timeoutMs: 60_000 },
  );
  const parsed = JSON.parse(stdout) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AWS ingress lookup returned a non-object payload.");
  }
  const reservations = (parsed as Record<string, unknown>).Reservations;
  if (!Array.isArray(reservations)) {
    throw new Error("AWS ingress lookup returned no Reservations array.");
  }
  const matches: RunningManagedCloudIngress[] = [];
  for (const reservation of reservations) {
    if (!reservation || typeof reservation !== "object" || Array.isArray(reservation)) {
      throw new Error("AWS ingress lookup returned a malformed reservation.");
    }
    const instances = (reservation as Record<string, unknown>).Instances;
    if (!Array.isArray(instances)) {
      throw new Error("AWS ingress lookup returned a reservation without Instances.");
    }
    for (const instance of instances) {
      if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
        throw new Error("AWS ingress lookup returned a malformed instance.");
      }
      const value = instance as Record<string, unknown>;
      const tags = tagsFrom(value.Tags);
      const state = value.State as Record<string, unknown> | undefined;
      if (
        tags.get("Purpose") !== "managed-cloud-qualification" ||
        tags.get("RunId") !== inputs.runId ||
        tags.get("ShardId") !== inputs.shardId ||
        state?.Name !== "running"
      ) {
        throw new Error("AWS returned an ingress instance outside the exact run/shard tag boundary.");
      }
      if (typeof value.InstanceId !== "string" || !/^i-[A-Za-z0-9]+$/.test(value.InstanceId)) {
        throw new Error("AWS ingress instance has no valid immutable instance id.");
      }
      if (typeof value.PublicIpAddress !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(value.PublicIpAddress)) {
        throw new Error(`AWS ingress instance ${value.InstanceId} has no usable public IPv4.`);
      }
      matches.push({ instanceId: value.InstanceId, publicIp: value.PublicIpAddress });
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one running run-owned ingress instance; observed ${matches.length}.`);
  }
  return matches[0];
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for selected fixture cleanup entries.`);
  }
  return value;
}

function entriesEqual(left: CleanupLedgerEntry, right: CleanupLedgerEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateIdentity(args: ReplayManagedCloudFixturesArgs): void {
  if (!isSafeId(args.runId) || !isSafeId(args.shardId)) {
    throw new Error("run id and shard id must be safe qualification identities.");
  }
}

async function validateIngressKey(keyPath: string): Promise<void> {
  const info = await lstat(keyPath);
  if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
    throw new Error("managed-cloud ingress key must be a regular mode-0600 file.");
  }
}

/** Loads and replays only persisted Cell A-D fixture entries. */
export async function replayManagedCloudFixtures(
  rawArgs: ReplayManagedCloudFixturesArgs,
  env: NodeJS.ProcessEnv = process.env,
  deps: ReplayManagedCloudFixturesDeps = DEFAULT_DEPS,
): Promise<ManagedCloudFixtureReplayReportV1> {
  validateIdentity(rawArgs);
  const args = { ...rawArgs, runDir: path.resolve(rawArgs.runDir) };
  const ledger = await loadCleanupLedger(args.runDir);
  if (ledger.ledgerId !== `${args.runId}:${args.shardId}`) {
    throw new Error("cleanup ledger identity does not match the requested run/shard.");
  }
  const before = ledger.entries();
  const selected = ledger.unreconciled().filter((entry) => FIXTURE_REPLAY_KINDS.has(entry.kind));
  const selectedKinds = sortedUnique(selected.map((entry) => entry.kind));
  const nonFixtureBefore = before.filter((entry) => !FIXTURE_REPLAY_KINDS.has(entry.kind));
  if (selected.length === 0) {
    return {
      kind: "managed_cloud_fixture_cleanup_replay",
      schema_version: 1,
      status: "not_needed",
      run_id: args.runId,
      shard_id: args.shardId,
      selected_fixture_entries: 0,
      reconciled_fixture_entries: 0,
      selected_fixture_kinds: [],
      reconciled_fixture_kinds: [],
      reconciled_domains: [],
      untouched_non_fixture_entries: nonFixtureBefore.filter((entry) => entry.phase !== "reconciled").length,
      ingress_instance_id: null,
    };
  }

  let ingressInstanceId: string | null = null;
  const unusedBox = createBoxExec({
    ssh: deps.ssh,
    destination: "unused@127.0.0.1",
    keyPath: path.join(args.runDir, "secrets", "ingress-key.pem"),
    secretsDir: path.join(args.runDir, "secrets"),
  });
  const failures: string[] = [];
  const runTag = `${args.runId}:${args.shardId}`;
  const replayDomain = async (
    name: string,
    kinds: ReadonlySet<CleanupResourceKind>,
    prepareHandlers: () => Promise<ReturnType<typeof managedCloudFixtureReplayHandlers>>,
  ): Promise<void> => {
    if (!selected.some((entry) => kinds.has(entry.kind))) {
      return;
    }
    try {
      await replayManagedCloudFixtureEntries(ledger, await prepareHandlers(), kinds);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Each provider domain preflights lazily and independently. A terminated
  // ingress must not prevent Stripe/E2B cleanup, and a missing Stripe key must
  // not strand an E2B sandbox. The command still exits nonzero if any domain
  // remains unreconciled after every independent replay has been attempted.
  await replayDomain("box", BOX_KINDS, async () => {
    const region = requireEnv(env, "RELEASE_E2E_CLOUD_AWS_REGION");
    const keyPath = path.join(args.runDir, "secrets", "ingress-key.pem");
    await validateIngressKey(keyPath);
    const discovered = await discoverRunningManagedCloudIngress(
      { region, runId: args.runId, shardId: args.shardId },
      deps.awsExec,
    );
    ingressInstanceId = discovered.instanceId;
    return managedCloudFixtureReplayHandlers({
      box: createBoxExec({
        ssh: deps.ssh,
        destination: `ubuntu@${discovered.publicIp}`,
        keyPath,
        secretsDir: path.join(args.runDir, "secrets"),
      }),
      runTag,
      stripeSecretKey: "unused",
      stripeHttp: deps.stripeHttp,
      ledgerEntries: before,
      ledger,
      env,
      providers: deps.providers,
    });
  });
  await replayDomain("stripe", STRIPE_KINDS, async () => {
    const stripeSecretKey = requireEnv(env, "STRIPE_TEST_SECRET_KEY");
    if (isLiveModeSecretKey(stripeSecretKey)) {
      throw new Error("STRIPE_TEST_SECRET_KEY is live-mode; refusing fixture cleanup.");
    }
    return managedCloudFixtureReplayHandlers({
      box: unusedBox,
      runTag,
      stripeSecretKey,
      stripeHttp: deps.stripeHttp,
      ledgerEntries: before,
      ledger,
      env,
      providers: deps.providers,
    });
  });
  await replayDomain("e2b", E2B_KINDS, async () => {
    requireEnv(env, "RELEASE_E2E_E2B_API_KEY");
    return managedCloudFixtureReplayHandlers({
      box: unusedBox,
      runTag,
      stripeSecretKey: "unused",
      stripeHttp: deps.stripeHttp,
      ledgerEntries: before,
      ledger,
      env,
      providers: deps.providers,
    });
  });

  const afterLedger = await loadCleanupLedger(args.runDir);
  if (afterLedger.ledgerId !== ledger.ledgerId) {
    throw new Error("cleanup ledger identity changed during fixture replay.");
  }
  const after = afterLedger.entries();
  const remaining = after.filter(
    (entry) => FIXTURE_REPLAY_KINDS.has(entry.kind) && entry.phase !== "reconciled",
  );
  if (remaining.length > 0) {
    failures.push(`fixture cleanup replay left ${remaining.length} selected entry/entries unreconciled.`);
  }
  for (const original of nonFixtureBefore) {
    const current = after.find((entry) => entry.entryId === original.entryId);
    if (!current || !entriesEqual(original, current)) {
      throw new Error(`non-fixture cleanup entry ${original.entryId} changed during bounded replay.`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join(" "));
  }
  return {
    kind: "managed_cloud_fixture_cleanup_replay",
    schema_version: 1,
    status: "reconciled",
    run_id: args.runId,
    shard_id: args.shardId,
    selected_fixture_entries: selected.length,
    reconciled_fixture_entries: selected.length - remaining.length,
    selected_fixture_kinds: selectedKinds,
    reconciled_fixture_kinds: sortedUnique(
      selected
        .filter((entry) => !remaining.some((candidate) => candidate.entryId === entry.entryId))
        .map((entry) => entry.kind),
    ),
    reconciled_domains: (Object.entries(FIXTURE_REPLAY_DOMAINS) as Array<[
      FixtureReplayDomain,
      ReadonlySet<CleanupResourceKind>,
    ]>)
      .filter(([, kinds]) => selected.some((entry) => kinds.has(entry.kind)))
      .map(([domain]) => domain)
      .sort((left, right) => left.localeCompare(right)),
    untouched_non_fixture_entries: nonFixtureBefore.filter((entry) => entry.phase !== "reconciled").length,
    ingress_instance_id: ingressInstanceId,
  };
}

function requiredFlag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} value.`);
  }
  return value;
}

export function parseReplayManagedCloudFixturesArgs(argv: string[]): ReplayManagedCloudFixturesArgs {
  const allowed = new Set(["--run-dir", "--run-id", "--shard-id"]);
  if (argv.length !== 6) {
    throw new Error("Usage: replay-managed-cloud-fixtures --run-dir <path> --run-id <id> --shard-id <id>");
  }
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index] ?? "") || argv[index + 1] === undefined) {
      throw new Error("Usage: replay-managed-cloud-fixtures --run-dir <path> --run-id <id> --shard-id <id>");
    }
  }
  return {
    runDir: requiredFlag(argv, "--run-dir"),
    runId: requiredFlag(argv, "--run-id"),
    shardId: requiredFlag(argv, "--shard-id"),
  };
}

function boundedReason(error: unknown, env: NodeJS.ProcessEnv): string {
  let raw = error instanceof Error ? error.message : String(error);
  for (const name of [
    "STRIPE_TEST_SECRET_KEY",
    "RELEASE_E2E_E2B_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ]) {
    const value = env[name];
    if (value && value.length >= 4) {
      raw = raw.split(value).join(`[REDACTED_${name}]`);
    }
  }
  return raw
    .replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[REDACTED_SECRET]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  try {
    const report = await replayManagedCloudFixtures(
      parseReplayManagedCloudFixturesArgs(process.argv.slice(2)),
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    console.log(JSON.stringify({
      kind: "managed_cloud_fixture_cleanup_replay",
      schema_version: 1,
      status: "failed",
      reason: boundedReason(error, process.env),
    }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
