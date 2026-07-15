// Sanitizer coverage for the five PR 7 self-host evidence kinds (GitHub auth,
// dual-server switch isolation, gateway capability, cloud add-on, and the
// CloudFormation-wrapper posture) — the extended sanitizeSelfHostCellEvidence
// dispatch inside sanitizeCellEvidence. Mirrors
// schema.tier2-sanitize.test.ts's structure so this file stays independently
// ownable/reviewable. Does not touch the PR 3 kinds' own tests
// (write.test.ts).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeCellEvidence,
  type SelfHostCfnWrapperEvidenceV1,
  type SelfHostCloudAddonEvidenceV1,
  type SelfHostGatewayEvidenceV1,
  type SelfHostGithubAuthEvidenceV1,
  type SelfHostSwitchIsolationEvidenceV1,
} from "./schema.js";

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
  const serverAOrigin = "sh-run-a.qualification.proliferate.com";
  return {
    kind: "selfhost_switch_isolation",
    artifact_ids: ["server/linux-amd64"],
    server_version: "0.3.29",
    anyharness_version: "0.3.29",
    harness: "claude",
    api_origin: serverAOrigin,
    controller_runtime_origin: "127.0.0.1:8542",
    server_a_origin: serverAOrigin,
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

test("sanitizeCellEvidence redacts a planted secret in selfhost_github_auth evidence", () => {
  const secret = "gh_pat_supersecret";
  const dirty = githubAuthEvidence({ member_role: `member-${secret}` });
  const clean = sanitizeCellEvidence(dirty, [secret]) as SelfHostGithubAuthEvidenceV1;
  assert.equal(clean.kind, "selfhost_github_auth");
  assert.ok(clean.member_role.includes("[REDACTED]"));
  assert.ok(!clean.member_role.includes(secret));
});

test("sanitizeCellEvidence redacts a planted secret in selfhost_switch_isolation evidence", () => {
  const secret = "session-secret-xyz";
  const dirty = switchIsolationEvidence({ server_b_origin: `sh-run-b-${secret}.qualification.proliferate.com` });
  const clean = sanitizeCellEvidence(dirty, [secret]) as SelfHostSwitchIsolationEvidenceV1;
  assert.equal(clean.kind, "selfhost_switch_isolation");
  assert.ok(clean.server_b_origin.includes("[REDACTED]"));
  assert.ok(!clean.server_b_origin.includes(secret));
});

test("sanitizeCellEvidence redacts a planted secret in selfhost_gateway evidence", () => {
  const secret = "sk-litellm-live-secret";
  const dirty = gatewayEvidence({ litellm_image_digest: `sha256:leaked-${secret}` });
  const clean = sanitizeCellEvidence(dirty, [secret]) as SelfHostGatewayEvidenceV1;
  assert.equal(clean.kind, "selfhost_gateway");
  assert.ok(clean.litellm_image_digest.includes("[REDACTED]"));
  assert.ok(!clean.litellm_image_digest.includes(secret));
});

test("sanitizeCellEvidence redacts a planted secret in selfhost_cloud_addon evidence", () => {
  const secret = "e2b_secret_token";
  const dirty = cloudAddonEvidence({ e2b_template_id: `tmpl-${secret}` });
  const clean = sanitizeCellEvidence(dirty, [secret]) as SelfHostCloudAddonEvidenceV1;
  assert.equal(clean.kind, "selfhost_cloud_addon");
  assert.ok(clean.e2b_template_id.includes("[REDACTED]"));
  assert.ok(!clean.e2b_template_id.includes(secret));
});

test("sanitizeCellEvidence redacts a planted secret in selfhost_cfn_wrapper evidence (no base shape)", () => {
  const secret = "cfn-leaked-secret";
  const dirty = cfnWrapperEvidence({ api_origin: `sh-cfn-1-${secret}.qualification.proliferate.com` });
  const clean = sanitizeCellEvidence(dirty, [secret]) as SelfHostCfnWrapperEvidenceV1;
  assert.equal(clean.kind, "selfhost_cfn_wrapper");
  assert.ok(clean.api_origin.includes("[REDACTED]"));
  assert.ok(!clean.api_origin.includes(secret));
  // Numeric/boolean cleanup fields pass through untouched.
  assert.equal(clean.cleanup.registered, 5);
  assert.equal(clean.cleanup.stack_deleted, true);
});

test("sanitizeCellEvidence leaves clean self-host evidence byte-for-byte identical with no secrets", () => {
  assert.deepEqual(sanitizeCellEvidence(githubAuthEvidence(), []), githubAuthEvidence());
  assert.deepEqual(sanitizeCellEvidence(switchIsolationEvidence(), []), switchIsolationEvidence());
  assert.deepEqual(sanitizeCellEvidence(gatewayEvidence(), []), gatewayEvidence());
  assert.deepEqual(sanitizeCellEvidence(cloudAddonEvidence(), []), cloudAddonEvidence());
  assert.deepEqual(sanitizeCellEvidence(cfnWrapperEvidence(), []), cfnWrapperEvidence());
});
