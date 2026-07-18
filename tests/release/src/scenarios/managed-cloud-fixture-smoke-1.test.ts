import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FIXTURE_SMOKE_CELL_NAMES,
  FIXTURE_SMOKE_WORLD_SUBDIR,
  MANAGED_CLOUD_FIXTURE_SMOKE_1_ID,
  WEBHOOK_CUSTODY_DIRNAME,
  WEBHOOK_INTENT_FILENAME,
  assertDuplicateDeliveryByteIdentity,
  assertRepresentativeFixtureReplay,
  allCleanupBooleansTrue,
  armRuntimeReadinessFailureWatcher,
  buildDuplicatePostScript,
  createFixtureSmokeDriver,
  createCellACustomerWithCustody,
  decodeE2bSandboxCleanupIdentity,
  encodeE2bSandboxCleanupIdentity,
  ensureOwnerActor,
  fixtureSmokeScopedRunDir,
  managedCloudFixtureSmoke1,
  parseProcStatStarttime,
  parseRelayPidfileJson,
  parseStatModes,
  parseWebhookReceiptSnapshot,
  PRODUCT_LLM_CREDIT_DENIAL_CODE,
  procCmdlineContainsScript,
  reconcileWebhookIntentFile,
  registerFailureInjectionSandboxIntent,
  resolveSmokeSecretKey,
  runBillingThresholdCellLive,
  runFailureInjectionCellLive,
  runFixtureSmokeCells,
  waitForPersonalMaterializationReady,
  type BillingThresholdCellDeps,
  type FixtureSmokeCellResult,
  type FixtureSmokeDriver,
  type RuntimeReadinessRecoveryOps,
  type StripePreparation,
} from "./managed-cloud-fixture-smoke-1.js";
import type { StripeHttp } from "../fixtures/stripe-test-clock.js";
import { encodeWebhookEndpointIntentRef, webhookEndpointUrl } from "../fixtures/stripe-smoke-resources.js";
import { TEST_QUALIFICATION_TLS } from "../worlds/qualification-tls.test-fixture.js";
import type { CloudProvision1ConstructionInputs } from "./cloud-provision-1.js";
import type { ConstructManagedCloudWorldOptions } from "../worlds/managed-cloud/world.js";
import { isMatrixScenario, type ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { CapturedDelivery } from "../fixtures/callback-relay.js";
import type { FailureInjectionHandle } from "../fixtures/failure-injection.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";
import type { ManagedCloudCleanupEvidence } from "../worlds/managed-cloud/cleanup-kinds.js";
import type { AuthenticatedActor } from "../fixtures/authenticated-actor.js";

const REQUIRED_ENV_VARS: Record<string, string> = {
  AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
  AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
  AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
  RELEASE_E2E_E2B_API_KEY: "e2b-test-key",
  RELEASE_E2E_E2B_TEAM_ID: "team-test",
  RELEASE_E2E_CLOUD_AWS_REGION: "us-east-1",
  RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: "Z000000TEST",
  RELEASE_E2E_CLOUD_GITHUB_APP_ID: "123456",
  RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID: "Iv1.testclientid",
  RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID: "78901",
  RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64: TEST_QUALIFICATION_TLS.certificateBase64,
  RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64: TEST_QUALIFICATION_TLS.privateKeyBase64,
  STRIPE_TEST_SECRET_KEY: "sk_test_abc123",
};

function fakeCandidateMap(): CandidateBuildMapV1 {
  return { schema_version: 1, kind: "proliferate.candidate-build", source_sha: "a".repeat(40), artifacts: [] };
}

function fakeEnv(overrides: Record<string, string | undefined> = {}): EnvResolution {
  const values: Record<string, string> = { ...REQUIRED_ENV_VARS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete values[key];
    } else {
      values[key] = value;
    }
  }
  return {
    all: [],
    missing: [],
    present: (name) => values[name] !== undefined,
    get: (name) => values[name],
    require: (name) => {
      const value = values[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "cloud",
    runtimeLane: "sandbox",
    desktop: "web",
    agents: ["claude"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "smoke-run-1",
      shard_id: "smoke-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/smoke-run-1",
    ports: null,
    ...overrides,
  };
}

function fakeArtifact(id: string) {
  return { artifact_id: id, version: "1.0.0", sha256: "a".repeat(64), path: `/tmp/${id.replace(/\//g, "-")}` };
}

function fakeWorld(closeImpl?: () => Promise<ManagedCloudCleanupEvidence>): ManagedCloudWorld & { closeCalls: number } {
  const calls = { closeCalls: 0 };
  const world = {
    kind: "managed-cloud",
    run: fakeCtx().runIdentity!,
    artifacts: {
      server: fakeArtifact("server/linux/amd64"),
      anyharness: fakeArtifact("anyharness/x86_64-unknown-linux-musl"),
      worker: fakeArtifact("worker/x86_64-unknown-linux-musl"),
      supervisor: fakeArtifact("supervisor/x86_64-unknown-linux-musl"),
      credentialHelper: fakeArtifact("credential-helper/x86_64-unknown-linux-musl"),
      desktopRenderer: fakeArtifact("desktop-renderer/browser"),
      template: {
        artifact_id: "e2b-template/smoke-run-1",
        templateId: "tmpl_123",
        buildId: "build_456",
        inputHash: "b".repeat(64),
        bakedInputs: [],
      },
      candidateApi: {
        artifact_id: "candidate-api/smoke-run-1.qualification.proliferate.com",
        version: "1.0.0",
        sha256: "c".repeat(64),
        publicOrigin: "https://smoke-run-1.qualification.proliferate.com",
        ec2InstanceId: "i-0123456789",
      },
    },
    api: { baseUrl: "https://smoke-run-1.qualification.proliferate.com", client: {} as never },
    renderer: { baseUrl: "https://smoke-run-1.qualification.proliferate.com", browser: {} as never },
    gateway: {} as never,
    sandbox: { e2bTeamId: "team-test" },
    paths: { runDir: "/tmp/smoke-run-1", secretsDir: "/tmp/smoke-run-1/secrets" },
    registerCleanup: async () => undefined,
    registerCleanupIntent: async () => ({ entryId: "e", markAcquired: async () => undefined }),
    trackActorSubjects: async () => undefined,
    close:
      closeImpl ??
      (async (): Promise<ManagedCloudCleanupEvidence> => {
        calls.closeCalls += 1;
        return cleanEvidence();
      }),
  } as unknown as ManagedCloudWorld & { closeCalls: number };
  Object.defineProperty(world, "closeCalls", { get: () => calls.closeCalls });
  return world;
}

function cleanEvidence(): ManagedCloudCleanupEvidence {
  return {
    ledgerIdHash: "e".repeat(64),
    registered: 5,
    reconciled: 5,
    failed: 0,
    sandboxesDeleted: true,
    templateDeleted: true,
    dnsRecordDeleted: true,
    ec2Terminated: true,
    securityGroupDeleted: true,
    keyPairDeleted: true,
    virtualKeyDeleted: true,
    litellmSubjectsDeleted: true,
    localPathsRemoved: true,
    billingFixtureCleared: true,
    relayStopped: true,
    stripeFixturesDeleted: true,
  };
}

function fakePrep(): StripePreparation {
  return {
    scopedRunDir: "/tmp/smoke-run-1/fixture-smoke",
    secretsEnvFilePath: "/tmp/smoke-run-1/fixture-smoke/secrets/stripe.env",
    webhookSecretEnvFilePath: "/tmp/smoke-run-1/fixture-smoke/secrets/stripe-webhook.env",
    subdomain: "mcq-smoke-run-1-smoke-0.qualification.proliferate.com",
    webhookEndpointId: "we_123",
    webhookIntentRef: "intent:webhook_endpoint:url=https://x/v1/billing/webhooks/stripe",
    webhookIntentFilePath: "/tmp/smoke-run-1/cleanup-custody/stripe-webhook-endpoint-intent.json",
  };
}

function cellResult(transition: string): FixtureSmokeCellResult {
  return { externalIds: ["cus_1"], observedTransition: transition, cleanupEntries: ["stripe_customer"] };
}

function cleanupReplayResult(): FixtureSmokeCellResult {
  return {
    externalIds: ["cus_e"],
    observedTransition: "swept_zero",
    cleanupEntries: ["stripe_customer"],
    providerSweeps: [
      { provider: "aws", remaining_owned_resources: 0 },
      { provider: "stripe", remaining_owned_resources: 0 },
      { provider: "e2b", remaining_owned_resources: 0 },
      { provider: "process", remaining_owned_resources: 0 },
      { provider: "filesystem", remaining_owned_resources: 0 },
    ],
  };
}

/** A fully-wired happy-path fake driver; tests override methods. */
function fakeDriver(
  overrides: Partial<FixtureSmokeDriver> = {},
): FixtureSmokeDriver & { world: ManagedCloudWorld & { closeCalls: number }; closeWorldCalls: number } {
  const world = fakeWorld();
  const state = { closeWorldCalls: 0 };
  const driver: FixtureSmokeDriver & { world: typeof world; closeWorldCalls: number } = {
    world,
    get closeWorldCalls() {
      return state.closeWorldCalls;
    },
    prepareStripe: async () => fakePrep(),
    buildWorld: async () => world,
    adoptWebhookIntent: async () => undefined,
    deleteWebhookEndpoint: async () => undefined,
    createActor: async () => fakeCellCActor(),
    trackActorSubjects: async () => undefined,
    runCallbackRelayCell: async () => cellResult("held→replayed→duplicate:byte_identical(abc)"),
    // B/C/D route through the shared-actor memoizer exactly as production does, so
    // the orchestration regression test can observe single-creation.
    runStripeTestClockCell: async function (w, s) {
      await ensureOwnerActor(w, s, this);
      return cellResult("created→advanced→event_observed→recovered_by_identity→deleted_absent");
    },
    runBillingThresholdCell: async function (w, s) {
      await ensureOwnerActor(w, s, this);
      return cellResult("positioned:remaining=0.0001");
    },
    runFailureInjectionCell: async function (w, s) {
      await ensureOwnerActor(w, s, this);
      return cellResult("control_ok→injected_failure(500)→recovered→control_ok(relay=true)");
    },
    runCleanupReplayCell: async (_w, _s, closeWorld) => {
      await closeWorld();
      return cleanupReplayResult();
    },
    closeWorld: async () => {
      state.closeWorldCalls += 1;
      return cleanEvidence();
    },
    ...overrides,
  };
  return driver;
}

function cellsFor(names: readonly string[]): PlannedCellV1[] {
  return names.map((name) => ({
    cell_id: `${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=${name}`,
    scenario_id: MANAGED_CLOUD_FIXTURE_SMOKE_1_ID,
    registry_flow_ref: "specs/developing/testing/flows.md#cloud-provision",
    runtime_lane: "sandbox",
    dimensions: { cell: name },
    required_env: [],
  }));
}

const ALL_CELLS = cellsFor(FIXTURE_SMOKE_CELL_NAMES);

test("the scenario is a matrix over exactly the five fixture cells", async () => {
  assert.ok(isMatrixScenario(managedCloudFixtureSmoke1));
  if (isMatrixScenario(managedCloudFixtureSmoke1)) {
    const cells = await managedCloudFixtureSmoke1.expandCells({ runtimeLane: "sandbox", desktop: "web", agents: ["claude"] });
    assert.deepEqual(
      cells.map((c) => c.dimensions.cell).sort(),
      [...FIXTURE_SMOKE_CELL_NAMES].sort(),
    );
  }
  assert.ok(managedCloudFixtureSmoke1.requiredEnv.includes("STRIPE_TEST_SECRET_KEY"));
  assert.ok(managedCloudFixtureSmoke1.requiredEnv.includes("RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64"));
  assert.ok(managedCloudFixtureSmoke1.requiredEnv.includes("RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64"));
});

test("all five cells go green with kind-scoped evidence on the happy path", async () => {
  const driver = fakeDriver();
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  assert.equal(outcomes.length, 5);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "green", `${outcome.cellId} should be green`);
    const evidence = (outcome as { evidence?: { kind?: string; cells?: unknown[] } }).evidence;
    assert.equal(evidence?.kind, "managed_cloud_fixture_smoke");
    assert.equal(evidence?.cells?.length, 1, "each cell carries exactly its own entry");
  }
  // The world is closed exactly once (by cleanup-replay).
  assert.equal(driver.closeWorldCalls, 1);
});

test("a failing earlier cell does not poison later cells (independent judgment)", async () => {
  const driver = fakeDriver({
    runCallbackRelayCell: async () => {
      throw new Error("relay boom");
    },
  });
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  const byCell = new Map(outcomes.map((o) => [o.cellId, o]));
  assert.equal(byCell.get(`${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=callback-relay`)?.status, "failed");
  assert.equal(byCell.get(`${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=stripe-test-clock`)?.status, "green");
  assert.equal(byCell.get(`${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=cleanup-replay`)?.status, "green");
  assert.equal(driver.closeWorldCalls, 1);
});

test("cleanup-replay's closeWorld callback returns the world-close evidence (gate + sweeps use the real result)", async () => {
  let received: unknown = "unset";
  const driver = fakeDriver({
    runCleanupReplayCell: async (_w, _s, closeWorld) => {
      received = await closeWorld();
      // A second call returns null (already closed) — cell E only gates on the
      // first (real) close evidence.
      const second = await closeWorld();
      assert.equal(second, null);
      return cleanupReplayResult();
    },
  });
  const outcomes = await runFixtureSmokeCells(fakeCtx(), cellsFor(["cleanup-replay"]), driver);
  assert.equal(outcomes[0]!.status, "green");
  assert.ok(received && typeof received === "object", "cell E must receive the ManagedCloudCleanupEvidence, not void");
  assert.equal((received as { failed: number }).failed, 0);
  assert.equal((received as { stripeFixturesDeleted?: boolean }).stripeFixturesDeleted, true);
  assert.equal(driver.closeWorldCalls, 1);
});

test("allCleanupBooleansTrue gates on required + present optional booleans", async () => {
  const clean = cleanEvidence();
  assert.equal(allCleanupBooleansTrue(clean), true);
  // A false required boolean fails.
  assert.equal(allCleanupBooleansTrue({ ...clean, ec2Terminated: false }), false);
  // A false optional (present) fails; an undefined optional is treated as clean.
  assert.equal(allCleanupBooleansTrue({ ...clean, relayStopped: false }), false);
  assert.equal(allCleanupBooleansTrue({ ...clean, stripeFixturesDeleted: false }), false);
  assert.equal(allCleanupBooleansTrue({ ...clean, relayStopped: undefined, stripeFixturesDeleted: undefined, billingFixtureCleared: undefined }), true);
});

test("cleanup-replay runs last and the world is closed exactly once even when it is the only assigned cell", async () => {
  const driver = fakeDriver();
  const outcomes = await runFixtureSmokeCells(fakeCtx(), cellsFor(["cleanup-replay"]), driver);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.status, "green");
  assert.equal(driver.closeWorldCalls, 1);
});

