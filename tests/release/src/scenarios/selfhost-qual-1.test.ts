import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIXED_SUBDOMAIN_LABEL,
  REPRESENTATIVE_HARNESS,
  SELFHOST_QUAL_1_ID,
  SELFHOST_QUAL_CELL_ORDER,
  SH_GATEWAY,
  SH_GITHUB_AUTH,
  attachCleanupEvidence,
  runGatewayCell,
  runGithubAuthCell,
  runSelfHostQualCells,
  type GatewayCellOps,
  type QualCellEvidenceNoCleanup,
  type SelfHostQualCellResult,
  type SelfHostQualDriver,
} from "./selfhost-qual-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import { canonicalCellId } from "../runner/plan.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus, type PlannedCellV1 } from "../runner/result.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import type { SelfHostWorldCleanupEvidence } from "../worlds/selfhost/cleanup-kinds.js";
import type { SelfHostOwnerActor } from "../fixtures/selfhost-actor.js";
import {
  correlateGatewaySpend,
  enrollmentIsSynced,
  gatewayAuthSelectionBody,
  resolveGatewayConfig,
  selectPersonalEnrollmentKeyToken,
  type GatewayEnvSource,
} from "../worlds/selfhost/gateway.js";
import {
  classifyGithubInterstitial,
  parseAdvertisedMethods,
  resolveGithubOauthConfig,
  type GithubAuthOps,
  type GithubOauthConfig,
} from "../fixtures/selfhost-github-auth.js";
import {
  expectedVerdict,
  validateReportV4,
  type CellEvidenceV1,
  type TestRunReportV4,
} from "../evidence/schema.js";

// ── Shared fakes ─────────────────────────────────────────────────────────────

const OAUTH_ENV: Record<string, string> = {
  RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID: "iv1.abc",
  RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET: "gh-secret",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE: "/tmp/a.json",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE: "/tmp/b.json",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_EMAIL: "identity-a@example.com",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL: "identity-b@example.com",
};

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
    RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY: "sk-ant-a",
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
    cell_id: canonicalCellId(SELFHOST_QUAL_1_ID, "selfhost", { cell: cellName, harness: REPRESENTATIVE_HARNESS }),
    scenario_id: SELFHOST_QUAL_1_ID,
    registry_flow_ref: "specs/developing/testing/tier-3-scenario-contract.md#sh-gateway",
    runtime_lane: "selfhost",
    dimensions: { cell: cellName, harness: "claude" },
    required_env: [],
  };
}

function allCells(): PlannedCellV1[] {
  return SELFHOST_QUAL_CELL_ORDER.map((cell) => cellFor(cell));
}

const FAKE_WORLD = { kind: "selfhost" } as unknown as ReadySelfHostWorld;

const FAKE_OWNER: SelfHostOwnerActor = {
  role: "owner",
  userId: "owner-user-1",
  organizationId: "org-1",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: {} as any,
};

