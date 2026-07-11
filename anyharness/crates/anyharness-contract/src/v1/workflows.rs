use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The anyharness-local run status vocabulary (mirrors the server ledger's
/// observed state; the server owns the desired/delivery states separately).
/// Non-terminal: `running | waiting_approval`; terminal: `completed | failed |
/// cancelled`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

/// Per-step observed status. `waiting` is a step parked on a durable approval
/// (human.approval, or an `agent.goal` blocked step paused for approval).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStepStatus {
    Pending,
    Running,
    Waiting,
    Completed,
    Failed,
    Skipped,
}

/// A single step's observed execution truth. `output` carries the typed,
/// step-kind-specific output the run view + downstream template late-binding
/// consume (e.g. `{turnId, sessionId}`, `{exitCode, outputTail}`, `{prUrl}`).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepRunView {
    pub step_index: i64,
    pub kind: String,
    pub status: WorkflowStepStatus,
    pub attempt: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

/// The full run view: the run record plus its step runs and the session ids the
/// run has opened. This is the shape `GET /v1/workflow-runs/{id}` returns and
/// the `POST` echoes on idempotent delivery.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunView {
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_n: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
    pub workspace_id: String,
    pub status: WorkflowRunStatus,
    pub step_cursor: i64,
    /// Slot-keyed session map (B7): `slot -> session_id`.
    #[serde(default)]
    pub session_ids: std::collections::BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub steps: Vec<WorkflowStepRunView>,
}

/// A run summary without step detail, for the run list.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunSummaryView {
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_kind: Option<String>,
    pub workspace_id: String,
    pub status: WorkflowRunStatus,
    pub step_cursor: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunListResponse {
    pub runs: Vec<WorkflowRunSummaryView>,
}

/// Delivery request: the fully-resolved plan JSON (opaque here — the runtime's
/// workflow domain deserializes it strictly and rejects unknown step kinds) and
/// the workspace the run executes in. Idempotent on the plan's `run_id`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkflowRunRequest {
    pub plan: serde_json::Value,
    pub workspace_id: String,
}

/// Resolve a durable approval (`human.approval`, or an `agent.goal` step paused
/// for approval on a block).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkflowApprovalRequest {
    pub approve: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_view_serializes_camel_case() {
        let view = WorkflowRunView {
            run_id: "run-1".to_string(),
            workflow_id: Some("wf-1".to_string()),
            workflow_version_id: None,
            version_n: Some(3),
            trigger_kind: Some("manual".to_string()),
            target_mode: None,
            workspace_id: "ws-1".to_string(),
            status: WorkflowRunStatus::Running,
            step_cursor: 1,
            session_ids: std::collections::BTreeMap::from([(
                "triage".to_string(),
                "session-1".to_string(),
            )]),
            error_code: None,
            error_message: None,
            created_at: "2026-07-03T00:00:00Z".to_string(),
            updated_at: "2026-07-03T00:01:00Z".to_string(),
            steps: vec![WorkflowStepRunView {
                step_index: 0,
                kind: "agent.prompt".to_string(),
                status: WorkflowStepStatus::Completed,
                attempt: 1,
                output: Some(serde_json::json!({ "turnId": "turn-1", "sessionId": "session-1" })),
                error_code: None,
                error_message: None,
                started_at: Some("2026-07-03T00:00:10Z".to_string()),
                ended_at: Some("2026-07-03T00:00:20Z".to_string()),
            }],
        };

        let json = serde_json::to_value(&view).expect("serialize run view");
        assert_eq!(json["runId"], "run-1");
        assert_eq!(json["status"], "running");
        assert_eq!(json["sessionIds"]["triage"], "session-1");
        assert_eq!(json["steps"][0]["kind"], "agent.prompt");
        assert_eq!(json["steps"][0]["status"], "completed");
        assert_eq!(json["steps"][0]["output"]["turnId"], "turn-1");

        let round_tripped: WorkflowRunView =
            serde_json::from_value(json).expect("deserialize run view");
        assert_eq!(round_tripped.status, WorkflowRunStatus::Running);
        assert_eq!(round_tripped.steps.len(), 1);
    }

    #[test]
    fn create_request_round_trips_plan_verbatim() {
        let request = CreateWorkflowRunRequest {
            plan: serde_json::json!({ "run_id": "run-1", "steps": [] }),
            workspace_id: "ws-1".to_string(),
        };
        let json = serde_json::to_value(&request).expect("serialize");
        assert_eq!(json["plan"]["run_id"], "run-1");
        assert_eq!(json["workspaceId"], "ws-1");
        let round_tripped: CreateWorkflowRunRequest =
            serde_json::from_value(json).expect("deserialize");
        assert_eq!(round_tripped.plan["run_id"], "run-1");
    }
}
