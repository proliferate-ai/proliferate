import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";
import type { CandidateBuildEvidenceV1 } from "../artifacts/build-map.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import { canonicalCellId, dimensionShapeProblem } from "../runner/plan.js";
import {
  ALL_FINAL_STATUSES,
  deriveVerdict,
  type FinalCellResultV1,
  type FinalTestStatus,
  type IntegrityErrorV1,
  type PlannedCellV1,
  type ResultBehavior,
  type RunnerErrorV1,
  type VerdictStatus,
} from "../runner/result.js";

/**
 * The versioned combined-report contract, per
 * specs/developing/testing/qualification-runner-core.md ("Combined report"),
 * specs/developing/testing/candidate-build-handoff.md (candidate-artifact
 * evidence), and specs/developing/testing/exact-test-matrix.md ("Combined
 * report V3"), which changes the semantic result unit to an exact test cell.
 * One artifact per invocation/shard/attempt; validated before writing. V1 and
 * V2 are prior contracts recorded in repository history; current code emits
 * only V3.
 */
export interface TestRunReportV3 {
  schema_version: 3;
  kind: "proliferate.test-run";
  /**
   * Artifact ID/version/SHA-256 from the validated candidate build map, or
   * an explicit null when a diagnostic run omitted the map. Never map paths,
   * local paths, raw map JSON, credentials, or command/provider output.
   */
  candidate_build: CandidateBuildEvidenceV1 | null;
  run: RunIdentityV1 & {
    behavior: ResultBehavior;
    execution: "real" | "dry_run";
    started_at: string;
    finished_at: string;
  };
  inputs: {
    target_lane: TargetLane;
    desktop: DesktopMode;
    agents: string[] | "all";
    scenarios: string[] | "all";
  };
  selected_cells: PlannedCellV1[];
  results: FinalCellResultV1[];
  summary: {
    selected: number;
    finalized: number;
    by_status: Record<FinalTestStatus, number>;
    integrity_errors: IntegrityErrorV1[];
    runner_errors: RunnerErrorV1[];
    intended_exit_code: 0 | 1 | 2;
  };
  verdict: {
    status: VerdictStatus;
    scope: "selected_cells";
    completeness: "partial";
    reasons: string[];
  };
}

/**
 * ── Report V4 type DELTA (spec "Aggregate evidence") ──────────────────────
 *
 * Report V3 cannot attach proof to a green result. LOCAL-WORLD-SMOKE-1 is the
 * first consumer that justifies V4. V4 keeps every V3 plan/result/verdict
 * semantic and adds ONE bounded optional evidence field to each result.
 *
 * Only the TYPES live here (added by the contracts stage). The V4 validator
 * (`validateReportV4`) and writer changes are owned by the evidence workstream;
 * this stage does not implement them. Required validator behavior, verbatim, is
 * in BRIEF.md "Evidence workstream" — summarized:
 *   - accept `schema_version: 4`, `kind: "proliferate.test-run"`;
 *   - reuse every V3 invariant (identity/dimension/verdict recomputation);
 *   - each result carries `evidence: CellEvidenceV1 | null`; existing cells
 *     emit `null` and keep V3 semantics;
 *   - a GREEN `LOCAL-WORLD-SMOKE-1/*` result with absent/incomplete evidence is
 *     REJECTED;
 *   - reject unknown evidence `kind`, extra fields, unsafe strings (must pass
 *     the same safe-string checks as identity fields), invalid/negative counts,
 *     internally inconsistent token math (prompt+completion === total, all > 0),
 *     non-positive spend, or — on a GREEN cell only — a `cleanup` block with
 *     `failed > 0` or any deletion boolean false (a non-green cell may retain
 *     evidence recording its own cleanup failure).
 */

/**
 * One result's optional bounded evidence. Append-only union (see "Parallel
 * Tracks - Extension Contract"): each track adds exactly its own kind(s).
 * `local_workspace_turn` is the Tier-3 local-world proof (its `harness` widens
 * to the closed shipped harness-kind set); the four `local_*` variants (PR 5f,
 * audit ruling #3) cover the functional local journeys; `tier2_billing` (PR 4)
 * binds, per Tier-2 cell, the asserted ruled policy values, safe Stripe
 * object/test-clock ids, and ledger deltas; PR 3 adds the four self-host
 * journey-cell kinds; PR 2 adds `cloud_provision_turn` for the managed-cloud
 * world. Each kind is validated by its own kind-scoped function; a kind never
 * touches another kind's validation (extension-contract rule).
 * Green-requires-complete-clean-evidence is preserved for every kind that
 * demands it.
 */
export type CellEvidenceV1 =
  | LocalWorkspaceTurnEvidenceV1
  | LocalRouteTurnEvidenceV1
  | LocalConfigMatrixEvidenceV1
  | LocalSessionTabsEvidenceV1
  | LocalMcpIntegrationEvidenceV1
  | Tier2BillingEvidenceV1
  | SelfHostInstallClaimEvidenceV1
  | SelfHostDesktopOwnerEvidenceV1
  | SelfHostBaseTurnEvidenceV1
  | SelfHostInviteeEvidenceV1
  | CloudProvisionTurnEvidenceV1
  | SelfHostGithubAuthEvidenceV1
  | SelfHostSwitchIsolationEvidenceV1
  | SelfHostGatewayEvidenceV1
  | SelfHostCloudAddonEvidenceV1
  | SelfHostCfnWrapperEvidenceV1;

/**
 * ── Tier-2 billing evidence (PR 4) ─────────────────────────────────────────
 *
 * Bounded and secret-free BY CONSTRUCTION: asserted ruled policy values as
 * finite non-negative numbers, safe Stripe test-mode object/test-clock ids as
 * safe tokens, integer ledger row-count deltas. No free text, no credentials,
 * no local paths. Full validator/sanitizer contract in BRIEF §2 — the validator
 * body is owned by workstream D (`validateTier2BillingEvidence` below is the
 * kind-scoped seam).
 */
export interface Tier2BillingEvidenceV1 {
  kind: "tier2_billing";
  /** The authoritative manifest case id, e.g. "T2-BILL-2" (safe token). */
  manifest_id: string;
  /** The Server under test's VERSION (safe token). */
  server_version: string;
  billing_mode: "enforce" | "observe" | "off";
  /** Ruled policy values THIS case asserted; every present value is finite >= 0. */
  asserted_policy: {
    free_grant_usd?: number;
    llm_per_seat_usd?: number;
    compute_per_seat_usd?: number;
    compute_margin_multiplier?: number;
    topup_pack_usd?: number;
    topup_margin_pct?: number;
    topup_trigger_usd?: number;
    overage_cap_usd_per_org_month?: number;
  };
  /** Safe Stripe test-mode identifiers this case created (never secrets). */
  stripe: {
    /** tc_… ; sorted ascending, unique, bounded. */
    test_clock_ids: string[];
    /** sub_/cus_/in_/evt_/pi_… ; sorted ascending, unique, bounded. */
    object_ids: string[];
  };
  /** Billing-ledger row-count deltas this case produced (non-negative integers). */
  ledger: {
    grants_delta: number;
    seat_adjustments_delta: number;
    usage_exports_delta: number;
    llm_events_delta: number;
    webhook_receipts_delta: number;
    holds_delta: number;
  };
}

/** The closed set of shipped catalog harness kinds (audit ruling #3). Kept as a
 * literal union + runtime array so both the type system and the kind-scoped
 * validators reference one source. If the catalog gains a harness kind, extend
 * both here (append-only). */
export type LocalHarnessKind = "claude" | "codex" | "cursor" | "grok" | "opencode";
export const LOCAL_HARNESS_KINDS: readonly LocalHarnessKind[] = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
];

/** Which route a local-functional turn launched on. */
export type LocalRoute = "gateway" | "user_key";

/** The correlated per-turn LiteLLM spend block, shared by the new route-turn and
 * (structurally) identical to `LocalWorkspaceTurnEvidenceV1.litellm`. */
export interface LocalLitellmSpendV1 {
  token_id_hash: string;
  request_ids: string[];
  window_started_at: string;
  window_finished_at: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  spend_usd: number;
}

/**
 * ── PR 3 self-host evidence types (contracts stage) ───────────────────────
 *
 * The four `SELFHOST-INSTALL-1` journey cells attach one of these. Only the
 * TYPES live here now; the kind-scoped validators (`validateSelfHostEvidence`
 * and friends) are stubbed below and owned by the scenario+evidence+cli
 * workstream. Every member binds the candidate artifact ids + versions, records
 * the EC2 **API origin** and the controller-local **runtime origin**
 * SEPARATELY (evidence never implies AnyHarness ran on the box), carries only
 * safe hashes (setup token, BYOK key, invitation token are NEVER stored raw),
 * and carries the shared world cleanup block. Green requires complete evidence
 * AND a clean cleanup block (failed === 0, every deletion boolean true).
 */
export interface SelfHostCleanupEvidenceBlock {
  ledger_id_hash: string;
  registered: number;
  reconciled: number;
  failed: number;
  ec2_terminated: boolean;
  security_group_deleted: boolean;
  key_pair_deleted: boolean;
  route53_record_deleted: boolean;
  browser_closed: boolean;
  processes_stopped: boolean;
  local_paths_removed: boolean;
}

/** Fields common to every self-host journey cell's evidence. */
export interface SelfHostEvidenceBaseV1 {
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: "claude";
  /** EC2 self-host public API origin hostname (safe; never the raw public IP). */
  api_origin: string;
  /** Controller-local candidate AnyHarness origin (safe; recorded separately). */
  controller_runtime_origin: string;
  cleanup: SelfHostCleanupEvidenceBlock;
}

export interface SelfHostInstallClaimEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_install_claim";
  /**
   * The candidate map's server artifact version. `server_version` (base) is the
   * OBSERVED running version read from `/meta`; the two must be equal, witnessed
   * by `server_version_matches_candidate`.
   */
  candidate_server_version: string;
  /** The observed running server version equalled the candidate map version. */
  server_version_matches_candidate: true;
  /** Running container image digest asserted on the box == candidate receipt. */
  running_image_digest: string;
  /** SHA-256 of the exact deploy bundle bytes the shipped installer verified. */
  bundle_sha256: string;
  setup_token_hash: string;
  owner_user_id_hash: string;
  org_id_hash: string;
  tls_verified: true;
  second_claim_rejected: true;
  restart_persisted: true;
}

export interface SelfHostDesktopOwnerEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_desktop_owner";
  owner_user_id_hash: string;
  org_id_hash: string;
  connect_rejected_invalid_url: true;
  connect_rejected_non_proliferate_host: true;
  only_meta_before_trust: true;
  owner_login_verified: true;
  single_org: true;
}

export interface SelfHostBaseTurnEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_base_turn";
  model_id: string;
  workspace_id_hash: string;
  session_id_hash: string;
  transcript_reopened: true;
  /** BYOK is a direct-provider call — never a gateway/LiteLLM correlation. */
  byok_route: "api_key";
  byok_key_id_hash: string;
  /**
   * The frozen contract's `no_litellm_spend`/`no_e2b` are run-window provider
   * SPEND/TRAFFIC observations. PR 7 does not perform those observations for a
   * gateway-OFF base install (there is no LiteLLM admin API to query, and E2B
   * traffic proof needs the managed-cloud controller PR 7 does not own), so the
   * claims are recorded HONESTLY as `"unproven"` rather than asserted `true`
   * (PR7-CONTROL-010: a false `true` from an unavailable/insufficient
   * observation is worse than an explicit unproven). The cell's green rests on
   * its REAL BYOK-direct observations — capabilities gateway/cloud both false,
   * the pushed auth route is `api_key` not `gateway`, and the scrubbed candidate
   * env carries no LiteLLM/E2B input — which prove the TURN was BYOK-direct, not
   * that zero provider spend/traffic occurred anywhere. `"observed_absent"` is
   * reserved for when a real run-window observation is later wired.
   */
  no_litellm_spend: SelfHostProviderClaim;
  no_e2b: SelfHostProviderClaim;
}

/**
 * A run-window provider-absence claim (PR7-CONTROL-010). `"unproven"` = the
 * observation was not performed (recorded honestly, never a false absence);
 * `"observed_absent"` = a real run-window spend/traffic observation confirmed
 * absence. Never a bare `true` derived from configuration.
 */
export type SelfHostProviderClaim = "unproven" | "observed_absent";

export interface SelfHostInviteeEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_invitee";
  invitee_user_id_hash: string;
  invitation_id_hash: string;
  member_role: "member";
  second_page_isolated: true;
  authenticated_member_action: true;
}

/**
 * ── PR 7 self-host evidence types (append-only) ───────────────────────────
 *
 * Five further `SELFHOST-INSTALL-1`-family journey cells (GitHub auth,
 * dual-server switch isolation, gateway capability, cloud add-on, and the
 * CloudFormation-wrapper posture) attach one of these. Same rules as the
 * PR 3 kinds above: bounded artifact ids/versions, safe hashes only (never a
 * raw secret), green requires complete evidence AND a clean cleanup block.
 * Each kind is validated/sanitized by its own kind-scoped function — a kind
 * never touches another kind's rules (extension-contract).
 */
export interface SelfHostGithubAuthEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_github_auth";
  owner_user_id_hash: string;
  org_id_hash: string;
  /** The two distinct GitHub identities exercised (owner-link vs invited/uninvited member). */
  github_identity_a_hash: string;
  github_identity_b_hash: string;
  setup_password_only: true;
  owner_link_no_duplicate: true;
  uninvited_denied: true;
  invited_admitted: true;
  member_role: string;
  methods_advertise_github: true;
}

/**
 * `api_origin` (inherited from `SelfHostEvidenceBaseV1`) doubles as server
 * A's origin, so this kind still gets the shared base
 * api_origin/controller_runtime_origin distinctness check for free;
 * `server_a_origin` is carried explicitly too so evidence never needs a
 * reader to know that convention to find server A, and the validator below
 * requires the two to agree.
 */
export interface SelfHostSwitchIsolationEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_switch_isolation";
  server_a_origin: string;
  server_b_origin: string;
  no_cross_origin_token: true;
  no_cross_origin_pending_auth: true;
  no_cross_origin_credential: true;
  no_cross_origin_runtime_identity: true;
  no_cross_origin_workspace_session: true;
  b_started_anonymous: true;
  b_authenticated_independently: true;
  a_state_restored_origin_scoped: true;
}

export interface SelfHostGatewayEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_gateway";
  actor_user_id_hash: string;
  virtual_key_id_hash: string;
  litellm_image_digest: string;
  model_id: string;
  capability_gateway_before: false;
  capability_gateway_after: true;
  gateway_spend_correlated: true;
  master_key_not_used: true;
  restart_persisted: true;
}

export interface SelfHostCloudAddonEvidenceV1 extends SelfHostEvidenceBaseV1 {
  kind: "selfhost_cloud_addon";
  github_app_installation_id_hash: string;
  e2b_template_id: string;
  sandbox_id_hash: string;
  workspace_id_hash: string;
  session_id_hash: string;
  turn_completed: true;
  pause_wake_state_intact: true;
  disable_truthful: true;
  base_healthy_after_disable: true;
}

/**
 * The CloudFormation-wrapper posture cleanup block. Deliberately NOT
 * `SelfHostCleanupEvidenceBlock`: no EC2/security-group/key-pair exist in
 * this posture (the wrapper provisions exactly one stack), and it adds
 * S3/GHCR deletion evidence the EC2 posture never carries.
 */
export interface SelfHostCfnCleanupEvidenceBlock {
  ledger_id_hash: string;
  registered: number;
  reconciled: number;
  failed: number;
  stack_deleted: boolean;
  s3_objects_deleted: boolean;
  ghcr_version_deleted: boolean;
  route53_record_deleted: boolean;
  local_paths_removed: boolean;
}

/**
 * Does NOT extend `SelfHostEvidenceBaseV1`: a CFN-wrapper install has no
 * controller-local AnyHarness runtime to record separately (there is no
 * `controller_runtime_origin` in this posture), and it asserts stack
 * template/digest/output bindings the EC2-posture base never carries.
 * `api_origin` is still the self-host public API origin, recorded the same
 * safe way as every other self-host kind.
 */
