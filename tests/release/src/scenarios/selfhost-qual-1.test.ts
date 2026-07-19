import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIXED_SUBDOMAIN_LABEL,
  REPRESENTATIVE_HARNESS,
  SELFHOST_QUAL_1_ID,
  SELFHOST_QUAL_CELL_ORDER,
  SH_CLOUD_ADDON,
  SH_GATEWAY,
  SH_GITHUB_AUTH,
  attachCleanupEvidence,
  describeSelfHostSetupFailure,
  runCloudAddonCell,
  runGatewayCell,
  runGithubAuthCell,
  runSelfHostQualCells,
  type CloudAddonCellOps,
  type CloudAddonProvisionResult,
  type GatewayCellOps,
  type QualCellEvidenceNoCleanup,
  type SelfHostQualCellResult,
  type SelfHostQualDriver,
} from "./selfhost-qual-1.js";
import {
  renderCloudAddonEnvLines,
  resolveCloudAddonConfig,
  stripCloudAddonKeysSedProgram,
  CLOUD_ADDON_ENV_KEYS,
  type CloudAddonEnvSource,
} from "../worlds/selfhost/cloud-addon.js";
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
  GATEWAY_ENV_KEYS,
  QUALIFICATION_GATEWAY_USER_BUDGET_USD,
  renderGatewayEnvLines,
  resolveGatewayConfig,
  selectPersonalEnrollmentKeyToken,
  spendWindowUtc,
  stripGatewayKeysSedProgram,
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
  redactExternalPayloads,
  validateReportV4,
  type CellEvidenceV1,
  type TestRunReportV4,
} from "../evidence/schema.js";

test("self-host setup diagnostics preserve the phase while withholding external payloads", () => {
  const commandError = Object.assign(
    new Error("Command failed: ssh qualification-box sudo install\nsecret remote stderr"),
    { stdout: "secret remote stdout", stderr: "secret remote stderr" },
  );
  const install = redactExternalPayloads(
    describeSelfHostSetupFailure("install", commandError),
  );
  assert.match(install, /phase=install/);
  assert.doesNotMatch(install, /qualification-box|secret remote/);
  assert.match(install, /output withheld from evidence/);

  const claim = redactExternalPayloads(
    describeSelfHostSetupFailure(
      "owner_claim",
      new Error("GET /v1/organizations -> 500: secret response body"),
    ),
  );
  assert.match(claim, /phase=owner_claim/);
  assert.match(claim, /GET \/v1\/organizations -> 500/);
  assert.doesNotMatch(claim, /secret response body/);
  assert.match(claim, /response body withheld from evidence/);
});

// ── Shared fakes ─────────────────────────────────────────────────────────────

const OAUTH_ENV: Record<string, string> = {
  RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID: "iv1.abc",
  RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET: "gh-secret",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE: "/tmp/a.json",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE: "/tmp/b.json",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_EMAIL: "identity-a@example.com",
  RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL: "identity-b@example.com",
};

