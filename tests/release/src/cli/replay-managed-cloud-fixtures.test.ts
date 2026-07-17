import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  decodeE2bSandboxCleanupIdentity,
  encodeE2bSandboxCleanupIdentity,
  managedCloudFixtureReplayHandlers,
  replayManagedCloudFixtureEntries,
} from "../fixtures/managed-cloud-fixture-replay.js";
import type { StripeHttp } from "../fixtures/stripe-test-clock.js";
import {
  loadCleanupLedger,
  openCleanupLedger,
  type CleanupLedger,
  type CleanupResourceKind,
} from "../worlds/local-workspace/cleanup-ledger.js";
import type { AwsCliExec } from "../worlds/managed-cloud/ec2.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import type { SshExec } from "../worlds/managed-cloud/ingress.js";
import {
  discoverRunningManagedCloudIngress,
  replayManagedCloudFixtures,
  replayManagedCloudFixturesInFreshProcess,
  type ReplayManagedCloudFixturesDeps,
} from "./replay-managed-cloud-fixtures.js";

const RUN_ID = "run-1";
const SHARD_ID = "shard-1";
const REGION = "us-west-2";
const PUBLIC_IP = "203.0.113.9";

const UNUSED_BOX: BoxExec = {
  async exec() { throw new Error("unused box exec"); },
  async putSecretFile() { throw new Error("unused box secret write"); },
  async readRemoteFile() { throw new Error("unused box read"); },
  async removeRemoteFile() { throw new Error("unused box remove"); },
  async serverPython() { throw new Error("unused box python"); },
};

function awsPayload(count = 1, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Reservations: [
      {
        Instances: Array.from({ length: count }, (_, index) => ({
          InstanceId: `i-0abc${index}`,
          PublicIpAddress: `203.0.113.${index + 9}`,
          State: { Name: "running" },
          Tags: [
            { Key: "Purpose", Value: "managed-cloud-qualification" },
            { Key: "RunId", Value: RUN_ID },
            { Key: "ShardId", Value: SHARD_ID },
          ],
          ...overrides,
        })),
      },
    ],
  });
}

function fakeAws(calls: string[][], payload = awsPayload()): AwsCliExec {
  return async (file, args) => {
    assert.equal(file, "aws");
    calls.push([...args]);
    return { stdout: payload, stderr: "" };
  };
}

async function acquire(
  ledger: CleanupLedger,
  kind: CleanupResourceKind,
  entryId: string,
  providerId: string,
): Promise<void> {
  await ledger.registerIntent(kind, entryId);
  await ledger.markAcquired(entryId, providerId);
}

test("exact AWS lookup requires one running instance with all three ownership tags", async () => {
  const calls: string[][] = [];
  const result = await discoverRunningManagedCloudIngress(
    { region: REGION, runId: RUN_ID, shardId: SHARD_ID },
    fakeAws(calls),
  );
  assert.deepEqual(result, { instanceId: "i-0abc0", publicIp: PUBLIC_IP });
  assert.deepEqual(calls[0]?.slice(0, 6), [
    "ec2",
    "describe-instances",
    "--region",
    REGION,
    "--filters",
    "Name=tag:Purpose,Values=managed-cloud-qualification",
  ]);
  assert.ok(calls[0]?.includes(`Name=tag:RunId,Values=${RUN_ID}`));
  assert.ok(calls[0]?.includes(`Name=tag:ShardId,Values=${SHARD_ID}`));
  await assert.rejects(
    () => discoverRunningManagedCloudIngress(
      { region: REGION, runId: RUN_ID, shardId: SHARD_ID },
      fakeAws([], awsPayload(2)),
    ),
    /exactly one.*observed 2/,
  );
  await assert.rejects(
    () => discoverRunningManagedCloudIngress(
      { region: REGION, runId: RUN_ID, shardId: SHARD_ID },
      fakeAws([], awsPayload(1, {
        Tags: [
          { Key: "Purpose", Value: "managed-cloud-qualification" },
          { Key: "RunId", Value: "another-run" },
          { Key: "ShardId", Value: SHARD_ID },
        ],
      })),
    ),
    /outside the exact run\/shard tag boundary/,
  );
});

