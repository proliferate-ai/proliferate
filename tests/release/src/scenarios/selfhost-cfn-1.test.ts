import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  SELFHOST_CFN_1_ID,
  SH_CFN_WRAPPER,
  attachCfnCleanup,
  cleanupIsClean,
  constructSelfHostCfnWorld,
  registerSelfHostCfnCancellationFinalizer,
  rethrowCfnConstructionFailureAfterCleanup,
  resolveCfnWorldInputs,
  runCfnWrapperCell,
  runSelfHostCfnCells,
  type ReadySelfHostCfnWorld,
  type SelfHostCfnDriver,
  type SelfHostCfnWrapperEvidenceNoCleanup,
} from "./selfhost-cfn-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus, type PlannedCellV1 } from "../runner/result.js";
import {
  expectedVerdict,
  validateReportV4,
  type TestRunReportV3,
  type TestRunReportV4,
} from "../evidence/schema.js";
import type { SelfHostCfnWorldCleanupEvidence } from "../worlds/selfhost/cfn.js";
import {
  CFN_CLEANUP_RECEIPT_FILENAME,
  SelfHostCfnCleanupStack,
  buildCfnStackTags,
  createCfnStackAndWait,
  deleteCfnStackAndWait,
  type CfnAwsExec,
} from "../worlds/selfhost/cfn.js";
import {
  clearCancellationFinalizersForTest,
  finalizeRegisteredForSignal,
} from "../cli/cancellation-finalizer.js";
import {
  CLEANUP_LEDGER_FILENAME,
  openCleanupLedger,
} from "../worlds/local-workspace/cleanup-ledger.js";

afterEach(() => clearCancellationFinalizersForTest());

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [
      { artifact_id: "server/linux-amd64", version: "1", sha256: "s".repeat(64), locator: { kind: "local_file", path: "/tmp/server.tar" } },
      { artifact_id: "selfhost-bundle/linux-amd64", version: "1", sha256: "b".repeat(64), locator: { kind: "local_file", path: "/tmp/bundle.tar.gz" } },
      { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "1", sha256: "a".repeat(64), locator: { kind: "local_file", path: "/tmp/anyharness" } },
      { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), locator: { kind: "local_file", path: "/tmp/renderer.tar" } },
    ],
  };
}

