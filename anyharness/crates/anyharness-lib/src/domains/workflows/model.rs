use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

/// The anyharness-local mirror of one delivered workflow run. The resolved plan
/// is stored verbatim in `plan_json` (the actor never re-fetches a definition —
/// the StartRun payload is the whole contract). `step_cursor` is the index of
/// the step the actor is at; `session_ids` is the ordered list of sessions the
/// run has opened (the harness-switch design opens a new one per harness).
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
    pub status: WorkflowRunStatus,
    pub step_cursor: i64,
    pub session_ids: Vec<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl WorkflowRunRecord {
    pub fn is_terminal(&self) -> bool {
        run_status_is_terminal(self.status)
    }

    /// The session opened most recently (the run's current session, if any).
    pub fn current_session_id(&self) -> Option<&str> {
        self.session_ids.last().map(String::as_str)
    }
}

/// One plan step's observed execution truth.
#[derive(Debug, Clone)]
pub struct WorkflowStepRunRecord {
    pub run_id: String,
    pub step_index: i64,
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