/** Full add-on env (all six founder inputs present) so resolveCloudAddonConfig succeeds. */
const CLOUD_ADDON_ENV: Record<string, string> = {
  RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY: "e2b-key",
  RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME: "tmpl-selfhost-1",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID: "123456",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID: "Iv1.cloud",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET: "cloud-secret",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----",
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
    RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64: "Y2VydA==",
    RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64: "a2V5",
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
  if (cellName === SH_CLOUD_ADDON) {
    return {
      ...base,
      kind: "selfhost_cloud_addon",
      github_app_installation_id_hash: "6".repeat(64),
      e2b_template_id: "tmpl-selfhost-1",
      sandbox_id_hash: "7".repeat(64),
      workspace_id_hash: "8".repeat(64),
      session_id_hash: "9".repeat(64),
      turn_completed: true,
      pause_wake_state_intact: true,
      disable_truthful: true,
      base_healthy_after_disable: true,
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
    runCloudAddon: () => green(SH_CLOUD_ADDON),
    closeWorld: async () => cleanCleanup(),
  };
}

// ── Orchestration tests (fake driver) ────────────────────────────────────────

test("runSelfHostQualCells: all cells green with a clean teardown", async () => {
  const outcomes = await runSelfHostQualCells(
    fakeCtx({ env: fakeEnv({ ...OAUTH_ENV, ...CLOUD_ADDON_ENV }) }),
    allCells(),
    allGreenDriver(),
  );
  assert.equal(outcomes.length, SELFHOST_QUAL_CELL_ORDER.length);
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
  get: (name) =>
    name === "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY"
      ? "sk-ant-b"
      : name === "RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG"
        ? "v1.2.3-abcdef" // pinned immutable tag (PR7-CONTROL-010)
        : undefined,
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

// ── SH-CLOUD-ADDON cell logic (fake ops) ─────────────────────────────────────

const CLOUD_ADDON_ENV_SOURCE: CloudAddonEnvSource = { get: (name) => CLOUD_ADDON_ENV[name] };

function greenCloudAddonOps(): CloudAddonCellOps {
  let enabled = false;
  return {
    async fetchCloudWorkspacesCapability() {
      return { agentGateway: false, cloudWorkspaces: enabled };
    },
    async configureAndEnableCloudAddon() {
      enabled = true;
    },
    async provisionAndRunTurn(_world, _owner, _config, onSandboxCreated) {
      // A faithful fake announces the sandbox at "create time" via the callback.
      await onSandboxCreated("e2b-sbx-1");
      return {
        githubAppInstallationId: "inst-1",
        e2bTemplateId: "tmpl-selfhost-1",
        sandboxId: "sbx-1",
        workspaceId: "ws-1",
        sessionId: "sess-1",
        providerSandboxId: "e2b-sbx-1",
        turn: { ended: true },
      } satisfies CloudAddonProvisionResult;
    },
    async registerSandboxReap() {
      // no-op in the fake; the real op registers a durable reap
    },
    async pauseWakeStateIntact() {
      return { intact: true };
    },
    async disableAndReassert() {
      enabled = false;
      return { cloudWorkspacesFalse: true, baseHealthy: true };
    },
  };
}

test("runCloudAddonCell: green through enable → provision+turn → pause/wake → truthful disable", async () => {
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, greenCloudAddonOps());
  assert.equal(result.status, "green", JSON.stringify(result));
  assert.equal(result.evidence?.kind, "selfhost_cloud_addon");
  assert.equal((result.evidence as { e2b_template_id: string }).e2b_template_id, "tmpl-selfhost-1");
});

test("runCloudAddonCell: fails when the provisioned template does not match the configured one (PR7-CONTROL-009)", async () => {
  const ops = greenCloudAddonOps();
  const reaped: string[] = [];
  ops.registerSandboxReap = async (_w, id) => void reaped.push(id);
  ops.provisionAndRunTurn = async (_world, _owner, _config, onSandboxCreated) => {
    await onSandboxCreated("e2b-sbx-1");
    return {
      githubAppInstallationId: "inst-1",
      e2bTemplateId: "tmpl-DEFAULT-alias", // a different template than configured (tmpl-selfhost-1)
      sandboxId: "sbx-1",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerSandboxId: "e2b-sbx-1",
      turn: { ended: true },
    };
  };
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /does not match the configured self-built template/);
  // The wrong-template sandbox was still registered for reap (created before the check).
  assert.deepEqual(reaped, ["e2b-sbx-1"]);
});

test("runCloudAddonCell: fails closed when the add-on env is absent", async () => {
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, { get: () => undefined }, greenCloudAddonOps());
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /missing required cloud add-on env/);
  assert.equal(result.evidence, undefined);
});

test("runCloudAddonCell: fails when cloudWorkspaces is already true before enabling (mismatch)", async () => {
  const ops = greenCloudAddonOps();
  ops.fetchCloudWorkspacesCapability = async () => ({ agentGateway: false, cloudWorkspaces: true });
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /already true before/);
});

test("runCloudAddonCell: fails when cloudWorkspaces does not flip to true after enabling", async () => {
  const ops = greenCloudAddonOps();
  ops.fetchCloudWorkspacesCapability = async () => ({ agentGateway: false, cloudWorkspaces: false });
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not flip to true/);
});

test("runCloudAddonCell: fails closed when provisioning/turn errors", async () => {
  const ops = greenCloudAddonOps();
  ops.provisionAndRunTurn = async (_world, _owner, _config, onSandboxCreated) => {
    await onSandboxCreated("e2b-sbx-1");
    return {
      githubAppInstallationId: "",
      e2bTemplateId: "",
      sandboxId: "",
      workspaceId: "",
      sessionId: "",
      providerSandboxId: "e2b-sbx-1",
      turn: { ended: false, error: "authorization drive not wired" },
    };
  };
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /provisioning\/turn errored/);
});