test("cells B+C+D create the owner actor EXACTLY ONCE (a second /setup claim would fail)", async () => {
  // The server's claim_first_run raises SetupClosedError once any user exists, so
  // authenticatedActor's /setup claim can only succeed once against the shared
  // world. This driver's createActor THROWS on the second call — proving the
  // orchestration memoizes one shared actor across B/C/D (the bug this catches).
  let createCount = 0;
  const driver = fakeDriver({
    createActor: async () => {
      createCount += 1;
      if (createCount > 1) {
        throw new Error("SetupClosedError: /setup already claimed");
      }
      return fakeCellCActor();
    },
  });
  const outcomes = await runFixtureSmokeCells(
    fakeCtx(),
    cellsFor(["stripe-test-clock", "billing-threshold", "failure-injection"]),
    driver,
  );
  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((o) => o.status === "green"), JSON.stringify(outcomes.map((o) => [o.cellId, o.status, o.reason?.message])));
  assert.equal(createCount, 1, "the owner actor must be created exactly once across cells B/C/D");
});

test("ensureOwnerActor memoizes the actor and never creates a second (createActor throws on 2nd call)", async () => {
  let createCount = 0;
  const state = { runTag: "r:s", secretKey: "k", prep: fakePrep(), aws: { region: "r", hostedZoneId: "z" } };
  const seam = {
    createActor: async () => {
      createCount += 1;
      if (createCount > 1) throw new Error("second creation attempted");
      return fakeCellCActor();
    },
    trackActorSubjects: async () => undefined,
  };
  const world = fakeWorld();
  const a1 = await ensureOwnerActor(world, state, seam);
  const a2 = await ensureOwnerActor(world, state, seam);
  const a3 = await ensureOwnerActor(world, state, seam);
  assert.equal(createCount, 1);
  assert.equal(a1, a2);
  assert.equal(a2, a3);
});