function cleanCleanup(): SelfHostWorldCleanupEvidence {
  return {
    ledgerIdHash: "9".repeat(64),
    registered: 4,
    reconciled: 4,
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

function greenEvidenceFor(cellName: string): QualCellEvidenceNoCleanup {
  const base = {
    artifact_ids: ["server/linux-amd64", "selfhost-bundle/linux-amd64", "anyharness/x86_64-unknown-linux-gnu", "desktop-renderer/browser"],
    server_version: "0.3.29",
    anyharness_version: "0.3.29",
    harness: "claude" as const,
    api_origin: "selfhost-fixed.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:4",
  };
  if (cellName === SH_GITHUB_AUTH) {
    return {
      ...base,
      kind: "selfhost_github_auth",
      owner_user_id_hash: "0".repeat(64),
      org_id_hash: "1".repeat(64),
      github_identity_a_hash: "2".repeat(64),
      github_identity_b_hash: "3".repeat(64),
      setup_password_only: true,
      owner_link_no_duplicate: true,
      uninvited_denied: true,
      invited_admitted: true,
      member_role: "member",
      methods_advertise_github: true,
    };
  }
  return {
    ...base,
    kind: "selfhost_gateway",
    actor_user_id_hash: "4".repeat(64),
    virtual_key_id_hash: "5".repeat(64),
    litellm_image_digest: "sha256:" + "c".repeat(64),
    model_id: "claude-haiku-4-5",
    capability_gateway_before: false,
    capability_gateway_after: true,
    gateway_spend_correlated: true,
    master_key_not_used: true,
    restart_persisted: true,
  };
}

interface DriverProbe {
  fixedSubdomains: Array<string | undefined>;
  ownerEmails: Array<string | undefined>;
}

function allGreenDriver(probe: DriverProbe = { fixedSubdomains: [], ownerEmails: [] }): SelfHostQualDriver {
  const green = (cellName: string): Promise<SelfHostQualCellResult> =>
    Promise.resolve({ status: "green", evidence: greenEvidenceFor(cellName) });
  return {
    buildWorld: async (_inputs, fixedSubdomain) => {
      probe.fixedSubdomains.push(fixedSubdomain);
      return FAKE_WORLD;
    },
    installAndClaim: async (_world, opts) => {
      probe.ownerEmails.push(opts.ownerEmail);
      return { ok: true, owner: FAKE_OWNER };
    },
    runGithubAuth: () => green(SH_GITHUB_AUTH),
    runGateway: () => green(SH_GATEWAY),
    closeWorld: async () => cleanCleanup(),
  };
}

// ── Orchestration tests (fake driver) ────────────────────────────────────────

test("runSelfHostQualCells: both cells green with a clean teardown", async () => {
  const outcomes = await runSelfHostQualCells(fakeCtx({ env: fakeEnv(OAUTH_ENV) }), allCells(), allGreenDriver());
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "green", JSON.stringify(outcome));
    assert.ok(outcome.evidence, `${outcome.cellId} missing evidence`);
    assert.equal((outcome.evidence as { cleanup: { failed: number } }).cleanup.failed, 0);
  }
});

test("runSelfHostQualCells: selecting SH-GITHUB-AUTH pins the fixed origin + identity-A owner email", async () => {
  const probe: DriverProbe = { fixedSubdomains: [], ownerEmails: [] };
  await runSelfHostQualCells(fakeCtx({ env: fakeEnv(OAUTH_ENV) }), allCells(), allGreenDriver(probe));
  assert.deepEqual(probe.fixedSubdomains, [FIXED_SUBDOMAIN_LABEL]);
  assert.deepEqual(probe.ownerEmails, ["identity-a@example.com"]);
});

test("runSelfHostQualCells: SH-GATEWAY alone runs on the run-scoped origin", async () => {
  const probe: DriverProbe = { fixedSubdomains: [], ownerEmails: [] };
  const outcomes = await runSelfHostQualCells(fakeCtx(), [cellFor(SH_GATEWAY)], allGreenDriver(probe));
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "green");
  assert.deepEqual(probe.fixedSubdomains, [undefined]);
  assert.deepEqual(probe.ownerEmails, [undefined]);
});

test("runSelfHostQualCells: a failed install/claim fails both cells cleanly", async () => {
  const driver = allGreenDriver();
  driver.installAndClaim = async () => ({ ok: false, reason: "shipped installer digest mismatch" });
  const outcomes = await runSelfHostQualCells(fakeCtx(), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed", JSON.stringify(outcome));
    assert.match(outcome.reason?.message ?? "", /digest mismatch/);
    assert.equal(outcome.evidence, undefined);
  }
});

test("runSelfHostQualCells: a non-clean teardown downgrades every green cell", async () => {
  const driver = allGreenDriver();
  driver.closeWorld = async () => dirtyCleanup();
  const outcomes = await runSelfHostQualCells(fakeCtx({ env: fakeEnv(OAUTH_ENV) }), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed", JSON.stringify(outcome));
    assert.match(outcome.reason?.message ?? "", /cleanup/i);
    assert.ok(outcome.evidence);
  }
});

test("runSelfHostQualCells: world construction failure fails every cell without install/claim", async () => {
  let installCalled = false;
  const driver = allGreenDriver();
  driver.buildWorld = async () => {
    throw new Error("EC2 run-instances failed");
  };
  driver.installAndClaim = async () => {
    installCalled = true;
    return { ok: true, owner: FAKE_OWNER };
  };
  const outcomes = await runSelfHostQualCells(fakeCtx(), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.match(outcome.reason?.message ?? "", /world construction failed/);
  }
  assert.equal(installCalled, false);
});

