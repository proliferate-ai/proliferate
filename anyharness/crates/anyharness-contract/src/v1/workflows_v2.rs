//! Workflows v1 completion contract spine (WS1).
//!
//! Byte-faithful transport types for the four run contracts (feature spec §5)
//! plus the derived transport messages: materialization offer, execution
//! envelope, observed run, gateway receipt, control command, and checkpoint
//! manifest. These parse/serialize the shared golden fixtures under
//! `tests/contracts/workflows/fixtures` identically to the Python and
//! TypeScript implementations.
//!
//! Strictness: `deny_unknown_fields` is applied only where the feature spec
//! requires strict version/kind failure — unknown top-level fields, unknown
//! step/spine/capability kinds, and unknown enum members fail. Cross-language
//! hash agreement (RFC 8785 + SHA-256) is proven by the Python and TypeScript
//! legs of `scripts/check_workflow_contract_fixtures.py`; this crate proves
//! byte-faithful parse/serialize round-trips and strict-failure behavior.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A schema/plan version pinned to a single integer. Deserialization of any
/// other value fails, giving the required "unknown contract version fails"
/// behavior without a lossy fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchemaVersion<const N: u32>;

impl<const N: u32> Serialize for SchemaVersion<N> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u32(N)
    }
}

impl<'de, const N: u32> Deserialize<'de> for SchemaVersion<N> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = u32::deserialize(deserializer)?;
        if value == N {
            Ok(SchemaVersion::<N>)
        } else {
            Err(serde::de::Error::custom(format!(
                "unsupported contract version {value}; expected {N}"
            )))
        }
    }
}

impl<const N: u32> utoipa::PartialSchema for SchemaVersion<N> {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        u32::schema()
    }
}
impl<const N: u32> ToSchema for SchemaVersion<N> {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowTarget {
    Local,
    PersonalCloud,
    SharedCloud,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OnFail {
    Fail,
    Continue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    RemoteCommit,
    LocalCommit,
    WorkspaceCheckpoint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryObjectFormat {
    Sha1,
    Sha256,
}

// --- capability references (feature spec §7.1) -------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CapabilityRef {
    IntegrationTool {
        #[serde(rename = "providerDefinitionId")]
        provider_definition_id: String,
        #[serde(rename = "providerRevision")]
        provider_revision: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "inputSchemaHash")]
        input_schema_hash: String,
    },
    Function {
        #[serde(rename = "definitionId")]
        definition_id: String,
        #[serde(rename = "semanticRevision")]
        semantic_revision: i64,
    },
    ProductMcp {
        definition: String,
        #[serde(rename = "policyRevision")]
        policy_revision: i64,
    },
}