export interface SelfHostCfnWrapperEvidenceV1 {
  kind: "selfhost_cfn_wrapper";
  artifact_ids: string[];
  server_version: string;
  api_origin: string;
  stack_name_hash: string;
  /** The observed running-api image RepoDigest (`sha256:<hex>`) the binding rests on. */
  image_repo_digest: string;
  /** The run-scoped tag the candidate was pushed under + passed as ReleaseVersion (safe token). */
  release_version_tag: string;
  /** SHA-256 of the validated CloudFormation template (safe token). */
  template_sha256: string;
  template_validated: true;
  bundle_digest_bound: true;
  image_digest_bound: true;
  outputs_valid: true;
  dns_tls_verified: true;
  meta_version_matches: true;
  cleanup: SelfHostCfnCleanupEvidenceBlock;
}

/** The scenario id whose green cells require complete self-host evidence. */
export const SELFHOST_INSTALL_1_SCENARIO_ID = "SELFHOST-INSTALL-1";

/** The reverse-order cleanup reconciliation block, shared by the new local
 * functional kinds and (structurally) identical to
 * `LocalWorkspaceTurnEvidenceV1.cleanup`. */
export interface LocalCleanupV1 {
  ledger_id_hash: string;
  registered: number;
  reconciled: number;
  failed: number;
  virtual_key_deleted: boolean;
  litellm_subjects_deleted: boolean;
  browser_closed: boolean;
  processes_stopped: boolean;
  containers_removed: boolean;
  local_paths_removed: boolean;
}

export interface LocalWorkspaceTurnEvidenceV1 {
  kind: "local_workspace_turn";
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: LocalHarnessKind;
  model_id: string;
  workspace_id_hash: string;
  session_id_hash: string;
  transcript_reopened: true;
  litellm: {
    token_id_hash: string;
    request_ids: string[];
    window_started_at: string;
    window_finished_at: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    spend_usd: number;
  };
  cleanup: {
    ledger_id_hash: string;
    registered: number;
    reconciled: number;
    failed: number;
    virtual_key_deleted: boolean;
    litellm_subjects_deleted: boolean;
    browser_closed: boolean;
    processes_stopped: boolean;
    containers_removed: boolean;
    local_paths_removed: boolean;
  };
}

/**
 * LOCAL-2 / LOCAL-3 / LOCAL-6 route turn. Exactly one of `gateway_spend`
 * (route=gateway) / `user_key_isolation` (route=user_key) is non-null; a
 * `route_change` block is present only for LOCAL-6. `billing_reconcile_deferred`
 * is always true here (audit ruling #1: the product usage-import/balance/debit
 * reconcile is DEFERRED to PR 4's billing half; no T3-BILL-1 claim is made).
 */
export interface LocalRouteTurnEvidenceV1 {
  kind: "local_route_turn";
  journey: "LOCAL-2" | "LOCAL-3" | "LOCAL-6";
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: LocalHarnessKind;
  route: LocalRoute;
  model_id: string;
  workspace_id_hash: string;
  session_id_hash: string;
  transcript_reopened: true;
  /** Non-null iff route === "gateway": correlated LiteLLM spend for the actor key. */
  gateway_spend: LocalLitellmSpendV1 | null;
  /**
   * Non-null iff route === "user_key". Records only the OBSERVED isolation fact —
   * the user-key actor's managed gateway token has zero LiteLLM spend rows.
   * `managed_balance_read_deferred` is always true: the product-ledger balance is
   * NOT read here (hard billing non-goal, LQF-006) — a zero balance move is
   * inferable from zero LiteLLM rows but is never encoded as an observed number.
   */
  user_key_isolation: { litellm_spend_rows: 0; managed_balance_read_deferred: true } | null;
  /** LOCAL-6 only: the retained user-key session and the switched-to gateway session. */
  route_change: {
    original_route: "user_key";
    original_session_id_hash: string;
    new_route: "gateway";
    new_session_id_hash: string;
  } | null;
  billing_reconcile_deferred: true;
  cleanup: LocalCleanupV1;
}

/** LOCAL-4 live configuration matrix. Each control records the last-accepted
 * value read back from the UI and whether the applied value was rejected (which
 * must have restored the last-accepted value). #1063 rejections are tracked
 * `known_1063_expected_fail`, never green. */
export interface LocalConfigMatrixEvidenceV1 {
  kind: "local_config_matrix";
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: LocalHarnessKind;
  model_id: string;
  workspace_id_hash: string;
  session_id_hash: string;
  controls: Array<{ control_key: string; accepted_value: string; rejected: boolean }>;
  known_1063_expected_fail: boolean;
  cleanup: LocalCleanupV1;
}

/** LOCAL-5 session and tab semantics (single cell). Each boolean records one of
 * the four proofs; `session_id_hashes` are the distinct session ids observed. */
export interface LocalSessionTabsEvidenceV1 {
  kind: "local_session_tabs";
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: LocalHarnessKind;
  workspace_id_hash: string;
  empty_switch_session_replaced: true;
  messaged_switch_new_tab: true;
  same_harness_model_change_in_session: true;
  reload_preserved: true;
  session_id_hashes: string[];
  cleanup: LocalCleanupV1;
}

/** LOCAL-7 Product MCP integration (per harness). Correlates the agent's tool
 * call through the Proliferate integrations MCP to its audit row. */
export interface LocalMcpIntegrationEvidenceV1 {
  kind: "local_mcp_integration";
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: LocalHarnessKind;
  model_id: string;
  workspace_id_hash: string;
  session_id_hash: string;
  integration_namespace: string;
  tool_name: string;
  audit_event_id_hash: string;
  audit_ok: true;
  cleanup: LocalCleanupV1;
}

/**
 * ── CLOUD-PROVISION-1 evidence (spec step 10) ──────────────────────────────
 *
 * The bounded evidence a green managed-cloud provisioning cell attaches. It
 * binds the artifact identities (including the composite `e2b-template/<name>`
 * and `candidate-api/<subdomain>` receipts), the provider-verified template/
 * build IDs, the one-way sandbox-id hash, the Worker/Supervisor identity +
 * parentage proof, the covered-repository identity, the LiteLLM turn
 * correlation, the actor-isolation denial proof, and the full cleanup block —
 * with the same bounded/safe-string discipline the local kind uses. Every
 * string field passes the shared safe-token/hash/timestamp patterns; no raw
 * secret, provider key, local path, sandbox id, or credentialled URL is ever a
 * field value.
 *
 * TYPES are owned by the contracts stage; the kind-scoped validator
 * (`validateCloudProvisionTurnEvidence`) and sanitizer
 * (`sanitizeCloudProvisionTurnEvidence`) bodies are owned by the
 * scenario+evidence+cli workstream (BRIEF "Evidence"). Until implemented they
 * throw, so a green cloud cell fails closed rather than validating loose
 * evidence.
 */
export interface CloudProvisionTurnEvidenceV1 {
  kind: "cloud_provision_turn";
  /** Every qualified artifact id, including the template + candidate-api receipts. */
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  worker_version: string;
  supervisor_version: string;
  harness: "claude";
  model_id: string;
  /** Provider-verified immutable E2B template identity + baked-input digest. */
  template: {
    template_id: string;
    build_id: string;
    input_hash: string;
  };
  /** One-way hash of the provider (E2B) sandbox id — never the raw id. */
  sandbox_id_hash: string;
  /**
   * Worker liveness (spec step 5). `supervisor_is_parent` records the HONEST
   * current state and is NOT required to be true: on current main the
   * fresh-provision path launches the runtime directly (no Supervisor), and
   * Supervisor-parentage is PR 9's guarantee, deferred there (ruled
   * 2026-07-15). PR 2 proves exactly one Worker is running with matching
   * version identities; it does not claim Supervisor parentage.
   */
  worker: {
    supervisor_is_parent: boolean;
    heartbeat_recent: true;
  };
  /** Covered repository materialized by the product at the pinned commit (spec step 7). */
  covered_repo: {
    name: string;
    commit: string;
    no_credential_in_remote: true;
  };
  /**
   * Actor-B isolation denial proof (spec step 9). Each field is an OBSERVED
   * boolean (MCW-001): actor B's product listing did not reveal actor A's
   * sandbox, and the direct runtime rejected the missing-credential and
   * actor-B-credential probes. A GREEN cell requires all three true (the
   * validator gates it); the scenario throws before evidence if any is false,
   * so these are proven, not fabricated.
   */
  isolation: {
    actor_b_denied: boolean;
    runtime_rejects_missing: boolean;
    runtime_rejects_actor_b: boolean;
  };
  litellm: {
    token_id_hash: string;
    request_ids: string[];
    window_started_at: string;
    window_finished_at: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    spend_usd: number;
  };
  /**
   * The managed-cloud cleanup block. Its shape mirrors
   * `ManagedCloudCleanupEvidence` (worlds/managed-cloud/cleanup-kinds.ts) in
   * snake_case: a green cell requires `failed === 0` and every deletion boolean
   * true (spec "Cleanup reconciles every run-created resource").
   */
  cleanup: {
    ledger_id_hash: string;
    registered: number;
    reconciled: number;
    failed: number;
    sandboxes_deleted: boolean;
    template_deleted: boolean;
    dns_record_deleted: boolean;
    ec2_terminated: boolean;
    security_group_deleted: boolean;
    key_pair_deleted: boolean;
    virtual_key_deleted: boolean;
    litellm_subjects_deleted: boolean;
    local_paths_removed: boolean;
  };
}

/** V4 result: a V3 result plus one bounded optional evidence attachment. */
export interface FinalCellResultV2 extends FinalCellResultV1 {
  evidence: CellEvidenceV1 | null;
}

/**
 * Report V4: structurally V3 with `schema_version: 4` and evidence-bearing
 * results. The evidence workstream promotes the writer/validator to emit and
 * check this; V3 remains recorded history.
 */
export interface TestRunReportV4 extends Omit<TestRunReportV3, "schema_version" | "results"> {
  schema_version: 4;
  results: FinalCellResultV2[];
}

/**
 * The report fields validated identically across V3 and V4 (everything but
 * the version-specific `schema_version` literal and the evidence attached to
 * each V4 result — `FinalCellResultV2` is a structural supertype-safe
 * substitute for `FinalCellResultV1` here). `validateReportCore` is the one
 * shared invariant walk both `validateReport` (V3) and `validateReportV4`
 * (V4) run after their own version-specific header check.
 */
type ValidatableReportCore = Omit<TestRunReportV3, "schema_version">;

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}

export const MAX_MESSAGE_CODE_POINTS = 4096;

/** Bounds a message to 4,096 Unicode code points. */
export function boundMessage(message: string): string {
  const codePoints = [...message];
  if (codePoints.length <= MAX_MESSAGE_CODE_POINTS) {
    return message;
  }
  return `${codePoints.slice(0, MAX_MESSAGE_CODE_POINTS - 1).join("")}…`;
}

/** Replaces exact resolved secret values anywhere in the string with [REDACTED]. */
export function redactSecrets(message: string, secretValues: readonly string[]): string {
  let redacted = message;
  for (const secret of secretValues) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}

/**
 * Scrubs URL userinfo credentials (`scheme://user:token@host`) regardless of
 * where they came from. Exact-value redaction only knows environment-manifest
 * secrets; credentials discovered at runtime (e.g. `gh auth token` embedded
 * in a clone URL) would otherwise pass through untouched.
 */
export function redactUrlCredentials(message: string): string {
  return message.replace(/(\/\/)[^\s/@]+@/g, "$1[REDACTED]@");
}

/**
 * Withholds external response/provider details after the safe diagnostic
 * prefix. Release scenarios wrap those payloads in several ways (HTTP
 * `-> 502:`, `error:`, `failed:`, `returned:`, provider command output, and
 * similar); retaining the prefix preserves the operation/status while keeping
 * raw bodies, SSE messages, and provider stdout/stderr out of evidence.
 */
