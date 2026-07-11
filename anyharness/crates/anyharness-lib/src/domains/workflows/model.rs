use std::collections::BTreeMap;

use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

/// The anyharness-local mirror of one delivered workflow run. The resolved plan
/// is stored verbatim in `plan_json` (the actor never re-fetches a definition —
/// the StartRun payload is the whole contract). `step_cursor` is the index of
/// the step the actor is at; `session_ids` is the slot-keyed session map (B7):
/// `{"triage": "sess_…"}` — one session per agent slot, opened lazily.
#[derive(Debug, Clone)]
pub struct WorkflowRunRecord {
    pub run_id: String,
    pub workflow_id: Option<String>,
    pub workflow_version_id: Option<String>,
    pub version_n: Option<i64>,
    pub trigger_kind: Option<String>,
    pub target_mode: Option<String>,
    pub workspace_id: String,
    pub plan_json: String,
    /// Strict delivery identity (WS5a, spec §5.3): the immutable identity is
    /// `(run_id, plan_hash, binding_hash, execution_generation)`. All three are
    /// optional — a legacy delivery (before WS2c wires the server side) leaves
    /// them `None` and no identity assertion happens. When present they are
    /// immutable after insert; a re-delivery that disagrees is rejected with a
    /// typed conflict error ([`super::service::WorkflowServiceError::DeliveryIdentityConflict`]).
    pub plan_hash: Option<String>,
    pub binding_hash: Option<String>,
    pub execution_generation: Option<i64>,
    pub status: WorkflowRunStatus,
    pub step_cursor: i64,
    /// Slot-keyed session map (B7): `slot -> session_id`.
    pub session_ids: BTreeMap<String, String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl WorkflowRunRecord {
    pub fn is_terminal(&self) -> bool {
        run_status_is_terminal(self.status)
    }

    /// A live session of the run, for best-effort control (e.g. cancel's
    /// in-flight-turn teardown). With slot-keyed sessions there is no single
    /// "current" session; any bound session is a valid teardown target.
    pub fn current_session_id(&self) -> Option<&str> {
        self.session_ids.values().next().map(String::as_str)
    }

    /// The slot-keyed session map (B7).
    pub fn sessions(&self) -> &BTreeMap<String, String> {
        &self.session_ids
    }
}

/// One plan step's observed execution truth.
#[derive(Debug, Clone)]
pub struct WorkflowStepRunRecord {
    pub run_id: String,
    pub step_index: i64,
    /// Structured step key "<node>.<lane>.<step>" (B5) — the step's stable
    /// identity; outputs are reported keyed by this.
    pub step_key: String,
    pub kind: String,
    pub status: WorkflowStepStatus,
    pub attempt: i64,
    pub output_json: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl WorkflowStepRunRecord {
    /// The step's typed output as parsed JSON, if any was recorded.
    pub fn output_value(&self) -> Option<serde_json::Value> {
        self.output_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
    }
}

/// One immutable row of the durable observation outbox (WS5a, spec §5.4).
/// `revision` is strictly increasing per run with no skips;
/// `canonical_snapshot_json` is the whole serialized `ObservedRun` snapshot
/// stored verbatim (replay returns identical bytes). `acked` is the only
/// mutable bit: it flips once the server acknowledges the revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowObservationRecord {
    pub run_id: String,
    pub revision: i64,
    pub canonical_snapshot_json: String,
    pub created_at: String,
    pub acked: bool,
}

/// A parallel lane's own terminal state (L30). Distinct from the run status:
/// a lane failing does NOT immediately fail the run — siblings run to
/// completion first, then the group's join fails the run (D-031b).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneStatus {
    Running,
    Completed,
    Failed,
}

pub fn lane_status_to_db(status: LaneStatus) -> &'static str {
    match status {
        LaneStatus::Running => "running",
        LaneStatus::Completed => "completed",
        LaneStatus::Failed => "failed",
    }
}

pub fn lane_status_from_db(value: &str) -> Option<LaneStatus> {
    match value {
        "running" => Some(LaneStatus::Running),
        "completed" => Some(LaneStatus::Completed),
        "failed" => Some(LaneStatus::Failed),
        _ => None,
    }
}

/// One lane's per-lane cursor row (L30). `cursor` is the 0-based index into the
/// lane's own step list (not a flat step index).
#[derive(Debug, Clone)]
pub struct WorkflowLaneCursorRecord {
    pub run_id: String,
    pub node_index: i64,
    pub lane: String,
    pub cursor: i64,
    pub status: LaneStatus,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn run_status_is_terminal(status: WorkflowRunStatus) -> bool {
    matches!(
        status,
        WorkflowRunStatus::Completed | WorkflowRunStatus::Failed | WorkflowRunStatus::Cancelled
    )
}

pub fn run_status_to_db(status: WorkflowRunStatus) -> &'static str {
    match status {
        WorkflowRunStatus::Running => "running",
        WorkflowRunStatus::WaitingApproval => "waiting_approval",
        WorkflowRunStatus::Completed => "completed",
        WorkflowRunStatus::Failed => "failed",
        WorkflowRunStatus::Cancelled => "cancelled",
    }
}

pub fn run_status_from_db(value: &str) -> Option<WorkflowRunStatus> {
    match value {
        "running" => Some(WorkflowRunStatus::Running),
        "waiting_approval" => Some(WorkflowRunStatus::WaitingApproval),
        "completed" => Some(WorkflowRunStatus::Completed),
        "failed" => Some(WorkflowRunStatus::Failed),
        "cancelled" => Some(WorkflowRunStatus::Cancelled),
        _ => None,
    }
}

pub fn step_status_to_db(status: WorkflowStepStatus) -> &'static str {
    match status {
        WorkflowStepStatus::Pending => "pending",
        WorkflowStepStatus::Running => "running",
        WorkflowStepStatus::Waiting => "waiting",
        WorkflowStepStatus::Completed => "completed",
        WorkflowStepStatus::Failed => "failed",
        WorkflowStepStatus::Skipped => "skipped",
    }
}

pub fn step_status_from_db(value: &str) -> Option<WorkflowStepStatus> {
    match value {
        "pending" => Some(WorkflowStepStatus::Pending),
        "running" => Some(WorkflowStepStatus::Running),
        "waiting" => Some(WorkflowStepStatus::Waiting),
        "completed" => Some(WorkflowStepStatus::Completed),
        "failed" => Some(WorkflowStepStatus::Failed),
        "skipped" => Some(WorkflowStepStatus::Skipped),
        _ => None,
    }
}