test("runCloudAddonCell: registers the sandbox via onSandboxCreated before judging the turn (turn returns an error)", async () => {
  const reaped: string[] = [];
  const ops = greenCloudAddonOps();
  ops.registerSandboxReap = async (_world, providerSandboxId) => {
    reaped.push(providerSandboxId);
  };
  // The turn fails, but the sandbox was announced at create time — it must be reaped.
  ops.provisionAndRunTurn = async (_world, _owner, _config, onSandboxCreated) => {
    await onSandboxCreated("e2b-sbx-9");
    return {
      githubAppInstallationId: "inst-1",
      e2bTemplateId: "tmpl-selfhost-1",
      sandboxId: "sbx-1",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerSandboxId: "e2b-sbx-9",
      turn: { ended: false, error: "turn timed out" },
    };
  };
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.deepEqual(reaped, ["e2b-sbx-9"]);
});

test("runCloudAddonCell: reaps the sandbox even when provisioning THROWS after announcing it (register-before-create)", async () => {
  const reaped: string[] = [];
  const ops = greenCloudAddonOps();
  ops.registerSandboxReap = async (_world, providerSandboxId) => {
    reaped.push(providerSandboxId);
  };
  // Announce at create time, THEN throw mid-provision (network/turn crash). The
  // cell must have already registered the reap via the callback.
  ops.provisionAndRunTurn = async (_world, _owner, _config, onSandboxCreated) => {
    await onSandboxCreated("e2b-sbx-throw");
    throw new Error("provider connect crashed after sandbox create");
  };
  await assert.rejects(() => runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops));
  assert.deepEqual(reaped, ["e2b-sbx-throw"]);
});

test("runCloudAddonCell: registers each provider sandbox exactly once (idempotent callback + safety net)", async () => {
  const reaped: string[] = [];
  const ops = greenCloudAddonOps();
  ops.registerSandboxReap = async (_world, providerSandboxId) => {
    reaped.push(providerSandboxId);
  };
  // The op announces via the callback AND returns the same id; it must register once.
  ops.provisionAndRunTurn = async (_world, _owner, _config, onSandboxCreated) => {
    await onSandboxCreated("e2b-dup");
    await onSandboxCreated("e2b-dup");
    return {
      githubAppInstallationId: "inst-1",
      e2bTemplateId: "tmpl-selfhost-1",
      sandboxId: "sbx-1",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerSandboxId: "e2b-dup",
      turn: { ended: true },
    };
  };
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "green");
  assert.deepEqual(reaped, ["e2b-dup"]);
});

test("runCloudAddonCell: fails when the sandbox state does not survive pause/wake", async () => {
  const ops = greenCloudAddonOps();
  ops.pauseWakeStateIntact = async () => ({ intact: false });
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /did not survive a pause\/wake/);
});

test("runCloudAddonCell: fails when disabling leaves cloudWorkspaces stale-true (not truthful)", async () => {
  const ops = greenCloudAddonOps();
  ops.disableAndReassert = async () => ({ cloudWorkspacesFalse: false, baseHealthy: true });
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /stale-true|disable not truthful/);
});

test("runCloudAddonCell: fails when the base product is unhealthy after disable", async () => {
  const ops = greenCloudAddonOps();
  ops.disableAndReassert = async () => ({ cloudWorkspacesFalse: true, baseHealthy: false });
  const result = await runCloudAddonCell(fakeWorld(), FAKE_OWNER, CLOUD_ADDON_ENV_SOURCE, ops);
  assert.equal(result.status, "failed");
  assert.match(result.reason?.message ?? "", /base product was not healthy/);
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

test("spendWindowUtc: advances LiteLLM's midnight end bound so same-day rows are included", () => {
  assert.deepEqual(spendWindowUtc(new Date("2026-07-18T23:59:59.000Z")), {
    startDate: "2026-07-18",
    endDate: "2026-07-19",
  });
});

/** A gateway env source with a pinned (immutable) LiteLLM tag + the given extras. */
function gatewayEnvGet(extra: Record<string, string>): (name: string) => string | undefined {
  const base: Record<string, string> = { RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG: "v1.2.3-abcdef", ...extra };
  return (name) => base[name];
}

test("resolveGatewayConfig: uses the required A upstream key, generates a fresh master key + public /llm url", () => {
  const result = resolveGatewayConfig(
    { get: gatewayEnvGet({ RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY: "sk-b", RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY: "sk-a" }) },
    "https://box.qualification.proliferate.com",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.upstreamKeyEnvVar, "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY");
    assert.equal(result.value.block.upstreamAnthropicKey, "sk-a");
    assert.equal(result.value.block.litellmPublicBaseUrl, "https://box.qualification.proliferate.com/llm");
    assert.equal(result.value.block.agentGatewayDefaultUserBudgetUsd, QUALIFICATION_GATEWAY_USER_BUDGET_USD);
    assert.match(result.value.block.litellmMasterKey, /^sk-[0-9a-f]{64}$/);
    assert.equal(result.value.imageTag, "v1.2.3-abcdef");
  }
});

test("resolveGatewayConfig: falls back to the optional B upstream key", () => {
  const result = resolveGatewayConfig(
    { get: gatewayEnvGet({ RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY: "sk-b" }) },
    "https://box.example.com",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.upstreamKeyEnvVar, "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY");
    assert.equal(result.value.block.upstreamAnthropicKey, "sk-b");
  }
});