export function redactExternalPayloads(message: string): string {
  return message
    .replace(
      /(\bexited\s+(?:-?\d+|null)\s*:\s*)[\s\S]*$/i,
      "$1(output withheld from evidence)",
    )
    .replace(
      /(\b(?:ssh command|git [^:\n]{0,160})\s+failed(?:\s*\([^\n)]*\))?\s*:\s*)[\s\S]*$/i,
      "$1(output withheld from evidence)",
    )
    .replace(
      /(\bcould not parse\b[^:\n]{0,160}\bjson\b[^:\n]{0,160}:\s*)[\s\S]*$/i,
      "$1(output withheld from evidence)",
    )
    .replace(
      /(\bsandbox\b[^:\n]{0,160}\bdid not reach\b[^:\n]{0,160}\blast observed\s*:\s*)[\s\S]*$/i,
      "$1response body withheld from evidence)",
    )
    .replace(
      /((?:->\s*\d{3}|\b(?:provider|gateway|sandbox|materializer|provisioning|completion|turn|session|claim|e2b[\w.-]*)\b[^:\n]{0,160}\b(?:error|errored|failed|warning|returned|reported|got|exited)\b[^:\n]{0,80}|\b(?:last error|got iserror|did not print valid json)\b[^:\n]{0,80}|\b(?:error|failure)\b[^:\n]{0,160}\(got|\(error)\s*:\s*)[\s\S]*$/i,
      "$1(response body withheld from evidence)",
    )
    .replace(
      /\(got\s+(?:\{|\[)[\s\S]*$/i,
      "(provider response withheld from evidence)",
    );
}

/**
 * Applies redaction + bounding to every message-bearing field in the report.
 * Runs before validation/serialization so no exact secret value or overlong
 * message can enter the persisted artifact.
 */
export function sanitizeReport(report: TestRunReportV3, secretValues: readonly string[]): TestRunReportV3 {
  const clean = (message: string): string =>
    boundMessage(redactExternalPayloads(redactUrlCredentials(redactSecrets(message, secretValues))));
  // Structured identity fields (cell ids, dimension keys/values) cannot be
  // redacted without making the evidence ambiguous, so a resolved secret
  // appearing there fails closed: no report is produced at all.
  assertNoSecretsInIdentity(report, secretValues);
  return {
    ...report,
    results: report.results.map((result) => ({
      ...result,
      reason: result.reason ? { ...result.reason, message: clean(result.reason.message) } : null,
      plan_steps: result.plan_steps.map(clean),
    })),
    summary: {
      ...report.summary,
      integrity_errors: report.summary.integrity_errors.map((error) => ({
        ...error,
        message: clean(error.message),
      })),
      runner_errors: report.summary.runner_errors.map((error) => ({ ...error, message: clean(error.message) })),
    },
    verdict: { ...report.verdict, reasons: report.verdict.reasons.map(clean) },
  };
}

/**
 * Rejects a report whose structured identity fields carry a resolved secret
 * value. Exported for the writer-side tests; execution calls it through
 * `sanitizeReport`.
 */
export function assertNoSecretsInIdentity(report: ValidatableReportCore, secretValues: readonly string[]): void {
  const secrets = secretValues.filter((secret) => secret.length > 0);
  if (secrets.length === 0) {
    return;
  }
  const identityStrings: string[] = [];
  for (const cell of report.selected_cells) {
    identityStrings.push(cell.cell_id, ...Object.keys(cell.dimensions), ...Object.values(cell.dimensions));
  }
  for (const result of report.results) {
    identityStrings.push(result.cell_id, ...Object.keys(result.dimensions), ...Object.values(result.dimensions));
  }
  for (const value of identityStrings) {
    for (const secret of secrets) {
      if (value.includes(secret)) {
        throw new ReportValidationError(
          "A resolved secret value appears in a cell id or dimension; refusing to produce evidence.",
        );
      }
    }
  }
}

/**
 * Validates the report invariants before writing: unique + exactly-equal
 * selected/result test ids, finalized counts, all seven status keys with
 * exact counts, and verdict/exit consistency.
 */
export function validateReport(report: TestRunReportV3): void {
  if (report.schema_version !== 3 || report.kind !== "proliferate.test-run") {
    throw new ReportValidationError("Report must be schema_version 3, kind proliferate.test-run.");
  }
  validateReportCore(report);
}

/**
 * Report V4: `schema_version: 4` plus every V3 invariant, plus per-result
 * evidence. Existing cells emit `evidence: null` and keep V3 semantics; a
 * green `LOCAL-WORLD-SMOKE-1` result must carry complete evidence.
 */
export function validateReportV4(report: TestRunReportV4): void {
  if (report.schema_version !== 4 || report.kind !== "proliferate.test-run") {
    throw new ReportValidationError("Report must be schema_version 4, kind proliferate.test-run.");
  }
  validateReportCore(report);
  // A world-backed report (non-null candidate_build) is the functional local
  // qualification path; the legacy diagnostic path omits the map and never
  // requires kind-scoped evidence for its green cells. See BRIEF §"Evidence".
  const worldBacked = report.candidate_build !== null;
  // The exact bytes this report qualified: every evidence block's artifact_ids
  // must name artifacts from THIS candidate identity (audit cross-field bind).
  const candidateArtifactIds =
    report.candidate_build === null
      ? null
      : new Set(report.candidate_build.artifacts.map((artifact) => artifact.artifact_id));
  for (const result of report.results) {
    validateCellEvidence(result, worldBacked, candidateArtifactIds);
  }
}

/**
 * The kind each evidence-bearing local-functional scenario MUST carry (audit
 * LQF-005). Dispatch on `evidence.kind` alone let a green T3-SESSION cell carry
 * a structurally valid route/config object from another scenario/harness; this
 * binds the cell's `scenario_id` to its one legal evidence kind so mismatched
 * evidence fails closed. `T3-WT-1`/`T3-REPO-1` (LOCAL-1) run no LLM turn and
 * carry `evidence: null`, so they are intentionally absent.
 */
const SCENARIO_REQUIRED_EVIDENCE_KIND: Readonly<Record<string, CellEvidenceV1["kind"]>> = {
  "T3-CHAT-1": "local_route_turn",
  "T3-AUTHROUTE-1": "local_route_turn",
  "T3-CFG-1": "local_config_matrix",
  "T3-SESSION-1": "local_session_tabs",
  "T3-INT-1": "local_mcp_integration",
  // Single-kind PR 7 scenarios (PR7-CONTROL-007): bind the scenario to its one
  // legal evidence kind so a green cell cannot carry null or another scenario's
  // structurally-valid evidence.
  "SELFHOST-ISOLATION-1": "selfhost_switch_isolation",
  "SELFHOST-CFN-1": "selfhost_cfn_wrapper",
};

/**
 * PR 7's multi-kind scenarios attach a DIFFERENT evidence kind per staged cell,
 * so their binding is keyed on `(scenario_id, cell-dimension)` rather than
 * scenario id alone (PR7-CONTROL-007). A green cell whose evidence kind does not
 * match its cell dimension fails closed.
 */
const CELL_REQUIRED_EVIDENCE_KIND: Readonly<Record<string, CellEvidenceV1["kind"]>> = {
  "SELFHOST-INSTALL-1/SH-INSTALL-CLAIM": "selfhost_install_claim",
  "SELFHOST-INSTALL-1/SH-DESKTOP-OWNER": "selfhost_desktop_owner",
  "SELFHOST-INSTALL-1/SH-BASE-TURN": "selfhost_base_turn",
  "SELFHOST-INSTALL-1/SH-INVITEE": "selfhost_invitee",
  "SELFHOST-QUAL-1/SH-GITHUB-AUTH": "selfhost_github_auth",
  "SELFHOST-QUAL-1/SH-GATEWAY": "selfhost_gateway",
  "SELFHOST-QUAL-1/SH-CLOUD-ADDON": "selfhost_cloud_addon",
};

/**
 * Cross-field binding of a cell's identity to its evidence (audit LQF-005),
 * run in addition to the kind-scoped structural validator. Prevents a
 * structurally valid evidence object from a DIFFERENT scenario/harness/journey
 * or a stale candidate build from validating against this cell.
 */
function validateEvidenceCellBinding(
  result: FinalCellResultV2,
  evidence: CellEvidenceV1,
  where: string,
  candidateArtifactIds: ReadonlySet<string> | null,
): void {
  // (a) scenario_id → required kind.
  const requiredKind = SCENARIO_REQUIRED_EVIDENCE_KIND[result.scenario_id];
  if (requiredKind !== undefined && evidence.kind !== requiredKind) {
    throw new ReportValidationError(
      `${where}.kind is "${evidence.kind}" but ${result.scenario_id} requires "${requiredKind}".`,
    );
  }

  // (a2) (scenario_id, cell-dimension) → required kind, for PR 7's multi-kind
  // scenarios where each staged cell attaches a different evidence kind
  // (PR7-CONTROL-007).
  const cellDimension = result.dimensions.cell;
  if (typeof cellDimension === "string") {
    const requiredCellKind = CELL_REQUIRED_EVIDENCE_KIND[`${result.scenario_id}/${cellDimension}`];
    if (requiredCellKind !== undefined && evidence.kind !== requiredCellKind) {
      throw new ReportValidationError(
        `${where}.kind is "${evidence.kind}" but ${result.scenario_id} cell "${cellDimension}" requires "${requiredCellKind}".`,
      );
    }
  }

  // (b) AUTHROUTE dimensions → journey (route=change ⇒ LOCAL-6, else LOCAL-3).
  if (result.scenario_id === "T3-AUTHROUTE-1" && evidence.kind === "local_route_turn") {
    const expectedJourney = result.dimensions.route === "change" ? "LOCAL-6" : "LOCAL-3";
    if (evidence.journey !== expectedJourney) {
      throw new ReportValidationError(
        `${where}.journey is "${evidence.journey}" but the cell's dimensions (route=${result.dimensions.route ?? "<harness>"}) require "${expectedJourney}".`,
      );
    }
  }

  // (c) evidence harness → cell harness dimension (when the cell carries one).
  const cellHarness = result.dimensions.harness;
  const evidenceHarness = (evidence as { harness?: unknown }).harness;
  if (typeof cellHarness === "string" && typeof evidenceHarness === "string" && cellHarness !== evidenceHarness) {
    throw new ReportValidationError(
      `${where}.harness is "${evidenceHarness}" but the cell's dimensions name harness "${cellHarness}".`,
    );
  }

  // (d) artifact_ids → exact candidate identity: every id names a THIS-build
  // artifact. A world-backed report always has a candidate identity here; a
  // diagnostic report (null) never reaches evidence validation with artifacts.
  // Scoped to the local kinds this binding was authored for (LQF-005): the
  // `cloud_provision_turn` kind legitimately mixes run-scoped receipts
  // (`e2b-template/…`, `candidate-api/…` minted DURING the run) into its
  // artifact_ids, which are not in the pre-run candidate_build map — its own
  // kind-scoped validator owns those bounds.
  const artifactIds = (evidence as { artifact_ids?: unknown }).artifact_ids;
  const kindBindsArtifacts = evidence.kind in SCENARIO_ARTIFACT_BOUND_KINDS;
  if (kindBindsArtifacts && candidateArtifactIds !== null && Array.isArray(artifactIds)) {
    for (const id of artifactIds) {
      if (typeof id === "string" && !candidateArtifactIds.has(id)) {
        throw new ReportValidationError(
          `${where}.artifact_ids names "${id}", which is not an artifact of this report's candidate_build.`,
        );
      }
    }
  }
}

/**
 * Evidence kinds whose `artifact_ids` are bound to the report's exact
 * `candidate_build` (LQF-005 rule d). The local-functional kinds only name
 * pre-built candidate artifacts; `cloud_provision_turn`/`selfhost_*` also carry
 * run-scoped receipts (templates, candidate-api subdomains, install bundles) not
 * present in the pre-run map, so they are deliberately excluded and rely on
 * their own kind-scoped validators.
 */
const SCENARIO_ARTIFACT_BOUND_KINDS: Readonly<Record<string, true>> = {
  local_workspace_turn: true,
  local_route_turn: true,
  local_config_matrix: true,
  local_session_tabs: true,
  local_mcp_integration: true,
};

/**
 * Green cells of these local-functional scenarios must carry complete
 * kind-scoped evidence WHEN the run is world-backed (BRIEF §"Evidence"). The
 * legacy diagnostic path (candidate_build null) is exempt. `LOCAL-WORLD-SMOKE-1`
 * is required unconditionally (handled separately). `T3-WT-1` (LOCAL-1) is
 * intentionally ABSENT: it runs no LLM turn and the four new kinds do not cover
 * it, so its green cell carries `evidence: null`.
 */
export const LOCAL_FUNCTIONAL_EVIDENCE_SCENARIOS: readonly string[] = [
  "T3-CHAT-1", // LOCAL-2 gateway turn → local_route_turn
  "T3-AUTHROUTE-1", // LOCAL-3 user-key + LOCAL-6 route-change → local_route_turn
  "T3-CFG-1", // LOCAL-4 config matrix → local_config_matrix
  "T3-SESSION-1", // LOCAL-5 tabs → local_session_tabs
  "T3-INT-1", // LOCAL-7 MCP → local_mcp_integration
];

/** The invariant walk shared by `validateReport` (V3) and `validateReportV4`. */
function validateReportCore(report: ValidatableReportCore): void {
  if (report.run.behavior !== "diagnostic" && report.run.behavior !== "strict") {
    throw new ReportValidationError(`Unknown behavior "${report.run.behavior}".`);
  }
  if (report.run.execution !== "real" && report.run.execution !== "dry_run") {
    throw new ReportValidationError(`Unknown execution mode "${report.run.execution}".`);
  }
  if (report.verdict.scope !== "selected_cells" || report.verdict.completeness !== "partial") {
    throw new ReportValidationError(
      "Verdict scope/completeness must be selected_cells/partial; this report cannot claim more.",
    );
  }
  if (report.selected_cells.length === 0) {
    throw new ReportValidationError("A report with zero selected cells is not representable evidence.");
  }
  validateCandidateBuildEvidence(report.candidate_build);
  // Strict evidence must name the exact bytes it qualified: only diagnostic
  // omission may record null.
  if (report.run.behavior === "strict" && report.candidate_build === null) {
    throw new ReportValidationError("Strict reports require non-null candidate_build identity.");
  }

  const selectedIds = report.selected_cells.map((cell) => cell.cell_id);
  const resultIds = report.results.map((result) => result.cell_id);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new ReportValidationError("Selected cell ids are not unique.");
  }
  if (new Set(resultIds).size !== resultIds.length) {
    throw new ReportValidationError("Result cell ids are not unique.");
  }
  const selectedSet = new Set(selectedIds);
  if (resultIds.length !== selectedIds.length || !resultIds.every((id) => selectedSet.has(id))) {
    throw new ReportValidationError("Selected and result cell ids are not exactly equal sets.");
  }

  // Every selected cell's id must be re-derivable from its own
  // scenario/lane/dimensions through the same canonical derivation the
  // planner uses — a coordinated edit of cell_id and dimensions together
  // still cannot validate.
  for (const cell of report.selected_cells) {
    if (
      cell.runtime_lane !== "local" &&
      cell.runtime_lane !== "sandbox" &&
      cell.runtime_lane !== "selfhost"
    ) {
      throw new ReportValidationError(`Unknown runtime lane on "${cell.cell_id}".`);
    }
    if (
      !Array.isArray(cell.required_env) ||
      cell.required_env.some((name) => typeof name !== "string")
    ) {
      throw new ReportValidationError(`required_env on "${cell.cell_id}" is malformed.`);
    }
    // The planner's complete dimension rules apply to persisted evidence too:
    // a report carrying dimensions the planner could never have produced
    // (invalid keys, empty/oversized/non-string values) is not valid even if
    // its cell id was edited consistently.
    const dimensionProblem = dimensionShapeProblem(cell.dimensions);
    if (dimensionProblem) {
      throw new ReportValidationError(`Selected cell "${cell.cell_id}" has ${dimensionProblem}.`);
    }
    const expectedId = canonicalCellId(cell.scenario_id, cell.runtime_lane, cell.dimensions ?? {});
    if (cell.cell_id !== expectedId) {
      throw new ReportValidationError(
        `Selected cell id "${cell.cell_id}" is not the canonical id for its scenario/lane/dimensions.`,
      );
    }
  }

  // Every result must repeat its planned cell's identity and dimensions
  // exactly — a result that drifts from its plan is tampered evidence.
  const cellsById = new Map(report.selected_cells.map((cell) => [cell.cell_id, cell]));
  for (const result of report.results) {
    const cell = cellsById.get(result.cell_id)!;
    if (
      result.scenario_id !== cell.scenario_id ||
      result.runtime_lane !== cell.runtime_lane ||
      result.registry_flow_ref !== cell.registry_flow_ref
    ) {
      throw new ReportValidationError(
        `Result "${result.cell_id}" does not match its planned cell's scenario/lane/reference.`,
      );
    }
    const cellDims = JSON.stringify(Object.entries(cell.dimensions).sort());
    const resultDims = JSON.stringify(Object.entries(result.dimensions ?? {}).sort());
    if (cellDims !== resultDims) {
      throw new ReportValidationError(`Result "${result.cell_id}" dimensions do not match its planned cell.`);
    }
  }

  if (report.summary.selected !== selectedIds.length || report.summary.finalized !== report.results.length) {
    throw new ReportValidationError("summary.selected/finalized do not match the selected/result counts.");
  }

  const byStatus = report.summary.by_status;
  for (const status of ALL_FINAL_STATUSES) {
    if (typeof byStatus[status] !== "number") {
      throw new ReportValidationError(`summary.by_status is missing the "${status}" key.`);
    }
  }
  const counted = { ...Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) } as Record<
    FinalTestStatus,
    number
  >;
  for (const result of report.results) {
    counted[result.status] += 1;
  }
  for (const status of ALL_FINAL_STATUSES) {
    if (byStatus[status] !== counted[status]) {
      throw new ReportValidationError(`summary.by_status.${status} does not match the results.`);
    }
  }

  const knownStatuses = new Set<string>(ALL_FINAL_STATUSES);
  for (const result of report.results) {
    if (!knownStatuses.has(result.status)) {
      throw new ReportValidationError(`Unknown result status "${result.status}" for ${result.cell_id}.`);
    }
  }

  // Execution semantics: strict dry-run is an invalid invocation and can
  // never be honest persisted evidence. Diagnostic planning normally
  // finalizes not_run; a post-selection runner defect may instead synthesize
  // missing, which remains valid only with its integrity error below.
  if (report.run.execution === "dry_run") {
    if (report.run.behavior === "strict") {
      throw new ReportValidationError("A strict dry-run report is not representable evidence.");
    }
    const executed = report.results.find(
      (result) => result.status !== "not_run" && result.status !== "missing",
    );
    if (executed) {
      throw new ReportValidationError(
        `Dry-run cannot produce a real result: ${executed.cell_id} is "${executed.status}".`,
      );
    }
  }

  // A missing result exists only as a runner-integrity failure; without its
  // integrity error the report would present unrecorded work as an ordinary
  // (exit-1) outcome instead of forcing exit 2.
  if (report.results.some((result) => result.status === "missing")) {
    const flagged = report.summary.integrity_errors.some(
      (error) => error.code === "selection_result_mismatch",
    );
    if (!flagged) {
      throw new ReportValidationError(
        "A missing result requires its selection_result_mismatch integrity error.",
      );
    }
  }

  // A not_run result during real execution is only representable alongside
  // its integrity error; without it the report would disguise unexecuted
  // work as a tolerated outcome.
  if (report.run.execution === "real" && report.results.some((result) => result.status === "not_run")) {
    const flagged = report.summary.integrity_errors.some((error) => error.code === "real_execution_not_run");
    if (!flagged) {
      throw new ReportValidationError(
        "not_run during real execution requires a real_execution_not_run integrity error.",
      );
    }
  }

  // Recompute the complete verdict/exit policy from the results and errors
  // and require the persisted fields to match — the validator, not the
  // producer, is the last line against false-success evidence.
  const expected = expectedVerdict(report);
  if (report.verdict.status !== expected.status) {
    throw new ReportValidationError(
      `Verdict "${report.verdict.status}" does not match the recomputed "${expected.status}".`,
    );
  }
  if (report.summary.intended_exit_code !== expected.intendedExitCode) {
    throw new ReportValidationError(
      `intended_exit_code ${report.summary.intended_exit_code} does not match the recomputed ${expected.intendedExitCode}.`,
    );
  }
  // The reasons array is derived evidence too: arbitrary prose (e.g.
  // "production fully qualified") must not validate.
  if (JSON.stringify(report.verdict.reasons) !== JSON.stringify(expected.reasons)) {
    throw new ReportValidationError("verdict.reasons do not match the recomputed derived reasons.");
  }
}

/**
 * The single derivation both the producer (runner/execute.ts, applied after
 * sanitization) and this validator use for the persisted verdict, including
 * the bounded reasons array.
 */
export function expectedVerdict(report: ValidatableReportCore): {
  status: VerdictStatus;
  intendedExitCode: 0 | 1 | 2;
  reasons: string[];
} {
  const derived = deriveVerdict({
    behavior: report.run.behavior,
    results: report.results,
    integrityErrors: report.summary.integrity_errors,
    runnerErrors: report.summary.runner_errors,
  });
  return { ...derived, reasons: derived.reasons.map(boundMessage) };
}

const EVIDENCE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * `candidate_build` must be present on every report — an explicit null for
 * diagnostic omission, otherwise only bounded artifact ID/version/SHA-256
 * triples. Anything path-like, oversized, or extra is rejected so map paths
 * and raw map JSON can never masquerade as evidence.
 */
function validateCandidateBuildEvidence(evidence: CandidateBuildEvidenceV1 | null): void {
  if (evidence === undefined) {
    throw new ReportValidationError("candidate_build must be present (null for diagnostic omission).");
  }
  if (evidence === null) {
    return;
  }
  if (typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new ReportValidationError("candidate_build must be an object or null.");
  }
  // No undeclared fields beside `artifacts` — extra keys are how paths or
  // raw map metadata would smuggle into persisted evidence.
  const evidenceKeys = Object.keys(evidence);
  if (evidenceKeys.length !== 1 || evidenceKeys[0] !== "artifacts") {
    throw new ReportValidationError("candidate_build carries exactly one field: artifacts.");
  }
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
    throw new ReportValidationError("candidate_build.artifacts must be a non-empty array.");
  }
  const seen = new Set<string>();
  for (const artifact of evidence.artifacts) {
    const keys = Object.keys(artifact).sort();
    if (keys.join(",") !== "artifact_id,sha256,version") {
      throw new ReportValidationError(
        "candidate_build artifacts carry exactly artifact_id/version/sha256.",
      );
    }
    if (
      typeof artifact.artifact_id !== "string" ||
      artifact.artifact_id.length === 0 ||
      artifact.artifact_id.length > 128 ||
      !EVIDENCE_ARTIFACT_ID_PATTERN.test(artifact.artifact_id)
    ) {
      throw new ReportValidationError("candidate_build artifact_id is missing or unsafe.");
    }
    if (seen.has(artifact.artifact_id)) {
      throw new ReportValidationError(`candidate_build duplicate artifact_id "${artifact.artifact_id}".`);
    }
    seen.add(artifact.artifact_id);
    if (typeof artifact.version !== "string" || artifact.version.length === 0 || artifact.version.length > 128) {
      throw new ReportValidationError("candidate_build version is missing or unbounded.");
    }
    if (typeof artifact.sha256 !== "string" || !EVIDENCE_SHA256_PATTERN.test(artifact.sha256)) {
      throw new ReportValidationError("candidate_build sha256 must be a lowercase 64-hex digest.");
    }
  }
}

/**
 * ── Report V4 evidence validation ─────────────────────────────────────────
 *
 * Every string field below passes the same bounded, path/secret-hostile
 * safe-token or hash pattern used for candidate-build/identity fields
 * elsewhere in this file: no leading slash, no `..` traversal segment, no
 * whitespace/control/URL-credential characters, bounded length. This is the
 * fail-closed backstop for BRIEF §6.5/§6.6: if a raw secret or local path
 * ever reached an evidence field, `sanitizeSecretsInEvidence` below turns it
 * into a `[REDACTED]`-bearing (or otherwise unsafe) string, and these
 * patterns then reject it rather than silently accepting mangled evidence.
 */
const EVIDENCE_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)*$/;
const MAX_EVIDENCE_TOKEN_LENGTH = 200;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_LITELLM_REQUEST_IDS = 50;

