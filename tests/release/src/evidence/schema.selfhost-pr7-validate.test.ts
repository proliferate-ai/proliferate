// Unit coverage for the five PR 7 self-host evidence kinds (GitHub auth,
// dual-server switch isolation, gateway capability, cloud add-on, and the
// CloudFormation-wrapper posture) — validateSelfHostCellEvidence's extended
// dispatch plus the standalone validateSelfHostCfnWrapperEvidence. Exercises
// each validator through the public `validateReportV4` entry point (the
// kind-scoped dispatch it lives behind), mirroring
// schema.tier2-validate.test.ts's self-contained report-scaffolding
// convention so this file stays independently ownable/reviewable. Does not
// touch the PR 3 kinds' own tests (write.test.ts).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  expectedVerdict,
  SELFHOST_INSTALL_1_SCENARIO_ID,
  validateReportV4,
  type CellEvidenceV1,
  type SelfHostCfnWrapperEvidenceV1,
  type SelfHostCloudAddonEvidenceV1,
  type SelfHostGatewayEvidenceV1,
  type SelfHostGithubAuthEvidenceV1,
  type SelfHostSwitchIsolationEvidenceV1,
  type TestRunReportV3,
  type TestRunReportV4,
} from "./schema.js";
import { canonicalCellId } from "../runner/plan.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus } from "../runner/result.js";

const SERVER_A_ORIGIN = "sh-run-a.qualification.proliferate.com";

function selfHostCleanup(overrides: Partial<SelfHostGithubAuthEvidenceV1["cleanup"]> = {}) {
  return {
    ledger_id_hash: "9".repeat(64),
    registered: 4,
    reconciled: 4,
    failed: 0,
    ec2_terminated: true,
    security_group_deleted: true,
    key_pair_deleted: true,
    route53_record_deleted: true,
    browser_closed: true,
    processes_stopped: true,
    local_paths_removed: true,
    ...overrides,
  };
}

function githubAuthEvidence(overrides: Partial<SelfHostGithubAuthEvidenceV1> = {}): SelfHostGithubAuthEvidenceV1 {
  return {
    kind: "selfhost_github_auth",
    artifact_ids: ["server/linux-amd64"],
    server_version: "0.3.29",
    anyharness_version: "0.3.29",
    harness: "claude",
    api_origin: "sh-run-1.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:8542",
    owner_user_id_hash: "a".repeat(64),
    org_id_hash: "b".repeat(64),
    github_identity_a_hash: "c".repeat(64),
    github_identity_b_hash: "d".repeat(64),
    setup_password_only: true,
    owner_link_no_duplicate: true,
    uninvited_denied: true,
    invited_admitted: true,
    member_role: "member",
    methods_advertise_github: true,
    cleanup: selfHostCleanup(),
    ...overrides,
  };
}

function switchIsolationEvidence(
  overrides: Partial<SelfHostSwitchIsolationEvidenceV1> = {},
): SelfHostSwitchIsolationEvidenceV1 {
  return {
    kind: "selfhost_switch_isolation",
    artifact_ids: ["server/linux-amd64"],
    server_version: "0.3.29",
    anyharness_version: "0.3.29",
    harness: "claude",
    api_origin: SERVER_A_ORIGIN,
    controller_runtime_origin: "127.0.0.1:8542",
    server_a_origin: SERVER_A_ORIGIN,
    server_b_origin: "sh-run-b.qualification.proliferate.com",
    no_cross_origin_token: true,
    no_cross_origin_pending_auth: true,
    no_cross_origin_credential: true,
    no_cross_origin_runtime_identity: true,
    no_cross_origin_workspace_session: true,
    b_started_anonymous: true,
    b_authenticated_independently: true,
    a_state_restored_origin_scoped: true,
    cleanup: selfHostCleanup(),
    ...overrides,
  };
}

function gatewayEvidence(overrides: Partial<SelfHostGatewayEvidenceV1> = {}): SelfHostGatewayEvidenceV1 {
  return {
    kind: "selfhost_gateway",
    artifact_ids: ["server/linux-amd64"],
    server_version: "0.3.29",
    anyharness_version: "0.3.29",
    harness: "claude",
    api_origin: "sh-run-1.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:8542",
    actor_user_id_hash: "a".repeat(64),
    virtual_key_id_hash: "b".repeat(64),
    litellm_image_digest: "sha256:" + "c".repeat(64),
    model_id: "claude-haiku-4-5",
    capability_gateway_before: false,
    capability_gateway_after: true,
    gateway_spend_correlated: true,
    master_key_not_used: true,
    restart_persisted: true,
    cleanup: selfHostCleanup(),
    ...overrides,
  };
}