test("runSelfHostQualCells: a typed world-input resolution failure fails every cell without a world", async () => {
  let buildCalled = false;
  const driver = allGreenDriver();
  driver.buildWorld = async () => {
    buildCalled = true;
    return FAKE_WORLD;
  };
  const outcomes = await runSelfHostQualCells(fakeCtx({ candidateBuildMap: null }), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
  }
  assert.equal(buildCalled, false);
});

test("runSelfHostQualCells: closeWorld throwing fails every evidence-bearing cell (no false green)", async () => {
  const driver = allGreenDriver();
  driver.closeWorld = async () => {
    throw new Error("AWS terminate-instances timed out");
  };
  const outcomes = await runSelfHostQualCells(fakeCtx({ env: fakeEnv(OAUTH_ENV) }), allCells(), driver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.evidence, undefined);
  }
});

// ── SH-GITHUB-AUTH cell logic (fake ops) ─────────────────────────────────────

function fakeWorld(): ReadySelfHostWorld {
  return {
    artifacts: {
      serverImage: { artifact_id: "server/linux-amd64", version: "0.3.29", sha256: "s".repeat(64), path: "/tmp/s" },
      bundle: { artifact_id: "selfhost-bundle/linux-amd64", version: "0.3.29", sha256: "b".repeat(64), path: "/tmp/b" },
      anyharness: { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "0.3.29", sha256: "a".repeat(64), path: "/tmp/a" },
      desktopRenderer: { artifact_id: "desktop-renderer/browser", version: "0.3.29", sha256: "d".repeat(64), path: "/tmp/d" },
    },
    api: { baseUrl: "https://selfhost-fixed.qualification.proliferate.com" },
    runtime: { baseUrl: "http://127.0.0.1:8542" },
  } as unknown as ReadySelfHostWorld;
}

function oauthConfig(): { ok: true; value: GithubOauthConfig } {
  const resolved = resolveGithubOauthConfig({ get: (name) => OAUTH_ENV[name] });
  assert.equal(resolved.ok, true);
  return resolved as { ok: true; value: GithubOauthConfig };
}

/** Green ops: github advertised only after config, B denied-then-admitted, A links to owner. */
function greenGithubOps(): GithubAuthOps {
  let configured = false;
  let bInvited = false;
  return {
    async configureOauth() {
      configured = true;
    },
    async fetchAuthMethods() {
      return configured ? ["password", "github"] : ["password"];
    },
    async signInWithGithub(_world, identity) {
      if (identity.label === "A") {
        return { admitted: true, userId: FAKE_OWNER.userId };
      }
      return bInvited ? { admitted: true, userId: "b-user", memberRole: "member" } : { admitted: false };
    },
    async inviteThroughUi() {
      bInvited = true;
      return { invitationId: "inv-1" };
    },
  };
}

test("runGithubAuthCell: green when methods flip, B is denied-then-admitted, and A links to owner", async () => {
  const result = await runGithubAuthCell(fakeWorld(), FAKE_OWNER, oauthConfig(), greenGithubOps());
  assert.equal(result.status, "green", JSON.stringify(result));
  assert.equal(result.evidence?.kind, "selfhost_github_auth");
});

test("runGithubAuthCell: fails closed when the OAuth env is absent", async () => {
  const result = await runGithubAuthCell(
    fakeWorld(),
    FAKE_OWNER,
    { ok: false, reason: "SH-GITHUB-AUTH: missing required GitHub OAuth env: RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET." },
    greenGithubOps(),
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /missing required GitHub OAuth env/);
  assert.equal(result.evidence, undefined);
});

test("runGithubAuthCell: fails when github is not advertised after configuration", async () => {
  const ops = greenGithubOps();
  ops.fetchAuthMethods = async () => ["password"];
  const result = await runGithubAuthCell(fakeWorld(), FAKE_OWNER, oauthConfig(), ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not advertise github/);
});

test("runGithubAuthCell: fails when an uninvited GitHub identity is admitted", async () => {
  const ops = greenGithubOps();
  ops.signInWithGithub = async (_world, identity) =>
    identity.label === "A" ? { admitted: true, userId: FAKE_OWNER.userId } : { admitted: true, memberRole: "member" };
  const result = await runGithubAuthCell(fakeWorld(), FAKE_OWNER, oauthConfig(), ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /uninvited GitHub identity .* was admitted/);
});