const LOCAL_WORKSPACE_TURN_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "model_id",
  "workspace_id_hash",
  "session_id_hash",
  "transcript_reopened",
  "litellm",
  "cleanup",
] as const;

const LITELLM_EVIDENCE_KEYS = [
  "token_id_hash",
  "request_ids",
  "window_started_at",
  "window_finished_at",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "spend_usd",
] as const;

const CLEANUP_EVIDENCE_KEYS = [
  "ledger_id_hash",
  "registered",
  "reconciled",
  "failed",
  "virtual_key_deleted",
  "litellm_subjects_deleted",
  "browser_closed",
  "processes_stopped",
  "containers_removed",
  "local_paths_removed",
] as const;

function requireExactKeys(value: object, expected: readonly string[], where: string): void {
  const keys = Object.keys(value).sort();
  const expectedSorted = [...expected].sort();
  if (keys.join(",") !== expectedSorted.join(",")) {
    throw new ReportValidationError(`${where} has undeclared or missing field(s).`);
  }
}

function requireSafeEvidenceToken(where: string, value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_EVIDENCE_TOKEN_LENGTH ||
    value.includes("..") ||
    !EVIDENCE_SAFE_TOKEN_PATTERN.test(value)
  ) {
    throw new ReportValidationError(`${where} is missing or unsafe.`);
  }
}

function requireEvidenceHash(where: string, value: unknown): void {
  if (typeof value !== "string" || !EVIDENCE_SHA256_PATTERN.test(value)) {
    throw new ReportValidationError(`${where} must be a lowercase 64-hex digest.`);
  }
}

function requireEvidenceTimestamp(where: string, value: unknown): void {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ReportValidationError(`${where} must be an ISO-8601 UTC timestamp.`);
  }
}

function requireNonNegativeInteger(where: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ReportValidationError(`${where} must be a non-negative integer.`);
  }
}

function requireBoolean(where: string, value: unknown): void {
  if (typeof value !== "boolean") {
    throw new ReportValidationError(`${where} must be a boolean.`);
  }
}

/**
 * Validates one result's `evidence: CellEvidenceV1 | null`. `null` is always
 * representable except on a GREEN `LOCAL-WORLD-SMOKE-1` result, which must
 * carry complete evidence (spec "Aggregate evidence" / BRIEF §6.3).
 */
function validateCellEvidence(
  result: FinalCellResultV2,
  worldBacked = true,
  candidateArtifactIds: ReadonlySet<string> | null = null,
): void {
  // `evidence` is a required field of FinalCellResultV2, but the report
  // ultimately comes from parsed JSON (`writeReportV4`'s caller may pass an
  // externally-constructed object at runtime), so a missing key is still
  // rejected explicitly rather than reading `undefined` as if it were `null`.
  if (!Object.prototype.hasOwnProperty.call(result, "evidence")) {
    throw new ReportValidationError(`Result "${result.cell_id}" must carry an explicit evidence field (or null).`);
  }
  const evidence = result.evidence;
  if (evidence === null) {
    if (
      (result.status === "green" && scenarioRequiresGreenEvidence(result.scenario_id)) ||
      requiresCompleteLocalEvidence(result, worldBacked)
    ) {
      throw new ReportValidationError(
        `Green result "${result.cell_id}" for ${result.scenario_id} requires complete evidence.`,
      );
    }
    return;
  }
  if (typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new ReportValidationError(`Result "${result.cell_id}" evidence must be an object or null.`);
  }
  const where = `Result "${result.cell_id}" evidence`;
  // Cross-field binding (audit LQF-005): the evidence must belong to THIS cell —
  // its kind/journey/harness match the scenario_id + dimensions, and its
  // artifact_ids name this report's exact candidate build. Run before the
  // kind-scoped structural dispatch, whose per-kind branches return early.
  validateEvidenceCellBinding(result, evidence as CellEvidenceV1, where, candidateArtifactIds);
  // Kind-scoped dispatch (audit ruling #3 + extension contract). Each kind owns
  // its own validator so no kind can weaken another's checks. The self-host
  // slice owns the whole `selfhost_*` namespace (its green cells require a
  // complete, clean cleanup block exactly like local_workspace_turn); route the
  // family to its kind-scoped validator, which reports an unknown selfhost kind
  // rather than mis-validating it. Unknown kinds otherwise fail closed.
  const evidenceKind = (evidence as { kind?: unknown }).kind;
  if (typeof evidenceKind === "string" && evidenceKind.startsWith("selfhost_")) {
    validateSelfHostCellEvidence(where, evidence as CellEvidenceV1, result.status);
    return;
  }
  // Dispatch to the kind-scoped validator. Adding a kind never edits another
  // kind's function (extension-contract rule). Each validator keeps its own
  // parameter order (the local/tier2 kinds predate the cloud PR's
  // (where, evidence, status) convention; unifying them is out of this slice's
  // scope).
  switch (evidence.kind) {
    case "local_workspace_turn":
      validateLocalWorkspaceTurnEvidence(evidence, where, result.status);
      return;
    case "local_route_turn":
      validateLocalRouteTurnEvidence(evidence, where, result.status);
      return;
    case "local_config_matrix":
      validateLocalConfigMatrixEvidence(evidence, where, result.status);
      return;
    case "local_session_tabs":
      validateLocalSessionTabsEvidence(evidence, where, result.status);
      return;
    case "local_mcp_integration":
      validateLocalMcpIntegrationEvidence(evidence, where, result.status);
      return;
    case "tier2_billing":
      validateTier2BillingEvidence(where, evidence as Tier2BillingEvidenceV1, result.status);
      return;
    case "cloud_provision_turn":
      validateCloudProvisionTurnEvidence(where, evidence as CloudProvisionTurnEvidenceV1, result.status);
      return;
    default:
      throw new ReportValidationError(`${where}.kind is unknown.`);
  }
}

/** Whether a green result MUST carry complete evidence (see
 * `LOCAL_FUNCTIONAL_EVIDENCE_SCENARIOS` + BRIEF §"Evidence"). */
function requiresCompleteLocalEvidence(result: FinalCellResultV2, worldBacked: boolean): boolean {
  if (result.status !== "green") {
    return false;
  }
  if (result.scenario_id === "LOCAL-WORLD-SMOKE-1") {
    return true;
  }
  return (
    worldBacked &&
    result.runtime_lane === "local" &&
    LOCAL_FUNCTIONAL_EVIDENCE_SCENARIOS.includes(result.scenario_id)
  );
}

/** The unchanged `local_workspace_turn` validator, extracted verbatim from the
 * pre-dispatch `validateCellEvidence` (still claude-only; the smoke's kind). */
function validateLocalWorkspaceTurnEvidence(
  evidence: LocalWorkspaceTurnEvidenceV1,
  where: string,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, LOCAL_WORKSPACE_TURN_EVIDENCE_KEYS, where);
  if (!Array.isArray(evidence.artifact_ids) || evidence.artifact_ids.length === 0) {
    throw new ReportValidationError(`${where}.artifact_ids must be a non-empty array.`);
  }
  for (const [index, id] of evidence.artifact_ids.entries()) {
    requireSafeEvidenceToken(`${where}.artifact_ids[${index}]`, id);
  }
  requireSafeEvidenceToken(`${where}.server_version`, evidence.server_version);
  requireSafeEvidenceToken(`${where}.anyharness_version`, evidence.anyharness_version);
  if (evidence.harness !== "claude") {
    throw new ReportValidationError(`${where}.harness must be "claude".`);
  }
  requireSafeEvidenceToken(`${where}.model_id`, evidence.model_id);
  requireEvidenceHash(`${where}.workspace_id_hash`, evidence.workspace_id_hash);
  requireEvidenceHash(`${where}.session_id_hash`, evidence.session_id_hash);
  if (evidence.transcript_reopened !== true) {
    throw new ReportValidationError(`${where}.transcript_reopened must be true.`);
  }
  validateLitellmEvidence(where, evidence.litellm);
  validateCleanupEvidence(where, evidence.cleanup, status);
}

// ── Kind-scoped validators for the four new local-functional evidence kinds ──
// Owned by the evidence-runner workstream (BRIEF §"Evidence workstream"). The
// contracts stage provides the exact key arrays + dispatch; the workstream
// fills these bodies with the same safe-token/hash/positive-count/complete-clean
// rigor the `local_workspace_turn` validator uses (reuse `validateLitellmEvidence`
// for `gateway_spend` and `validateCleanupEvidence` for `cleanup`). Green
// requires complete, clean evidence of the matching kind; cursor typed-unsupported
// cells are `blocked`, not green, and carry `evidence: null`.

export const LOCAL_ROUTE_TURN_EVIDENCE_KEYS = [
  "kind",
  "journey",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "route",
  "model_id",
  "workspace_id_hash",
  "session_id_hash",
  "transcript_reopened",
  "gateway_spend",
  "user_key_isolation",
  "route_change",
  "billing_reconcile_deferred",
  "cleanup",
] as const;

export const LOCAL_CONFIG_MATRIX_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "model_id",
  "workspace_id_hash",
  "session_id_hash",
  "controls",
  "known_1063_expected_fail",
  "cleanup",
] as const;

export const LOCAL_SESSION_TABS_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "workspace_id_hash",
  "empty_switch_session_replaced",
  "messaged_switch_new_tab",
  "same_harness_model_change_in_session",
  "reload_preserved",
  "session_id_hashes",
  "cleanup",
] as const;

export const LOCAL_MCP_INTEGRATION_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "model_id",
  "workspace_id_hash",
  "session_id_hash",
  "integration_namespace",
  "tool_name",
  "audit_event_id_hash",
  "audit_ok",
  "cleanup",
] as const;

/** Common front matter shared by every local-functional evidence kind:
 * bounded artifact ids + version tokens + the widened harness field. */
function validateLocalEvidenceCommon(
  where: string,
  evidence: {
    artifact_ids: unknown;
    server_version: unknown;
    anyharness_version: unknown;
    harness: unknown;
  },
): void {
  if (!Array.isArray(evidence.artifact_ids) || evidence.artifact_ids.length === 0) {
    throw new ReportValidationError(`${where}.artifact_ids must be a non-empty array.`);
  }
  for (const [index, id] of evidence.artifact_ids.entries()) {
    requireSafeEvidenceToken(`${where}.artifact_ids[${index}]`, id);
  }
  requireSafeEvidenceToken(`${where}.server_version`, evidence.server_version);
  requireSafeEvidenceToken(`${where}.anyharness_version`, evidence.anyharness_version);
  if (!LOCAL_HARNESS_KINDS.includes(evidence.harness as LocalHarnessKind)) {
    throw new ReportValidationError(`${where}.harness must be one of ${LOCAL_HARNESS_KINDS.join(", ")}.`);
  }
}

const LOCAL_ROUTE_TURN_JOURNEYS = ["LOCAL-2", "LOCAL-3", "LOCAL-6"] as const;
const LOCAL_ROUTES = ["gateway", "user_key"] as const;
const USER_KEY_ISOLATION_KEYS = ["litellm_spend_rows", "managed_balance_read_deferred"] as const;
const ROUTE_CHANGE_KEYS = ["original_route", "original_session_id_hash", "new_route", "new_session_id_hash"] as const;

/**
 * LOCAL-2/LOCAL-3/LOCAL-6 route turn (BRIEF §3.3). Cross-field rules: exactly
 * one of `gateway_spend`/`user_key_isolation` matching `route`, and
 * `route_change` present iff `journey === "LOCAL-6"`.
 */