test("resolveGatewayConfig: fails closed with no upstream key", () => {
  const result = resolveGatewayConfig({ get: gatewayEnvGet({}) }, "https://box.example.com");
  assert.equal(result.ok, false);
});

test("resolveGatewayConfig: fails closed when the LiteLLM image tag is absent (no mutable stable fallback, PR7-CONTROL-010)", () => {
  const result = resolveGatewayConfig(
    { get: (name) => (name === "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY" ? "sk-a" : undefined) },
    "https://box.example.com",
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /must be pinned|LITELLM_IMAGE_TAG is not set/);
  }
});

test("resolveGatewayConfig: fails closed on a mutable rolling tag (stable/latest, PR7-CONTROL-010)", () => {
  for (const rolling of ["stable", "latest", "STABLE"]) {
    const result = resolveGatewayConfig(
      { get: gatewayEnvGet({ RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY: "sk-a", RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG: rolling }) },
      "https://box.example.com",
    );
    assert.equal(result.ok, false, `tag "${rolling}" must fail closed`);
  }
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

test("stripGatewayKeysSedProgram + append overrides a shipped AGENT_GATEWAY_ENABLED=false", () => {
  // proliferate_read_env reads the FIRST KEY= occurrence (grep -m1), so a blind
  // append leaves the shipped `false` winning. Simulate the on-box sed strip +
  // append and assert the resolved (first-occurrence) value is our `true`.
  const shippedStatic = [
    "PROLIFERATE_HOSTNAME=box.example.com",
    "AGENT_GATEWAY_ENABLED=false",
    "SOME_OTHER=keep-me",
    "",
  ].join("\n");
  const block = renderGatewayEnvLines({
    agentGatewayEnabled: true,
    agentGatewayDefaultUserBudgetUsd: QUALIFICATION_GATEWAY_USER_BUDGET_USD,
    litellmMasterKey: "MASTER",
    litellmPostgresPassword: "PGPW",
    litellmPublicBaseUrl: "https://box.example.com/gateway",
    litellmImageTag: "pinned",
    upstreamAnthropicKey: "UPSTREAM",
  });
  // Apply the sed program's `/^KEY=/d` semantics in JS, then append the block.
  const stripped = shippedStatic
    .split("\n")
    .filter((line) => !GATEWAY_ENV_KEYS.some((key) => line.startsWith(`${key}=`)))
    .join("\n");
  const resolved = `${stripped}\n${block}`;
  const firstValue = (key: string): string | undefined => {
    const match = resolved.split("\n").find((line) => line.startsWith(`${key}=`));
    return match?.slice(key.length + 1);
  };
  assert.equal(firstValue("AGENT_GATEWAY_ENABLED"), "true");
  assert.equal(firstValue("AGENT_GATEWAY_DEFAULT_USER_BUDGET_USD"), "10");
  assert.equal(firstValue("LITELLM_MASTER_KEY"), "MASTER");
  assert.equal(firstValue("PROLIFERATE_LITELLM_IMAGE_TAG"), "pinned");
  // Unrelated shipped keys are preserved.
  assert.equal(firstValue("SOME_OTHER"), "keep-me");
  assert.equal(firstValue("PROLIFERATE_HOSTNAME"), "box.example.com");
  // The sed program deletes exactly the gateway keys, anchored to line start.
  const program = stripGatewayKeysSedProgram();
  for (const key of GATEWAY_ENV_KEYS) {
    assert.ok(program.includes(`/^${key}=/d`), `sed program should delete ${key}`);
  }
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

test("resolveCloudAddonConfig: ok with all six inputs; records template + app id receipts", () => {
  const result = resolveCloudAddonConfig(CLOUD_ADDON_ENV_SOURCE, "https://box.qualification.proliferate.com");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.e2bTemplateName, "tmpl-selfhost-1");
    assert.equal(result.value.githubAppId, "123456");
    // Bare origin: the server appends the /auth/github-app/... route itself.
    assert.equal(result.value.block.githubAppCallbackBaseUrl, "https://box.qualification.proliferate.com");
    assert.equal(result.value.block.e2bApiKey, "e2b-key");
  }
});

test("resolveCloudAddonConfig: fails closed naming every missing var", () => {
  const result = resolveCloudAddonConfig({ get: () => undefined }, "https://box.example.com");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY/);
    assert.match(result.reason, /RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY/);
    assert.match(result.reason, /fails closed/);
  }
});

