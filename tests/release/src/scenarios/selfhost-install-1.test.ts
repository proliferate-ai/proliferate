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
  browserOriginsForBox,
  resolveSelfHostWorldInputs,
  runBaseTurnCell,
  runSelfHostInstallCells,
  type BaseTurnCellOps,
  type CellEvidenceNoCleanup,
  type SelfHostCellResult,
  type SelfHostInstallDriver,
} from "./selfhost-install-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { ProductPage } from "../fixtures/product-page.js";
import type { SelfHostOwnerActor } from "../fixtures/selfhost-actor.js";
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
        candidate_server_version: "1.2.3",
        server_version_matches_candidate: true,
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
    // Every self-host journey kind extends SelfHostEvidenceBaseV1, which carries
    // `cleanup`; narrow past the widened CellEvidenceV1 union (tier2_billing has
    // no cleanup block) with a structural cast.
    assert.deepEqual((outcome.evidence as { cleanup: { failed: number } }).cleanup.failed, 0);
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

test("browserOriginsForBox always emits both 127.0.0.1 and localhost forms (greptile P2)", () => {
  const forBase = (rendererBaseUrl: string): string[] =>
    browserOriginsForBox({ renderer: { baseUrl: rendererBaseUrl } } as unknown as ReadySelfHostWorld).split(",");

  // Renderer bound on 127.0.0.1 → both forms present.
  const fromIp = forBase("http://127.0.0.1:9103/");
  assert.ok(fromIp.includes("http://127.0.0.1:9103"), `missing 127.0.0.1 form: ${fromIp.join(",")}`);
  assert.ok(fromIp.includes("http://localhost:9103"), `missing localhost form: ${fromIp.join(",")}`);

  // Renderer bound on localhost → the 127.0.0.1 form must NOT be dropped
  // (the old `.replace("127.0.0.1", ...)` + Set left only localhost here).
  const fromLocalhost = forBase("http://localhost:9103/");
  assert.ok(
    fromLocalhost.includes("http://127.0.0.1:9103"),
    `missing 127.0.0.1 form when bound on localhost: ${fromLocalhost.join(",")}`,
  );
  assert.ok(fromLocalhost.includes("http://localhost:9103"), `missing localhost form: ${fromLocalhost.join(",")}`);

  // Same origin set regardless of which loopback host the renderer bound on,
  // and exact-deduped (no repeated entries).
  assert.deepEqual([...fromIp].sort(), [...fromLocalhost].sort());
  assert.equal(new Set(fromIp).size, fromIp.length);

  // A non-loopback renderer origin is passed through unchanged (single entry).
  assert.deepEqual(forBase("https://renderer.internal.example:8443/"), ["https://renderer.internal.example:8443"]);
});

// ── SH-BASE-TURN cell logic (fake ops; UI-real flow, offline) ────────────────

function baseTurnWorld(): ReadySelfHostWorld {
  return {
    kind: "selfhost",
    artifacts: {
      serverImage: { artifact_id: "server/linux-amd64", version: "1.2.3" },
      bundle: { artifact_id: "selfhost-bundle/linux-amd64", version: "1.2.3" },
      anyharness: { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "4.5.6" },
      desktopRenderer: { artifact_id: "desktop-renderer/browser", version: "1" },
    },
    api: { baseUrl: "https://run-1.qualification.proliferate.com" },
    runtime: { baseUrl: "http://127.0.0.1:4" },
  } as unknown as ReadySelfHostWorld;
}

const FAKE_OWNER: SelfHostOwnerActor = {
  role: "owner",
  userId: "owner-user-1",
  organizationId: "org-1",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: {} as any,
};

/** A ProductPage whose close() is tracked so the finally-close path is provable. */
function fakePage(closed: { value: boolean }): ProductPage {
  return {
    context: undefined as never,
    page: undefined as never,
    debug: { console: [], network: [] },
    close: async () => {
      closed.value = true;
    },
  };
}

/**
 * Green ops: BYOK ok, Desktop sync lands, the UI-real turn materializes a
 * workspace/session and renders "pong", the runtime reopen stays commandable,
 * the product-native reload restores the transcript, and no LiteLLM/E2B is seen.
 */
function greenBaseTurnOps(closed: { value: boolean }, overrides: Partial<BaseTurnCellOps> = {}): BaseTurnCellOps {
  return {
    resolveByokRawKey: () => "sk-ant-test-key",
    preflightByok: async () => ({ ok: true }),
    storeAndSelectByok: async () => ({ apiKeyId: "byok-key-1", harnessKind: "claude", envVarName: "ANTHROPIC_API_KEY" }),
    openOwnerPage: async () => fakePage(closed),
    waitForByokSync: async () => undefined,
    summarizeAuthState: () => "[diag: state.json present]",
    resolveModel: async () => "claude-haiku-4-5",
    createWorkspaceTurnThroughUi: async () => ({ workspaceId: "ws-1", sessionId: "sess-1", reply: "pong" }),
    reopenSession: async () => ({ workspaceId: "ws-1" }),
    reloadTranscript: async () => ({ ok: true, text: "pong" }),
    fetchCapabilities: async () => ({ agentGateway: false, cloudWorkspaces: false }),
    readAuthSourceKinds: () => ["api_key"],
    detectGatewayEnvVar: () => undefined,
    detectE2bEnvKey: () => undefined,
    ...overrides,
  };
}