test("the world is still closed when cleanup-replay is NOT assigned (no leak, no cleanup outcome)", async () => {
  const driver = fakeDriver();
  const outcomes = await runFixtureSmokeCells(fakeCtx(), cellsFor(["callback-relay"]), driver);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.status, "green");
  // The finally-close ran even though cleanup-replay did not emit an outcome.
  assert.equal(driver.closeWorldCalls, 1);
});

test("missing STRIPE_TEST_SECRET_KEY fails every assigned cell with a bounded reason and no side effects", async () => {
  let buildWorldCalled = false;
  const driver = fakeDriver({
    buildWorld: async () => {
      buildWorldCalled = true;
      return fakeWorld();
    },
  });
  const outcomes = await runFixtureSmokeCells(
    fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: undefined }) }),
    ALL_CELLS,
    driver,
  );
  assert.equal(outcomes.length, 5);
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /STRIPE_TEST_SECRET_KEY is not set/);
  assert.equal(buildWorldCalled, false);
  assert.equal(driver.closeWorldCalls, 0);
});

test("a live-mode STRIPE_TEST_SECRET_KEY fails closed before any world side effect", async () => {
  let prepareCalled = false;
  const driver = fakeDriver({
    prepareStripe: async () => {
      prepareCalled = true;
      return fakePrep();
    },
  });
  const outcomes = await runFixtureSmokeCells(
    fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: "sk_live_dangerous" }) }),
    ALL_CELLS,
    driver,
  );
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /LIVE-mode/);
  assert.equal(prepareCalled, false);
});

test("resolveSmokeSecretKey rejects missing and live keys, accepts a test key", () => {
  assert.equal(resolveSmokeSecretKey(fakeCtx()).ok, true);
  assert.equal(resolveSmokeSecretKey(fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: undefined }) })).ok, false);
  assert.equal(resolveSmokeSecretKey(fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: "rk_live_x" }) })).ok, false);
});

test("world construction failure fails every assigned cell cleanly", async () => {
  const driver = fakeDriver({
    buildWorld: async () => {
      throw new Error("aws quota exceeded");
    },
  });
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /world construction failed/);
});

// ── Duplicate-delivery byte-identity witness (pure) ─────────────────────────

function delivery(overrides: Partial<CapturedDelivery>): CapturedDelivery {
  return {
    deliveryId: "d1",
    channel: "stripe",
    providerEventId: "evt_1",
    bytesSha256: "s".repeat(64),
    receivedAt: new Date().toISOString(),
    state: "held",
    ...overrides,
  };
}

test("assertDuplicateDeliveryByteIdentity witnesses a new byte-identical forwarded row", () => {
  const before = [delivery({ deliveryId: "d1", state: "replayed:200" })];
  const after = [
    delivery({ deliveryId: "d1", state: "replayed:200" }),
    delivery({ deliveryId: "d1", state: "replayed:200" }),
  ];
  const witness = assertDuplicateDeliveryByteIdentity(before, after, "evt_1");
  assert.equal(witness.bytesSha256, "s".repeat(64));
});

test("assertDuplicateDeliveryByteIdentity throws when the duplicate's bytes differ", () => {
  const before = [delivery({ bytesSha256: "s".repeat(64) })];
  const after = [
    delivery({ bytesSha256: "s".repeat(64) }),
    delivery({ bytesSha256: "d".repeat(64) }),
  ];
  assert.throws(() => assertDuplicateDeliveryByteIdentity(before, after, "evt_1"), /did not forward verbatim/);
});

test("assertDuplicateDeliveryByteIdentity throws when no new forwarded row appeared", () => {
  const before = [delivery({})];
  assert.throws(() => assertDuplicateDeliveryByteIdentity(before, before, "evt_1"), /no NEW forwarded row/);
});

test("assertDuplicateDeliveryByteIdentity throws when there is no baseline row for the event", () => {
  assert.throws(() => assertDuplicateDeliveryByteIdentity([], [], "evt_missing"), /no baseline delivery row/);
});

// ── Cell A pure parsers (mode / pid / receipt / duplicate-post builder) ─────