function validateLocalRouteTurnEvidence(
  evidence: LocalRouteTurnEvidenceV1,
  where: string,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, LOCAL_ROUTE_TURN_EVIDENCE_KEYS, where);
  validateLocalEvidenceCommon(where, evidence);
  if (!LOCAL_ROUTE_TURN_JOURNEYS.includes(evidence.journey as (typeof LOCAL_ROUTE_TURN_JOURNEYS)[number])) {
    throw new ReportValidationError(`${where}.journey must be one of ${LOCAL_ROUTE_TURN_JOURNEYS.join(", ")}.`);
  }
  if (!LOCAL_ROUTES.includes(evidence.route as (typeof LOCAL_ROUTES)[number])) {
    throw new ReportValidationError(`${where}.route must be one of ${LOCAL_ROUTES.join(", ")}.`);
  }
  requireSafeEvidenceToken(`${where}.model_id`, evidence.model_id);
  requireEvidenceHash(`${where}.workspace_id_hash`, evidence.workspace_id_hash);
  requireEvidenceHash(`${where}.session_id_hash`, evidence.session_id_hash);
  if (evidence.transcript_reopened !== true) {
    throw new ReportValidationError(`${where}.transcript_reopened must be true.`);
  }
  if (evidence.route === "gateway") {
    if (evidence.gateway_spend === null) {
      throw new ReportValidationError(`${where}.gateway_spend must be non-null when route is "gateway".`);
    }
    if (evidence.user_key_isolation !== null) {
      throw new ReportValidationError(`${where}.user_key_isolation must be null when route is "gateway".`);
    }
    validateLitellmEvidence(where, evidence.gateway_spend);
  } else {
    if (evidence.gateway_spend !== null) {
      throw new ReportValidationError(`${where}.gateway_spend must be null when route is "user_key".`);
    }
    if (evidence.user_key_isolation === null) {
      throw new ReportValidationError(`${where}.user_key_isolation must be non-null when route is "user_key".`);
    }
    requireExactKeys(evidence.user_key_isolation, USER_KEY_ISOLATION_KEYS, `${where}.user_key_isolation`);
    if (evidence.user_key_isolation.litellm_spend_rows !== 0) {
      throw new ReportValidationError(`${where}.user_key_isolation.litellm_spend_rows must be 0.`);
    }
    if (evidence.user_key_isolation.managed_balance_read_deferred !== true) {
      throw new ReportValidationError(
        `${where}.user_key_isolation.managed_balance_read_deferred must be true (the product balance is not read here — LQF-006).`,
      );
    }
  }
  if (evidence.journey === "LOCAL-6") {
    if (evidence.route_change === null) {
      throw new ReportValidationError(`${where}.route_change must be non-null for journey "LOCAL-6".`);
    }
    requireExactKeys(evidence.route_change, ROUTE_CHANGE_KEYS, `${where}.route_change`);
    if (evidence.route_change.original_route !== "user_key") {
      throw new ReportValidationError(`${where}.route_change.original_route must be "user_key".`);
    }
    if (evidence.route_change.new_route !== "gateway") {
      throw new ReportValidationError(`${where}.route_change.new_route must be "gateway".`);
    }
    requireEvidenceHash(`${where}.route_change.original_session_id_hash`, evidence.route_change.original_session_id_hash);
    requireEvidenceHash(`${where}.route_change.new_session_id_hash`, evidence.route_change.new_session_id_hash);
  } else if (evidence.route_change !== null) {
    throw new ReportValidationError(`${where}.route_change must be null outside journey "LOCAL-6".`);
  }
  if (evidence.billing_reconcile_deferred !== true) {
    throw new ReportValidationError(`${where}.billing_reconcile_deferred must be true.`);
  }
  validateCleanupEvidence(where, evidence.cleanup, status);
}

const CONFIG_CONTROL_KEYS = ["control_key", "accepted_value", "rejected"] as const;

/** LOCAL-4 live configuration matrix (BRIEF §3.3). */
function validateLocalConfigMatrixEvidence(
  evidence: LocalConfigMatrixEvidenceV1,
  where: string,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, LOCAL_CONFIG_MATRIX_EVIDENCE_KEYS, where);
  validateLocalEvidenceCommon(where, evidence);
  requireSafeEvidenceToken(`${where}.model_id`, evidence.model_id);
  requireEvidenceHash(`${where}.workspace_id_hash`, evidence.workspace_id_hash);
  requireEvidenceHash(`${where}.session_id_hash`, evidence.session_id_hash);
  if (!Array.isArray(evidence.controls) || evidence.controls.length === 0) {
    throw new ReportValidationError(`${where}.controls must be a non-empty array.`);
  }
  for (const [index, control] of evidence.controls.entries()) {
    const controlWhere = `${where}.controls[${index}]`;
    if (typeof control !== "object" || control === null || Array.isArray(control)) {
      throw new ReportValidationError(`${controlWhere} must be an object.`);
    }
    requireExactKeys(control, CONFIG_CONTROL_KEYS, controlWhere);
    requireSafeEvidenceToken(`${controlWhere}.control_key`, control.control_key);
    requireSafeEvidenceToken(`${controlWhere}.accepted_value`, control.accepted_value);
    requireBoolean(`${controlWhere}.rejected`, control.rejected);
  }
  requireBoolean(`${where}.known_1063_expected_fail`, evidence.known_1063_expected_fail);
  // A known #1063 rejection is never green (BRIEF §3.3: "never green").
  if (status === "green" && evidence.known_1063_expected_fail === true) {
    throw new ReportValidationError(`${where}.known_1063_expected_fail cannot be true on a green result.`);
  }
  validateCleanupEvidence(where, evidence.cleanup, status);
}

/** LOCAL-5 session and tab semantics (BRIEF §3.3). */
function validateLocalSessionTabsEvidence(
  evidence: LocalSessionTabsEvidenceV1,
  where: string,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, LOCAL_SESSION_TABS_EVIDENCE_KEYS, where);
  validateLocalEvidenceCommon(where, evidence);
  requireEvidenceHash(`${where}.workspace_id_hash`, evidence.workspace_id_hash);
  if (evidence.empty_switch_session_replaced !== true) {
    throw new ReportValidationError(`${where}.empty_switch_session_replaced must be true.`);
  }
  if (evidence.messaged_switch_new_tab !== true) {
    throw new ReportValidationError(`${where}.messaged_switch_new_tab must be true.`);
  }
  if (evidence.same_harness_model_change_in_session !== true) {
    throw new ReportValidationError(`${where}.same_harness_model_change_in_session must be true.`);
  }
  if (evidence.reload_preserved !== true) {
    throw new ReportValidationError(`${where}.reload_preserved must be true.`);
  }
  if (!Array.isArray(evidence.session_id_hashes) || evidence.session_id_hashes.length === 0) {
    throw new ReportValidationError(`${where}.session_id_hashes must be a non-empty array.`);
  }
  const seenSessionHashes = new Set<string>();
  for (const [index, hash] of evidence.session_id_hashes.entries()) {
    requireEvidenceHash(`${where}.session_id_hashes[${index}]`, hash);
    if (seenSessionHashes.has(hash)) {
      throw new ReportValidationError(`${where}.session_id_hashes has a duplicate entry.`);
    }
    seenSessionHashes.add(hash);
  }
  validateCleanupEvidence(where, evidence.cleanup, status);
}

/** LOCAL-7 Product MCP integration (BRIEF §3.3). */
function validateLocalMcpIntegrationEvidence(
  evidence: LocalMcpIntegrationEvidenceV1,
  where: string,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, LOCAL_MCP_INTEGRATION_EVIDENCE_KEYS, where);
  validateLocalEvidenceCommon(where, evidence);
  requireSafeEvidenceToken(`${where}.model_id`, evidence.model_id);
  requireEvidenceHash(`${where}.workspace_id_hash`, evidence.workspace_id_hash);
  requireEvidenceHash(`${where}.session_id_hash`, evidence.session_id_hash);
  requireSafeEvidenceToken(`${where}.integration_namespace`, evidence.integration_namespace);
  requireSafeEvidenceToken(`${where}.tool_name`, evidence.tool_name);
  requireEvidenceHash(`${where}.audit_event_id_hash`, evidence.audit_event_id_hash);
  if (evidence.audit_ok !== true) {
    throw new ReportValidationError(`${where}.audit_ok must be true.`);
  }
  validateCleanupEvidence(where, evidence.cleanup, status);
}

const CLOUD_PROVISION_TURN_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "worker_version",
  "supervisor_version",
  "harness",
  "model_id",
  "template",
  "sandbox_id_hash",
  "worker",
  "covered_repo",
  "isolation",
  "litellm",
  "cleanup",
] as const;

const TEMPLATE_EVIDENCE_KEYS = ["template_id", "build_id", "input_hash"] as const;
const WORKER_EVIDENCE_KEYS = ["supervisor_is_parent", "heartbeat_recent"] as const;
const COVERED_REPO_EVIDENCE_KEYS = ["name", "commit", "no_credential_in_remote"] as const;
const ISOLATION_EVIDENCE_KEYS = ["actor_b_denied", "runtime_rejects_missing", "runtime_rejects_actor_b"] as const;
const CLOUD_CLEANUP_EVIDENCE_KEYS = [
  "ledger_id_hash",
  "registered",
  "reconciled",
  "failed",
  "sandboxes_deleted",
  "template_deleted",
  "dns_record_deleted",
  "ec2_terminated",
  "security_group_deleted",
  "key_pair_deleted",
  "virtual_key_deleted",
  "litellm_subjects_deleted",
  "local_paths_removed",
] as const;

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Kind-scoped validator for `cloud_provision_turn` (PR 2, spec step 10). Per
 * the extension contract: requires the exact declared key set on the object and
 * every nested object (no extra fields); bounds every string field with the
 * same safe-token/hash/timestamp patterns the local kind uses; reuses
 * `validateLitellmEvidence` verbatim for the `litellm` block; requires
 * `template.input_hash` and `sandbox_id_hash` be 64-hex digests and the
 * template ids safe tokens; requires `covered_repo.commit` be a full sha;
 * requires the `worker`/`covered_repo`/`isolation` proofs true (the isolation
 * fields are observed booleans the scenario emits true only when proven);
 * requires non-negative-integer cleanup counts and a boolean on every deletion
 * field; and on a GREEN cell requires `cleanup.failed === 0` and every
 * deletion boolean true (a non-green cell may record its own cleanup
 * failure). Does not touch `validateLocalWorkspaceTurnEvidence`.
 */
function validateCloudProvisionTurnEvidence(
  where: string,
  evidence: CloudProvisionTurnEvidenceV1,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, CLOUD_PROVISION_TURN_EVIDENCE_KEYS, where);
  if (evidence.kind !== "cloud_provision_turn") {
    throw new ReportValidationError(`${where}.kind is unknown.`);
  }
  if (!Array.isArray(evidence.artifact_ids) || evidence.artifact_ids.length === 0) {
    throw new ReportValidationError(`${where}.artifact_ids must be a non-empty array.`);
  }
  for (const [index, id] of evidence.artifact_ids.entries()) {
    requireSafeEvidenceToken(`${where}.artifact_ids[${index}]`, id);
  }
  requireSafeEvidenceToken(`${where}.server_version`, evidence.server_version);
  requireSafeEvidenceToken(`${where}.anyharness_version`, evidence.anyharness_version);
  requireSafeEvidenceToken(`${where}.worker_version`, evidence.worker_version);
  requireSafeEvidenceToken(`${where}.supervisor_version`, evidence.supervisor_version);
  if (evidence.harness !== "claude") {
    throw new ReportValidationError(`${where}.harness must be "claude".`);
  }
  requireSafeEvidenceToken(`${where}.model_id`, evidence.model_id);

  const template = evidence.template;
  if (typeof template !== "object" || template === null || Array.isArray(template)) {
    throw new ReportValidationError(`${where}.template must be an object.`);
  }
  requireExactKeys(template, TEMPLATE_EVIDENCE_KEYS, `${where}.template`);
  requireSafeEvidenceToken(`${where}.template.template_id`, template.template_id);
  requireSafeEvidenceToken(`${where}.template.build_id`, template.build_id);
  requireEvidenceHash(`${where}.template.input_hash`, template.input_hash);

  requireEvidenceHash(`${where}.sandbox_id_hash`, evidence.sandbox_id_hash);

  const worker = evidence.worker;
  if (typeof worker !== "object" || worker === null || Array.isArray(worker)) {
    throw new ReportValidationError(`${where}.worker must be an object.`);
  }
  requireExactKeys(worker, WORKER_EVIDENCE_KEYS, `${where}.worker`);
  if (typeof worker.supervisor_is_parent !== "boolean") {
    // Honest record, not a gate: Supervisor-parentage is PR 9's guarantee
    // (deferred), so this is boolean, not required-true.
    throw new ReportValidationError(`${where}.worker.supervisor_is_parent must be a boolean.`);
  }
  if (worker.heartbeat_recent !== true) {
    throw new ReportValidationError(`${where}.worker.heartbeat_recent must be true.`);
  }

  const coveredRepo = evidence.covered_repo;
  if (typeof coveredRepo !== "object" || coveredRepo === null || Array.isArray(coveredRepo)) {
    throw new ReportValidationError(`${where}.covered_repo must be an object.`);
  }
  requireExactKeys(coveredRepo, COVERED_REPO_EVIDENCE_KEYS, `${where}.covered_repo`);
  requireSafeEvidenceToken(`${where}.covered_repo.name`, coveredRepo.name);
  if (typeof coveredRepo.commit !== "string" || !FULL_SHA_PATTERN.test(coveredRepo.commit)) {
    throw new ReportValidationError(`${where}.covered_repo.commit must be a full lowercase 40-hex sha.`);
  }
  if (coveredRepo.no_credential_in_remote !== true) {
    throw new ReportValidationError(`${where}.covered_repo.no_credential_in_remote must be true.`);
  }

  const isolation = evidence.isolation;
  if (typeof isolation !== "object" || isolation === null || Array.isArray(isolation)) {
    throw new ReportValidationError(`${where}.isolation must be an object.`);
  }
  requireExactKeys(isolation, ISOLATION_EVIDENCE_KEYS, `${where}.isolation`);
  if (isolation.actor_b_denied !== true) {
    throw new ReportValidationError(`${where}.isolation.actor_b_denied must be true.`);
  }
  if (isolation.runtime_rejects_missing !== true) {
    throw new ReportValidationError(`${where}.isolation.runtime_rejects_missing must be true.`);
  }
  if (isolation.runtime_rejects_actor_b !== true) {
    throw new ReportValidationError(`${where}.isolation.runtime_rejects_actor_b must be true.`);
  }

  validateLitellmEvidence(where, evidence.litellm);
  validateCloudCleanupEvidence(where, evidence.cleanup, status);
}

function validateCloudCleanupEvidence(
  where: string,
  cleanup: CloudProvisionTurnEvidenceV1["cleanup"],
  status: FinalTestStatus,
): void {
  if (typeof cleanup !== "object" || cleanup === null || Array.isArray(cleanup)) {
    throw new ReportValidationError(`${where}.cleanup must be an object.`);
  }
  requireExactKeys(cleanup, CLOUD_CLEANUP_EVIDENCE_KEYS, `${where}.cleanup`);
  requireEvidenceHash(`${where}.cleanup.ledger_id_hash`, cleanup.ledger_id_hash);
  requireNonNegativeInteger(`${where}.cleanup.registered`, cleanup.registered);
  requireNonNegativeInteger(`${where}.cleanup.reconciled`, cleanup.reconciled);
  requireNonNegativeInteger(`${where}.cleanup.failed`, cleanup.failed);
  const deletionFields = [
    "sandboxes_deleted",
    "template_deleted",
    "dns_record_deleted",
    "ec2_terminated",
    "security_group_deleted",
    "key_pair_deleted",
    "virtual_key_deleted",
    "litellm_subjects_deleted",
    "local_paths_removed",
  ] as const;
  for (const field of deletionFields) {
    requireBoolean(`${where}.cleanup.${field}`, cleanup[field]);
  }
  // Green-cell rule (spec "Cleanup and failure behavior"): a green cell requires
  // failed === 0 and every deletion boolean true; a non-green cell may record
  // its own cleanup failure so the report is still persisted with a real
  // nonzero exit rather than throwing and exiting 2.
  if (status === "green") {
    if (cleanup.failed > 0) {
      throw new ReportValidationError(`${where}.cleanup.failed must be 0 for a green result.`);
    }
    if (deletionFields.some((field) => cleanup[field] !== true)) {
      throw new ReportValidationError(`${where}.cleanup is incomplete on a green result.`);
    }
  }
}