function cloudAddonEvidence(overrides: Partial<SelfHostCloudAddonEvidenceV1> = {}): SelfHostCloudAddonEvidenceV1 {
  return {
    kind: "selfhost_cloud_addon",
    artifact_ids: ["server/linux-amd64"],
    server_version: "0.3.29",
    anyharness_version: "0.3.29",
    harness: "claude",
    api_origin: "sh-run-1.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:8542",
    github_app_installation_id_hash: "a".repeat(64),
    e2b_template_id: "tmpl-abc123",
    sandbox_id_hash: "b".repeat(64),
    workspace_id_hash: "c".repeat(64),
    session_id_hash: "d".repeat(64),
    turn_completed: true,
    pause_wake_state_intact: true,
    disable_truthful: true,
    base_healthy_after_disable: true,
    cleanup: selfHostCleanup(),
    ...overrides,
  };
}

function cfnWrapperEvidence(overrides: Partial<SelfHostCfnWrapperEvidenceV1> = {}): SelfHostCfnWrapperEvidenceV1 {
  return {
    kind: "selfhost_cfn_wrapper",
    artifact_ids: ["selfhost-cfn-template/aws"],
    server_version: "0.3.29",
    api_origin: "sh-cfn-1.qualification.proliferate.com",
    stack_name_hash: "a".repeat(64),
    image_repo_digest: "sha256:" + "e".repeat(64),
    release_version_tag: "run-1-shard-1",
    template_sha256: "f".repeat(64),
    template_validated: true,
    bundle_digest_bound: true,
    image_digest_bound: true,
    outputs_valid: true,
    dns_tls_verified: true,
    meta_version_matches: true,
    cleanup: {
      ledger_id_hash: "b".repeat(64),
      registered: 5,
      reconciled: 5,
      failed: 0,
      stack_deleted: true,
      s3_objects_deleted: true,
      ghcr_version_deleted: true,
      route53_record_deleted: true,
      local_paths_removed: true,
    },
    ...overrides,
  };
}

/** The owning scenario id for a PR 7 self-host cell dimension (PR7-CONTROL-007). */
function scenarioForCell(cell: string | undefined): string {
  switch (cell) {
    case "SH-INSTALL-CLAIM":
    case "SH-DESKTOP-OWNER":
    case "SH-BASE-TURN":
    case "SH-INVITEE":
      return SELFHOST_INSTALL_1_SCENARIO_ID;
    case "SH-GITHUB-AUTH":
    case "SH-GATEWAY":
    case "SH-CLOUD-ADDON":
      return "SELFHOST-QUAL-1";
    case "SH-SWITCH-ISOLATION":
      return "SELFHOST-ISOLATION-1";
    case "SH-CFN-WRAPPER":
      return "SELFHOST-CFN-1";
    default:
      return SELFHOST_INSTALL_1_SCENARIO_ID;
  }
}

function baseReportV3(dimensions: Record<string, string>): TestRunReportV3 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.green = 1;
  // Bind each cell to its REAL owning scenario (PR7-CONTROL-007): the per-cell
  // evidence-kind binding is keyed on (scenario_id, cell), so a report that
  // filed SH-GATEWAY/SH-CLOUD-ADDON/SH-SWITCH-ISOLATION/SH-CFN-WRAPPER evidence
  // under SELFHOST-INSTALL-1 (as this helper used to) never exercised the
  // binding. Derive the owning scenario from the cell dimension.
  const scenarioId = scenarioForCell(dimensions.cell);
  const cellId = canonicalCellId(scenarioId, "selfhost", dimensions);
  const report: TestRunReportV3 = {
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
      started_at: "2026-07-13T00:00:00Z",
      finished_at: "2026-07-13T00:01:00Z",
    },
    inputs: { target_lane: "staging", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: cellId,
        scenario_id: scenarioId,
        registry_flow_ref: `specs#${scenarioId}`,
        runtime_lane: "selfhost",
        dimensions,
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: cellId,
        scenario_id: scenarioId,
        registry_flow_ref: `specs#${scenarioId}`,
        runtime_lane: "selfhost",
        dimensions,
        status: "green",
        started_at: "2026-07-13T00:00:01Z",
        finished_at: "2026-07-13T00:00:59Z",
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
  report.verdict.reasons = expectedVerdict(report).reasons;
  return report;
}