test("Cell A persists customer intent before POST and retains cleanup through the create→acquire gap", async () => {
  const calls: string[] = [];
  const cleanupCapture: { release?: () => Promise<void> } = {};
  const world = {
    registerCleanupIntent: async (
      kind: string,
      providerId: string,
      handler: () => Promise<void>,
    ) => {
      calls.push(`intent:${kind}:${providerId}`);
      cleanupCapture.release = handler;
      return {
        entryId: "cell-a-customer",
        markAcquired: async (customerId: string) => {
          calls.push(`acquire:${customerId}`);
          throw new Error("simulated runner death before durable acquire");
        },
      };
    },
  } as unknown as ManagedCloudWorld;
  const http: StripeHttp = {
    async request(_key, request) {
      calls.push(`${request.method} ${request.path}`);
      if (request.method === "POST" && request.path === "/customers") {
        return { id: "cus_gap_1" };
      }
      if (request.method === "DELETE" && request.path === "/customers/cus_gap_1") {
        return { id: "cus_gap_1", deleted: true };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    },
  };

  await assert.rejects(
    () => createCellACustomerWithCustody(
      world,
      { secretKey: "sk_test_cell_a", runTag: "run-a:shard-a" },
      http,
    ),
    /simulated runner death/,
  );
  assert.deepEqual(calls.slice(0, 3), [
    "intent:stripe_customer:intent:customer:runTag=run-a:shard-a:cellA",
    "POST /customers",
    "acquire:cus_gap_1",
  ]);
  assert.ok(cleanupCapture.release, "cleanup registration must retain a replayable customer cleanup");
  await cleanupCapture.release();
  assert.equal(calls.at(-1), "DELETE /customers/cus_gap_1");
});

test("parseStatModes maps each path to its octal mode", () => {
  const stdout = "/home/ubuntu/candidate/callback-relay 700\n/home/ubuntu/candidate/callback-relay/held/ab.bin 600\n";
  const modes = parseStatModes(stdout);
  assert.equal(modes["/home/ubuntu/candidate/callback-relay"], "700");
  assert.equal(modes["/home/ubuntu/candidate/callback-relay/held/ab.bin"], "600");
});

test("parseRelayPidfileJson parses {pid,starttime,script} and rejects a malformed pidfile", () => {
  const parsed = parseRelayPidfileJson('{"pid":4242,"starttime":"9988","script":"/x/relay.py"}');
  assert.deepEqual(parsed, { pid: 4242, starttime: "9988", script: "/x/relay.py" });
  assert.throws(() => parseRelayPidfileJson('{"pid":"nope"}'), /malformed/);
});

test("parseProcStatStarttime extracts starttime even when comm contains spaces/parens", () => {
  // After the parser strips through the LAST `) `, the remainder begins at field
  // 3 (state); starttime is field 22 overall = index 19 of the remainder. Build a
  // remainder with 19 filler fields (indices 0..18) then the starttime at index 19.
  const remainder = Array.from({ length: 19 }, (_, i) => String(i + 1)).join(" ") + " 9988 rest more";
  const statLine = `4242 (relay py) ${remainder}`;
  assert.equal(parseProcStatStarttime(statLine), "9988");
});

test("procCmdlineContainsScript detects the script path in a NUL→space-joined cmdline", () => {
  assert.equal(procCmdlineContainsScript("python3 /x/relay.py serve ", "/x/relay.py"), true);
  assert.equal(procCmdlineContainsScript("python3 /other.py serve ", "/x/relay.py"), false);
});

test("parseWebhookReceiptSnapshot reads count/status/attempt/processed_at", () => {
  const snap = parseWebhookReceiptSnapshot(
    JSON.stringify({ count: 1, status: "processed", attempt_count: 1, processed_at: "2026-07-16T00:00:00Z" }),
  );
  assert.deepEqual(snap, { count: 1, status: "processed", attemptCount: 1, processedAt: "2026-07-16T00:00:00Z" });
});

test("buildDuplicatePostScript re-POSTs the replayed spool bytes, skipping Host, printing the status", () => {
  const script = buildDuplicatePostScript("/home/ubuntu/candidate/callback-relay", "abc123", 8899, "/v1/billing/webhooks/stripe");
  assert.match(script, /python3 -c/);
  assert.match(script, /replayed/);
  assert.match(script, /abc123/);
  assert.match(script, /127\.0\.0\.1:8899\/v1\/billing\/webhooks\/stripe/);
  assert.match(script, /host/i); // the Host-skip guard is present
});

// ── Cell C arc (fake deps: original→positioned→crossed→gated→restored) ──────

function fakeCellCActor(): AuthenticatedActor {
  return {
    role: "owner",
    userId: "user-c",
    organizationId: "org-c",
    enrollmentId: "enr-c",
    api: {} as never,
    session: {} as never,
    gatewayKey: {} as never,
  };
}

/**
 * A scripted Cell-C arc over a fake deps seam. `perRequestCost` is the ledger
 * debit each crossing request incurs (the fake accumulates it and the crossing
 * loop stops once remaining <= 0). Default: original 5.0, positioned 0.0001,
 * each request costs 0.00005 (so it takes 2 requests to cross — exercising the
 * LOOP), total cost 0.0001, restored grants → 5.0 - 0.0001.
 */
function fakeCellCDeps(
  opts: {
    perRequestCost?: number;
    gateSecondStatus?: number;
    gateDenialCode?: typeof PRODUCT_LLM_CREDIT_DENIAL_CODE | null;
    budgetStatus?: string;
    completionTokens?: number;
  } = {},
  overrides: Partial<BillingThresholdCellDeps> = {},
): { deps: BillingThresholdCellDeps; calls: string[] } {
  const calls: string[] = [];
  const perRequestCost = opts.perRequestCost ?? 0.00006;
  let remaining = 5.0;
  let positioned = false;
  // Cost incurred by requests but not yet imported into the ledger. The importer
  // flushes it — so a request's cost lands exactly once regardless of how many
  // times the bounded poll runs the importer.
  let pendingCost = 0;
  const deps: BillingThresholdCellDeps = {
    resolveBillingSubjectId: async () => {
      calls.push("resolveSubject");
      return "sub-c";
    },
    readRemainingCreditUsd: async () => {
      calls.push(`read:${remaining}`);
      return remaining;
    },
    positionThreshold: async () => {
      calls.push("position");
      remaining = 0.0001;
      positioned = true;
      return { billingSubjectId: "sub-c", effectiveRemainder: 0.0001 };
    },
    decryptVirtualKey: async () => {
      calls.push("decrypt");
      return "sk-raw-virtual-key";
    },
    listGatewayModels: async () => ({ allowlist: ["claude-haiku-4-5"], live: ["claude-haiku-4-5"] }),
    gatewayChatCompletion: async ({ rawKey }) => {
      assert.equal(rawKey, "sk-raw-virtual-key");
      // After crossing, the cell issues one MORE request for the gate signal.
      if (positioned && remaining <= 0) {
        calls.push("gateRequest");
        return {
          status: opts.gateSecondStatus ?? 429,
          completionTokens: 0,
          costUsd: null,
          denialCode: opts.gateDenialCode === undefined
            ? PRODUCT_LLM_CREDIT_DENIAL_CODE
            : opts.gateDenialCode,
        };
      }
      calls.push("crossRequest");
      pendingCost = Number((pendingCost + perRequestCost).toFixed(8));
      return {
        status: 200,
        completionTokens: opts.completionTokens ?? 8,
        costUsd: perRequestCost,
        denialCode: null,
      };
    },
    runUsageImport: async () => {
      calls.push("usageImport");
      // The importer is what debits the ledger (writes agent_llm_usage_event): it
      // flushes the pending (un-imported) request cost exactly once.
      const flushed = pendingCost;
      pendingCost = 0;
      remaining = Number((remaining - flushed).toFixed(8));
      return { imported: flushed > 0 ? 1 : 0 };
    },
    runReconcilePasses: async () => {
      calls.push("reconcile");
    },
    readBudgetStatus: async () => opts.budgetStatus ?? "exhausted",
    restoreAdjustment: async () => {
      calls.push("restore");
      // Grants restored to original; imported usage (total cost) persists.
      remaining = Number((5.0 - crossingTotalCost(calls, perRequestCost)).toFixed(8));
    },
    ...overrides,
  };
  return { deps, calls };
}

/** Total cost across the crossing requests the fake issued (excludes the gate request). */
function crossingTotalCost(calls: readonly string[], perRequestCost: number): number {
  return calls.filter((c) => c === "crossRequest").length * perRequestCost;
}

const CELL_C_STATE = { runTag: "r:s", secretKey: "sk_test_x", prep: fakePrep(), aws: { region: "us-east-1", hostedZoneId: "Z1" } };
/** Near-instant import+read poll so offline tests never wait the production window. */
const FAST_POLL = { timeoutMs: 50, intervalMs: 1 };

test("Cell C runs the full arc across a multi-request crossing loop (original→positioned→crossed→gated→restored)", async () => {
  const { deps, calls } = fakeCellCDeps();
  const result = await runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL);
  assert.match(result.observedTransition, /original=5/);
  assert.match(result.observedTransition, /gated:/);
  assert.match(result.observedTransition, /restored=4.9998/);
  // The crossing took MORE than one request (loop exercised), each cost < balance.
  assert.equal(calls.filter((c) => c === "crossRequest").length, 2);
  // The usage IMPORTER ran (the step that debits the ledger) — not just reconcile.
  assert.ok(calls.includes("usageImport"));
  // Arc order: original read BEFORE positioning; restore AFTER the crossing.
  assert.ok(calls.indexOf("read:5") < calls.indexOf("position"));
  assert.ok(calls.indexOf("crossRequest") < calls.indexOf("restore"));
  assert.ok(calls.indexOf("usageImport") < calls.indexOf("restore"));
});