test("runGithubAuthCell: fails when identity A does not link to the existing owner", async () => {
  const ops = greenGithubOps();
  const base = ops.signInWithGithub;
  ops.signInWithGithub = async (world, identity) =>
    identity.label === "A" ? { admitted: true, userId: "some-other-user" } : base(world, identity);
  const result = await runGithubAuthCell(fakeWorld(), FAKE_OWNER, oauthConfig(), ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not link to the existing owner/);
});

// ── SH-GATEWAY cell logic (fake ops) ─────────────────────────────────────────

const GATEWAY_ENV: GatewayEnvSource = {
  get: (name) => (name === "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY" ? "sk-ant-b" : undefined),
};

function greenGatewayOps(): GatewayCellOps {
  let enabled = false;
  return {
    async fetchAgentGatewayCapability() {
      return { agentGateway: enabled, cloudWorkspaces: false };
    },
    async configureAndEnableGateway() {
      enabled = true;
    },
    async observeLitellmImageDigest() {
      return "sha256:" + "c".repeat(64);
    },
    async enrollActorAndRunTurn() {
      return {
        actorUserId: "actor-1",
        virtualKeyTokenId: "token-abc",
        turn: { ended: true, modelId: "claude-haiku-4-5" },
      };
    },
    async snapshotSpendRows() {
      return [{ api_key: "token-abc", spend: 0.0001, total_tokens: 12, model: "claude-haiku-4-5" }];
    },
    async restartAndReassert() {
      return { capabilityStillTrue: true, healthy: true };
    },
  };
}

test("runGatewayCell: green through enable → turn → correlation → restart persistence", async () => {
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, greenGatewayOps());
  assert.equal(result.status, "green", JSON.stringify(result));
  assert.equal(result.evidence?.kind, "selfhost_gateway");
  assert.equal((result.evidence as { capability_gateway_before: unknown }).capability_gateway_before, false);
});

test("runGatewayCell: fails when agentGateway is already true before enabling (mismatch)", async () => {
  const ops = greenGatewayOps();
  ops.fetchAgentGatewayCapability = async () => ({ agentGateway: true, cloudWorkspaces: false });
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /already true before/);
});

test("runGatewayCell: fails when agentGateway does not flip to true after enabling (mismatch)", async () => {
  const ops = greenGatewayOps();
  ops.fetchAgentGatewayCapability = async () => ({ agentGateway: false, cloudWorkspaces: false });
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not flip to true/);
});

test("runGatewayCell: fails closed when no upstream provider key is configured", async () => {
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, { get: () => undefined }, greenGatewayOps());
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /no upstream provider key/);
});

test("runGatewayCell: fails when the gateway-routed turn errors", async () => {
  const ops = greenGatewayOps();
  ops.enrollActorAndRunTurn = async () => ({
    actorUserId: "actor-1",
    virtualKeyTokenId: "token-abc",
    turn: { ended: true, error: "provider 429", modelId: "claude-haiku-4-5" },
  });
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /turn errored/);
});

test("runGatewayCell: fails when spend rode a key other than the actor's virtual key (master-key path)", async () => {
  const ops = greenGatewayOps();
  ops.snapshotSpendRows = async () => [{ api_key: "master-token", spend: 0.0002, total_tokens: 20 }];
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /no token-consuming spend correlated/);
});

test("runGatewayCell: fails when the actor's key AND another key both consumed tokens", async () => {
  const ops = greenGatewayOps();
  ops.snapshotSpendRows = async () => [
    { api_key: "token-abc", spend: 0.0001, total_tokens: 12 },
    { api_key: "master-token", spend: 0.0002, total_tokens: 20 },
  ];
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /rode a key other than the actor's virtual key/);
});

test("runGatewayCell: fails when the gateway does not persist across restart", async () => {
  const ops = greenGatewayOps();
  ops.restartAndReassert = async () => ({ capabilityStillTrue: false, healthy: true });
  const result = await runGatewayCell(fakeWorld(), FAKE_OWNER, GATEWAY_ENV, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not persist across restart/);
});

// ── Pure helper tests ────────────────────────────────────────────────────────

test("correlateGatewaySpend: correlated + master-key-not-used when only the virtual key spent", () => {
  const rows = [{ api_key: "vk", total_tokens: 10 }];
  assert.deepEqual(correlateGatewaySpend(rows, "vk"), { correlated: true, masterKeyNotUsed: true });
});

