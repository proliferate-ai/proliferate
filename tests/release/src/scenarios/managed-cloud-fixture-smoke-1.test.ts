import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIXTURE_SMOKE_CELL_NAMES,
  MANAGED_CLOUD_FIXTURE_SMOKE_1_ID,
  assertDuplicateDeliveryByteIdentity,
  allCleanupBooleansTrue,
  buildDuplicatePostScript,
  ensureOwnerActor,
  managedCloudFixtureSmoke1,
  parseProcStatStarttime,
  parseRelayPidfileJson,
  parseStatModes,
  parseWebhookReceiptSnapshot,
  procCmdlineContainsScript,
  resolveSmokeSecretKey,
  runBillingThresholdCellLive,
  runFixtureSmokeCells,
  type BillingThresholdCellDeps,
  type FixtureSmokeCellResult,
  type FixtureSmokeDriver,
  type StripePreparation,
} from "./managed-cloud-fixture-smoke-1.js";
import { isMatrixScenario, type ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { CapturedDelivery } from "../fixtures/callback-relay.js";
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
    secretsEnvFilePath: "/tmp/smoke-run-1/secrets/stripe.env",
    webhookSecretEnvFilePath: "/tmp/smoke-run-1/secrets/stripe-webhook.env",
    subdomain: "mcq-smoke-run-1-smoke-0.qualification.proliferate.com",
    webhookEndpointId: "we_123",
    webhookIntentRef: "intent:webhook_endpoint:url=https://x/v1/billing/webhooks/stripe",
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
  opts: { perRequestCost?: number; gateSecondStatus?: number; budgetStatus?: string } = {},
  overrides: Partial<BillingThresholdCellDeps> = {},
): { deps: BillingThresholdCellDeps; calls: string[] } {
  const calls: string[] = [];
  const perRequestCost = opts.perRequestCost ?? 0.00005;
  let remaining = 5.0;
  let positioned = false;
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
        return { status: opts.gateSecondStatus ?? 429, costUsd: null };
      }
      calls.push("crossRequest");
      return { status: 200, costUsd: perRequestCost };
    },
    runReconcilePasses: async () => {
      calls.push("reconcile");
      // Each reconcile after a crossing request debits the request's cost.
      remaining = Number((remaining - perRequestCost).toFixed(8));
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

test("Cell C runs the full arc across a multi-request crossing loop (original→positioned→crossed→gated→restored)", async () => {
  const { deps, calls } = fakeCellCDeps();
  const result = await runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps);
  assert.match(result.observedTransition, /original=5/);
  assert.match(result.observedTransition, /gated:/);
  assert.match(result.observedTransition, /restored=4.9999/);
  // The crossing took MORE than one request (loop exercised), each cost < balance.
  assert.equal(calls.filter((c) => c === "crossRequest").length, 2);
  // Arc order: original read BEFORE positioning; restore AFTER the crossing.
  assert.ok(calls.indexOf("read:5") < calls.indexOf("position"));
  assert.ok(calls.indexOf("crossRequest") < calls.indexOf("restore"));
});

test("Cell C fails when the ledger never crosses within the request-loop budget", async () => {
  const { deps } = fakeCellCDeps({}, {
    runReconcilePasses: async () => {
      /* never debits → remaining stays positive → loop exhausts */
    },
  });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps),
    /did not cross to <= 0/,
  );
});

test("Cell C fails when no product-side gate signal is observed", async () => {
  const { deps } = fakeCellCDeps({ gateSecondStatus: 200, budgetStatus: "ok" });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps),
    /NO product-side gate signal/,
  );
});

test("Cell C fails when the restored remainder != originalRemaining - totalCost", async () => {
  const { deps } = fakeCellCDeps({}, {
    restoreAdjustment: async () => {
      /* leaves remaining crossed instead of restoring */
    },
  });
  await assert.rejects(
    () => runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps),
    /restored remaining/,
  );
});

test("Cell C never leaks the raw virtual key into the observed transition", async () => {
  const { deps } = fakeCellCDeps();
  const result = await runBillingThresholdCellLive(fakeWorld(), CELL_C_STATE, fakeCellCActor(), deps);
  assert.ok(!result.observedTransition.includes("sk-raw-virtual-key"));
  assert.ok(!result.externalIds.some((id) => id.includes("sk-raw-virtual-key")));
});