const SELFHOST_BASE_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "api_origin",
  "controller_runtime_origin",
  "cleanup",
] as const;

const SELFHOST_INSTALL_CLAIM_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "candidate_server_version",
  "server_version_matches_candidate",
  "running_image_digest",
  "bundle_sha256",
  "setup_token_hash",
  "owner_user_id_hash",
  "org_id_hash",
  "tls_verified",
  "second_claim_rejected",
  "restart_persisted",
] as const;

const SELFHOST_DESKTOP_OWNER_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "owner_user_id_hash",
  "org_id_hash",
  "connect_rejected_invalid_url",
  "connect_rejected_non_proliferate_host",
  "only_meta_before_trust",
  "owner_login_verified",
  "single_org",
] as const;

const SELFHOST_BASE_TURN_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "model_id",
  "workspace_id_hash",
  "session_id_hash",
  "transcript_reopened",
  "byok_route",
  "byok_key_id_hash",
  "no_litellm_spend",
  "no_e2b",
] as const;

const SELFHOST_INVITEE_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "invitee_user_id_hash",
  "invitation_id_hash",
  "member_role",
  "second_page_isolated",
  "authenticated_member_action",
] as const;

// ── PR 7 self-host evidence key sets (append-only) ─────────────────────────

const SELFHOST_GITHUB_AUTH_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "owner_user_id_hash",
  "org_id_hash",
  "github_identity_a_hash",
  "github_identity_b_hash",
  "setup_password_only",
  "owner_link_no_duplicate",
  "uninvited_denied",
  "invited_admitted",
  "member_role",
  "methods_advertise_github",
] as const;

const SELFHOST_SWITCH_ISOLATION_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "server_a_origin",
  "server_b_origin",
  "no_cross_origin_token",
  "no_cross_origin_pending_auth",
  "no_cross_origin_credential",
  "no_cross_origin_runtime_identity",
  "no_cross_origin_workspace_session",
  "b_started_anonymous",
  "b_authenticated_independently",
  "a_state_restored_origin_scoped",
] as const;

const SELFHOST_GATEWAY_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "actor_user_id_hash",
  "virtual_key_id_hash",
  "litellm_image_digest",
  "model_id",
  "capability_gateway_before",
  "capability_gateway_after",
  "gateway_spend_correlated",
  "master_key_not_used",
  "restart_persisted",
] as const;

const SELFHOST_CLOUD_ADDON_EVIDENCE_KEYS = [
  ...SELFHOST_BASE_EVIDENCE_KEYS,
  "github_app_installation_id_hash",
  "e2b_template_id",
  "sandbox_id_hash",
  "workspace_id_hash",
  "session_id_hash",
  "turn_completed",
  "pause_wake_state_intact",
  "disable_truthful",
  "base_healthy_after_disable",
] as const;

const SELFHOST_CFN_WRAPPER_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "api_origin",
  "stack_name_hash",
  "image_repo_digest",
  "release_version_tag",
  "template_sha256",
  "template_validated",
  "bundle_digest_bound",
  "image_digest_bound",
  "outputs_valid",
  "dns_tls_verified",
  "meta_version_matches",
  "cleanup",
] as const;

const SELFHOST_CFN_CLEANUP_EVIDENCE_KEYS = [
  "ledger_id_hash",
  "registered",
  "reconciled",
  "failed",
  "stack_deleted",
  "s3_objects_deleted",
  "ghcr_version_deleted",
  "route53_record_deleted",
  "local_paths_removed",
] as const;

const SELFHOST_CFN_CLEANUP_DELETION_FIELDS = [
  "stack_deleted",
  "s3_objects_deleted",
  "ghcr_version_deleted",
  "route53_record_deleted",
  "local_paths_removed",
] as const;

const SELFHOST_CLEANUP_EVIDENCE_KEYS = [
  "ledger_id_hash",
  "registered",
  "reconciled",
  "failed",
  "ec2_terminated",
  "security_group_deleted",
  "key_pair_deleted",
  "route53_record_deleted",
  "browser_closed",
  "processes_stopped",
  "local_paths_removed",
] as const;

const SELFHOST_CLEANUP_DELETION_FIELDS = [
  "ec2_terminated",
  "security_group_deleted",
  "key_pair_deleted",
  "route53_record_deleted",
  "browser_closed",
  "processes_stopped",
  "local_paths_removed",
] as const;

function requireTrue(where: string, value: unknown): void {
  if (value !== true) {
    throw new ReportValidationError(`${where} must be true.`);
  }
}

/**
 * A run-window provider-absence claim (PR7-CONTROL-010): exactly `"unproven"`
 * (observation not performed) or `"observed_absent"` (a real run-window
 * spend/traffic observation confirmed absence). A bare `true` — an absence
 * asserted from configuration/an unavailable observation — is rejected.
 */
function requireProviderClaim(where: string, value: unknown): void {
  if (value !== "unproven" && value !== "observed_absent") {
    throw new ReportValidationError(`${where} must be "unproven" or "observed_absent".`);
  }
}

function requireFalse(where: string, value: unknown): void {
  if (value !== false) {
    throw new ReportValidationError(`${where} must be false.`);
  }
}

/**
 * Validates one self-host journey cell's evidence (BRIEF §"Evidence
 * workstream"): exact keys per kind; every string field passes the same
 * `requireSafeEvidenceToken`/`requireEvidenceHash` checks the local_workspace_turn
 * kind uses; `api_origin` and `controller_runtime_origin` are distinct safe
 * hostnames (evidence never implies AnyHarness ran on the box); the literal-`true`
 * witness booleans are exactly `true`; the `cleanup` block validates through the
 * shared green-requires-clean rule (failed === 0 and every deletion boolean true
 * on a GREEN cell; a non-green cell may record its own cleanup failure).
 */
function validateSelfHostCellEvidence(
  where: string,
  evidence: CellEvidenceV1,
  status: FinalTestStatus,
): void {
  const kind = (evidence as { kind?: unknown }).kind;

  // The CFN-wrapper posture's evidence shape has no controller_runtime_origin/
  // anyharness_version (see `SelfHostCfnWrapperEvidenceV1`'s doc comment: it
  // does not extend `SelfHostEvidenceBaseV1`), so it is validated end to end
  // by its own function rather than through the shared base-field walk below.
  if (kind === "selfhost_cfn_wrapper") {
    validateSelfHostCfnWrapperEvidence(where, evidence as SelfHostCfnWrapperEvidenceV1, status);
    return;
  }

  const keysByKind: Record<string, readonly string[]> = {
    selfhost_install_claim: SELFHOST_INSTALL_CLAIM_EVIDENCE_KEYS,
    selfhost_desktop_owner: SELFHOST_DESKTOP_OWNER_EVIDENCE_KEYS,
    selfhost_base_turn: SELFHOST_BASE_TURN_EVIDENCE_KEYS,
    selfhost_invitee: SELFHOST_INVITEE_EVIDENCE_KEYS,
    selfhost_github_auth: SELFHOST_GITHUB_AUTH_EVIDENCE_KEYS,
    selfhost_switch_isolation: SELFHOST_SWITCH_ISOLATION_EVIDENCE_KEYS,
    selfhost_gateway: SELFHOST_GATEWAY_EVIDENCE_KEYS,
    selfhost_cloud_addon: SELFHOST_CLOUD_ADDON_EVIDENCE_KEYS,
  };
  const expectedKeys = typeof kind === "string" ? keysByKind[kind] : undefined;
  if (!expectedKeys) {
    throw new ReportValidationError(`${where}.kind is unknown.`);
  }
  requireExactKeys(evidence, expectedKeys, where);

  const base = evidence as unknown as SelfHostEvidenceBaseV1 & { kind: string };
  if (!Array.isArray(base.artifact_ids) || base.artifact_ids.length === 0) {
    throw new ReportValidationError(`${where}.artifact_ids must be a non-empty array.`);
  }
  for (const [index, id] of base.artifact_ids.entries()) {
    requireSafeEvidenceToken(`${where}.artifact_ids[${index}]`, id);
  }
  requireSafeEvidenceToken(`${where}.server_version`, base.server_version);
  requireSafeEvidenceToken(`${where}.anyharness_version`, base.anyharness_version);
  if (base.harness !== "claude") {
    throw new ReportValidationError(`${where}.harness must be "claude".`);
  }
  requireSafeEvidenceToken(`${where}.api_origin`, base.api_origin);
  requireSafeEvidenceToken(`${where}.controller_runtime_origin`, base.controller_runtime_origin);
  if (base.api_origin === base.controller_runtime_origin) {
    throw new ReportValidationError(
      `${where}.api_origin and controller_runtime_origin must be distinct (AnyHarness did not run on the box).`,
    );
  }
  validateSelfHostCleanupEvidence(where, base.cleanup, status);

  switch (kind) {
    case "selfhost_install_claim": {
      const e = evidence as SelfHostInstallClaimEvidenceV1;
      requireSafeEvidenceToken(`${where}.candidate_server_version`, e.candidate_server_version);
      requireTrue(`${where}.server_version_matches_candidate`, e.server_version_matches_candidate);
      requireSafeEvidenceToken(`${where}.running_image_digest`, e.running_image_digest);
      requireEvidenceHash(`${where}.bundle_sha256`, e.bundle_sha256);
      requireEvidenceHash(`${where}.setup_token_hash`, e.setup_token_hash);
      requireEvidenceHash(`${where}.owner_user_id_hash`, e.owner_user_id_hash);
      requireEvidenceHash(`${where}.org_id_hash`, e.org_id_hash);
      requireTrue(`${where}.tls_verified`, e.tls_verified);
      requireTrue(`${where}.second_claim_rejected`, e.second_claim_rejected);
      requireTrue(`${where}.restart_persisted`, e.restart_persisted);
      return;
    }
    case "selfhost_desktop_owner": {
      const e = evidence as SelfHostDesktopOwnerEvidenceV1;
      requireEvidenceHash(`${where}.owner_user_id_hash`, e.owner_user_id_hash);
      requireEvidenceHash(`${where}.org_id_hash`, e.org_id_hash);
      requireTrue(`${where}.connect_rejected_invalid_url`, e.connect_rejected_invalid_url);
      requireTrue(`${where}.connect_rejected_non_proliferate_host`, e.connect_rejected_non_proliferate_host);
      requireTrue(`${where}.only_meta_before_trust`, e.only_meta_before_trust);
      requireTrue(`${where}.owner_login_verified`, e.owner_login_verified);
      requireTrue(`${where}.single_org`, e.single_org);
      return;
    }
    case "selfhost_base_turn": {
      const e = evidence as SelfHostBaseTurnEvidenceV1;
      requireSafeEvidenceToken(`${where}.model_id`, e.model_id);
      requireEvidenceHash(`${where}.workspace_id_hash`, e.workspace_id_hash);
      requireEvidenceHash(`${where}.session_id_hash`, e.session_id_hash);
      requireTrue(`${where}.transcript_reopened`, e.transcript_reopened);
      if (e.byok_route !== "api_key") {
        throw new ReportValidationError(`${where}.byok_route must be "api_key".`);
      }
      requireEvidenceHash(`${where}.byok_key_id_hash`, e.byok_key_id_hash);
      requireProviderClaim(`${where}.no_litellm_spend`, e.no_litellm_spend);
      requireProviderClaim(`${where}.no_e2b`, e.no_e2b);
      // Defense-in-depth for PR7-CONTROL-010: the frozen contract folds the
      // provider-absence guarantees into SH-BASE-TURN, so an UNPROVEN required
      // subclaim cannot contribute a GREEN result. A green base-turn must have
      // BOTH claims `observed_absent`; `unproven` on green is rejected here even
      // if the cell logic ever regressed to returning green with unproven claims.
      if (status === "green") {
        if (e.no_litellm_spend !== "observed_absent") {
          throw new ReportValidationError(
            `${where}.no_litellm_spend is "${e.no_litellm_spend}" on a GREEN result; a green SH-BASE-TURN requires "observed_absent".`,
          );
        }
        if (e.no_e2b !== "observed_absent") {
          throw new ReportValidationError(
            `${where}.no_e2b is "${e.no_e2b}" on a GREEN result; a green SH-BASE-TURN requires "observed_absent".`,
          );
        }
      }
      return;
    }
    case "selfhost_invitee": {
      const e = evidence as SelfHostInviteeEvidenceV1;
      requireEvidenceHash(`${where}.invitee_user_id_hash`, e.invitee_user_id_hash);
      requireEvidenceHash(`${where}.invitation_id_hash`, e.invitation_id_hash);
      if (e.member_role !== "member") {
        throw new ReportValidationError(`${where}.member_role must be "member".`);
      }
      requireTrue(`${where}.second_page_isolated`, e.second_page_isolated);
      requireTrue(`${where}.authenticated_member_action`, e.authenticated_member_action);
      return;
    }
    case "selfhost_github_auth": {
      const e = evidence as SelfHostGithubAuthEvidenceV1;
      requireEvidenceHash(`${where}.owner_user_id_hash`, e.owner_user_id_hash);
      requireEvidenceHash(`${where}.org_id_hash`, e.org_id_hash);
      requireEvidenceHash(`${where}.github_identity_a_hash`, e.github_identity_a_hash);
      requireEvidenceHash(`${where}.github_identity_b_hash`, e.github_identity_b_hash);
      requireTrue(`${where}.setup_password_only`, e.setup_password_only);
      requireTrue(`${where}.owner_link_no_duplicate`, e.owner_link_no_duplicate);
      requireTrue(`${where}.uninvited_denied`, e.uninvited_denied);
      requireTrue(`${where}.invited_admitted`, e.invited_admitted);
      requireSafeEvidenceToken(`${where}.member_role`, e.member_role);
      requireTrue(`${where}.methods_advertise_github`, e.methods_advertise_github);
      return;
    }
    case "selfhost_switch_isolation": {
      const e = evidence as SelfHostSwitchIsolationEvidenceV1;
      requireSafeEvidenceToken(`${where}.server_a_origin`, e.server_a_origin);
      requireSafeEvidenceToken(`${where}.server_b_origin`, e.server_b_origin);
      // `api_origin` doubles as server A's origin (base compatibility, see the
      // type's doc comment); the two must agree so evidence cannot claim a
      // different server A than the shared base-field check above verified.
      if (e.api_origin !== e.server_a_origin) {
        throw new ReportValidationError(`${where}.api_origin must equal server_a_origin.`);
      }
      if (e.server_a_origin === e.server_b_origin) {
        throw new ReportValidationError(`${where}.server_a_origin and server_b_origin must be distinct.`);
      }
      requireTrue(`${where}.no_cross_origin_token`, e.no_cross_origin_token);
      requireTrue(`${where}.no_cross_origin_pending_auth`, e.no_cross_origin_pending_auth);
      requireTrue(`${where}.no_cross_origin_credential`, e.no_cross_origin_credential);
      requireTrue(`${where}.no_cross_origin_runtime_identity`, e.no_cross_origin_runtime_identity);
      requireTrue(`${where}.no_cross_origin_workspace_session`, e.no_cross_origin_workspace_session);
      requireTrue(`${where}.b_started_anonymous`, e.b_started_anonymous);
      requireTrue(`${where}.b_authenticated_independently`, e.b_authenticated_independently);
      requireTrue(`${where}.a_state_restored_origin_scoped`, e.a_state_restored_origin_scoped);
      return;
    }
    case "selfhost_gateway": {
      const e = evidence as SelfHostGatewayEvidenceV1;
      requireEvidenceHash(`${where}.actor_user_id_hash`, e.actor_user_id_hash);
      requireEvidenceHash(`${where}.virtual_key_id_hash`, e.virtual_key_id_hash);
      requireSafeEvidenceToken(`${where}.litellm_image_digest`, e.litellm_image_digest);
      requireSafeEvidenceToken(`${where}.model_id`, e.model_id);
      requireFalse(`${where}.capability_gateway_before`, e.capability_gateway_before);
      requireTrue(`${where}.capability_gateway_after`, e.capability_gateway_after);
      requireTrue(`${where}.gateway_spend_correlated`, e.gateway_spend_correlated);
      requireTrue(`${where}.master_key_not_used`, e.master_key_not_used);
      requireTrue(`${where}.restart_persisted`, e.restart_persisted);
      return;
    }
    case "selfhost_cloud_addon": {
      const e = evidence as SelfHostCloudAddonEvidenceV1;
      requireEvidenceHash(`${where}.github_app_installation_id_hash`, e.github_app_installation_id_hash);
      requireSafeEvidenceToken(`${where}.e2b_template_id`, e.e2b_template_id);
      requireEvidenceHash(`${where}.sandbox_id_hash`, e.sandbox_id_hash);
      requireEvidenceHash(`${where}.workspace_id_hash`, e.workspace_id_hash);
      requireEvidenceHash(`${where}.session_id_hash`, e.session_id_hash);
      requireTrue(`${where}.turn_completed`, e.turn_completed);
      requireTrue(`${where}.pause_wake_state_intact`, e.pause_wake_state_intact);
      requireTrue(`${where}.disable_truthful`, e.disable_truthful);
      requireTrue(`${where}.base_healthy_after_disable`, e.base_healthy_after_disable);
      return;
    }
    default:
      throw new ReportValidationError(`${where}.kind is unknown.`);
  }
}