test("correlateGatewaySpend: not correlated when spend rode another key", () => {
  const rows = [{ api_key: "master", total_tokens: 10 }];
  assert.deepEqual(correlateGatewaySpend(rows, "vk"), { correlated: false, masterKeyNotUsed: false });
});

test("correlateGatewaySpend: correlated but master-key-used when both keys spent", () => {
  const rows = [
    { api_key: "vk", total_tokens: 10 },
    { api_key: "master", total_tokens: 5 },
  ];
  assert.deepEqual(correlateGatewaySpend(rows, "vk"), { correlated: true, masterKeyNotUsed: false });
});

test("correlateGatewaySpend: a zero-token row does not count as spend", () => {
  const rows = [{ api_key: "vk", total_tokens: 0 }];
  assert.deepEqual(correlateGatewaySpend(rows, "vk"), { correlated: false, masterKeyNotUsed: false });
});

test("resolveGatewayConfig: prefers the B upstream key, generates a fresh master key + public /llm url", () => {
  const result = resolveGatewayConfig(
    { get: (name) => (name === "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY" ? "sk-b" : name === "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY" ? "sk-a" : undefined) },
    "https://box.qualification.proliferate.com",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.upstreamKeyEnvVar, "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY");
    assert.equal(result.value.block.upstreamAnthropicKey, "sk-b");
    assert.equal(result.value.block.litellmPublicBaseUrl, "https://box.qualification.proliferate.com/llm");
    assert.match(result.value.block.litellmMasterKey, /^sk-[0-9a-f]{64}$/);
  }
});

test("resolveGatewayConfig: falls back to the A upstream key", () => {
  const result = resolveGatewayConfig(
    { get: (name) => (name === "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY" ? "sk-a" : undefined) },
    "https://box.example.com",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.upstreamKeyEnvVar, "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY");
  }
});

test("resolveGatewayConfig: fails closed with no upstream key", () => {
  const result = resolveGatewayConfig({ get: () => undefined }, "https://box.example.com");
  assert.equal(result.ok, false);
});

test("enrollmentIsSynced: true only for the literal synced status", () => {
  assert.equal(enrollmentIsSynced({ enrollmentStatus: "synced" }), true);
  assert.equal(enrollmentIsSynced({ enrollmentStatus: "pending" }), false);
  assert.equal(enrollmentIsSynced({ enrollmentStatus: "failed" }), false);
  assert.equal(enrollmentIsSynced({}), false);
  assert.equal(enrollmentIsSynced({ enrollmentStatus: null }), false);
});

test("gatewayAuthSelectionBody: a single enabled gateway source, no api_key material", () => {
  assert.deepEqual(gatewayAuthSelectionBody(), {
    sources: [{ sourceKind: "gateway", enabled: true }],
  });
});

test("selectPersonalEnrollmentKeyToken: prefers the personal (vk-user-) alias over a co-located org key", () => {
  const token = selectPersonalEnrollmentKeyToken([
    { token: "org-token", key_alias: "vk-org-org1-user-u1-abcd1234" },
    { token: "personal-token", key_alias: "vk-user-u1-abcd1234" },
  ]);
  assert.equal(token, "personal-token");
});

test("selectPersonalEnrollmentKeyToken: falls back to the first token when no alias is present", () => {
  assert.equal(selectPersonalEnrollmentKeyToken([{ token: "only-token" }]), "only-token");
  assert.equal(
    selectPersonalEnrollmentKeyToken([{ token: "first", key_alias: null }, { token: "second" }]),
    "first",
  );
});

test("selectPersonalEnrollmentKeyToken: undefined when there are no usable tokens", () => {
  assert.equal(selectPersonalEnrollmentKeyToken([]), undefined);
  assert.equal(selectPersonalEnrollmentKeyToken([{ token: "", key_alias: "vk-user-x" }]), undefined);
});

test("classifyGithubInterstitial: the first-authorize grant page is drivable", () => {
  assert.equal(
    classifyGithubInterstitial("https://github.com/login/oauth/authorize?client_id=iv1.abc", "Authorize Proliferate"),
    "authorize",
  );
});

test("classifyGithubInterstitial: leaving github.com (callback or desktop scheme) reads as authorized", () => {
  assert.equal(
    classifyGithubInterstitial("https://selfhost-fixed.qualification.proliferate.com/auth/github/callback?code=x", null),
    "authorized",
  );
  assert.equal(classifyGithubInterstitial("proliferate://auth/callback?code=x&state=y", null), "authorized");
  assert.equal(classifyGithubInterstitial("proliferate-local://auth/callback?code=x", null), "authorized");
});