test("Cell C fails when the ledger never crosses within the request-loop budget", async () => {
  const { deps } = fakeCellCDeps({}, {
    // Importer never lands spend → remaining never moves → loop exhausts.
    runUsageImport: async () => ({ imported: 0 }),
  });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL),
    /did not cross to <= 0/,
  );
});

test("Cell C fails loudly when a gateway request returns 2xx but zero completion tokens (silent no-op turn)", async () => {
  const { deps } = fakeCellCDeps({ completionTokens: 0 });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL),
    /zero completion\s*\n?\s*tokens|zero completion tokens/,
  );
});

test("Cell C fails when no product-side gate signal is observed", async () => {
  const { deps } = fakeCellCDeps({ gateSecondStatus: 200, budgetStatus: "ok" });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL),
    /NO classified product-side gate signal/,
  );
});

for (const status of [401, 429, 503]) {
  test(`Cell C rejects generic HTTP ${status} as billing-gate evidence`, async () => {
    const { deps } = fakeCellCDeps({
      gateSecondStatus: status,
      gateDenialCode: null,
      budgetStatus: "ok",
    });
    await assert.rejects(
      () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL),
      /Generic auth\/rate-limit\/server failures are not billing proof/,
    );
  });
}

test("Cell C accepts the exact product billing-denial classification without a budget-status echo", async () => {
  const { deps } = fakeCellCDeps({
    gateSecondStatus: 402,
    gateDenialCode: PRODUCT_LLM_CREDIT_DENIAL_CODE,
    budgetStatus: "ok",
  });
  const result = await runBillingThresholdCellLive(
    fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL,
  );
  assert.match(result.observedTransition, /gated:second_request_rejected/);
});

test("Cell C accepts an exact exhausted budget state even when the HTTP failure is unclassified", async () => {
  const { deps } = fakeCellCDeps({
    gateSecondStatus: 503,
    gateDenialCode: null,
    budgetStatus: "exhausted",
  });
  const result = await runBillingThresholdCellLive(
    fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL,
  );
  assert.match(result.observedTransition, /gated:budget_status_exhausted/);
});

test("Cell C fails when the restored remainder != originalRemaining - totalCost", async () => {
  const { deps } = fakeCellCDeps({}, {
    restoreAdjustment: async () => {
      /* leaves remaining crossed instead of restoring */
    },
  });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL),
    /restored remaining/,
  );
});

test("Cell C never leaks the raw virtual key into the observed transition", async () => {
  const { deps } = fakeCellCDeps();
  const result = await runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps, FAST_POLL);
  assert.ok(!result.observedTransition.includes("sk-raw-virtual-key"));
  assert.ok(!result.externalIds.some((id) => id.includes("sk-raw-virtual-key")));
});

// ── Cell D runtime-readiness failure/recovery (normal product path) ─────

function fakeRuntimeRecoveryOps(
  options: {
    injected?: boolean;
    boundary?: FailureInjectionHandle["boundary"];
    observedStatus?: string;
    observedProviderId?: string | null;
    observedReadyAt?: string | null;
  } = {},
): {
  ops: RuntimeReadinessRecoveryOps;
  calls: string[];
} {
  const calls: string[] = [];
  const providers = ["e2b-first", "e2b-first"];
  const ops: RuntimeReadinessRecoveryOps = {
    prepareActor: async () => { calls.push("prepare"); },
    controlProductAction: async () => { calls.push("control"); return true; },
    ensureSandbox: async () => { calls.push("ensure-row"); return { id: "cloud-1" }; },
    registerSandboxIntent: async (_world, id) => {
      calls.push(`intent:${id}`);
      calls.push(`acquired:logical:${id}`);
      return {
        entryId: "cleanup-1",
        markAcquired: async (providerId) => { calls.push(`acquired:${providerId}`); },
      };
    },
    armRuntimeReadinessFailure: async (_world, params) => {
      calls.push(`arm:${params.operationId}`);
      const handle: FailureInjectionHandle = {
        boundary: options.boundary ?? "runtime_readiness",
        injected: options.injected ?? true,
        disarm: async () => { calls.push("injection-disarm"); },
      };
      return {
        operationId: params.operationId,
        waitForInjection: async () => {
          calls.push("watch-fired");
          return {
            providerSandboxId: "e2b-first",
            handle,
            observation: {
              cloudSandboxId: "cloud-1",
              providerSandboxId: options.observedProviderId === undefined
                ? "e2b-first"
                : options.observedProviderId,
              status: options.observedStatus ?? "creating",
              readyAt: options.observedReadyAt ?? null,
            },
          };
        },
        disarm: async () => { calls.push("disarm"); await handle.disarm(); },
      };
    },
    startProductMaterialization: async () => { calls.push("materialize"); },
    waitForProvider: async () => {
      calls.push("wait-provider");
      const next = providers.shift();
      if (!next) throw new Error("provider sequence exhausted");
      return next;
    },
    recoverSandbox: async () => { calls.push("recover"); },
    waitForMaterializationReady: async () => { calls.push("materialization-ready"); },
    relayManifestReadable: async () => { calls.push("relay-control"); return true; },
  };
  return { ops, calls };
}

test("Cell D arms before materialization, kills AnyHarness before ready, and recovers on the same provider", async () => {
  const { ops, calls } = fakeRuntimeRecoveryOps();
  const result = await runFailureInjectionCellLive(
    fakeWorld(),
    CELL_C_STATE,
    fakeCellCActor(),
    ops,
  );
  assert.match(
    result.observedTransition,
    /anyharness_killed.*normal_path_recovery.*same_provider_ready.*secret_materialization_ready/,
  );
  assert.deepEqual(result.externalIds, ["cloud-1", "e2b-first"]);
  assert.ok(calls.indexOf("intent:cloud-1") < calls.indexOf("materialize"));
  assert.ok(calls.indexOf("acquired:logical:cloud-1") < calls.indexOf("materialize"));
  assert.ok(calls.findIndex((call) => call.startsWith("arm:runtime-readiness:")) < calls.indexOf("materialize"));
  assert.ok(calls.indexOf("watch-fired") > calls.indexOf("materialize"));
  assert.ok(calls.indexOf("watch-fired") < calls.indexOf("acquired:e2b-first"));
  assert.ok(calls.indexOf("injection-disarm") < calls.indexOf("recover"));
  assert.equal(calls.filter((call) => call === "materialize").length, 2, "initial + post-recovery control");
  assert.equal(calls.filter((call) => call === "wait-provider").length, 2, "recovery + control");
  assert.ok(calls.lastIndexOf("materialize") < calls.indexOf("materialization-ready"));
  assert.ok(calls.lastIndexOf("wait-provider") < calls.indexOf("materialization-ready"));
  assert.ok(calls.indexOf("materialization-ready") < calls.lastIndexOf("control"));
});

test("Cell D materialization poll requires the exact ready state", async () => {
  const states = ["pending", "running", "ready"];
  const paths: string[] = [];
  await waitForPersonalMaterializationReady({
    async get(path) {
      paths.push(path);
      return { materialization: { status: states.shift(), lastError: null } };
    },
  }, { sleep: async () => undefined, timeoutMs: 1_000 });
  assert.deepEqual(paths, [
    "/v1/cloud/secrets/personal",
    "/v1/cloud/secrets/personal",
    "/v1/cloud/secrets/personal",
  ]);
});

