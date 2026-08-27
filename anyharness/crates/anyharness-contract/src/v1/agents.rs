use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstallState {
    Installed,
    InstallRequired,
    Installing,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentCredentialState {
    Ready,
    MissingEnv,
    LoginRequired,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentCliAuthState {
    Authenticated,
    Expired,
    Absent,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentReadinessState {
    Ready,
    InstallRequired,
    CredentialsRequired,
    LoginRequired,
    Unsupported,
    Error,
}

// --- Artifact status ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactStatus {
    pub role: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// --- Agent summary ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub kind: String,
    pub display_name: String,
    pub install_state: AgentInstallState,
    pub native_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native: Option<ArtifactStatus>,
    pub agent_process: ArtifactStatus,
    pub credential_state: AgentCredentialState,
    /// True when the enrolled agent-auth route — not a credential detected on
    /// this machine — is what makes `credentialState` read `ready`.
    ///
    /// Readiness is route-aware on every surface (agent-distribution.md's
    /// route-aware law: settings and launch must agree), so `ready` alone no
    /// longer means "the vendor CLI is logged in here". A client that means the
    /// latter — first-run native-auth adoption, CLI login chrome — must exclude
    /// the route-upgraded case. Absent on older runtimes; treat absent as
    /// `false` (the pre-route-aware meaning, which is what those runtimes had).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub credentials_from_route: bool,
    pub readiness: AgentReadinessState,
    pub supports_login: bool,
    pub expected_env_vars: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_auth_state: Option<AgentCliAuthState>,
    /// True when the user has their own copy of this agent on PATH,
    /// regardless of whether a managed copy also exists and wins resolution
    /// (R2.0, always-managed: a managed copy never displaces a PATH one).
    /// Drives the settings-pane one-time notice explaining the managed copy
    /// when both exist. Additive and tolerant: absent on runtimes that
    /// predate R2.0, so old readers simply see no notice.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub user_path_copy_detected: bool,
    /// The canonical agent-auth evidence model (ADR FR-1), computed ALONGSIDE the
    /// legacy `credentialState`/`readiness` ladders and never replacing them. A
    /// client still renders the legacy ladder until the UI rung; this field is
    /// the additive canonical projection. Absent on runtimes predating it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_state: Option<AgentAuthStateSummary>,
}

// --- Canonical agent-auth evidence model (FR-1) ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthDisplay {
    NotInstalled,
    Unsupported,
    Misconfigured,
    Expired,
    Unavailable,
    Probing,
    Usable,
    Authenticated,
    Selected,
    Installed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthNextAction {
    Install,
    None,
    FixConfig,
    LogInOrPasteKey,
    TopUpOrRetry,
    Wait,
    WaitForProbe,
    ChooseSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthEvidenceRef {
    ProbeObservation,
    GatewayKeyCheck,
    AcknowledgedRoute,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthCredentialSource {
    Gateway,
    ApiKeyByok,
    NativeLogin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthEvidenceStrength {
    BarePresence,
    AcknowledgedRoute,
    Tier1Trial,
    ProbeObservation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthProbePhase {
    Idle,
    Queued,
    Running,
    Backoff,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthGatewayHealth {
    Reachable,
    Unreachable,
    Unauthorized,
    ModelsDrifted,
    BudgetExhausted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthLoginHandoff {
    Initiated,
    AwaitingBrowser,
    Completed,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthCredentialEvidence {
    pub source: AgentAuthCredentialSource,
    pub strength: AgentAuthEvidenceStrength,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_age_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSelectionFact {
    pub acknowledged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<i64>,
    pub satisfiable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledged_age_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthProbeLifecycle {
    pub phase: AgentAuthProbePhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_success_age_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_failure_detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<String>,
    pub observation_nonempty: bool,
}

/// The orthogonal facts that fed the derivation, serialized alongside it so a
/// client can see WHY a display was chosen without re-deriving.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthFactsSummary {
    pub installed: bool,
    pub unsupported_route: bool,
    pub misconfigured: bool,
    pub expired: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<AgentAuthCredentialEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<AgentAuthSelectionFact>,
    pub probe: AgentAuthProbeLifecycle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway: Option<AgentAuthGatewayHealth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff: Option<AgentAuthLoginHandoff>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthStateSummary {
    pub display: AgentAuthDisplay,
    pub next_action: AgentAuthNextAction,
    /// Present exactly when the display is green (`usable`/`authenticated`) or an
    /// acknowledged `selected`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<AgentAuthEvidenceRef>,
    /// Age of that evidence in seconds. Present whenever the display is green.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_age_seconds: Option<i64>,
    pub facts: AgentAuthFactsSummary,
    /// Seat rotation (claude seats): the seat currently serving — last served
    /// if still in the applied pool, else the pool's first. Absent when the
    /// applied document carries no seats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serving_seat_id: Option<String>,
    /// The seat rotation would pick for the NEXT launch (rotate=false: the
    /// pinned candidate). Absent when the pool has fewer than two seats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_seat_id: Option<String>,
    /// RFC3339 UTC; present ONLY when no seat can serve right now (all pool
    /// seats cooling, or the rotate-off pinned candidate cooling).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooling_until: Option<String>,
}

// --- Install ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallAgentRequest {
    #[serde(default)]
    pub reinstall: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_process_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallAgentResponse {
    pub agent: AgentSummary,
    pub already_installed: bool,
    pub installed_artifacts: Vec<ArtifactStatus>,
}

// --- Login ---

/// Which login flow a terminal runs. `Native` (the default when absent) is the
/// harness's own interactive login; `MintSeat` runs the seat-minting flow
/// (seats v1: `claude setup-token` in an isolated dir, token captured in
/// memory by the runtime — never disk, never logs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentLoginVariant {
    #[default]
    Native,
    MintSeat,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentLoginRequest {
    /// Login-terminal variant; absent means the native login flow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<AgentLoginVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentLoginResponse {
    pub kind: String,
    pub label: String,
    pub mode: String,
    pub command: LoginCommand,
    pub reuses_user_state: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LoginCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentLoginTerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

/// The seat-mint capture's lifecycle on a `mint_seat` login terminal. Absent
/// on a native login terminal. The token itself never appears here — it is
/// claimable exactly once through the mint-token route while `Ready`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentMintCaptureStatus {
    /// No token line observed yet (the user is still signing in).
    Waiting,
    /// A token line matched; the completion grace window is running.
    Captured,
    /// Capture complete (terminal exit, or the grace elapsed) — claimable.
    Ready,
    /// The token was claimed and the buffer wiped.
    Consumed,
    /// The terminal finished with no captured token; nothing was persisted.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoginTerminalRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: AgentLoginTerminalStatus,
    pub cwd: String,
    pub command_display: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    /// Present only on a `mint_seat` terminal: the capture's lifecycle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mint_status: Option<AgentMintCaptureStatus>,
}

/// The one-time handoff of a captured seat token to the courier (seats v1).
/// Serving this response wipes the runtime's capture buffer; a second claim
/// finds nothing.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAgentMintTokenResponse {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentLoginTerminalResponse {
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub agent_login_terminal: AgentLoginTerminalRecord,
}

// --- Reconcile ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReconcileOutcome {
    Installed,
    AlreadyInstalled,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReconcileJobStatus {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstallProgressPhase {
    Queued,
    Downloading,
    Verifying,
    Extracting,
    Installing,
    Finalizing,
    Completed,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallProgressComponent {
    pub agent: String,
    /// Stable artifact role (`native_cli` or `agent_process`).
    pub role: String,
    pub phase: AgentInstallProgressPhase,
    pub downloaded_bytes: u64,
    /// Exact compressed transfer total when known. `null` means the runtime
    /// does not own or cannot determine the package-manager transfer size.
    pub download_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallProgress {
    pub downloaded_bytes: u64,
    /// Aggregate exact total, or `null` when any component is indeterminate.
    pub download_size_bytes: Option<u64>,
    pub completed_components: u32,
    pub total_components: u32,
    pub components: Vec<AgentInstallProgressComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentsRequest {
    #[serde(default)]
    pub reinstall: bool,
    /// When true, only agents already installed on disk are reconciled to the
    /// catalog pins; missing agents are skipped (they install on demand at
    /// session start). Defaults to false (full-scope reconcile).
    #[serde(default)]
    pub installed_only: bool,
    /// Optional harness kinds to reconcile. An empty list keeps the existing
    /// all-harness behavior; the settings UI uses a single kind for install.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_kinds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentResult {
    pub kind: String,
    pub outcome: ReconcileOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Typed classification of a terminal failure: one of `network`,
    /// `checksum`, `in_use`, `disk`, `other`. Additive and tolerant: absent on
    /// success/skip and on runtimes that predate typed failures, so old readers
    /// simply ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_kind: Option<String>,
    pub installed_artifacts: Vec<ArtifactStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentsResponse {
    pub status: ReconcileJobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    pub reinstall: bool,
    /// Present on runtimes that support scoped reconcile progress. Optional so
    /// newer clients can still decode responses from older runtime versions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<AgentInstallProgress>,
    pub results: Vec<ReconcileAgentResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Coarse, low-cardinality reconcile status for `/health`. Per-agent detail
/// stays on `GET /v1/agents/reconcile`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentReconcileSummary {
    pub status: ReconcileJobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_agent: Option<String>,
    pub installed: u32,
    pub already_installed: u32,
    pub skipped: u32,
    pub failed: u32,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::v1::{HarnessLaunchDefaults, HarnessLaunchModelControls, HarnessLaunchOptions};

    #[test]
    fn empty_observation_is_not_absent_options() {
        let value = serde_json::to_value(HarnessLaunchOptions {
            models: Vec::new(),
            controls: Vec::new(),
            defaults: HarnessLaunchDefaults::default(),
            model_controls: Vec::new(),
        })
        .expect("launch options serialize");
        assert_eq!(value["models"], serde_json::json!([]));
        assert_eq!(value["controls"], serde_json::json!([]));
        assert!(value.get("modelControls").is_none());

        let decoded: HarnessLaunchOptions = serde_json::from_value(value)
            .expect("legacy launch options without modelControls deserialize");
        assert!(decoded.model_controls.is_empty());
    }

    #[test]
    fn model_scoped_controls_use_camel_case_wire_keys() {
        let value = serde_json::to_value(HarnessLaunchOptions {
            models: Vec::new(),
            controls: Vec::new(),
            defaults: HarnessLaunchDefaults::default(),
            model_controls: vec![HarnessLaunchModelControls {
                model_id: "fable".to_string(),
                controls: Vec::new(),
                default_control_values: BTreeMap::from([(
                    "effort".to_string(),
                    "high".to_string(),
                )]),
            }],
        })
        .expect("model-scoped launch options serialize");

        assert_eq!(value["modelControls"][0]["modelId"], "fable");
        assert_eq!(
            value["modelControls"][0]["defaultControlValues"]["effort"],
            "high"
        );
    }
}