/**
 * Kind-scoped validator for `SelfHostCfnWrapperEvidenceV1` (PR 7): this kind
 * does not extend `SelfHostEvidenceBaseV1` (no controller-local AnyHarness
 * runtime exists in a CFN-wrapper posture — there is only the one deployed
 * stack), so it validates its own field set end to end rather than sharing
 * `validateSelfHostCellEvidence`'s base-field walk. The cleanup block mirrors
 * `validateSelfHostCleanupEvidence`'s green-requires-clean rule (`failed === 0`
 * and every deletion boolean `true` on a GREEN cell only; a non-green cell may
 * still record its own cleanup failure).
 */
function validateSelfHostCfnWrapperEvidence(
  where: string,
  evidence: SelfHostCfnWrapperEvidenceV1,
  status: FinalTestStatus,
): void {
  requireExactKeys(evidence, SELFHOST_CFN_WRAPPER_EVIDENCE_KEYS, where);
  if (evidence.kind !== "selfhost_cfn_wrapper") {
    throw new ReportValidationError(`${where}.kind is unknown.`);
  }
  if (!Array.isArray(evidence.artifact_ids) || evidence.artifact_ids.length === 0) {
    throw new ReportValidationError(`${where}.artifact_ids must be a non-empty array.`);
  }
  for (const [index, id] of evidence.artifact_ids.entries()) {
    requireSafeEvidenceToken(`${where}.artifact_ids[${index}]`, id);
  }
  requireSafeEvidenceToken(`${where}.server_version`, evidence.server_version);
  requireSafeEvidenceToken(`${where}.api_origin`, evidence.api_origin);
  requireEvidenceHash(`${where}.stack_name_hash`, evidence.stack_name_hash);
  requireSafeEvidenceToken(`${where}.image_repo_digest`, evidence.image_repo_digest);
  requireSafeEvidenceToken(`${where}.release_version_tag`, evidence.release_version_tag);
  requireSafeEvidenceToken(`${where}.template_sha256`, evidence.template_sha256);
  requireTrue(`${where}.template_validated`, evidence.template_validated);
  requireTrue(`${where}.bundle_digest_bound`, evidence.bundle_digest_bound);
  requireTrue(`${where}.image_digest_bound`, evidence.image_digest_bound);
  requireTrue(`${where}.outputs_valid`, evidence.outputs_valid);
  requireTrue(`${where}.dns_tls_verified`, evidence.dns_tls_verified);
  requireTrue(`${where}.meta_version_matches`, evidence.meta_version_matches);

  const cleanup = evidence.cleanup;
  if (typeof cleanup !== "object" || cleanup === null || Array.isArray(cleanup)) {
    throw new ReportValidationError(`${where}.cleanup must be an object.`);
  }
  requireExactKeys(cleanup, SELFHOST_CFN_CLEANUP_EVIDENCE_KEYS, `${where}.cleanup`);
  requireEvidenceHash(`${where}.cleanup.ledger_id_hash`, cleanup.ledger_id_hash);
  requireNonNegativeInteger(`${where}.cleanup.registered`, cleanup.registered);
  requireNonNegativeInteger(`${where}.cleanup.reconciled`, cleanup.reconciled);
  requireNonNegativeInteger(`${where}.cleanup.failed`, cleanup.failed);
  for (const field of SELFHOST_CFN_CLEANUP_DELETION_FIELDS) {
    requireBoolean(`${where}.cleanup.${field}`, cleanup[field]);
  }
  if (status === "green") {
    if (cleanup.failed > 0) {
      throw new ReportValidationError(`${where}.cleanup.failed must be 0 for a green result.`);
    }
    if (SELFHOST_CFN_CLEANUP_DELETION_FIELDS.some((field) => cleanup[field] !== true)) {
      throw new ReportValidationError(`${where}.cleanup is incomplete on a green result.`);
    }
  }
}

/**
 * Validates the self-host cleanup block: exact keys, a safe ledger hash,
 * non-negative counts, and boolean deletion flags — a GREEN cell requires
 * `failed === 0` and every deletion boolean `true` (mirrors
 * `validateCleanupEvidence`'s green-requires-clean rule; a non-green cell may
 * still carry evidence recording its own cleanup failure).
 */
function validateSelfHostCleanupEvidence(
  where: string,
  cleanup: SelfHostCleanupEvidenceBlock,
  status: FinalTestStatus,
): void {
  if (typeof cleanup !== "object" || cleanup === null || Array.isArray(cleanup)) {
    throw new ReportValidationError(`${where}.cleanup must be an object.`);
  }
  requireExactKeys(cleanup, SELFHOST_CLEANUP_EVIDENCE_KEYS, `${where}.cleanup`);
  requireEvidenceHash(`${where}.cleanup.ledger_id_hash`, cleanup.ledger_id_hash);
  requireNonNegativeInteger(`${where}.cleanup.registered`, cleanup.registered);
  requireNonNegativeInteger(`${where}.cleanup.reconciled`, cleanup.reconciled);
  requireNonNegativeInteger(`${where}.cleanup.failed`, cleanup.failed);
  for (const field of SELFHOST_CLEANUP_DELETION_FIELDS) {
    requireBoolean(`${where}.cleanup.${field}`, cleanup[field]);
  }
  if (status === "green") {
    if (cleanup.failed > 0) {
      throw new ReportValidationError(`${where}.cleanup.failed must be 0 for a green result.`);
    }
    if (SELFHOST_CLEANUP_DELETION_FIELDS.some((field) => cleanup[field] !== true)) {
      throw new ReportValidationError(`${where}.cleanup is incomplete on a green result.`);
    }
  }
}

function validateLitellmEvidence(where: string, litellm: LocalWorkspaceTurnEvidenceV1["litellm"]): void {
  if (typeof litellm !== "object" || litellm === null || Array.isArray(litellm)) {
    throw new ReportValidationError(`${where}.litellm must be an object.`);
  }
  requireExactKeys(litellm, LITELLM_EVIDENCE_KEYS, `${where}.litellm`);
  requireEvidenceHash(`${where}.litellm.token_id_hash`, litellm.token_id_hash);
  if (!Array.isArray(litellm.request_ids) || litellm.request_ids.length === 0) {
    throw new ReportValidationError(`${where}.litellm.request_ids must be a non-empty array.`);
  }
  if (litellm.request_ids.length > MAX_LITELLM_REQUEST_IDS) {
    throw new ReportValidationError(`${where}.litellm.request_ids exceeds the bounded cap of ${MAX_LITELLM_REQUEST_IDS}.`);
  }
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, id] of litellm.request_ids.entries()) {
    requireSafeEvidenceToken(`${where}.litellm.request_ids[${index}]`, id);
    if (seen.has(id)) {
      throw new ReportValidationError(`${where}.litellm.request_ids has a duplicate entry.`);
    }
    seen.add(id);
    if (previous !== undefined && id < previous) {
      throw new ReportValidationError(`${where}.litellm.request_ids must be sorted ascending.`);
    }
    previous = id;
  }
  requireEvidenceTimestamp(`${where}.litellm.window_started_at`, litellm.window_started_at);
  requireEvidenceTimestamp(`${where}.litellm.window_finished_at`, litellm.window_finished_at);
  if (litellm.window_finished_at < litellm.window_started_at) {
    throw new ReportValidationError(`${where}.litellm window_finished_at precedes window_started_at.`);
  }
  for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"] as const) {
    const value = litellm[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new ReportValidationError(`${where}.litellm.${field} must be a positive integer.`);
    }
  }
  if (litellm.prompt_tokens + litellm.completion_tokens !== litellm.total_tokens) {
    throw new ReportValidationError(`${where}.litellm token counts are internally inconsistent.`);
  }
  if (typeof litellm.spend_usd !== "number" || !Number.isFinite(litellm.spend_usd) || litellm.spend_usd <= 0) {
    throw new ReportValidationError(`${where}.litellm.spend_usd must be positive.`);
  }
}

function validateCleanupEvidence(
  where: string,
  cleanup: LocalWorkspaceTurnEvidenceV1["cleanup"],
  status: FinalTestStatus,
): void {
  if (typeof cleanup !== "object" || cleanup === null || Array.isArray(cleanup)) {
    throw new ReportValidationError(`${where}.cleanup must be an object.`);
  }
  requireExactKeys(cleanup, CLEANUP_EVIDENCE_KEYS, `${where}.cleanup`);
  requireEvidenceHash(`${where}.cleanup.ledger_id_hash`, cleanup.ledger_id_hash);
  requireNonNegativeInteger(`${where}.cleanup.registered`, cleanup.registered);
  requireNonNegativeInteger(`${where}.cleanup.reconciled`, cleanup.reconciled);
  requireNonNegativeInteger(`${where}.cleanup.failed`, cleanup.failed);
  const deletionFields = [
    "virtual_key_deleted",
    "litellm_subjects_deleted",
    "browser_closed",
    "processes_stopped",
    "containers_removed",
    "local_paths_removed",
  ] as const;
  for (const field of deletionFields) {
    requireBoolean(`${where}.cleanup.${field}`, cleanup[field]);
  }
  // Green-cell rule (spec "Cleanup and failure behavior"): a green cell requires
  // complete clean cleanup evidence — zero failed entries and every deletion
  // boolean true. A non-green cell may carry evidence that records the cleanup
  // failure itself (failed > 0 and/or an incomplete deletion) so the report is
  // still persisted with a real nonzero exit rather than throwing and exiting 2.
  if (status === "green") {
    if (cleanup.failed > 0) {
      throw new ReportValidationError(`${where}.cleanup.failed must be 0 for a green result.`);
    }
    if (deletionFields.some((field) => cleanup[field] !== true)) {
      throw new ReportValidationError(`${where}.cleanup is incomplete on a green result.`);
    }
  }
}

/**
 * Applies the same redaction pipeline message fields use
 * (`redactSecrets`/`redactUrlCredentials`/`boundMessage`) to every
 * string-bearing evidence field before validation, per BRIEF §6.6. A raw
 * secret or local path that somehow reached evidence is turned into a
 * `[REDACTED]`-bearing string here, which the safe-token/hash patterns above
 * then reject rather than silently persisting.
 */
/**
 * Scenario ids whose GREEN cells must carry complete evidence (a green cell
 * with `evidence: null` is rejected). Kind/id-scoped allowlist — LOCAL-WORLD
 * proof, the PR-4 Tier-2 scenarios, and the PR-3 self-host journey scenario
 * (BRIEF §2/§7). Extend here, not by touching another kind's validation.
 */
const GREEN_EVIDENCE_REQUIRED_SCENARIOS: ReadonlySet<string> = new Set([
  "LOCAL-WORLD-SMOKE-1",
  "T2-BILL",
  "T2-AUTH-ORG",
  SELFHOST_INSTALL_1_SCENARIO_ID,
  "CLOUD-PROVISION-1",
  // Every SELFHOST-QUAL-1 cell (SH-GITHUB-AUTH / SH-GATEWAY / SH-CLOUD-ADDON)
  // emits its kind-scoped evidence on green (a bare string here, not a scenario
  // import, to keep schema.ts free of a scenario→schema cycle — matching
  // CLOUD-PROVISION-1). Enforces the frozen Acceptance rule "Green requires
  // complete evidence" for the optional-capability lane.
  "SELFHOST-QUAL-1",
  // PR7-CONTROL-007: CFN and isolation were missing here, so either could
  // validate GREEN with null evidence. Both now require their kind-scoped
  // evidence on green. (SELFHOST-ISOLATION-1 is fail-closed today, so this only
  // ever bites if it later greens without evidence — which is exactly the guard.)
  "SELFHOST-CFN-1",
  "SELFHOST-ISOLATION-1",
]);

function scenarioRequiresGreenEvidence(scenarioId: string): boolean {
  return GREEN_EVIDENCE_REQUIRED_SCENARIOS.has(scenarioId);
}

const TIER2_BILLING_EVIDENCE_KEYS = [
  "kind",
  "manifest_id",
  "server_version",
  "billing_mode",
  "asserted_policy",
  "stripe",
  "ledger",
] as const;

const TIER2_ASSERTED_POLICY_KEYS = [
  "free_grant_usd",
  "llm_per_seat_usd",
  "compute_per_seat_usd",
  "compute_margin_multiplier",
  "topup_pack_usd",
  "topup_margin_pct",
  "topup_trigger_usd",
  "overage_cap_usd_per_org_month",
] as const;

const TIER2_LEDGER_KEYS = [
  "grants_delta",
  "seat_adjustments_delta",
  "usage_exports_delta",
  "llm_events_delta",
  "webhook_receipts_delta",
  "holds_delta",
] as const;

const MAX_TIER2_TEST_CLOCK_IDS = 20;
const MAX_TIER2_OBJECT_IDS = 50;

/**
 * Kind-scoped validator for `Tier2BillingEvidenceV1`:
 *   - `requireExactKeys` at top / `asserted_policy` / `stripe` / `ledger`;
 *   - `manifest_id` + `server_version` via `requireSafeEvidenceToken`;
 *   - `billing_mode` in {enforce,observe,off};
 *   - every present `asserted_policy` value: finite number >= 0 (the exact
 *     ruled number is asserted by the cell against the product, not here);
 *   - `stripe.test_clock_ids` (<= MAX_TIER2_TEST_CLOCK_IDS) and
 *     `stripe.object_ids` (<= MAX_TIER2_OBJECT_IDS): safe tokens, sorted
 *     ascending, unique, secret-free;
 *   - every `ledger.*` delta: `requireNonNegativeInteger`.
 * Green completeness is enforced upstream (a green Tier-2 cell with null
 * evidence is already rejected via `scenarioRequiresGreenEvidence`).
 */