test("Cell D materialization poll fails immediately on an error state", async () => {
  let sleeps = 0;
  await assert.rejects(
    () => waitForPersonalMaterializationReady({
      async get() {
        return { materialization: { status: "error", lastError: "worker failed" } };
      },
    }, { sleep: async () => { sleeps += 1; }, timeoutMs: 1_000 }),
    /materialization failed: worker failed/,
  );
  assert.equal(sleeps, 0);
});

test("Cell D materialization poll fails closed at its bounded deadline", async () => {
  let now = 0;
  await assert.rejects(
    () => waitForPersonalMaterializationReady({
      async get() { return { materialization: { status: "pending", lastError: null } }; },
    }, {
      sleep: async () => { now = 101; },
      now: () => now,
      timeoutMs: 100,
      pollMs: 1,
    }),
    /did not reach ready within the bounded wait/,
  );
});

test("Cell D in-memory cleanup preserves a logical-only intent with no provider binding", async () => {
  const world = fakeWorld();
  let release!: () => Promise<void>;
  world.registerCleanupIntent = async (_kind, providerId, handler) => {
    assert.deepEqual(decodeE2bSandboxCleanupIdentity(providerId), {
      cloudSandboxId: "cloud-1", providerSandboxId: null,
    });
    release = handler;
    return { entryId: "sandbox-1", markAcquired: async () => undefined };
  };
  const cleanup = await registerFailureInjectionSandboxIntent(world, "cloud-1", {
    find: async () => ({ providerSandboxId: null, state: null, matches: [], count: 0 }),
    kill: async () => { throw new Error("logical-only custody must not kill an unrelated sandbox"); },
  });
  assert.equal(cleanup.entryId, "sandbox-1");
  await assert.rejects(release, /no authoritative provider binding.*preserving cleanup custody/);
});

test("Cell D in-memory cleanup treats pre-return registration failure as no-provider", async () => {
  const world = fakeWorld();
  world.registerCleanupIntent = async (_kind, _providerId, handler) => {
    await handler();
    throw new Error("simulated registration persistence failure");
  };
  await assert.rejects(
    () => registerFailureInjectionSandboxIntent(world, "cloud-1", {
      find: async () => ({ providerSandboxId: null, state: null, matches: [], count: 0 }),
      kill: async () => { throw new Error("pre-return cleanup must not kill a provider"); },
    }),
    /simulated registration persistence failure/,
  );
});

test("Cell D in-memory cleanup retains the known provider across fresh-replay deletion", async () => {
  const world = fakeWorld();
  let release!: () => Promise<void>;
  const promoted: string[] = [];
  world.registerCleanupIntent = async (_kind, _providerId, handler) => {
    release = handler;
    return {
      entryId: "sandbox-1",
      markAcquired: async (providerId) => { promoted.push(providerId); },
    };
  };
  const killed: string[] = [];
  const cleanup = await registerFailureInjectionSandboxIntent(world, "cloud-1", {
    find: async () => ({ providerSandboxId: null, state: null, matches: [], count: 0 }),
    kill: async (providerId) => { killed.push(providerId); return { killed: true }; },
  });
  await cleanup.markAcquired("e2b-1");
  await release();
  assert.deepEqual(promoted.map(decodeE2bSandboxCleanupIdentity), [
    { cloudSandboxId: "cloud-1", providerSandboxId: "e2b-1" },
    { cloudSandboxId: "cloud-1", providerSandboxId: "e2b-1" },
  ]);
  assert.deepEqual(killed, ["e2b-1"]);
});

test("Cell D in-memory cleanup persists every discovered provider before deleting any", async () => {
  const world = fakeWorld();
  let release!: () => Promise<void>;
  const promoted: string[] = [];
  world.registerCleanupIntent = async (_kind, _providerId, handler) => {
    release = handler;
    return {
      entryId: "sandbox-1",
      markAcquired: async (providerId) => { promoted.push(providerId); },
    };
  };
  let inventory = 0;
  const killed: string[] = [];
  await registerFailureInjectionSandboxIntent(world, "cloud-1", {
    find: async () => {
      inventory += 1;
      return inventory === 1
        ? {
            providerSandboxId: "e2b-1",
            state: "running",
            matches: [
              { providerSandboxId: "e2b-1", state: "running", templateId: "tpl", startedAt: null },
              { providerSandboxId: "e2b-2", state: "paused", templateId: "tpl", startedAt: null },
            ],
            count: 2,
          }
        : { providerSandboxId: null, state: null, matches: [], count: 0 };
    },
    kill: async (providerId) => { killed.push(providerId); return { killed: true }; },
  });
  await release();
  assert.deepEqual(decodeE2bSandboxCleanupIdentity(promoted[0] ?? ""), {
    cloudSandboxId: "cloud-1",
    providerSandboxId: "e2b-1",
    providerSandboxIds: ["e2b-1", "e2b-2"],
  });
  assert.deepEqual(killed.sort(), ["e2b-1", "e2b-2"]);
});

test("Cell D watcher starts while armed and injects only after the product creates a non-ready runtime", async () => {
  const calls: string[] = [];
  let poll = 0;
  let productStarted = false;
  let releaseProduct!: () => void;
  const productGate = new Promise<void>((resolve) => { releaseProduct = resolve; });
  const armed = await armRuntimeReadinessFailureWatcher(fakeWorld(), {
    cloudSandboxId: "cloud-1",
    operationId: "runtime-readiness:smoke-run-1:smoke-0:cloud-1",
  }, {
    find: async (logicalId) => {
      calls.push(`find:${logicalId}:${poll}`);
      poll += 1;
      return poll === 1 || !productStarted ? { providerSandboxId: null, matches: [] } : {
        providerSandboxId: "e2b-first", matches: [{ providerSandboxId: "e2b-first" }],
      };
    },
    observeProduct: async () => ({
      cloudSandboxId: "cloud-1", providerSandboxId: "e2b-first", status: "creating", readyAt: null,
    }),
    processPresent: async (providerId) => { calls.push(`process:${providerId}`); return true; },
    inject: async (_world, providerId) => {
      calls.push(`inject:${providerId}`);
      return {
        boundary: "runtime_readiness",
        injected: true,
        disarm: async () => { calls.push("injection-disarm"); },
      };
    },
    sleep: async () => { if (!productStarted) await productGate; },
    timeoutMs: 1_000,
    postKillQuietChecks: 2,
  });
  await Promise.resolve();
  calls.push("product-action");
  productStarted = true;
  releaseProduct();
  const fired = await armed.waitForInjection();
  await armed.disarm();
  assert.equal(fired.providerSandboxId, "e2b-first");
  assert.equal(calls[0], "find:cloud-1:0");
  assert.ok(calls.indexOf("find:cloud-1:1") < calls.indexOf("product-action"), "watcher starts while armed");
  assert.ok(calls.indexOf("product-action") < calls.indexOf("inject:e2b-first"));
  assert.ok(calls.includes("injection-disarm"));
});

test("Cell D watcher rejects stale providers and ambiguous first attempts without injecting", async () => {
  let injected = 0;
  await assert.rejects(() => armRuntimeReadinessFailureWatcher(fakeWorld(), {
    cloudSandboxId: "cloud-1",
    operationId: "runtime-readiness:smoke-run-1:smoke-0:cloud-1",
  }, {
    find: async () => ({ providerSandboxId: "stale", matches: [{ providerSandboxId: "stale" }] }),
    inject: async () => { injected += 1; throw new Error("must not inject"); },
  }), /pre-existing/);
  assert.equal(injected, 0);

  let poll = 0;
  const armed = await armRuntimeReadinessFailureWatcher(fakeWorld(), {
    cloudSandboxId: "cloud-1",
    operationId: "runtime-readiness:smoke-run-1:smoke-0:cloud-1",
  }, {
    find: async () => (++poll === 1 ? { providerSandboxId: null, matches: [] } : {
      providerSandboxId: null,
      matches: [{ providerSandboxId: "first" }, { providerSandboxId: "second" }],
    }),
    inject: async () => { injected += 1; throw new Error("must not inject"); },
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });
  await assert.rejects(armed.waitForInjection(), /ambiguous/);
  await armed.disarm();
  assert.equal(injected, 0);
});