test("fresh executor discovers ingress, reconstructs handlers, and leaves world entries untouched", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-cli-"));
  const secretsDir = path.join(runDir, "secrets");
  const keyPath = path.join(secretsDir, "ingress-key.pem");
  const awsCalls: string[][] = [];
  const sshCalls: Array<{ destination: string; keyPath: string; command: string }> = [];
  const copies: Array<{ destination: string; keyPath: string; remotePath: string }> = [];
  const stripeCalls: string[] = [];
  let providerVisible = true;
  const ssh: SshExec = {
    async run(destination, usedKeyPath, command) {
      sshCalls.push({ destination, keyPath: usedKeyPath, command });
      if (command.includes("sudo docker exec")) {
        return { stdout: '{"cleared":true}\n', stderr: "" };
      }
      if (command.includes("relay.pid")) {
        return { stdout: "RELAY_STOP_ABSENT\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    async copyFile(destination, usedKeyPath, _localPath, remotePath) {
      copies.push({ destination, keyPath: usedKeyPath, remotePath });
    },
  };
  const stripeHttp: StripeHttp = {
    async request(_key, request) {
      stripeCalls.push(`${request.method} ${request.path}`);
      return { deleted: true };
    },
  };
  const deps: ReplayManagedCloudFixturesDeps = {
    awsExec: fakeAws(awsCalls),
    ssh,
    stripeHttp,
    providers: {
      now: () => new Date("2026-07-17T00:00:00.000Z"),
      async findSandbox(cloudSandboxId, env) {
        assert.equal(cloudSandboxId, "cloud-sandbox-1");
        assert.equal(env.RELEASE_E2E_E2B_API_KEY, "e2b_test_key");
        return providerVisible
          ? {
              providerSandboxId: "e2b-provider-1",
              state: "running",
              matches: [{
                providerSandboxId: "e2b-provider-1",
                state: "running",
                templateId: "tpl-1",
                startedAt: null,
              }],
              count: 1,
            }
          : { providerSandboxId: null, state: null, matches: [], count: 0 };
      },
      async killSandbox(providerSandboxId) {
        assert.equal(providerSandboxId, "e2b-provider-1");
        providerVisible = false;
        return { killed: true };
      },
    },
  };
  try {
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(keyPath, "not-a-real-key\n", { mode: 0o600 });
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(ledger, "ec2_instance", "world-instance", "i-0abc0");
    await acquire(
      ledger,
      "billing_fixture_adjustment",
      "billing",
      `billing-threshold:${RUN_ID}:${SHARD_ID}:user-1:llm`,
    );
    await acquire(
      ledger,
      "callback_relay_spool",
      "relay-spool",
      "/home/ubuntu/candidate/callback-relay",
    );
    await acquire(
      ledger,
      "callback_relay_process",
      "relay-process",
      `${PUBLIC_IP}:/home/ubuntu/candidate/callback-relay/relay.pid`,
    );
    await acquire(ledger, "stripe_customer", "stripe-customer", "cus_123");
    await acquire(
      ledger,
      "e2b_sandbox",
      "provider-sandbox",
      encodeE2bSandboxCleanupIdentity({
        cloudSandboxId: "cloud-sandbox-1",
        providerSandboxId: "e2b-provider-1",
      }),
    );

    const report = await replayManagedCloudFixtures(
      { runDir, runId: RUN_ID, shardId: SHARD_ID },
      {
        RELEASE_E2E_CLOUD_AWS_REGION: REGION,
        RELEASE_E2E_E2B_API_KEY: "e2b_test_key",
        STRIPE_TEST_SECRET_KEY: "sk_test_fixture_replay",
      },
      deps,
    );
    assert.deepEqual(report, {
      kind: "managed_cloud_fixture_cleanup_replay",
      schema_version: 1,
      status: "reconciled",
      run_id: RUN_ID,
      shard_id: SHARD_ID,
      selected_fixture_entries: 5,
      reconciled_fixture_entries: 5,
      selected_fixture_kinds: [
        "billing_fixture_adjustment",
        "callback_relay_process",
        "callback_relay_spool",
        "e2b_sandbox",
        "stripe_customer",
      ],
      reconciled_fixture_kinds: [
        "billing_fixture_adjustment",
        "callback_relay_process",
        "callback_relay_spool",
        "e2b_sandbox",
        "stripe_customer",
      ],
      reconciled_domains: ["box", "e2b", "stripe"],
      untouched_non_fixture_entries: 1,
      ingress_instance_id: "i-0abc0",
    });
    assert.equal(awsCalls.length, 1);
    assert.ok(sshCalls.every((call) => call.destination === `ubuntu@${PUBLIC_IP}`));
    assert.ok(sshCalls.every((call) => call.keyPath === keyPath));
    assert.equal(copies.length, 1);
    assert.equal(copies[0]?.destination, `ubuntu@${PUBLIC_IP}`);
    assert.deepEqual(stripeCalls, ["DELETE /customers/cus_123"]);

    const after = (await loadCleanupLedger(runDir)).entries();
    assert.equal(after.find((entry) => entry.entryId === "world-instance")?.phase, "acquired");
    assert.ok(after.filter((entry) => entry.entryId !== "world-instance").every((entry) => entry.phase === "reconciled"));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("Cell A customer intent survives the create→acquire gap and replays by exact run/cell ownership", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-cell-a-gap-"));
  const calls: string[] = [];
  let customerPresent = true;
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    const intent = await ledger.registerIntent("stripe_customer", "cell-a-customer");
    await ledger.markAcquired(
      intent.entryId,
      `intent:customer:runTag=${RUN_ID}:${SHARD_ID}:cellA`,
    );

    const report = await replayManagedCloudFixtures(
      { runDir, runId: RUN_ID, shardId: SHARD_ID },
      { STRIPE_TEST_SECRET_KEY: "sk_test_fixture_replay" },
      {
        awsExec: async () => { throw new Error("AWS must not be called"); },
        ssh: {
          async run() { throw new Error("SSH must not be called"); },
          async copyFile() { throw new Error("SSH must not be called"); },
        },
        stripeHttp: {
          async request(_key, request) {
            calls.push(`${request.method} ${request.path}`);
            if (request.method === "GET" && request.path.startsWith("/customers")) {
              return {
                data: customerPresent
                  ? [{
                      id: "cus_gap_1",
                      metadata: {
                        proliferate_qualification_run: `${RUN_ID}:${SHARD_ID}`,
                        proliferate_qualification_cell: "cellA",
                      },
                    }]
                  : [],
                has_more: false,
              };
            }
            if (request.method === "DELETE" && request.path === "/customers/cus_gap_1") {
              customerPresent = false;
              return { id: "cus_gap_1", deleted: true };
            }
            throw new Error(`unexpected Stripe request ${request.method} ${request.path}`);
          },
        },
      },
    );

    assert.equal(report.status, "reconciled");
    assert.deepEqual(report.reconciled_fixture_kinds, ["stripe_customer"]);
    assert.deepEqual(report.reconciled_domains, ["stripe"]);
    assert.equal(customerPresent, false);
    assert.deepEqual(calls, [
      "GET /customers?limit=100",
      "DELETE /customers/cus_gap_1",
      "GET /customers?limit=100",
    ]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("non-fixture-only ledger is a no-op and never queries AWS or providers", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-noop-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(ledger, "ec2_instance", "world-instance", "i-0abc0");
    const unexpected = async (): Promise<never> => {
      throw new Error("provider must not be called");
    };
    const report = await replayManagedCloudFixtures(
      { runDir, runId: RUN_ID, shardId: SHARD_ID },
      {},
      {
        awsExec: unexpected,
        ssh: { run: unexpected, copyFile: unexpected },
        stripeHttp: { request: unexpected },
      },
    );
    assert.equal(report.status, "not_needed");
    assert.equal(report.untouched_non_fixture_entries, 1);
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "acquired");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("ambiguous ingress fails before any fixture mutation and preserves the ledger", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-ambiguous-"));
  const secretsDir = path.join(runDir, "secrets");
  try {
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(secretsDir, "ingress-key.pem"), "not-a-real-key\n", { mode: 0o600 });
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(ledger, "callback_relay_spool", "spool", "/home/ubuntu/candidate/callback-relay");
    const unexpected = async (): Promise<never> => {
      throw new Error("mutation must not be called");
    };
    await assert.rejects(
      () => replayManagedCloudFixtures(
        { runDir, runId: RUN_ID, shardId: SHARD_ID },
        { RELEASE_E2E_CLOUD_AWS_REGION: REGION },
        {
          awsExec: fakeAws([], awsPayload(2)),
          ssh: { run: unexpected, copyFile: unexpected },
          stripeHttp: { request: unexpected },
        },
      ),
      /exactly one.*observed 2/,
    );
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "acquired");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("an unavailable ingress does not prevent independent Stripe and E2B cleanup", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-domains-"));
  const secretsDir = path.join(runDir, "secrets");
  const stripeCalls: string[] = [];
  let providerVisible = true;
  try {
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(secretsDir, "ingress-key.pem"), "not-a-real-key\n", { mode: 0o600 });
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(ledger, "callback_relay_spool", "spool", "/home/ubuntu/candidate/callback-relay");
    await acquire(ledger, "stripe_customer", "customer", "cus_123");
    await acquire(
      ledger,
      "e2b_sandbox",
      "sandbox",
      encodeE2bSandboxCleanupIdentity({
        cloudSandboxId: "cloud-sandbox-1",
        providerSandboxId: "e2b-provider-1",
      }),
    );

    await assert.rejects(
      () => replayManagedCloudFixtures(
        { runDir, runId: RUN_ID, shardId: SHARD_ID },
        {
          RELEASE_E2E_CLOUD_AWS_REGION: REGION,
          RELEASE_E2E_E2B_API_KEY: "e2b_test_key",
          STRIPE_TEST_SECRET_KEY: "sk_test_fixture_replay",
        },
        {
          awsExec: fakeAws([], awsPayload(0)),
          ssh: {
            async run() { throw new Error("missing ingress must not be contacted"); },
            async copyFile() { throw new Error("missing ingress must not be contacted"); },
          },
          stripeHttp: {
            async request(_key, request) {
              stripeCalls.push(`${request.method} ${request.path}`);
              return { deleted: true };
            },
          },
          providers: {
            now: () => new Date("2026-07-17T00:00:00.000Z"),
            async findSandbox() {
              return providerVisible
                ? {
                    providerSandboxId: "e2b-provider-1",
                    state: "running",
                    matches: [{
                      providerSandboxId: "e2b-provider-1",
                      state: "running",
                      templateId: "tpl-1",
                      startedAt: null,
                    }],
                    count: 1,
                  }
                : { providerSandboxId: null, state: null, matches: [], count: 0 };
            },
            async killSandbox() {
              providerVisible = false;
              return { killed: true };
            },
          },
        },
      ),
      /box:.*observed 0.*left 1 selected entry/i,
    );

    const entries = (await loadCleanupLedger(runDir)).entries();
    assert.equal(entries.find((entry) => entry.entryId === "spool")?.phase, "acquired");
    assert.equal(entries.find((entry) => entry.entryId === "customer")?.phase, "reconciled");
    assert.equal(entries.find((entry) => entry.entryId === "sandbox")?.phase, "reconciled");
    assert.deepEqual(stripeCalls, ["DELETE /customers/cus_123"]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("encoded intent-only E2B cleanup preserves custody after repeated provider absence", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-e2b-intent-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(
      ledger,
      "e2b_sandbox",
      "sandbox-intent",
      encodeE2bSandboxCleanupIdentity({ cloudSandboxId: "cloud-intent-1", providerSandboxId: null }),
    );
    let observations = 0;
    const replay = (count = 0) => replayManagedCloudFixtures(
      { runDir, runId: RUN_ID, shardId: SHARD_ID },
      { RELEASE_E2E_E2B_API_KEY: "e2b_test_key" },
      {
        awsExec: fakeAws([], awsPayload(0)),
        ssh: {
          async run() { throw new Error("E2B-only replay must not use SSH"); },
          async copyFile() { throw new Error("E2B-only replay must not use SCP"); },
        },
        stripeHttp: { async request() { throw new Error("E2B-only replay must not use Stripe"); } },
        providers: {
          now: () => new Date(),
          async sleep() {},
          async findSandbox() {
            observations += 1;
            return { providerSandboxId: null, state: null, matches: [], count };
          },
          async killSandbox() { throw new Error("empty inventory must not issue a kill"); },
        },
      },
    );
    await assert.rejects(() => replay(), /no authoritative provider binding.*preserving cleanup custody/i);
    assert.equal(observations, 3);
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "acquired");

    // Time cannot turn eventual-consistency observations into authoritative
    // absence while the candidate materialization producer remains alive.
    observations = 0;
    await assert.rejects(() => replay(), /no authoritative provider binding.*preserving cleanup custody/i);
    assert.equal(observations, 3);
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "acquired");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("E2B cleanup persists discovered provider ids before delete and survives reconcile failure", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-e2b-crash-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(
      ledger,
      "e2b_sandbox",
      "sandbox-crash",
      encodeE2bSandboxCleanupIdentity({ cloudSandboxId: "cloud-crash-1", providerSandboxId: null }),
    );
    let providerVisible = true;
    const killed: string[] = [];
    const providers = {
      now: () => new Date(),
      async sleep() {},
      async findSandbox() {
        return providerVisible
          ? {
              providerSandboxId: "e2b-crash-1",
              state: "running" as const,
              matches: [{
                providerSandboxId: "e2b-crash-1", state: "running" as const,
                templateId: "tpl-1", startedAt: null,
              }],
              count: 1,
            }
          : { providerSandboxId: null, state: null, matches: [], count: 0 };
      },
      async killSandbox(providerSandboxId: string) {
        killed.push(providerSandboxId);
        providerVisible = false;
        return { killed: true };
      },
    };
    const handlers = managedCloudFixtureReplayHandlers({
      box: UNUSED_BOX,
      runTag: `${RUN_ID}:${SHARD_ID}`,
      stripeSecretKey: "unused",
      stripeHttp: { async request() { throw new Error("unused Stripe"); } },
      ledgerEntries: ledger.entries(),
      ledger,
      providers,
    });
    const crashingLedger: CleanupLedger = {
      ledgerId: ledger.ledgerId,
      registerIntent: (kind, entryId) => ledger.registerIntent(kind, entryId),
      markAcquired: (entryId, providerId) => ledger.markAcquired(entryId, providerId),
      async markReconciled() { throw new Error("simulated crash before reconciliation persistence"); },
      entries: () => ledger.entries(),
      unreconciled: () => ledger.unreconciled(),
    };
    await assert.rejects(
      () => replayManagedCloudFixtureEntries(
        crashingLedger, handlers, new Set<CleanupResourceKind>(["e2b_sandbox"]),
      ),
      /simulated crash before reconciliation persistence/,
    );
    assert.deepEqual(killed, ["e2b-crash-1"]);

    const persisted = await loadCleanupLedger(runDir);
    const entry = persisted.entries().find((row) => row.entryId === "sandbox-crash");
    assert.equal(entry?.phase, "acquired");
    assert.deepEqual(decodeE2bSandboxCleanupIdentity(entry?.providerId ?? ""), {
      cloudSandboxId: "cloud-crash-1", providerSandboxId: "e2b-crash-1",
    });

    const retryHandlers = managedCloudFixtureReplayHandlers({
      box: UNUSED_BOX,
      runTag: `${RUN_ID}:${SHARD_ID}`,
      stripeSecretKey: "unused",
      stripeHttp: { async request() { throw new Error("unused Stripe"); } },
      ledgerEntries: persisted.entries(),
      ledger: persisted,
      providers,
    });
    const retry = await replayManagedCloudFixtureEntries(
      persisted, retryHandlers, new Set<CleanupResourceKind>(["e2b_sandbox"]),
    );
    assert.equal(retry.reconciled, 1);
    assert.deepEqual(killed, ["e2b-crash-1", "e2b-crash-1"]);
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "reconciled");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("null pre-return E2B intent reconciles without provider discovery or destruction", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-e2b-null-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await ledger.registerIntent("e2b_sandbox", "sandbox-null");
    let providerCalls = 0;
    const report = await replayManagedCloudFixtures(
      { runDir, runId: RUN_ID, shardId: SHARD_ID },
      { RELEASE_E2E_E2B_API_KEY: "e2b_test_key" },
      {
        awsExec: fakeAws([], awsPayload(0)),
        ssh: {
          async run() { throw new Error("unused"); },
          async copyFile() { throw new Error("unused"); },
        },
        stripeHttp: { async request() { throw new Error("unused"); } },
        providers: {
          now: () => new Date(),
          async findSandbox() { providerCalls += 1; throw new Error("must not list E2B"); },
          async killSandbox() { providerCalls += 1; throw new Error("must not destroy E2B"); },
        },
      },
    );
    assert.equal(report.status, "reconciled");
    assert.equal(providerCalls, 0);
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "reconciled");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("E2B cleanup rejects a count that disagrees with the exhaustive match list", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "fixture-replay-e2b-count-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN_ID, shardId: SHARD_ID });
    await acquire(
      ledger,
      "e2b_sandbox",
      "sandbox-count",
      encodeE2bSandboxCleanupIdentity({ cloudSandboxId: "cloud-count-1", providerSandboxId: null }),
    );
    await assert.rejects(() => replayManagedCloudFixtures(
      { runDir, runId: RUN_ID, shardId: SHARD_ID },
      { RELEASE_E2E_E2B_API_KEY: "e2b_test_key" },
      {
        awsExec: fakeAws([], awsPayload(0)),
        ssh: {
          async run() { throw new Error("unused"); },
          async copyFile() { throw new Error("unused"); },
        },
        stripeHttp: { async request() { throw new Error("unused"); } },
        providers: {
          now: () => new Date(),
          async sleep() {},
          async findSandbox() {
            return { providerSandboxId: null, state: null, matches: [], count: 1 };
          },
          async killSandbox() { throw new Error("unused"); },
        },
      },
    ), /count does not match/i);
    assert.equal((await loadCleanupLedger(runDir)).entries()[0]?.phase, "acquired");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("fresh-process wrapper invokes the CLI and validates its exact run identity", async () => {
  const calls: Array<{ file: string; args: readonly string[]; cwd: string; marker?: string }> = [];
  const report = await replayManagedCloudFixturesInFreshProcess(
    { runDir: "/tmp/run-dir", runId: RUN_ID, shardId: SHARD_ID },
    { QUALIFICATION_MARKER: "present" },
    async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, marker: options.env.QUALIFICATION_MARKER });
      return {
        stdout: `${JSON.stringify({
          kind: "managed_cloud_fixture_cleanup_replay",
          schema_version: 1,
          status: "reconciled",
          run_id: RUN_ID,
          shard_id: SHARD_ID,
          selected_fixture_entries: 7,
          reconciled_fixture_entries: 7,
          selected_fixture_kinds: [
            "billing_fixture_adjustment",
            "callback_relay_process",
            "callback_relay_spool",
            "e2b_sandbox",
            "stripe_customer",
            "stripe_product_price",
            "stripe_test_clock",
          ],
          reconciled_fixture_kinds: [
            "billing_fixture_adjustment",
            "callback_relay_process",
            "callback_relay_spool",
            "e2b_sandbox",
            "stripe_customer",
            "stripe_product_price",
            "stripe_test_clock",
          ],
          reconciled_domains: ["box", "e2b", "stripe"],
          untouched_non_fixture_entries: 9,
          ingress_instance_id: "i-0abc0",
        })}\n`,
        stderr: "",
      };
    },
  );
  assert.equal(report.status, "reconciled");
  assert.equal(report.selected_fixture_entries, 7);
  assert.equal(calls[0]?.file, "pnpm");
  assert.deepEqual(calls[0]?.args.slice(0, 2), ["exec", "tsx"]);
  assert.ok(calls[0]?.args.includes("--run-dir"));
  assert.ok(calls[0]?.args.includes("/tmp/run-dir"));
  assert.equal(calls[0]?.marker, "present");
  assert.ok(calls[0]?.cwd.endsWith("/tests/release"));
});

test("fresh-process wrapper rejects drifted reports and redacts bounded child failures", async () => {
  await assert.rejects(
    () => replayManagedCloudFixturesInFreshProcess(
      { runDir: "/tmp/run-dir", runId: RUN_ID, shardId: SHARD_ID },
      {},
      async () => ({
        stdout: `${JSON.stringify({
          kind: "managed_cloud_fixture_cleanup_replay",
          schema_version: 1,
          status: "reconciled",
          run_id: "another-run",
          shard_id: SHARD_ID,
          selected_fixture_entries: 1,
          reconciled_fixture_entries: 1,
          selected_fixture_kinds: ["stripe_customer"],
          reconciled_fixture_kinds: ["stripe_customer"],
          reconciled_domains: ["stripe"],
          untouched_non_fixture_entries: 0,
          ingress_instance_id: null,
        })}\n`,
        stderr: "",
      }),
    ),
    /identity\/schema validation/,
  );
  await assert.rejects(
    () => replayManagedCloudFixturesInFreshProcess(
      { runDir: "/tmp/run-dir", runId: RUN_ID, shardId: SHARD_ID },
      {},
      async () => {
        throw { stdout: "cleanup rejected sk_test_super_secret_value", stderr: "" };
      },
    ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.includes("[REDACTED_STRIPE_KEY]") && !message.includes("super_secret_value");
    },
  );
});