test("classifyGithubInterstitial: 2FA and device-verification fail closed by name", () => {
  assert.equal(classifyGithubInterstitial("https://github.com/sessions/two-factor/app", null), "two_factor");
  assert.equal(classifyGithubInterstitial("https://github.com/x", "Two-factor authentication"), "two_factor");
  assert.equal(classifyGithubInterstitial("https://github.com/sessions/verified-device", null), "device_verification");
});

test("classifyGithubInterstitial: an unexpected re-login is login_required; unknown otherwise", () => {
  assert.equal(classifyGithubInterstitial("https://github.com/login", null), "login_required");
  assert.equal(classifyGithubInterstitial("https://github.com/dashboard", "Home"), "unknown");
  assert.equal(classifyGithubInterstitial("about:blank", null), "unknown");
});

test("resolveGithubOauthConfig: names every missing var", () => {
  const result = resolveGithubOauthConfig({ get: () => undefined });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID/);
    assert.match(result.reason, /RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL/);
  }
});

test("parseAdvertisedMethods: accepts strings, objects, and a methods envelope", () => {
  assert.deepEqual(parseAdvertisedMethods(["Password", "GitHub"]), ["password", "github"]);
  assert.deepEqual(parseAdvertisedMethods({ methods: [{ id: "github" }, { method: "password" }] }), ["github", "password"]);
  assert.deepEqual(parseAdvertisedMethods([{ type: "GITHUB" }]), ["github"]);
  assert.deepEqual(parseAdvertisedMethods(null), []);
});

// ── Emitted green evidence must pass validateReportV4 ─────────────────────────

function reportWith(cellName: string, evidence: CellEvidenceV1): TestRunReportV4 {
  const dimensions = { cell: cellName, harness: "claude" };
  const cellId = canonicalCellId(SELFHOST_QUAL_1_ID, "selfhost", dimensions);
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<FinalTestStatus, number>;
  byStatus.green = 1;
  const report = {
    schema_version: 4 as const,
    kind: "proliferate.test-run" as const,
    candidate_build: null,
    run: {
      run_id: "run-1",
      shard_id: "shard-1",
      attempt: 1,
      source_sha: "d".repeat(40),
      origin: { kind: "local" as const, github_run_id: null, github_job: null },
      behavior: "diagnostic" as const,
      execution: "real" as const,
      started_at: "2026-07-15T00:00:00Z",
      finished_at: "2026-07-15T00:01:00Z",
    },
    inputs: { target_lane: "staging" as const, desktop: "web" as const, agents: "all" as const, scenarios: "all" as const },
    selected_cells: [
      {
        cell_id: cellId,
        scenario_id: SELFHOST_QUAL_1_ID,
        registry_flow_ref: `specs#${SELFHOST_QUAL_1_ID}`,
        runtime_lane: "selfhost" as const,
        dimensions,
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: cellId,
        scenario_id: SELFHOST_QUAL_1_ID,
        registry_flow_ref: `specs#${SELFHOST_QUAL_1_ID}`,
        runtime_lane: "selfhost" as const,
        dimensions,
        status: "green" as const,
        started_at: "2026-07-15T00:00:01Z",
        finished_at: "2026-07-15T00:00:59Z",
        duration_ms: 58_000,
        reason: null,
        plan_steps: [],
        evidence,
      },
    ],
    summary: {
      selected: 1,
      finalized: 1,
      by_status: byStatus,
      integrity_errors: [],
      runner_errors: [],
      intended_exit_code: 0 as const,
    },
    verdict: { status: "non_qualifying" as const, scope: "selected_cells" as const, completeness: "partial" as const, reasons: [] as string[] },
  };
  report.verdict.reasons = expectedVerdict(report).reasons;
  return report;
}

test("validateReportV4 accepts emitted green SH-GITHUB-AUTH + SH-GATEWAY evidence", () => {
  const github = attachCleanupEvidence(greenEvidenceFor(SH_GITHUB_AUTH), cleanCleanup());
  const gateway = attachCleanupEvidence(greenEvidenceFor(SH_GATEWAY), cleanCleanup());
  validateReportV4(reportWith(SH_GITHUB_AUTH, github));
  validateReportV4(reportWith(SH_GATEWAY, gateway));
});