// --- steps (feature spec §6.1/§6.2/§7.1) -------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum WorkflowStep {
    #[serde(rename = "agent.prompt", rename_all = "camelCase")]
    AgentPrompt {
        step_id: String,
        step_key: String,
        on_fail: OnFail,
        prompt: String,
    },
    #[serde(rename = "agent.emit", rename_all = "camelCase")]
    AgentEmit {
        step_id: String,
        step_key: String,
        on_fail: OnFail,
        emit_name: String,
        prompt: String,
        correction_budget: i64,
        #[serde(rename = "schema")]
        emit_schema: serde_json::Value,
    },
    #[serde(rename = "branch", rename_all = "camelCase")]
    Branch {
        step_id: String,
        step_key: String,
        on_fail: OnFail,
        on: String,
        cases: std::collections::BTreeMap<String, BranchCase>,
    },
    #[serde(rename = "required_invocation", rename_all = "camelCase")]
    RequiredInvocation {
        step_id: String,
        step_key: String,
        on_fail: OnFail,
        correction_budget: i64,
        prompt: String,
        capability: CapabilityRef,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BranchCase {
    Continue,
    End,
}

// --- spine (feature spec §6.1) -----------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlotConfig {
    pub harness: String,
    pub model: String,
    pub mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowLane {
    pub lane_id: String,
    pub slot_id: String,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkflowSpineEntry {
    #[serde(rename_all = "camelCase")]
    Sequential {
        node_id: String,
        slot_id: String,
        steps: Vec<WorkflowStep>,
    },
    #[serde(rename_all = "camelCase")]
    Parallel {
        group_id: String,
        lanes: Vec<WorkflowLane>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowSlot {
    pub slot_id: String,
    pub label: String,
    pub requested_config: SlotConfig,
    pub effective_config: SlotConfig,
    pub capability_subset: Vec<CapabilityRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowInputValue {
    #[serde(rename = "type")]
    pub input_type: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceIntent {
    pub kind: SourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    // `ref` is a Rust keyword; the wire name is `ref`.
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub ref_: Option<String>,
    #[serde(rename = "resolvedCommit", skip_serializing_if = "Option::is_none")]
    pub resolved_commit: Option<String>,
}

// --- resolved plan (feature spec §5.2) ---------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedPlan {
    pub plan_version: SchemaVersion<2>,
    pub plan_hash: String,
    pub run_id: String,
    pub workflow_id: String,
    pub workflow_version_id: String,
    pub version_n: i64,
    pub target: WorkflowTarget,
    pub isolation: String,
    pub source_intent: SourceIntent,
    pub inputs: std::collections::BTreeMap<String, WorkflowInputValue>,
    pub capabilities: Vec<CapabilityRef>,
    pub slots: Vec<WorkflowSlot>,
    pub spine: Vec<WorkflowSpineEntry>,
}

// --- checkpoint manifest (feature spec §5.3) ---------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointOrigin {
    Tracked,
    Untracked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum CheckpointMode {
    #[serde(rename = "100644")]
    RegularFile,
    #[serde(rename = "100755")]
    ExecutableFile,
    #[serde(rename = "120000")]
    Symlink,
    #[serde(rename = "160000")]
    Gitlink,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointEntry {
    /// Unpadded base64 of the raw path bytes.
    pub path: String,
    pub origin: CheckpointOrigin,
    pub mode: CheckpointMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(rename = "submoduleOid", skip_serializing_if = "Option::is_none")]
    pub submodule_oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointManifest {
    pub schema_version: SchemaVersion<1>,
    pub repository_object_format: RepositoryObjectFormat,
    pub base_oid: String,
    pub index_entries: Vec<CheckpointEntry>,
    pub worktree_entries: Vec<CheckpointEntry>,
}

// --- materialization offer / execution envelope (feature spec §5.3) ----------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterializationOffer {
    pub schema_version: SchemaVersion<1>,
    pub run_id: String,
    pub plan_hash: String,
    pub target: WorkflowTarget,
    pub execution_generation: i64,
    pub executor_id: String,
    pub executor_fence: String,
    pub source_intent: SourceIntent,
    pub materialization_credential: String,
    pub credential_generation: i64,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionBinding {
    pub schema_version: SchemaVersion<1>,
    pub target: WorkflowTarget,
    pub source_kind: SourceKind,
    pub repository_object_format: RepositoryObjectFormat,
    pub base_commit_oid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_content_hash: Option<String>,
    pub workspace_id: String,
    pub workspace_generation: i64,
    pub materialization_id: String,
    pub executor_id: String,
    pub executor_generation: i64,
    pub binding_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerSlotCredentialIssuance {
    pub slot_id: String,
    pub issuance_handle: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateCallbacks {
    pub observation_endpoint: String,
    pub control_endpoint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionEnvelope {
    pub schema_version: SchemaVersion<1>,
    pub run_id: String,
    pub plan_hash: String,
    pub binding_hash: String,
    pub execution_generation: i64,
    pub credential_generation: i64,
    pub expires_at: String,
    pub run_report_credential: String,
    pub delivery_claim_fence: String,
    pub private_callbacks: PrivateCallbacks,
    pub per_slot_credential_issuance: Vec<PerSlotCredentialIssuance>,
    pub binding: ExecutionBinding,
}

// --- observed run (feature spec §5.4) ----------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ObservedStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    OutcomeUncertain,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedStep {
    pub step_key: String,
    pub attempt: i64,
    pub status: ObservedStepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedWorktrees {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_base_checkpoint_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lane_checkpoints: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ObservedCost {
    pub usd: String,
    pub tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedTiming {
    pub started_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservedRun {
    pub schema_version: SchemaVersion<2>,
    pub run_id: String,
    pub plan_hash: String,
    pub binding_hash: String,
    pub execution_generation: i64,
    pub revision: i64,
    pub observed_state: String,
    pub quiescence_state: String,
    pub global_cursor: String,
    pub lane_cursors: std::collections::BTreeMap<String, String>,
    /// Slot-keyed session map at every boundary.
    pub sessions: std::collections::BTreeMap<String, String>,
    pub steps: Vec<ObservedStep>,
    pub worktrees: ObservedWorktrees,
    pub cost: ObservedCost,
    pub timing: ObservedTiming,
}

// --- gateway receipt (feature spec §7.3) -------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayCallReceipt {
    pub schema_version: SchemaVersion<1>,
    pub receipt_id: String,
    pub run_id: String,
    pub plan_hash: String,
    pub slot_id: String,
    pub session_id: String,
    pub step_key: String,
    pub attempt: i64,
    pub turn_id: String,
    pub activation_id: String,
    pub capability: CapabilityRef,
    pub authorization_decision: String,
    pub outcome: String,
    pub created_at: String,
    pub completed_at: String,
}

// --- control command (feature spec §8.3) -------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowControlCommand {
    pub schema_version: SchemaVersion<1>,
    pub command_id: String,
    pub run_id: String,
    pub plan_hash: String,
    pub binding_hash: String,
    pub execution_generation: i64,
    pub kind: String,
    pub reason: String,
    pub cancellation_fence: String,
    pub issued_at: String,
}
