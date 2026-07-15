import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SELFHOST_CELL_ORDER,
  SELFHOST_INSTALL_1_ID,
  SH_BASE_TURN,
  SH_DESKTOP_OWNER,
  SH_INSTALL_CLAIM,
  SH_INVITEE,
  attachCleanupEvidence,
  resolveSelfHostWorldInputs,
  runSelfHostInstallCells,
  type CellEvidenceNoCleanup,
  type SelfHostCellResult,
  type SelfHostInstallDriver,
} from "./selfhost-install-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import type { SelfHostWorldCleanupEvidence } from "../worlds/selfhost/cleanup-kinds.js";

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

function fakeEnv(vars: Record<string, string> = {}): EnvResolution {
  const defaults: Record<string, string> = {
    RELEASE_E2E_SELFHOST_REGION: "us-east-1",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123",
    RELEASE_E2E_SELFHOST_INSTANCE_TYPE: "t3.small",
    RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY: "sk-ant-test-key",
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

function cellFor(cellName: string): PlannedCellV1 {
  return {
    cell_id: `${SELFHOST_INSTALL_1_ID}/selfhost/cell=${cellName},harness=claude`,
    scenario_id: SELFHOST_INSTALL_1_ID,
    registry_flow_ref: "specs/developing/testing/flows.md#selfhost-install",
    runtime_lane: "selfhost",
    dimensions: { cell: cellName, harness: "claude" },
    required_env: [],
  };
}

function allCells(): PlannedCellV1[] {
  return SELFHOST_CELL_ORDER.map((cell) => cellFor(cell));
}

const FAKE_WORLD = { kind: "selfhost" } as unknown as ReadySelfHostWorld;

function cleanCleanup(): SelfHostWorldCleanupEvidence {
  return {
    ledgerIdHash: "l".repeat(64),
    registered: 6,
    reconciled: 6,
    failed: 0,
    ec2Terminated: true,
    securityGroupDeleted: true,
    keyPairDeleted: true,
    route53RecordDeleted: true,
    browserClosed: true,
    processesStopped: true,
    localPathsRemoved: true,
  };
}

function dirtyCleanup(): SelfHostWorldCleanupEvidence {
  return { ...cleanCleanup(), failed: 1, ec2Terminated: false };
}

function greenEvidenceFor(cellName: string): CellEvidenceNoCleanup {
  const base = {
    artifact_ids: ["server/linux-amd64", "selfhost-bundle/linux-amd64", "anyharness/x86_64-unknown-linux-gnu", "desktop-renderer/browser"],
    server_version: "1.2.3",
    anyharness_version: "4.5.6",
    harness: "claude" as const,
    api_origin: "run-1.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:4",
  };
  switch (cellName) {
    case SH_INSTALL_CLAIM: {
      const evidence: CellEvidenceNoCleanup = {
        ...base,
        kind: "selfhost_install_claim",
        running_image_digest: "sha256:" + "d".repeat(64),
        bundle_sha256: "e".repeat(64),
        setup_token_hash: "f".repeat(64),
        owner_user_id_hash: "0".repeat(64),
        org_id_hash: "1".repeat(64),
        tls_verified: true,
        second_claim_rejected: true,
        restart_persisted: true,
      };
      return evidence;
    }
    case SH_DESKTOP_OWNER: {
      const evidence: CellEvidenceNoCleanup = {
        ...base,
        kind: "selfhost_desktop_owner",
        owner_user_id_hash: "0".repeat(64),
        org_id_hash: "1".repeat(64),
        connect_rejected_invalid_url: true,
        connect_rejected_non_proliferate_host: true,
        only_meta_before_trust: true,
        owner_login_verified: true,
        single_org: true,
      };
      return evidence;
    }
    case SH_BASE_TURN: {
      const evidence: CellEvidenceNoCleanup = {
        ...base,
        kind: "selfhost_base_turn",
        model_id: "claude-cheap-1",
        workspace_id_hash: "2".repeat(64),
        session_id_hash: "3".repeat(64),
        transcript_reopened: true,
        byok_route: "api_key",
        byok_key_id_hash: "4".repeat(64),
        no_litellm_spend: true,
        no_e2b: true,
      };
      return evidence;
    }
    default: {
      const evidence: CellEvidenceNoCleanup = {
        ...base,
        kind: "selfhost_invitee",
        invitee_user_id_hash: "5".repeat(64),
        invitation_id_hash: "6".repeat(64),
        member_role: "member",
        second_page_isolated: true,
        authenticated_member_action: true,
      };
      return evidence;
    }
  }
}

function allGreenDriver(worldsBuilt: ReadySelfHostWorld[] = []): SelfHostInstallDriver {
  const green = (cellName: string): Promise<SelfHostCellResult> => {
    const result: SelfHostCellResult = { status: "green", evidence: greenEvidenceFor(cellName) };
    return Promise.resolve(result);
  };
  return {
    buildWorld: async () => {
      worldsBuilt.push(FAKE_WORLD);
      return FAKE_WORLD;
    },
    runInstallClaim: () => green(SH_INSTALL_CLAIM),
    runDesktopOwner: () => green(SH_DESKTOP_OWNER),
    runBaseTurn: () => green(SH_BASE_TURN),
    runInvitee: () => green(SH_INVITEE),
    closeWorld: async () => cleanCleanup(),
  };
}

test("resolveSelfHostWorldInputs: ok with a complete context", () => {
  const result = resolveSelfHostWorldInputs(fakeCtx());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.aws.region, "us-east-1");
    assert.equal(result.value.aws.zone, "qualification.proliferate.com");
    assert.equal(result.value.ssh.sshUser, "ubuntu");
  }
});