test("resolveCloudAddonConfig: a single missing input still fails closed and names it", () => {
  const partial = { ...CLOUD_ADDON_ENV };
  delete partial.RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME;
  const result = resolveCloudAddonConfig({ get: (name) => partial[name] }, "https://box.example.com");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME/);
  }
});

test("stripCloudAddonKeysSedProgram + append overrides a shipped blank E2B_API_KEY", () => {
  // Same grep -m1 first-occurrence gotcha as the gateway block: strip then append.
  const shippedStatic = ["PROLIFERATE_HOSTNAME=box.example.com", "E2B_API_KEY=", "KEEP=me", ""].join("\n");
  const block = renderCloudAddonEnvLines({
    e2bApiKey: "REAL-E2B",
    e2bTemplateName: "tmpl-x",
    githubAppId: "999",
    githubAppClientId: "Iv1.x",
    githubAppClientSecret: "SECRET",
    githubAppPrivateKey: "-----BEGIN-----\npem\n-----END-----",
    githubAppCallbackBaseUrl: "https://box.example.com/auth/",
  });
  const stripped = shippedStatic
    .split("\n")
    .filter((line) => !CLOUD_ADDON_ENV_KEYS.some((key) => line.startsWith(`${key}=`)))
    .join("\n");
  const resolved = `${stripped}\n${block}`;
  const firstValue = (key: string): string | undefined =>
    resolved.split("\n").find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  assert.equal(firstValue("E2B_API_KEY"), "REAL-E2B");
  assert.equal(firstValue("E2B_TEMPLATE_NAME"), "tmpl-x");
  assert.equal(firstValue("KEEP"), "me");
  assert.equal(firstValue("PROLIFERATE_HOSTNAME"), "box.example.com");
  const program = stripCloudAddonKeysSedProgram();
  for (const key of CLOUD_ADDON_ENV_KEYS) {
    assert.ok(program.includes(`/^${key}=/d`), `sed program should delete ${key}`);
  }
});

test("renderCloudAddonEnvLines: escapes the PEM to a single \\n-escaped line (server unescapes with replace)", () => {
  const lines = renderCloudAddonEnvLines({
    e2bApiKey: "k",
    e2bTemplateName: "t",
    githubAppId: "1",
    githubAppClientId: "c",
    githubAppClientSecret: "s",
    githubAppPrivateKey: "-----BEGIN-----\nmid\n-----END-----",
    githubAppCallbackBaseUrl: "https://b",
  });
  // One line, literal \n escapes, no surrounding quotes (server does inline.replace("\\n","\n")).
  assert.match(lines, /^GITHUB_APP_PRIVATE_KEY=-----BEGIN-----\\nmid\\n-----END-----$/m);
  // The PEM must NOT introduce a real newline into .env.static (would orphan lines the sed strip can't remove).
  const pemLine = lines.split("\n").find((l) => l.startsWith("GITHUB_APP_PRIVATE_KEY="));
  assert.ok(pemLine && !pemLine.includes("\n"));
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

test("validateReportV4 accepts emitted green SH-GITHUB-AUTH + SH-GATEWAY + SH-CLOUD-ADDON evidence", () => {
  const github = attachCleanupEvidence(greenEvidenceFor(SH_GITHUB_AUTH), cleanCleanup());
  const gateway = attachCleanupEvidence(greenEvidenceFor(SH_GATEWAY), cleanCleanup());
  const cloudAddon = attachCleanupEvidence(greenEvidenceFor(SH_CLOUD_ADDON), cleanCleanup());
  validateReportV4(reportWith(SH_GITHUB_AUTH, github));
  validateReportV4(reportWith(SH_GATEWAY, gateway));
  validateReportV4(reportWith(SH_CLOUD_ADDON, cloudAddon));
});