test("Cell D watcher refuses unrelated product states before process injection", async () => {
  let poll = 0;
  let injected = 0;
  const armed = await armRuntimeReadinessFailureWatcher(fakeWorld(), {
    cloudSandboxId: "cloud-1",
    operationId: "runtime-readiness:smoke-run-1:smoke-0:cloud-1",
  }, {
    find: async () => (++poll === 1 ? { providerSandboxId: null, matches: [] } : {
      providerSandboxId: "e2b-first", matches: [{ providerSandboxId: "e2b-first" }],
    }),
    observeProduct: async () => ({
      cloudSandboxId: "cloud-1", providerSandboxId: "e2b-first", status: "paused",
      readyAt: null,
    }),
    processPresent: async () => true,
    inject: async () => { injected += 1; throw new Error("must not inject"); },
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });
  await assert.rejects(armed.waitForInjection(), /expected exact status=creating.*observed paused/);
  await armed.disarm();
  assert.equal(injected, 0);
});

test("E2B cleanup identity retains the logical sandbox across provider replacement", () => {
  const initial = encodeE2bSandboxCleanupIdentity({ cloudSandboxId: "cloud-1", providerSandboxId: null });
  const replacement = encodeE2bSandboxCleanupIdentity({
    cloudSandboxId: "cloud-1",
    providerSandboxId: "e2b-new",
  });
  assert.deepEqual(decodeE2bSandboxCleanupIdentity(initial), {
    cloudSandboxId: "cloud-1",
    providerSandboxId: null,
  });
  assert.deepEqual(decodeE2bSandboxCleanupIdentity(replacement), {
    cloudSandboxId: "cloud-1",
    providerSandboxId: "e2b-new",
  });
  const duplicates = encodeE2bSandboxCleanupIdentity({
    cloudSandboxId: "cloud-1",
    providerSandboxId: "e2b-a",
    providerSandboxIds: ["e2b-b", "e2b-a"],
  });
  assert.deepEqual(decodeE2bSandboxCleanupIdentity(duplicates), {
    cloudSandboxId: "cloud-1",
    providerSandboxId: "e2b-a",
    providerSandboxIds: ["e2b-a", "e2b-b"],
  });
  assert.equal(decodeE2bSandboxCleanupIdentity("e2b-new"), null);
});

test("Cell D fails closed when the AnyHarness kill was not positively observed", async () => {
  const { ops } = fakeRuntimeRecoveryOps({ injected: false });
  await assert.rejects(
    () => runFailureInjectionCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), ops),
    /did not prove exact AnyHarness present→absent/,
  );
});

test("Cell D rejects an unrelated non-ready product state", async () => {
  const { ops } = fakeRuntimeRecoveryOps({ observedStatus: "paused" });
  await assert.rejects(
    () => runFailureInjectionCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), ops),
    /did not prove exact AnyHarness present→absent before product readiness/,
  );
});

test("Cell D rejects an injected failure from a different boundary", async () => {
  const { ops } = fakeRuntimeRecoveryOps({ boundary: "provider_create" });
  await assert.rejects(
    () => runFailureInjectionCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), ops),
    /did not prove exact AnyHarness present→absent/,
  );
});

test("Cell E requires the exact representative A-D replay kinds and domains", () => {
  const complete = {
    kind: "managed_cloud_fixture_cleanup_replay" as const,
    schema_version: 1 as const,
    status: "reconciled" as const,
    run_id: "r",
    shard_id: "s",
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
    ] as const,
    reconciled_fixture_kinds: [
      "billing_fixture_adjustment",
      "callback_relay_process",
      "callback_relay_spool",
      "e2b_sandbox",
      "stripe_customer",
      "stripe_product_price",
      "stripe_test_clock",
    ] as const,
    reconciled_domains: ["box", "e2b", "stripe"] as const,
    untouched_non_fixture_entries: 0,
    ingress_instance_id: "i-1",
  };
  assert.doesNotThrow(() => assertRepresentativeFixtureReplay(complete as never));
  assert.throws(
    () => assertRepresentativeFixtureReplay({
      ...complete,
      reconciled_fixture_kinds: complete.reconciled_fixture_kinds.filter(
        (kind) => kind !== "billing_fixture_adjustment",
      ),
    } as never),
    /missing kinds=billing_fixture_adjustment/,
  );
});

// ── Scoped world runDir (the CLOUD-PROVISION-1 shared-runDir collision fix) ──