function reportV4With(dimensions: Record<string, string>, evidence: CellEvidenceV1 | null): TestRunReportV4 {
  const v3 = baseReportV3(dimensions);
  return { ...v3, schema_version: 4, results: v3.results.map((result) => ({ ...result, evidence })) };
}

/** Force a specific (scenario_id, cell) pairing to exercise the cross-cell binding. */
function reportV4Forcing(
  scenarioId: string,
  dimensions: Record<string, string>,
  evidence: CellEvidenceV1,
): TestRunReportV4 {
  const v3 = baseReportV3(dimensions);
  const cellId = canonicalCellId(scenarioId, "selfhost", dimensions);
  const patch = <T extends { scenario_id: string; registry_flow_ref: string; cell_id: string }>(row: T): T => ({
    ...row,
    scenario_id: scenarioId,
    registry_flow_ref: `specs#${scenarioId}`,
    cell_id: cellId,
  });
  return {
    ...v3,
    schema_version: 4,
    selected_cells: v3.selected_cells.map(patch),
    results: v3.results.map((result) => ({ ...patch(result), evidence })),
  };
}

// ── (scenario_id, cell) → kind binding (PR7-CONTROL-007) ─────────────────────

test("validateReportV4 rejects a SELFHOST-QUAL-1 SH-GATEWAY cell carrying SH-CLOUD-ADDON evidence", () => {
  // Structurally-valid cloud-addon evidence must not validate under the gateway cell.
  assert.throws(
    () => validateReportV4(reportV4Forcing("SELFHOST-QUAL-1", { cell: "SH-GATEWAY", harness: "claude" }, cloudAddonEvidence())),
    /requires "selfhost_gateway"/,
  );
});

test("validateReportV4 rejects a SELFHOST-CFN-1 cell carrying isolation evidence (single-kind binding)", () => {
  assert.throws(
    () =>
      validateReportV4(
        reportV4Forcing("SELFHOST-CFN-1", { cell: "SH-CFN-WRAPPER", harness: "claude" }, switchIsolationEvidence()),
      ),
    /requires "selfhost_cfn_wrapper"/,
  );
});

test("validateReportV4 rejects a green SELFHOST-CFN-1 cell with NULL evidence (green-requires-evidence)", () => {
  assert.throws(
    () => validateReportV4(reportV4With({ cell: "SH-CFN-WRAPPER", harness: "claude" }, null)),
    /requires complete evidence/,
  );
});

test("validateReportV4 rejects a green SELFHOST-ISOLATION-1 cell with NULL evidence (green-requires-evidence)", () => {
  assert.throws(
    () => validateReportV4(reportV4With({ cell: "SH-SWITCH-ISOLATION", harness: "claude" }, null)),
    /requires complete evidence/,
  );
});

// ── selfhost_github_auth ────────────────────────────────────────────────────

const GITHUB_AUTH_DIMS = { cell: "SH-GITHUB-AUTH", harness: "claude" };

test("validateReportV4 accepts a green cell with complete selfhost_github_auth evidence", () => {
  validateReportV4(reportV4With(GITHUB_AUTH_DIMS, githubAuthEvidence()));
});

test("validateReportV4 rejects selfhost_github_auth evidence missing a required key", () => {
  const { member_role: _drop, ...incomplete } = githubAuthEvidence();
  assert.throws(
    () => validateReportV4(reportV4With(GITHUB_AUTH_DIMS, incomplete as unknown as CellEvidenceV1)),
    /undeclared or missing field/,
  );
});

test("validateReportV4 rejects selfhost_github_auth evidence with an undeclared extra field", () => {
  const dirty = { ...githubAuthEvidence(), extra_field: "x" } as unknown as CellEvidenceV1;
  assert.throws(() => validateReportV4(reportV4With(GITHUB_AUTH_DIMS, dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects a false literal-true field on selfhost_github_auth evidence", () => {
  const dirty = githubAuthEvidence({ setup_password_only: false as unknown as true });
  assert.throws(() => validateReportV4(reportV4With(GITHUB_AUTH_DIMS, dirty)), /setup_password_only must be true/);
});

test("validateReportV4 rejects a green selfhost_github_auth cell whose cleanup has a false deletion flag", () => {
  const dirty = githubAuthEvidence({ cleanup: selfHostCleanup({ ec2_terminated: false }) });
  assert.throws(() => validateReportV4(reportV4With(GITHUB_AUTH_DIMS, dirty)), /incomplete on a green result/);
});

// ── selfhost_switch_isolation ───────────────────────────────────────────────

const SWITCH_ISOLATION_DIMS = { cell: "SH-SWITCH-ISOLATION", harness: "claude" };

test("validateReportV4 accepts a green cell with complete selfhost_switch_isolation evidence", () => {
  validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, switchIsolationEvidence()));
});

test("validateReportV4 rejects selfhost_switch_isolation evidence missing a required key", () => {
  const { server_b_origin: _drop, ...incomplete } = switchIsolationEvidence();
  assert.throws(
    () => validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, incomplete as unknown as CellEvidenceV1)),
    /undeclared or missing field/,
  );
});