function validateTier2BillingEvidence(
  where: string,
  evidence: Tier2BillingEvidenceV1,
  _status: FinalTestStatus,
): void {
  requireExactKeys(evidence, TIER2_BILLING_EVIDENCE_KEYS, where);
  if (evidence.kind !== "tier2_billing") {
    throw new ReportValidationError(`${where}.kind is unknown.`);
  }
  requireSafeEvidenceToken(`${where}.manifest_id`, evidence.manifest_id);
  requireSafeEvidenceToken(`${where}.server_version`, evidence.server_version);
  if (evidence.billing_mode !== "enforce" && evidence.billing_mode !== "observe" && evidence.billing_mode !== "off") {
    throw new ReportValidationError(`${where}.billing_mode must be one of enforce|observe|off.`);
  }

  const policy = evidence.asserted_policy;
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new ReportValidationError(`${where}.asserted_policy must be an object.`);
  }
  const presentPolicyKeys = Object.keys(policy);
  for (const key of presentPolicyKeys) {
    if (!(TIER2_ASSERTED_POLICY_KEYS as readonly string[]).includes(key)) {
      throw new ReportValidationError(`${where}.asserted_policy has an undeclared field "${key}".`);
    }
  }
  for (const key of presentPolicyKeys as (keyof typeof policy)[]) {
    const value = policy[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new ReportValidationError(`${where}.asserted_policy.${key} must be a finite number >= 0.`);
    }
  }

  const stripe = evidence.stripe;
  if (typeof stripe !== "object" || stripe === null || Array.isArray(stripe)) {
    throw new ReportValidationError(`${where}.stripe must be an object.`);
  }
  requireExactKeys(stripe, ["test_clock_ids", "object_ids"], `${where}.stripe`);
  validateSortedUniqueSafeTokenArray(`${where}.stripe.test_clock_ids`, stripe.test_clock_ids, MAX_TIER2_TEST_CLOCK_IDS);
  validateSortedUniqueSafeTokenArray(`${where}.stripe.object_ids`, stripe.object_ids, MAX_TIER2_OBJECT_IDS);

  const ledger = evidence.ledger;
  if (typeof ledger !== "object" || ledger === null || Array.isArray(ledger)) {
    throw new ReportValidationError(`${where}.ledger must be an object.`);
  }
  requireExactKeys(ledger, TIER2_LEDGER_KEYS, `${where}.ledger`);
  for (const key of TIER2_LEDGER_KEYS) {
    requireNonNegativeInteger(`${where}.ledger.${key}`, ledger[key]);
  }
}

function validateSortedUniqueSafeTokenArray(where: string, value: unknown, cap: number): void {
  if (!Array.isArray(value)) {
    throw new ReportValidationError(`${where} must be an array.`);
  }
  if (value.length > cap) {
    throw new ReportValidationError(`${where} exceeds the bounded cap of ${cap}.`);
  }
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, id] of value.entries()) {
    requireSafeEvidenceToken(`${where}[${index}]`, id);
    if (seen.has(id)) {
      throw new ReportValidationError(`${where} has a duplicate entry.`);
    }
    seen.add(id);
    if (previous !== undefined && id < previous) {
      throw new ReportValidationError(`${where} must be sorted ascending.`);
    }
    previous = id;
  }
}

export function sanitizeCellEvidence(
  evidence: CellEvidenceV1 | null,
  secretValues: readonly string[],
): CellEvidenceV1 | null {
  if (evidence === null) {
    return null;
  }
  // Self-host kinds have a different string-field set; the scenario+evidence+cli
  // workstream owns their sanitizer (BRIEF §"Evidence workstream"). Applying the
  // local_workspace_turn field map below to them would read undefined fields.
  if (
    evidence.kind === "selfhost_install_claim" ||
    evidence.kind === "selfhost_desktop_owner" ||
    evidence.kind === "selfhost_base_turn" ||
    evidence.kind === "selfhost_invitee" ||
    evidence.kind === "selfhost_github_auth" ||
    evidence.kind === "selfhost_switch_isolation" ||
    evidence.kind === "selfhost_gateway" ||
    evidence.kind === "selfhost_cloud_addon" ||
    evidence.kind === "selfhost_cfn_wrapper"
  ) {
    return sanitizeSelfHostCellEvidence(evidence, secretValues);
  }
  const clean = (value: string): string => boundMessage(redactUrlCredentials(redactSecrets(value, secretValues)));
  const cleanSpend = (spend: LocalLitellmSpendV1): LocalLitellmSpendV1 => ({
    ...spend,
    token_id_hash: clean(spend.token_id_hash),
    request_ids: spend.request_ids.map(clean),
  });
  const cleanCleanup = (cleanup: LocalCleanupV1): LocalCleanupV1 => ({
    ...cleanup,
    ledger_id_hash: clean(cleanup.ledger_id_hash),
  });
  // Kind-scoped sanitization mirrors the kind-scoped validators (audit ruling
  // #3): each variant cleans exactly its own string-bearing fields.
  switch (evidence.kind) {
    case "local_workspace_turn":
      return {
        ...evidence,
        artifact_ids: evidence.artifact_ids.map(clean),
        server_version: clean(evidence.server_version),
        anyharness_version: clean(evidence.anyharness_version),
        model_id: clean(evidence.model_id),
        workspace_id_hash: clean(evidence.workspace_id_hash),
        session_id_hash: clean(evidence.session_id_hash),
        litellm: {
          ...evidence.litellm,
          token_id_hash: clean(evidence.litellm.token_id_hash),
          request_ids: evidence.litellm.request_ids.map(clean),
        },
        cleanup: {
          ...evidence.cleanup,
          ledger_id_hash: clean(evidence.cleanup.ledger_id_hash),
        },
      };
    case "local_route_turn":
      return {
        ...evidence,
        artifact_ids: evidence.artifact_ids.map(clean),
        server_version: clean(evidence.server_version),
        anyharness_version: clean(evidence.anyharness_version),
        model_id: clean(evidence.model_id),
        workspace_id_hash: clean(evidence.workspace_id_hash),
        session_id_hash: clean(evidence.session_id_hash),
        gateway_spend: evidence.gateway_spend ? cleanSpend(evidence.gateway_spend) : null,
        route_change: evidence.route_change
          ? {
              ...evidence.route_change,
              original_session_id_hash: clean(evidence.route_change.original_session_id_hash),
              new_session_id_hash: clean(evidence.route_change.new_session_id_hash),
            }
          : null,
        cleanup: cleanCleanup(evidence.cleanup),
      };
    case "local_config_matrix":
      return {
        ...evidence,
        artifact_ids: evidence.artifact_ids.map(clean),
        server_version: clean(evidence.server_version),
        anyharness_version: clean(evidence.anyharness_version),
        model_id: clean(evidence.model_id),
        workspace_id_hash: clean(evidence.workspace_id_hash),
        session_id_hash: clean(evidence.session_id_hash),
        controls: evidence.controls.map((control) => ({
          ...control,
          control_key: clean(control.control_key),
          accepted_value: clean(control.accepted_value),
        })),
        cleanup: cleanCleanup(evidence.cleanup),
      };
    case "local_session_tabs":
      return {
        ...evidence,
        artifact_ids: evidence.artifact_ids.map(clean),
        server_version: clean(evidence.server_version),
        anyharness_version: clean(evidence.anyharness_version),
        workspace_id_hash: clean(evidence.workspace_id_hash),
        session_id_hashes: evidence.session_id_hashes.map(clean),
        cleanup: cleanCleanup(evidence.cleanup),
      };
    case "local_mcp_integration":
      return {
        ...evidence,
        artifact_ids: evidence.artifact_ids.map(clean),
        server_version: clean(evidence.server_version),
        anyharness_version: clean(evidence.anyharness_version),
        model_id: clean(evidence.model_id),
        workspace_id_hash: clean(evidence.workspace_id_hash),
        session_id_hash: clean(evidence.session_id_hash),
        integration_namespace: clean(evidence.integration_namespace),
        tool_name: clean(evidence.tool_name),
        audit_event_id_hash: clean(evidence.audit_event_id_hash),
        cleanup: cleanCleanup(evidence.cleanup),
      };
    case "tier2_billing":
      // All string fields are safe tokens by construction; clean them as a
      // fail-closed backstop (numbers pass through untouched).
      return {
        ...evidence,
        manifest_id: clean(evidence.manifest_id),
        server_version: clean(evidence.server_version),
        stripe: {
          ...evidence.stripe,
          test_clock_ids: evidence.stripe.test_clock_ids.map(clean),
          object_ids: evidence.stripe.object_ids.map(clean),
        },
      };
    case "cloud_provision_turn":
      // Owned by the managed-cloud slice; delegate to its kind-scoped sanitizer.
      return sanitizeCloudProvisionTurnEvidence(evidence, secretValues);
    default:
      return evidence;
  }
}

/**
 * Applies the same redaction pipeline (`redactSecrets`/`redactUrlCredentials`/
 * `boundMessage`) to every string-bearing field of a self-host evidence object
 * (origins, versions, model id, and every `*_hash`/digest), so a raw secret or
 * local path that somehow reached evidence becomes a `[REDACTED]`-bearing
 * string the kind-scoped validator then rejects.
 */
function sanitizeSelfHostCellEvidence(
  evidence: CellEvidenceV1,
  secretValues: readonly string[],
): CellEvidenceV1 {
  const clean = (value: string): string => boundMessage(redactUrlCredentials(redactSecrets(value, secretValues)));

  // The CFN-wrapper posture's evidence shape has no controller_runtime_origin/
  // anyharness_version (`SelfHostCfnWrapperEvidenceV1` does not extend
  // `SelfHostEvidenceBaseV1`), so it is sanitized end to end here instead of
  // through the shared base-field cleaning below.
  if ((evidence as { kind?: unknown }).kind === "selfhost_cfn_wrapper") {
    const e = evidence as SelfHostCfnWrapperEvidenceV1;
    return {
      ...e,
      kind: "selfhost_cfn_wrapper",
      artifact_ids: e.artifact_ids.map(clean),
      server_version: clean(e.server_version),
      api_origin: clean(e.api_origin),
      stack_name_hash: clean(e.stack_name_hash),
      image_repo_digest: clean(e.image_repo_digest),
      release_version_tag: clean(e.release_version_tag),
      template_sha256: clean(e.template_sha256),
      cleanup: { ...e.cleanup, ledger_id_hash: clean(e.cleanup.ledger_id_hash) },
    } as SelfHostCfnWrapperEvidenceV1;
  }

  const base = evidence as unknown as SelfHostEvidenceBaseV1 & { kind: string };
  const cleanedBase = {
    ...base,
    artifact_ids: base.artifact_ids.map(clean),
    server_version: clean(base.server_version),
    anyharness_version: clean(base.anyharness_version),
    api_origin: clean(base.api_origin),
    controller_runtime_origin: clean(base.controller_runtime_origin),
    cleanup: { ...base.cleanup, ledger_id_hash: clean(base.cleanup.ledger_id_hash) },
  };

  switch (base.kind) {
    case "selfhost_install_claim": {
      const e = evidence as SelfHostInstallClaimEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_install_claim",
        candidate_server_version: clean(e.candidate_server_version),
        running_image_digest: clean(e.running_image_digest),
        bundle_sha256: clean(e.bundle_sha256),
        setup_token_hash: clean(e.setup_token_hash),
        owner_user_id_hash: clean(e.owner_user_id_hash),
        org_id_hash: clean(e.org_id_hash),
      } as SelfHostInstallClaimEvidenceV1;
    }
    case "selfhost_desktop_owner": {
      const e = evidence as SelfHostDesktopOwnerEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_desktop_owner",
        owner_user_id_hash: clean(e.owner_user_id_hash),
        org_id_hash: clean(e.org_id_hash),
      } as SelfHostDesktopOwnerEvidenceV1;
    }
    case "selfhost_base_turn": {
      const e = evidence as SelfHostBaseTurnEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_base_turn",
        model_id: clean(e.model_id),
        workspace_id_hash: clean(e.workspace_id_hash),
        session_id_hash: clean(e.session_id_hash),
        byok_key_id_hash: clean(e.byok_key_id_hash),
      } as SelfHostBaseTurnEvidenceV1;
    }
    case "selfhost_invitee": {
      const e = evidence as SelfHostInviteeEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_invitee",
        invitee_user_id_hash: clean(e.invitee_user_id_hash),
        invitation_id_hash: clean(e.invitation_id_hash),
      } as SelfHostInviteeEvidenceV1;
    }
    case "selfhost_github_auth": {
      const e = evidence as SelfHostGithubAuthEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_github_auth",
        owner_user_id_hash: clean(e.owner_user_id_hash),
        org_id_hash: clean(e.org_id_hash),
        github_identity_a_hash: clean(e.github_identity_a_hash),
        github_identity_b_hash: clean(e.github_identity_b_hash),
        member_role: clean(e.member_role),
      } as SelfHostGithubAuthEvidenceV1;
    }
    case "selfhost_switch_isolation": {
      const e = evidence as SelfHostSwitchIsolationEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_switch_isolation",
        server_a_origin: clean(e.server_a_origin),
        server_b_origin: clean(e.server_b_origin),
      } as SelfHostSwitchIsolationEvidenceV1;
    }
    case "selfhost_gateway": {
      const e = evidence as SelfHostGatewayEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_gateway",
        actor_user_id_hash: clean(e.actor_user_id_hash),
        virtual_key_id_hash: clean(e.virtual_key_id_hash),
        litellm_image_digest: clean(e.litellm_image_digest),
        model_id: clean(e.model_id),
      } as SelfHostGatewayEvidenceV1;
    }
    case "selfhost_cloud_addon": {
      const e = evidence as SelfHostCloudAddonEvidenceV1;
      return {
        ...cleanedBase,
        kind: "selfhost_cloud_addon",
        github_app_installation_id_hash: clean(e.github_app_installation_id_hash),
        e2b_template_id: clean(e.e2b_template_id),
        sandbox_id_hash: clean(e.sandbox_id_hash),
        workspace_id_hash: clean(e.workspace_id_hash),
        session_id_hash: clean(e.session_id_hash),
      } as SelfHostCloudAddonEvidenceV1;
    }
    default:
      // Unreachable given the CellEvidenceV1 union; fall back to the base
      // sanitization rather than throwing so an unknown future kind still
      // gets its common fields redacted (the validator rejects it either way).
      return cleanedBase as unknown as CellEvidenceV1;
  }
}

/**
 * Kind-scoped sanitizer for `cloud_provision_turn` (PR 2). Applies the same
 * `redactSecrets`/`redactUrlCredentials`/`boundMessage` pipeline to every
 * string-bearing field (artifact ids, versions, model id, template ids +
 * input_hash, sandbox_id_hash, covered_repo name/commit, litellm token/request
 * ids, cleanup ledger_id_hash) so a raw secret or credentialled URL that
 * reached evidence is turned into a `[REDACTED]`-bearing string the validator
 * then rejects. Does not touch the local-kind sanitizer switch.
 */
function sanitizeCloudProvisionTurnEvidence(
  evidence: CloudProvisionTurnEvidenceV1,
  secretValues: readonly string[],
): CloudProvisionTurnEvidenceV1 {
  const clean = (value: string): string => boundMessage(redactUrlCredentials(redactSecrets(value, secretValues)));
  return {
    ...evidence,
    artifact_ids: evidence.artifact_ids.map(clean),
    server_version: clean(evidence.server_version),
    anyharness_version: clean(evidence.anyharness_version),
    worker_version: clean(evidence.worker_version),
    supervisor_version: clean(evidence.supervisor_version),
    model_id: clean(evidence.model_id),
    template: {
      ...evidence.template,
      template_id: clean(evidence.template.template_id),
      build_id: clean(evidence.template.build_id),
      input_hash: clean(evidence.template.input_hash),
    },
    sandbox_id_hash: clean(evidence.sandbox_id_hash),
    worker: { ...evidence.worker },
    covered_repo: {
      ...evidence.covered_repo,
      name: clean(evidence.covered_repo.name),
      commit: clean(evidence.covered_repo.commit),
    },
    isolation: { ...evidence.isolation },
    litellm: {
      ...evidence.litellm,
      token_id_hash: clean(evidence.litellm.token_id_hash),
      request_ids: evidence.litellm.request_ids.map(clean),
    },
    cleanup: {
      ...evidence.cleanup,
      ledger_id_hash: clean(evidence.cleanup.ledger_id_hash),
    },
  };
}

/** Applies `sanitizeCellEvidence` to every result in a V4 report. */
export function sanitizeReportV4Evidence(
  report: TestRunReportV4,
  secretValues: readonly string[],
): TestRunReportV4 {
  return {
    ...report,
    results: report.results.map((result) => ({
      ...result,
      evidence: sanitizeCellEvidence(result.evidence, secretValues),
    })),
  };
}