/** Minimal construction inputs for the driver's prepareStripe/buildWorld paths. */
function fakeConstructionInputs(runDir: string): CloudProvision1ConstructionInputs {
  return {
    map: { schema_version: 1, kind: "proliferate.candidate-build", source_sha: "a".repeat(40), artifacts: [] },
    litellm: { adminBaseUrl: "https://admin", publicBaseUrl: "https://public", masterKey: "sk-master" },
    run: {
      run_id: "smoke-run-1",
      shard_id: "smoke-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir,
    aws: {
      region: "us-east-1",
      hostedZoneId: "Z1",
      zoneName: "qualification.proliferate.com",
      instanceType: "t3.small",
      imageRef: "/aws/service/x",
    },
    e2bTeamId: "team-test",
    e2bApiKey: "e2b-key",
    tls: TEST_QUALIFICATION_TLS,
    github: { appId: "1", clientId: "Iv1.x", installationId: "2", privateKey: "PEM", clientSecret: "cs" },
  };
}

/** A recording StripeHttp returning a webhook endpoint on create. */
function fakeStripeHttpForPrepare(reqs: Array<{ method: string; path: string }>): StripeHttp {
  return {
    async request(_key, req) {
      reqs.push({ method: req.method, path: req.path });
      if (req.path === "/webhook_endpoints" && req.method === "POST") {
        return { id: "we_scoped", secret: "whsec_scoped" };
      }
      return {};
    },
  };
}

test("buildWorld constructs the world with runDir scoped to <parentRunDir>/fixture-smoke", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "smoke-scope-"));
  try {
    const reqs: Array<{ method: string; path: string }> = [];
    let capturedRunDir = "";
    const driver = createFixtureSmokeDriver({
      http: fakeStripeHttpForPrepare(reqs),
      constructWorld: async (options: ConstructManagedCloudWorldOptions) => {
        capturedRunDir = options.runDir;
        // The world is never used by this assertion; return a minimal stub.
        return { paths: { runDir: options.runDir } } as never;
      },
    });
    const inputs = fakeConstructionInputs(parent);
    const prep = await driver.prepareStripe(inputs, "sk_test_scoped");
    await driver.buildWorld(inputs, prep);
    const expected = fixtureSmokeScopedRunDir(parent);
    assert.equal(prep.scopedRunDir, expected);
    assert.equal(capturedRunDir, expected, "the world's runDir MUST be the scoped subdir, not the shared parent");
    assert.ok(capturedRunDir.endsWith(path.join(FIXTURE_SMOKE_WORLD_SUBDIR)));
    assert.notEqual(capturedRunDir, parent);

    // #1318: the github-app env file MUST carry GITHUB_APP_WEBHOOK_SECRET (the
    // six-field github_app_configured gate #1257 added), and its value never leaks.
    const githubEnv = await readFile(path.join(expected, "secrets", "github-app.env"), "utf8");
    const match = /^GITHUB_APP_WEBHOOK_SECRET=([0-9a-f]{64})$/m.exec(githubEnv);
    assert.ok(match, "github-app.env must contain a 64-hex GITHUB_APP_WEBHOOK_SECRET line");
    assert.ok(githubEnv.includes("GITHUB_APP_CLIENT_SECRET="), "the existing client secret line is preserved");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("prepareStripe writes env under the scoped world and a durable webhook journal outside world cleanup", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "smoke-scope-"));
  try {
    // The builder wrote the sidecar in the PARENT run dir; also drop a marker
    // file so we can prove the scoped-dir cleanup would never touch the parent.
    const builtSubdomain = "mcq-built-value.qualification.proliferate.com";
    await writeFile(path.join(parent, "cloud-world-subdomain.json"), JSON.stringify({ subdomain: builtSubdomain }));
    await mkdir(path.join(parent, "artifacts"), { recursive: true });
    await writeFile(path.join(parent, "artifacts", "server.tar"), "BUILDER-ARTIFACT");

    const reqs: Array<{ method: string; path: string }> = [];
    const driver = createFixtureSmokeDriver({ http: fakeStripeHttpForPrepare(reqs) });
    const prep = await driver.prepareStripe(fakeConstructionInputs(parent), "sk_test_scoped");

    const scoped = fixtureSmokeScopedRunDir(parent);
    // The subdomain came from the PARENT sidecar (build value, NOT the formula).
    assert.equal(prep.subdomain, builtSubdomain);
    // The sidecar was COPIED into the scoped dir so the world constructor reads it.
    assert.equal(
      JSON.parse(await readFile(path.join(scoped, "cloud-world-subdomain.json"), "utf8")).subdomain,
      builtSubdomain,
    );
    // World env files are scoped. The pre-world journal deliberately lives in
    // the parent cleanup-custody directory so a failed world cleanup cannot
    // delete the only recovery identity.
    assert.ok(prep.secretsEnvFilePath.startsWith(scoped));
    assert.ok(prep.webhookSecretEnvFilePath.startsWith(scoped));
    assert.ok(!prep.webhookIntentFilePath.startsWith(scoped));
    assert.ok(prep.webhookIntentFilePath.startsWith(path.join(parent, "cleanup-custody")));
    const intent = JSON.parse(await readFile(prep.webhookIntentFilePath, "utf8"));
    assert.equal(intent.endpointId, "we_scoped");
    assert.equal((await stat(path.dirname(prep.webhookIntentFilePath))).mode & 0o777, 0o700);
    assert.equal((await stat(prep.webhookIntentFilePath)).mode & 0o777, 0o600);
    // The builder's parent artifacts are UNTOUCHED (the scoped dir is disjoint).
    assert.equal(await readFile(path.join(parent, "artifacts", "server.tar"), "utf8"), "BUILDER-ARTIFACT");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a fresh fixture executor replays the durable webhook journal before creating a replacement", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "smoke-restart-"));
  const endpointUrl = webhookEndpointUrl("restart.qualification.proliferate.com");
  const calls: string[] = [];
  let nextId = 1;
  let endpoints: Array<{ id: string; url: string; metadata: Record<string, string> }> = [];
  const http: StripeHttp = {
    async request(_key, req) {
      calls.push(`${req.method} ${req.path}`);
      if (req.method === "POST" && req.path === "/webhook_endpoints") {
        const endpoint = {
          id: `we_restart_${nextId++}`,
          url: req.form?.url ?? "",
          metadata: { proliferate_qualification_run: req.form?.["metadata[proliferate_qualification_run]"] ?? "" },
        };
        endpoints.push(endpoint);
        return { id: endpoint.id, secret: `whsec_${endpoint.id}` };
      }
      if (req.method === "GET" && req.path.startsWith("/webhook_endpoints?")) {
        return { data: endpoints, has_more: false };
      }
      if (req.method === "DELETE" && req.path.startsWith("/webhook_endpoints/")) {
        const id = req.path.split("/").at(-1);
        endpoints = endpoints.filter((endpoint) => endpoint.id !== id);
        return { id, deleted: true };
      }
      return {};
    },
  };
  try {
    await writeFile(
      path.join(parent, "cloud-world-subdomain.json"),
      JSON.stringify({ subdomain: "restart.qualification.proliferate.com" }),
    );
    const firstDriver = createFixtureSmokeDriver({ http });
    const first = await firstDriver.prepareStripe(fakeConstructionInputs(parent), "sk_test_restart");
    assert.equal(first.webhookEndpointId, "we_restart_1");

    // Simulate the first Node process dying before it can adopt the endpoint
    // into the world's cleanup ledger. A new driver has no closure state.
    const secondDriver = createFixtureSmokeDriver({ http });
    const second = await secondDriver.prepareStripe(fakeConstructionInputs(parent), "sk_test_restart");
    assert.equal(second.webhookEndpointId, "we_restart_2");
    assert.deepEqual(endpoints.map((entry) => entry.id), ["we_restart_2"]);
    assert.ok(
      calls.indexOf("DELETE /webhook_endpoints/we_restart_1") < calls.lastIndexOf("POST /webhook_endpoints"),
      "the prior accepted endpoint must be deleted before the replacement create",
    );
    assert.equal(endpointUrl, webhookEndpointUrl(second.subdomain));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("webhook custody replay removes every duplicate exact run-owned endpoint before releasing custody", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "smoke-duplicate-webhook-"));
  const custodyDir = path.join(parent, WEBHOOK_CUSTODY_DIRNAME);
  const intentPath = path.join(custodyDir, WEBHOOK_INTENT_FILENAME);
  const runTag = "smoke-run-1:smoke-0";
  const url = webhookEndpointUrl("duplicate.qualification.proliferate.com");
  let endpoints = ["we_duplicate_1", "we_duplicate_2"];
  const http: StripeHttp = {
    async request(_key, req) {
      if (req.method === "GET" && req.path.startsWith("/webhook_endpoints?")) {
        return {
          data: endpoints.map((id) => ({
            id,
            url,
            metadata: { proliferate_qualification_run: runTag },
          })),
          has_more: false,
        };
      }
      if (req.method === "DELETE" && req.path.startsWith("/webhook_endpoints/")) {
        const id = req.path.split("/").at(-1);
        endpoints = endpoints.filter((candidate) => candidate !== id);
        return { id, deleted: true };
      }
      return {};
    },
  };
  try {
    await mkdir(custodyDir, { recursive: true, mode: 0o700 });
    await writeFile(
      intentPath,
      JSON.stringify({
        intentRef: encodeWebhookEndpointIntentRef("duplicate.qualification.proliferate.com"),
        endpointId: "we_duplicate_1",
        runTag,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await reconcileWebhookIntentFile(intentPath, runTag, url, "sk_test_duplicate", http);
    assert.deepEqual(endpoints, []);
    await assert.rejects(() => readFile(intentPath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a construction failure after prepareStripe deletes the just-created webhook endpoint inline", async () => {
  let deleteCalledWith: string | null = null;
  const driver = fakeDriver({
    prepareStripe: async () => fakePrep(),
    buildWorld: async () => {
      throw new Error("boom: ec2 quota exceeded");
    },
    deleteWebhookEndpoint: async (prep) => {
      deleteCalledWith = prep.webhookEndpointId;
    },
  });
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /world construction failed/);
  assert.equal(deleteCalledWith, "we_123", "the pre-created webhook endpoint must be deleted inline on construction failure");
});