test("validateReportV4 rejects selfhost_switch_isolation evidence with an undeclared extra field", () => {
  const dirty = { ...switchIsolationEvidence(), extra_field: "x" } as unknown as CellEvidenceV1;
  assert.throws(() => validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects a false literal-true field on selfhost_switch_isolation evidence", () => {
  const dirty = switchIsolationEvidence({ b_started_anonymous: false as unknown as true });
  assert.throws(() => validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, dirty)), /b_started_anonymous must be true/);
});

test("validateReportV4 rejects a green selfhost_switch_isolation cell whose cleanup has a false deletion flag", () => {
  const dirty = switchIsolationEvidence({ cleanup: selfHostCleanup({ route53_record_deleted: false }) });
  assert.throws(() => validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, dirty)), /incomplete on a green result/);
});

test("validateReportV4 rejects selfhost_switch_isolation evidence whose api_origin disagrees with server_a_origin", () => {
  const dirty = switchIsolationEvidence({ api_origin: "sh-run-other.qualification.proliferate.com" });
  assert.throws(() => validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, dirty)), /must equal server_a_origin/);
});

test("validateReportV4 rejects selfhost_switch_isolation evidence whose server_a_origin equals server_b_origin", () => {
  const dirty = switchIsolationEvidence({ server_b_origin: SERVER_A_ORIGIN, api_origin: SERVER_A_ORIGIN });
  assert.throws(() => validateReportV4(reportV4With(SWITCH_ISOLATION_DIMS, dirty)), /must be distinct/);
});

// ── selfhost_gateway ─────────────────────────────────────────────────────────

const GATEWAY_DIMS = { cell: "SH-GATEWAY", harness: "claude" };

test("validateReportV4 accepts a green cell with complete selfhost_gateway evidence", () => {
  validateReportV4(reportV4With(GATEWAY_DIMS, gatewayEvidence()));
});

test("validateReportV4 rejects selfhost_gateway evidence missing a required key", () => {
  const { model_id: _drop, ...incomplete } = gatewayEvidence();
  assert.throws(
    () => validateReportV4(reportV4With(GATEWAY_DIMS, incomplete as unknown as CellEvidenceV1)),
    /undeclared or missing field/,
  );
});