test("resolveSelfHostWorldInputs: ssh user override", () => {
  const result = resolveSelfHostWorldInputs(fakeCtx({ env: fakeEnv({ RELEASE_E2E_SELFHOST_SSH_USER: "admin" }) }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.ssh.sshUser, "admin");
  }
});

test("resolveSelfHostWorldInputs: fails closed on a missing candidate map", () => {
  const result = resolveSelfHostWorldInputs(fakeCtx({ candidateBuildMap: null }));
  assert.equal(result.ok, false);
});

test("resolveSelfHostWorldInputs: fails closed on missing run identity/runDir/ports", () => {
  assert.equal(resolveSelfHostWorldInputs(fakeCtx({ runIdentity: null })).ok, false);
  assert.equal(resolveSelfHostWorldInputs(fakeCtx({ runDir: null })).ok, false);
  assert.equal(resolveSelfHostWorldInputs(fakeCtx({ ports: null })).ok, false);
});

test("resolveSelfHostWorldInputs: fails closed on a missing required AWS env var", () => {
  const result = resolveSelfHostWorldInputs(fakeCtx({ env: fakeEnv({ RELEASE_E2E_SELFHOST_REGION: "" }) }));
  assert.equal(result.ok, false);
});

test("attachCleanupEvidence: stamps the cleanup block with a snake_case projection", () => {
  const evidence = attachCleanupEvidence(greenEvidenceFor(SH_INSTALL_CLAIM), cleanCleanup());
  assert.equal(evidence.kind, "selfhost_install_claim");
  assert.deepEqual(evidence.cleanup, {
    ledger_id_hash: "l".repeat(64),
    registered: 6,
    reconciled: 6,
    failed: 0,
    ec2_terminated: true,
    security_group_deleted: true,
    key_pair_deleted: true,
    route53_record_deleted: true,
    browser_closed: true,
    processes_stopped: true,
    local_paths_removed: true,
  });
});

test("runSelfHostInstallCells: all four cells green with a clean teardown", async () => {
  const outcomes = await runSelfHostInstallCells(fakeCtx(), allCells(), allGreenDriver());
  assert.equal(outcomes.length, 4);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "green", JSON.stringify(outcome));
    assert.ok(outcome.evidence, `${outcome.cellId} is missing evidence`);
    assert.deepEqual(outcome.evidence!.cleanup.failed, 0);
  }
});

test("runSelfHostInstallCells: a failed SH-INSTALL-CLAIM fails the dependent cells cleanly", async () => {
  const driver = allGreenDriver();
  driver.runInstallClaim = async () => ({
    status: "failed",
    reason: { code: "scenario_failure", message: "shipped installer digest mismatch" },
  });
  const outcomes = await runSelfHostInstallCells(fakeCtx(), allCells(), driver);
  const byCell = new Map(outcomes.map((o) => [o.cellId, o]));
  const installOutcome = byCell.get(cellFor(SH_INSTALL_CLAIM).cell_id)!;
  assert.equal(installOutcome.status, "failed");
  assert.equal(installOutcome.evidence, undefined);

  for (const dependent of [SH_DESKTOP_OWNER, SH_BASE_TURN, SH_INVITEE]) {
    const outcome = byCell.get(cellFor(dependent).cell_id)!;
    assert.equal(outcome.status, "failed", `${dependent} should fail as a dependent`);
    assert.match(outcome.reason?.message ?? "", /SH-INSTALL-CLAIM/);
    assert.equal(outcome.evidence, undefined);
  }
});

test("runSelfHostInstallCells: a non-clean teardown downgrades every green cell to failed", async () => {
  const driver = allGreenDriver();
  driver.closeWorld = async () => dirtyCleanup();
  const outcomes = await runSelfHostInstallCells(fakeCtx(), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed", JSON.stringify(outcome));
    assert.match(outcome.reason?.message ?? "", /cleanup/i);
    // The cleanup block is still attached so the failure is inspectable.
    assert.ok(outcome.evidence);
  }
});

test("runSelfHostInstallCells: world construction failure fails every cell without touching closeWorld", async () => {
  let closeWorldCalled = false;
  const driver: SelfHostInstallDriver = {
    buildWorld: async () => {
      throw new Error("EC2 run-instances failed");
    },
    runInstallClaim: () => Promise.reject(new Error("should not run")),
    runDesktopOwner: () => Promise.reject(new Error("should not run")),
    runBaseTurn: () => Promise.reject(new Error("should not run")),
    runInvitee: () => Promise.reject(new Error("should not run")),
    closeWorld: async () => {
      closeWorldCalled = true;
      return cleanCleanup();
    },
  };
  const outcomes = await runSelfHostInstallCells(fakeCtx(), allCells(), driver);
  assert.equal(outcomes.length, 4);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.match(outcome.reason?.message ?? "", /world construction failed/);
  }
  assert.equal(closeWorldCalled, false);
});

test("runSelfHostInstallCells: a typed world-input resolution failure fails every cell without building a world", async () => {
  let buildWorldCalled = false;
  const driver = allGreenDriver();
  const originalBuild = driver.buildWorld;
  driver.buildWorld = async (inputs) => {
    buildWorldCalled = true;
    return originalBuild(inputs);
  };
  const outcomes = await runSelfHostInstallCells(fakeCtx({ candidateBuildMap: null }), allCells(), driver);
  assert.equal(outcomes.length, 4);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
  }
  assert.equal(buildWorldCalled, false);
});

test("runSelfHostInstallCells: closeWorld throwing fails every evidence-bearing cell (no false green)", async () => {
  const driver = allGreenDriver();
  driver.closeWorld = async () => {
    throw new Error("AWS terminate-instances timed out");
  };
  const outcomes = await runSelfHostInstallCells(fakeCtx(), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.evidence, undefined);
  }
});
