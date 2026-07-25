use std::path::PathBuf;

pub const BROKER_CLEANUP_FENCE_KIND: &str = "broker_quiescence";
pub const BROKER_CLEANUP_FENCE_KEY: &str = "run";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowMaterializationState {
    Pending,
    CleanupRequired,
    Registered,
    Cleaned,
}

impl WorkflowMaterializationState {
    pub(super) fn as_db(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::CleanupRequired => "cleanup_required",
            Self::Registered => "registered",
            Self::Cleaned => "cleaned",
        }
    }

    pub(super) fn from_db(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "cleanup_required" => Some(Self::CleanupRequired),
            "registered" => Some(Self::Registered),
            "cleaned" => Some(Self::Cleaned),
            _ => None,
        }
    }

    pub fn requires_reconciliation(self) -> bool {
        matches!(self, Self::Pending | Self::CleanupRequired)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowMaterializationIntent {
    pub run_id: String,
    pub scope_id: String,
    pub source_repo_root_id: String,
    pub source_root: PathBuf,
    pub target_root: PathBuf,
    pub branch_name: String,
    pub base_commit_oid: String,
    pub execution_generation: i64,
    pub broker_generation: u64,
}

/// Validated broker proof that the complete materialization operation has been
/// sealed and every artifact it created is absent. Construction is restricted
/// to the live broker boundary after it verifies every echoed identity field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowMaterializationCleanupReceipt {
    intent: WorkflowMaterializationIntent,
    canonical_source_root: PathBuf,
    canonical_target_root: PathBuf,
    branch_name: String,
    base_commit_oid: String,
    checkout_absent: bool,
    branch_ref_absent: bool,
    all_operation_artifacts_absent: bool,
    execution_generation: i64,
    broker_generation: u64,
}

impl WorkflowMaterializationCleanupReceipt {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_validated_broker(
        intent: WorkflowMaterializationIntent,
        canonical_source_root: PathBuf,
        canonical_target_root: PathBuf,
        branch_name: String,
        base_commit_oid: String,
        checkout_absent: bool,
        branch_ref_absent: bool,
        all_operation_artifacts_absent: bool,
        execution_generation: i64,
        broker_generation: u64,
    ) -> Self {
        Self {
            intent,
            canonical_source_root,
            canonical_target_root,
            branch_name,
            base_commit_oid,
            checkout_absent,
            branch_ref_absent,
            all_operation_artifacts_absent,
            execution_generation,
            broker_generation,
        }
    }

    pub fn intent(&self) -> &WorkflowMaterializationIntent {
        &self.intent
    }

    pub(crate) fn proves_exact_absence(&self) -> bool {
        self.canonical_source_root == self.intent.source_root
            && self.canonical_target_root == self.intent.target_root
            && self.branch_name == self.intent.branch_name
            && self.base_commit_oid == self.intent.base_commit_oid
            && self.checkout_absent
            && self.branch_ref_absent
            && self.all_operation_artifacts_absent
            && self.execution_generation == self.intent.execution_generation
            && self.broker_generation == self.intent.broker_generation
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowMaterializationRecord {
    pub intent: WorkflowMaterializationIntent,
    pub state: WorkflowMaterializationState,
    pub workspace_id: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowMaterializationBegin {
    Ready(WorkflowMaterializationRecord),
    ReconcileFirst(WorkflowMaterializationRecord),
    Registered(WorkflowMaterializationRecord),
    /// This exact operation identity already has a permanent cleanup receipt.
    /// Retrying requires a fresh execution/broker generation.
    Retired(WorkflowMaterializationRecord),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowCleanupFence {
    pub run_id: String,
    pub fence_kind: String,
    pub fence_key: String,
    pub detail: String,
    pub created_at: String,
    pub updated_at: String,
}