test("runBaseTurnCell: green through UI create → turn → runtime reopen → product-native reload", async () => {
  const closed = { value: false };
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, greenBaseTurnOps(closed));
  assert.equal(result.status, "green", JSON.stringify(result));
  assert.equal(result.evidence?.kind, "selfhost_base_turn");
  const evidence = result.evidence as {
    model_id: string;
    transcript_reopened: boolean;
    byok_route: string;
    no_litellm_spend: boolean;
    no_e2b: boolean;
  };
  assert.equal(evidence.model_id, "claude-haiku-4-5");
  assert.equal(evidence.transcript_reopened, true);
  assert.equal(evidence.byok_route, "api_key");
  assert.equal(evidence.no_litellm_spend, true);
  assert.equal(evidence.no_e2b, true);
  // The owner page is always closed in the finally.
  assert.equal(closed.value, true);
});

test("runBaseTurnCell: a failed BYOK preflight is a fail-closed red, never blocked", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, { preflightByok: async () => ({ ok: false, reason: "provider returned 401 on /models" }) });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /BYOK preflight rejected the key \(provider returned 401/);
});

test("runBaseTurnCell: no launchable model is blocked, not failed", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, { resolveModel: async () => undefined });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "blocked");
  assert.match(result.reason?.message ?? "", /no launchable claude model/);
  assert.equal(closed.value, true);
});

test("runBaseTurnCell: a UI create/turn failure fails the cell with a bounded reason", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, {
    createWorkspaceTurnThroughUi: async () => {
      throw new Error('could not find home Project picker trigger (role=button, name=/^Project:/)');
    },
  });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /creating the local workspace and running the turn through the renderer failed/);
  assert.match(result.reason?.message ?? "", /Project:/);
  assert.equal(closed.value, true);
});

test("runBaseTurnCell: a ui-turn step (uiTurnStep) is rendered BEFORE the redaction boundary", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, {
    createWorkspaceTurnThroughUi: async () => {
      const err = new Error("assistant turn errored: provider returned 500") as Error & { uiTurnStep?: string };
      err.uiTurnStep = "wait for turn completion";
      throw err;
    },
  });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  const message = result.reason?.message ?? "";
  // The step must precede " failed:" so evidence redaction (which withholds
  // everything after that colon) cannot strip it.
  const stepIdx = message.indexOf('step "wait for turn completion"');
  const failedIdx = message.indexOf(" failed:");
  assert.ok(stepIdx >= 0, `expected the step label in: ${message}`);
  assert.ok(failedIdx >= 0 && stepIdx < failedIdx, `expected the step before " failed:" in: ${message}`);
  assert.equal(closed.value, true);
});

test("runBaseTurnCell: a turn that never renders a reply (timeout) fails the cell", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, {
    createWorkspaceTurnThroughUi: async () => ({ workspaceId: "ws-1", sessionId: "sess-1", reply: "" }),
  });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /transcript did not render the turn's reply/);
});

test("runBaseTurnCell: the runtime session must remain commandable after the turn", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, { reopenSession: async () => undefined });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not remain commandable after reopen/);
});

test("runBaseTurnCell: a post-reload restore failure is a diagnosable product red", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, {
    reloadTranscript: async () => ({
      ok: false,
      diagnostic: 'the reload landed on the home/list view without re-opening workspace "ws-1…"',
    }),
  });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /product-native page reload the renderer did not restore/);
  assert.match(result.reason?.message ?? "", /home\/list view without re-opening/);
});

test("runBaseTurnCell: an agentGateway=true capability advertisement fails no_litellm_spend", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, { fetchCapabilities: async () => ({ agentGateway: true, cloudWorkspaces: false }) });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /capabilities\.agentGateway=true/);
});

test("runBaseTurnCell: a 'gateway' auth source (LiteLLM route) on a BYOK-direct turn fails", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, { readAuthSourceKinds: () => ["api_key", "gateway"] });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /carries a "gateway"/);
});

test("runBaseTurnCell: a leaked E2B key in the scrubbed child env fails no_e2b", async () => {
  const closed = { value: false };
  const ops = greenBaseTurnOps(closed, { detectE2bEnvKey: () => "E2B_API_KEY" });
  const result = await runBaseTurnCell(baseTurnWorld(), FAKE_OWNER, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /carries an E2B key \("E2B_API_KEY"\)/);
});