test("validateReportV4 rejects selfhost_gateway evidence with an undeclared extra field", () => {
  const dirty = { ...gatewayEvidence(), extra_field: "x" } as unknown as CellEvidenceV1;
  assert.throws(() => validateReportV4(reportV4With(GATEWAY_DIMS, dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects a false literal-true field on selfhost_gateway evidence", () => {
  const dirty = gatewayEvidence({ master_key_not_used: false as unknown as true });
  assert.throws(() => validateReportV4(reportV4With(GATEWAY_DIMS, dirty)), /master_key_not_used must be true/);
});

test("validateReportV4 rejects selfhost_gateway evidence whose capability_gateway_before is not literal false", () => {
  const dirty = gatewayEvidence({ capability_gateway_before: true as unknown as false });
  assert.throws(() => validateReportV4(reportV4With(GATEWAY_DIMS, dirty)), /capability_gateway_before must be false/);
});

test("validateReportV4 rejects a green selfhost_gateway cell whose cleanup has a false deletion flag", () => {
  const dirty = gatewayEvidence({ cleanup: selfHostCleanup({ security_group_deleted: false }) });
  assert.throws(() => validateReportV4(reportV4With(GATEWAY_DIMS, dirty)), /incomplete on a green result/);
});

// ── selfhost_cloud_addon ─────────────────────────────────────────────────────

const CLOUD_ADDON_DIMS = { cell: "SH-CLOUD-ADDON", harness: "claude" };

test("validateReportV4 accepts a green cell with complete selfhost_cloud_addon evidence", () => {
  validateReportV4(reportV4With(CLOUD_ADDON_DIMS, cloudAddonEvidence()));
});

test("validateReportV4 rejects selfhost_cloud_addon evidence missing a required key", () => {
  const { e2b_template_id: _drop, ...incomplete } = cloudAddonEvidence();
  assert.throws(
    () => validateReportV4(reportV4With(CLOUD_ADDON_DIMS, incomplete as unknown as CellEvidenceV1)),
    /undeclared or missing field/,
  );
});

test("validateReportV4 rejects selfhost_cloud_addon evidence with an undeclared extra field", () => {
  const dirty = { ...cloudAddonEvidence(), extra_field: "x" } as unknown as CellEvidenceV1;
  assert.throws(() => validateReportV4(reportV4With(CLOUD_ADDON_DIMS, dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects a false literal-true field on selfhost_cloud_addon evidence", () => {
  const dirty = cloudAddonEvidence({ base_healthy_after_disable: false as unknown as true });
  assert.throws(
    () => validateReportV4(reportV4With(CLOUD_ADDON_DIMS, dirty)),
    /base_healthy_after_disable must be true/,
  );
});

test("validateReportV4 rejects a green selfhost_cloud_addon cell whose cleanup has a false deletion flag", () => {
  const dirty = cloudAddonEvidence({ cleanup: selfHostCleanup({ key_pair_deleted: false }) });
  assert.throws(() => validateReportV4(reportV4With(CLOUD_ADDON_DIMS, dirty)), /incomplete on a green result/);
});

// ── selfhost_cfn_wrapper ─────────────────────────────────────────────────────

const CFN_WRAPPER_DIMS = { cell: "SH-CFN-WRAPPER", harness: "claude" };

test("validateReportV4 accepts a green cell with complete selfhost_cfn_wrapper evidence", () => {
  validateReportV4(reportV4With(CFN_WRAPPER_DIMS, cfnWrapperEvidence()));
});

test("validateReportV4 rejects selfhost_cfn_wrapper evidence missing a required key", () => {
  const { dns_tls_verified: _drop, ...incomplete } = cfnWrapperEvidence();
  assert.throws(
    () => validateReportV4(reportV4With(CFN_WRAPPER_DIMS, incomplete as unknown as CellEvidenceV1)),
    /undeclared or missing field/,
  );
});

test("validateReportV4 rejects selfhost_cfn_wrapper evidence with an undeclared extra field", () => {
  const dirty = { ...cfnWrapperEvidence(), extra_field: "x" } as unknown as CellEvidenceV1;
  assert.throws(() => validateReportV4(reportV4With(CFN_WRAPPER_DIMS, dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects a false literal-true field on selfhost_cfn_wrapper evidence", () => {
  const dirty = cfnWrapperEvidence({ template_validated: false as unknown as true });
  assert.throws(() => validateReportV4(reportV4With(CFN_WRAPPER_DIMS, dirty)), /template_validated must be true/);
});

test("validateReportV4 rejects a green selfhost_cfn_wrapper cell whose cleanup has a false deletion flag", () => {
  const dirty = cfnWrapperEvidence({
    cleanup: { ...cfnWrapperEvidence().cleanup, ghcr_version_deleted: false },
  });
  assert.throws(() => validateReportV4(reportV4With(CFN_WRAPPER_DIMS, dirty)), /incomplete on a green result/);
});

test("validateReportV4 rejects a green selfhost_cfn_wrapper cell whose cleanup recorded a failure", () => {
  const dirty = cfnWrapperEvidence({ cleanup: { ...cfnWrapperEvidence().cleanup, failed: 1 } });
  assert.throws(() => validateReportV4(reportV4With(CFN_WRAPPER_DIMS, dirty)), /cleanup.failed must be 0/);
});

test("validateReportV4 rejects selfhost_cfn_wrapper evidence with an undeclared cleanup field", () => {
  const dirty = {
    ...cfnWrapperEvidence(),
    cleanup: { ...cfnWrapperEvidence().cleanup, extra: "x" },
  } as unknown as CellEvidenceV1;
  assert.throws(() => validateReportV4(reportV4With(CFN_WRAPPER_DIMS, dirty)), /cleanup has undeclared/);
});

test("validateReportV4 rejects a green cell with null evidence across all five PR 7 kinds' dimensions", () => {
  for (const dims of [
    GITHUB_AUTH_DIMS,
    SWITCH_ISOLATION_DIMS,
    GATEWAY_DIMS,
    CLOUD_ADDON_DIMS,
    CFN_WRAPPER_DIMS,
  ]) {
    assert.throws(() => validateReportV4(reportV4With(dims, null)), /requires complete evidence/);
  }
});