function fakeEnv(vars: Record<string, string | undefined> = {}): EnvResolution {
  const defaults: Record<string, string | undefined> = {
    RELEASE_E2E_SELFHOST_REGION: "us-east-1",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123",
    RELEASE_E2E_SELFHOST_CFN_BUCKET: "qual-bundle-bucket",
    RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO: "ghcr.io/proliferate-ai/proliferate-server-qualification",
    ...vars,
  };
  return {
    all: [],
    missing: [],
    present: (name) => defaults[name] !== undefined,
    get: (name) => defaults[name],
    require: (name) => {
      const value = defaults[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "local",
    runtimeLane: "selfhost",
    desktop: "web",
    agents: ["claude"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "local-run-1",
      shard_id: "local-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/run-1",
    ports: { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 },
    ...overrides,
  };
}

const WRAPPER_CELL_ID = `${SELFHOST_CFN_1_ID}/selfhost/cell=${SH_CFN_WRAPPER},harness=claude`;
const SITE = "sh-x.qualification.proliferate.com";
const PUSHED_DIGEST = `sha256:${"c".repeat(64)}`;

function wrapperCell(): PlannedCellV1 {
  return {
    cell_id: WRAPPER_CELL_ID,
    scenario_id: SELFHOST_CFN_1_ID,
    registry_flow_ref: "specs/developing/testing/tier-3-scenario-contract.md#sh-cfn-wrapper",
    runtime_lane: "selfhost",
    dimensions: { cell: SH_CFN_WRAPPER, harness: "claude" },
    required_env: [],
  };
}

function cleanCleanup(): SelfHostCfnWorldCleanupEvidence {
  return {
    ledgerIdHash: "a".repeat(64),
    registered: 5,
    reconciled: 5,
    failed: 0,
    stackDeleted: true,
    s3ObjectsDeleted: true,
    ghcrVersionDeleted: true,
    route53RecordDeleted: true,
    localPathsRemoved: true,
  };
}

function dirtyCleanup(): SelfHostCfnWorldCleanupEvidence {
  return { ...cleanCleanup(), failed: 1, stackDeleted: false, route53RecordDeleted: false };
}

interface FakeWorldOptions {
  metaVersion?: string;
  cloudWorkspaces?: boolean;
  agentGateway?: boolean;
  healthy?: boolean;
  observedDigest?: string;
  ssmThrows?: boolean;
  bundleDigestBound?: boolean;
  runtimeDigestBound?: boolean;
  templateValidated?: boolean;
  outputsSiteAddress?: string;
  cleanup?: SelfHostCfnWorldCleanupEvidence;
}

function fakeWorld(options: FakeWorldOptions = {}): { world: ReadySelfHostCfnWorld; closeCalls: () => number } {
  let closeCalls = 0;
  const world: ReadySelfHostCfnWorld = {
    run: { run_id: "local-run-1", shard_id: "local-0", attempt: 1, source_sha: "a".repeat(40), origin: { kind: "local", github_run_id: null, github_job: null } },
    artifactIds: ["server/linux-amd64", "selfhost-bundle/linux-amd64", "anyharness/x86_64-unknown-linux-gnu", "desktop-renderer/browser"],
    serverVersion: "1.2.3",
    siteAddress: SITE,
    apiOrigin: SITE,
    stackName: "proliferate-sh-cfn-local-run-1-local-0-abcd1234",
    templateSha256: "t".repeat(64),
    templateValidated: options.templateValidated ?? true,
    bundleDigestBound: options.bundleDigestBound ?? true,
    runtimeDigestBound: options.runtimeDigestBound ?? true,
    pushedImageDigest: PUSHED_DIGEST,
    releaseVersionTag: "local-run-1-local-0",
    outputs: {
      baseUrl: `https://${options.outputsSiteAddress ?? SITE}`,
      siteAddress: options.outputsSiteAddress ?? SITE,
      instanceId: "i-0abc123",
    },
    inspectRunningImageDigest: async () => {
      if (options.ssmThrows) {
        throw new Error("SSM unusable");
      }
      return options.observedDigest ?? PUSHED_DIGEST;
    },
    waitHealthy: async () => {
      if (options.healthy === false) {
        throw new Error("HTTPS /health not green");
      }
    },
    fetchMeta: async () => ({
      serverVersion: options.metaVersion ?? "1.2.3",
      cloudWorkspaces: options.cloudWorkspaces ?? false,
      agentGateway: options.agentGateway ?? false,
    }),
    close: async () => {
      closeCalls += 1;
      return options.cleanup ?? cleanCleanup();
    },
  };
  return { world, closeCalls: () => closeCalls };
}

function greenDriver(overrides: Partial<SelfHostCfnDriver> = {}): { driver: SelfHostCfnDriver; buildCalls: () => number } {
  let buildCalls = 0;
  const built = fakeWorld();
  const driver: SelfHostCfnDriver = {
    buildWorld: async () => {
      buildCalls += 1;
      return built.world;
    },
    runCfnWrapper: (world) => runCfnWrapperCell(world),
    closeWorld: (world) => world.close(),
    ...overrides,
  };
  return { driver, buildCalls: () => buildCalls };
}

// ── Orchestration: green path ─────────────────────────────────────────────────

test("runSelfHostCfnCells: green cell folds the CFN cleanup block into the wrapper evidence", async () => {
  const { driver } = greenDriver();
  const outcomes = await runSelfHostCfnCells(fakeCtx(), [wrapperCell()], driver);
  assert.equal(outcomes.length, 1);
  const [outcome] = outcomes;
  assert.equal(outcome.status, "green", JSON.stringify(outcome));
  const evidence = outcome.evidence as { kind: string; cleanup: { registered: number; route53_record_deleted: boolean } };
  assert.equal(evidence.kind, "selfhost_cfn_wrapper");
  assert.equal(evidence.cleanup.registered, 5);
  assert.equal(evidence.cleanup.route53_record_deleted, true);
});

test("runSelfHostCfnCells: the emitted green evidence passes the real report validator", async () => {
  const { driver } = greenDriver();
  const outcomes = await runSelfHostCfnCells(fakeCtx(), [wrapperCell()], driver);
  const evidence = outcomes[0].evidence;
  assert.ok(evidence);
  validateReportV4(reportWithEvidence(evidence, "green"));
});

// ── runCfnWrapperCell: assertion coverage ─────────────────────────────────────

test("runCfnWrapperCell: green when every shallow check passes", async () => {
  const { world } = fakeWorld();
  const result = await runCfnWrapperCell(world);
  assert.equal(result.status, "green");
  assert.ok(result.evidence);
  assert.equal(result.evidence?.image_digest_bound, true);
  assert.equal(result.evidence?.runtime_digest_bound, true);
});

test("runCfnWrapperCell: an unreadable SSM image digest FAILS CLOSED (no version-only fallback, PR7-CONTROL-006)", async () => {
  // Previously the SSM-unusable path stayed green on /meta version equality
  // alone; CONTROL-006 requires the image-to-pushed-candidate binding be proven,
  // so an unreadable digest is now a red, not a pass.
  const { world } = fakeWorld({ ssmThrows: true });
  const result = await runCfnWrapperCell(world);
  assert.equal(result.status, "failed");
  assert.equal(result.evidence, undefined);
  assert.match(result.reason?.message ?? "", /digest could not be read|failing closed/);
});

test("runCfnWrapperCell: green records the pushed digest, release tag, and template sha (PR7-CONTROL-006)", async () => {
  const { world } = fakeWorld();
  const result = await runCfnWrapperCell(world);
  assert.equal(result.status, "green", JSON.stringify(result));
  const ev = result.evidence as { image_repo_digest: string; release_version_tag: string; template_sha256: string };
  assert.equal(ev.image_repo_digest, PUSHED_DIGEST);
  assert.equal(ev.release_version_tag, "local-run-1-local-0");
  assert.equal(ev.template_sha256, "t".repeat(64));
});

test("runCfnWrapperCell: a /meta version mismatch fails closed with no evidence", async () => {
  const { world } = fakeWorld({ metaVersion: "9.9.9" });
  const result = await runCfnWrapperCell(world);
  assert.equal(result.status, "failed");
  assert.equal(result.evidence, undefined);
  assert.match(result.reason?.message ?? "", /serverVersion/);
});

test("runCfnWrapperCell: a digest mismatch (SSM available) fails closed", async () => {
  const { world } = fakeWorld({ observedDigest: `sha256:${"e".repeat(64)}` });
  const result = await runCfnWrapperCell(world);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /image digest/);
});

test("runCfnWrapperCell: unhealthy TLS, bad outputs, unbound bundle, and hosted-web each fail closed", async () => {
  assert.equal((await runCfnWrapperCell(fakeWorld({ healthy: false }).world)).status, "failed");
  assert.equal((await runCfnWrapperCell(fakeWorld({ outputsSiteAddress: "other.example.com" }).world)).status, "failed");
  assert.equal((await runCfnWrapperCell(fakeWorld({ bundleDigestBound: false }).world)).status, "failed");
  assert.equal((await runCfnWrapperCell(fakeWorld({ runtimeDigestBound: false }).world)).status, "failed");
  assert.equal((await runCfnWrapperCell(fakeWorld({ templateValidated: false }).world)).status, "failed");
  assert.equal((await runCfnWrapperCell(fakeWorld({ cloudWorkspaces: true }).world)).status, "failed");
  assert.equal((await runCfnWrapperCell(fakeWorld({ agentGateway: true }).world)).status, "failed");
});

// ── Preflight fail-closed ─────────────────────────────────────────────────────

test("runSelfHostCfnCells: a missing CFN bucket fails the cell CLOSED without building a world", async () => {
  const { driver, buildCalls } = greenDriver();
  const ctx = fakeCtx({ env: fakeEnv({ RELEASE_E2E_SELFHOST_CFN_BUCKET: undefined }) });
  const outcomes = await runSelfHostCfnCells(ctx, [wrapperCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.match(outcomes[0].reason?.message ?? "", /RELEASE_E2E_SELFHOST_CFN_BUCKET/);
  assert.equal(buildCalls(), 0);
});

test("runSelfHostCfnCells: a missing GHCR image repo fails the cell CLOSED", async () => {
  const { driver } = greenDriver();
  const ctx = fakeCtx({ env: fakeEnv({ RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO: undefined }) });
  const outcomes = await runSelfHostCfnCells(ctx, [wrapperCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.match(outcomes[0].reason?.message ?? "", /RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO/);
});

test("resolveCfnWorldInputs: green resolution + typed failures for absent inputs", () => {
  const ok = resolveCfnWorldInputs(fakeCtx());
  assert.equal(ok.ok, true);
  assert.equal(resolveCfnWorldInputs(fakeCtx({ candidateBuildMap: null })).ok, false);
  const missingRegion = resolveCfnWorldInputs(fakeCtx({ env: fakeEnv({ RELEASE_E2E_SELFHOST_REGION: undefined }) }));
  assert.equal(missingRegion.ok, false);
});

test("constructSelfHostCfnWorld rejects a CFN map without the exact arm64 runtime before provider work", async () => {
  const ctx = fakeCtx();
  await assert.rejects(
    constructSelfHostCfnWorld({
      map: fakeCandidateMap(),
      run: ctx.runIdentity!,
      runDir: ctx.runDir ?? "/tmp/selfhost-cfn-missing-runtime",
      region: "us-east-1",
      hostedZoneId: "Z123",
      bucket: "qual-bundle-bucket",
      imageRepo: "ghcr.io/proliferate-ai/proliferate-server-qualification",
    }),
    /missing the required selfhost-runtime\/linux\/arm64 artifact/,
  );
});

test("SIGTERM during retained-stack diagnostics initiates one bounded delete and preserves red custody", async () => {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), "selfhost-cfn-signal-"));
  const cfnDir = path.join(parentDir, "cfn");
  await mkdir(cfnDir, { recursive: true });
  const run = fakeCtx().runIdentity!;
  const ledger = await openCleanupLedger({
    runDir: cfnDir,
    runId: run.run_id,
    shardId: run.shard_id,
  });
  const stack = new SelfHostCfnCleanupStack({ ledger });
  const finalizer = registerSelfHostCfnCancellationFinalizer(stack, run, cfnDir);
  let runDirectoryReleased = false;
  await stack.registerAcquire("run_directory", cfnDir, async () => {
    runDirectoryReleased = true;
  });

  const calls: Array<{ args: string[]; timeoutMs: number | undefined }> = [];
  const exec: CfnAwsExec = {
    async run(args, options) {
      const copy = [...args];
      calls.push({ args: copy, timeoutMs: options?.timeoutMs });
      if (copy[0] === "cloudformation" && copy[1] === "wait" && copy[2] === "stack-create-complete") {
        throw new Error("waiter observed CREATE_FAILED");
      }
      if (copy[0] === "cloudformation" && copy[1] === "describe-stack-events") {
        return JSON.stringify({
          StackEvents: [{
            LogicalResourceId: "ProliferateInstance",
            ResourceStatus: "CREATE_FAILED",
            ResourceStatusReason: "Received FAILURE signal",
          }],
        });
      }
      if (copy[0] === "cloudformation" && copy[1] === "describe-stacks") {
        return "DELETE_IN_PROGRESS\n";
      }
      return "";
    },
  };

  let markCaptureStarted!: () => void;
  const captureStarted = new Promise<void>((resolve) => { markCaptureStarted = resolve; });
  let releaseCapture!: () => void;
  const captureHeld = new Promise<void>((resolve) => { releaseCapture = resolve; });

  try {
    const create = createCfnStackAndWait({
      exec,
      stackName: "proliferate-sh-cfn-signal",
      templatePath: "/t.yaml",
      parameters: [],
      tags: buildCfnStackTags({
        stackName: "proliferate-sh-cfn-signal",
        runId: run.run_id,
        shardId: run.shard_id,
      }),
      region: "us-east-1",
      writeParameterFile: async () => ({ path: "/tmp/p.json", remove: async () => undefined }),
      registerCleanup: (kind, providerId, release, cancellationRelease) =>
        stack.registerAcquire(kind, providerId, release, cancellationRelease),
      onCreateFailure: async () => {
        markCaptureStarted();
        await captureHeld;
        throw new Error("diagnostic capture interrupted by supported signal");
      },
    });

    await captureStarted;
    await finalizeRegisteredForSignal("SIGTERM");
    const signalSummary = await finalizer.run();

    const deletes = calls.filter((call) =>
      call.args[0] === "cloudformation" && call.args[1] === "delete-stack"
    );
    const deleteWaits = calls.filter((call) =>
      call.args[0] === "cloudformation" && call.args[1] === "wait" && call.args[2] === "stack-delete-complete"
    );
    const deleteObservations = calls.filter((call) =>
      call.args[0] === "cloudformation" && call.args[1] === "describe-stacks"
    );
    assert.equal(deletes.length, 1, "supported signal submits the exact stack delete once");
    assert.equal(deleteWaits.length, 0, "signal cleanup must not enter the ordinary 30-minute waiter");
    assert.equal(deleteObservations.length, 1, "signal cleanup makes one immediate status observation");
    assert.equal(deletes[0]?.timeoutMs, 5_000);
    assert.equal(deleteObservations[0]?.timeoutMs, 5_000);
    assert.equal(runDirectoryReleased, false, "the ledger directory remains for follow-up cleanup");
    assert.equal(signalSummary.failed, 2);
    assert.equal(signalSummary.stackDeleted, false);

    const persistedLedger = JSON.parse(
      await readFile(path.join(cfnDir, CLEANUP_LEDGER_FILENAME), "utf8"),
    ) as { entries: Array<{ kind: string; phase: string; providerId: string | null }> };
    const stackEntry = persistedLedger.entries.find((entry) => entry.kind === "cloudformation_stack");
    assert.deepEqual(
      { phase: stackEntry?.phase, providerId: stackEntry?.providerId },
      { phase: "acquired", providerId: "proliferate-sh-cfn-signal" },
      "DELETE_IN_PROGRESS remains durable, unreconciled follow-up custody",
    );

    const receiptRaw = await readFile(path.join(parentDir, "cfn-cancellation-finalization.json"), "utf8");
    const receipt = JSON.parse(receiptRaw);
    assert.equal(receipt.signal, "SIGTERM");
    assert.equal(receipt.status, "failed");
    assert.doesNotMatch(receiptRaw, /proliferate-sh-cfn-signal|Received FAILURE signal/);

    const createRejected = assert.rejects(create, /Bootstrap diagnostic: capture_failed/);
    releaseCapture();
    await createRejected;
    assert.equal(
      calls.filter((call) => call.args[0] === "cloudformation" && call.args[1] === "delete-stack").length,
      1,
      "construction failure and signal share the memoized finalizer",
    );
  } finally {
    releaseCapture?.();
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("normal CFN finalization retains identity-bound zero-survivor truth after deleting its ledger", async () => {
  for (const route53Absent of [true, false]) {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "selfhost-cfn-cleanup-receipt-"));
    const cfnDir = path.join(parentDir, "cfn");
    const artifactsDir = path.join(cfnDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const run = fakeCtx().runIdentity!;
    const ledger = await openCleanupLedger({
      runDir: cfnDir,
      runId: run.run_id,
      shardId: run.shard_id,
    });
    const stack = new SelfHostCfnCleanupStack({
      ledger,
      observeRoute53RecordAbsent: async () => route53Absent,
    });
    const finalizer = registerSelfHostCfnCancellationFinalizer(stack, run, cfnDir);
    await stack.registerAcquire("run_directory", cfnDir, () => rm(cfnDir, { recursive: true, force: true }));
    await stack.registerAcquire("extracted_artifacts", artifactsDir, async () => undefined);
    await stack.registerAcquire("s3_object", "s3://bucket/key", async () => undefined);
    await stack.registerAcquire("ghcr_package_version", "ghcr.io/o/p:tag", async () => undefined);
    await stack.registerAcquire("cloudformation_stack", "provider-stack-unique", async () => undefined);

    try {
      const summary = await finalizer.run();
      assert.equal(summary.route53RecordDeleted, route53Absent);
      await assert.rejects(readFile(path.join(cfnDir, CLEANUP_LEDGER_FILENAME)), /ENOENT/);

      const receiptPath = path.join(parentDir, "logs", CFN_CLEANUP_RECEIPT_FILENAME);
      const receiptRaw = await readFile(receiptPath, "utf8");
      const receipt = JSON.parse(receiptRaw) as {
        run: { run_id: string; shard_id: string; attempt: number; source_sha: string };
        status: string;
        cleanup: { route53_record_deleted: boolean; stack_deleted: boolean; failed: number };
      };
      assert.deepEqual(receipt.run, {
        run_id: run.run_id,
        shard_id: run.shard_id,
        attempt: run.attempt,
        source_sha: run.source_sha,
      });
      assert.equal(receipt.status, route53Absent ? "reconciled" : "failed");
      assert.equal(receipt.cleanup.stack_deleted, true);
      assert.equal(receipt.cleanup.route53_record_deleted, route53Absent);
      assert.equal(receipt.cleanup.failed, 0);
      assert.doesNotMatch(receiptRaw, /s3:\/\/bucket|ghcr\.io|provider-stack-unique|providerId/);
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  }
});

test("SHCFN-CONTROL-001: a hung stack-delete submission retains a failed identity-bound receipt", async () => {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), "selfhost-cfn-hung-delete-receipt-"));
  const cfnDir = path.join(parentDir, "cfn");
  const artifactsDir = path.join(cfnDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const run = fakeCtx().runIdentity!;
  const ledger = await openCleanupLedger({
    runDir: cfnDir,
    runId: run.run_id,
    shardId: run.shard_id,
  });
  const stack = new SelfHostCfnCleanupStack({
    ledger,
    observeRoute53RecordAbsent: async () => true,
  });
  const exec: CfnAwsExec = {
    async run(args) {
      if (args[1] === "delete-stack") {
        return new Promise<string>(() => undefined);
      }
      throw new Error("stack-delete waiter must not run after submission timeout");
    },
  };
  const finalizer = registerSelfHostCfnCancellationFinalizer(stack, run, cfnDir);
  await stack.registerAcquire("run_directory", cfnDir, () => rm(cfnDir, { recursive: true, force: true }));
  await stack.registerAcquire("extracted_artifacts", artifactsDir, async () => undefined);
  await stack.registerAcquire("s3_object", "s3://bucket/key", async () => undefined);
  await stack.registerAcquire("ghcr_package_version", "ghcr.io/o/p:tag", async () => undefined);
  await stack.registerAcquire(
    "cloudformation_stack",
    "provider-stack-unique",
    () => deleteCfnStackAndWait(exec, "provider-stack-unique", "us-east-1", { callTimeoutMs: 5 }),
  );

  try {
    const summary = await finalizer.run();
    assert.equal(summary.stackDeleted, false);
    assert.ok(summary.failed > 0);
    const receiptRaw = await readFile(path.join(parentDir, "logs", CFN_CLEANUP_RECEIPT_FILENAME), "utf8");
    const receipt = JSON.parse(receiptRaw) as {
      run: { run_id: string; shard_id: string; attempt: number; source_sha: string };
      status: string;
      cleanup: { stack_deleted: boolean; failed: number };
    };
    assert.deepEqual(receipt.run, {
      run_id: run.run_id,
      shard_id: run.shard_id,
      attempt: run.attempt,
      source_sha: run.source_sha,
    });
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.cleanup.stack_deleted, false);
    assert.ok(receipt.cleanup.failed > 0);
    assert.doesNotMatch(receiptRaw, /provider-stack-unique/);
    await readFile(path.join(cfnDir, CLEANUP_LEDGER_FILENAME), "utf8");
  } finally {
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("construction failure preserves its cause but fails closed when cleanup proof is absent", async () => {
  const original = new Error("stack CREATE_FAILED");
  await assert.rejects(
    rethrowCfnConstructionFailureAfterCleanup(original, async () => cleanCleanup()),
    (error: unknown) => error === original,
  );
  await assert.rejects(
    rethrowCfnConstructionFailureAfterCleanup(original, async () => dirtyCleanup()),
    /Cleanup did not prove zero survivors/,
  );
  await assert.rejects(
    rethrowCfnConstructionFailureAfterCleanup(original, async () => {
      throw new Error("receipt write failed");
    }),
    /identity-bound receipt could be retained/,
  );
});

// ── Build / close failure semantics ───────────────────────────────────────────

test("runSelfHostCfnCells: a world-build failure fails the cell without a close", async () => {
  const { driver } = greenDriver({
    buildWorld: async () => {
      throw new Error("create-stack ROLLBACK");
    },
  });
  const outcomes = await runSelfHostCfnCells(fakeCtx(), [wrapperCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.match(outcomes[0].reason?.message ?? "", /world construction failed/);
});

test("runSelfHostCfnCells: a close throw fails the evidence-bearing cell (no false green)", async () => {
  const { driver } = greenDriver({
    closeWorld: async () => {
      throw new Error("delete-stack timed out");
    },
  });
  const outcomes = await runSelfHostCfnCells(fakeCtx(), [wrapperCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.equal(outcomes[0].evidence, undefined);
  assert.match(outcomes[0].reason?.message ?? "", /cleanup threw/i);
});

test("runSelfHostCfnCells: a non-clean teardown downgrades the green cell but keeps the evidence", async () => {
  const built = fakeWorld({ cleanup: dirtyCleanup() });
  const driver: SelfHostCfnDriver = {
    buildWorld: async () => built.world,
    runCfnWrapper: (world) => runCfnWrapperCell(world),
    closeWorld: (world) => world.close(),
  };
  const outcomes = await runSelfHostCfnCells(fakeCtx(), [wrapperCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.match(outcomes[0].reason?.message ?? "", /did not fully reconcile/);
  const evidence = outcomes[0].evidence as { cleanup: { failed: number; stack_deleted: boolean } };
  assert.ok(evidence);
  assert.equal(evidence.cleanup.stack_deleted, false);
});

test("runSelfHostCfnCells: an unexpected extra assigned cell fails cleanly", async () => {
  const { driver } = greenDriver();
  const extra: PlannedCellV1 = {
    ...wrapperCell(),
    cell_id: `${SELFHOST_CFN_1_ID}/selfhost/cell=SH-BOGUS,harness=claude`,
    dimensions: { cell: "SH-BOGUS", harness: "claude" },
  };
  const outcomes = await runSelfHostCfnCells(fakeCtx(), [wrapperCell(), extra], driver);
  const byId = new Map(outcomes.map((outcome) => [outcome.cellId, outcome]));
  assert.equal(byId.get(WRAPPER_CELL_ID)?.status, "green");
  assert.equal(byId.get(extra.cell_id)?.status, "failed");
  assert.match(byId.get(extra.cell_id)?.reason?.message ?? "", /not expected/);
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

test("cleanupIsClean + attachCfnCleanup: clean requires all deletions; block is snake_case", () => {
  assert.equal(cleanupIsClean(cleanCleanup()), true);
  assert.equal(cleanupIsClean(dirtyCleanup()), false);
  const evidence: SelfHostCfnWrapperEvidenceNoCleanup = {
    kind: "selfhost_cfn_wrapper",
    artifact_ids: ["server/linux-amd64"],
    server_version: "1.2.3",
    api_origin: SITE,
    stack_name_hash: "a".repeat(64),
    image_repo_digest: "sha256:" + "e".repeat(64),
    release_version_tag: "run-1-shard-1",
    template_sha256: "f".repeat(64),
    template_validated: true,
    bundle_digest_bound: true,
    runtime_digest_bound: true,
    image_digest_bound: true,
    outputs_valid: true,
    dns_tls_verified: true,
    meta_version_matches: true,
  };
  const attached = attachCfnCleanup(evidence, cleanCleanup());
  assert.equal(attached.cleanup.s3_objects_deleted, true);
  assert.equal(attached.cleanup.ghcr_version_deleted, true);
  assert.equal(attached.cleanup.route53_record_deleted, true);
});

// ── Report envelope for schema validation ─────────────────────────────────────

function reportWithEvidence(
  evidence: NonNullable<import("./types.js").ScenarioCellOutcome["evidence"]>,
  status: FinalTestStatus,
): TestRunReportV4 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((s) => [s, 0])) as Record<FinalTestStatus, number>;
  byStatus[status] = 1;
  const base: TestRunReportV3 = {
    schema_version: 3,
    kind: "proliferate.test-run",
    candidate_build: null,
    run: {
      run_id: "run-1",
      shard_id: "shard-1",
      attempt: 1,
      source_sha: "d".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
      behavior: "diagnostic",
      execution: "real",
      started_at: "2026-07-15T00:00:00Z",
      finished_at: "2026-07-15T00:01:00Z",
    },
    inputs: { target_lane: "local", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: WRAPPER_CELL_ID,
        scenario_id: SELFHOST_CFN_1_ID,
        registry_flow_ref: "specs#sh-cfn-wrapper",
        runtime_lane: "selfhost",
        dimensions: { cell: SH_CFN_WRAPPER, harness: "claude" },
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: WRAPPER_CELL_ID,
        scenario_id: SELFHOST_CFN_1_ID,
        registry_flow_ref: "specs#sh-cfn-wrapper",
        runtime_lane: "selfhost",
        dimensions: { cell: SH_CFN_WRAPPER, harness: "claude" },
        status,
        started_at: "2026-07-15T00:00:01Z",
        finished_at: "2026-07-15T00:00:59Z",
        duration_ms: 58_000,
        reason: null,
        plan_steps: [],
      },
    ],
    summary: {
      selected: 1,
      finalized: 1,
      by_status: byStatus,
      integrity_errors: [],
      runner_errors: [],
      intended_exit_code: 0,
    },
    verdict: { status: "non_qualifying", scope: "selected_cells", completeness: "partial", reasons: [] },
  };
  base.verdict.reasons = expectedVerdict(base).reasons;
  return { ...base, schema_version: 4, results: base.results.map((r) => ({ ...r, evidence })) };
}
