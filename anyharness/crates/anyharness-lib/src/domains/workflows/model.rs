//! Durable domain types for one-prompt workflow execution (spec
//! `workflow-runs.md`). These are the workflow domain's own models: contract
//! wire types stop at the API mapper and never appear here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// `workflow:` — the stable prefix on every workflow-owned prompt ID. The
/// session extension matches on this to tell a workflow turn from any other.
pub const WORKFLOW_PROMPT_ID_PREFIX: &str = "workflow:";

/// The deterministic, workflow-owned prompt identity for a run's single step.
/// Opaque correlation evidence; not the replay guard.
pub fn workflow_prompt_id(run_id: &str) -> String {
    format!("{WORKFLOW_PROMPT_ID_PREFIX}{run_id}:0:0")
}

/// Durable run status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowRunStatus {
    Accepted,
    Running,
    Completed,
    Failed,
}

impl WorkflowRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "accepted" => Some(Self::Accepted),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

/// Durable step status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

impl WorkflowStepStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

/// The stable, programmatic failure result stored on failed rows (spec §6.1).
/// No failure message is ever persisted; this code is the whole result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowRunFailureCode {
    WorkspaceUnavailable,
    SessionCreateFailed,
    SessionStartFailed,
    PromptDispatchFailed,
    SessionTurnFailed,
    SessionTurnCancelled,
    RuntimeRestarted,
}

impl WorkflowRunFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceUnavailable => "workspace_unavailable",
            Self::SessionCreateFailed => "session_create_failed",
            Self::SessionStartFailed => "session_start_failed",
            Self::PromptDispatchFailed => "prompt_dispatch_failed",
            Self::SessionTurnFailed => "session_turn_failed",
            Self::SessionTurnCancelled => "session_turn_cancelled",
            Self::RuntimeRestarted => "runtime_restarted",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "workspace_unavailable" => Some(Self::WorkspaceUnavailable),
            "session_create_failed" => Some(Self::SessionCreateFailed),
            "session_start_failed" => Some(Self::SessionStartFailed),
            "prompt_dispatch_failed" => Some(Self::PromptDispatchFailed),
            "session_turn_failed" => Some(Self::SessionTurnFailed),
            "session_turn_cancelled" => Some(Self::SessionTurnCancelled),
            "runtime_restarted" => Some(Self::RuntimeRestarted),
            _ => None,
        }
    }
}

/// The terminal turn result observed for the workflow's single prompt. This is
/// the workflow domain's own twin of the sessions `SessionTurnOutcome`; the
/// session extension maps into it so the store never imports sessions types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowTurnOutcome {
    Completed,
    Failed,
    Cancelled,
}

impl WorkflowTurnOutcome {
    /// The durable run/step status this outcome terminalizes to, plus the
    /// failure code (present only for the failed forms).
    pub fn terminal_states(
        self,
    ) -> (
        WorkflowRunStatus,
        WorkflowStepStatus,
        Option<WorkflowRunFailureCode>,
    ) {
        match self {
            Self::Completed => (
                WorkflowRunStatus::Completed,
                WorkflowStepStatus::Completed,
                None,
            ),
            Self::Failed => (
                WorkflowRunStatus::Failed,
                WorkflowStepStatus::Failed,
                Some(WorkflowRunFailureCode::SessionTurnFailed),
            ),
            Self::Cancelled => (
                WorkflowRunStatus::Failed,
                WorkflowStepStatus::Failed,
                Some(WorkflowRunFailureCode::SessionTurnCancelled),
            ),
        }
    }
}

/// The `workflow_runs` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowRunRecord {
    pub id: String,
    pub schema_version: i64,
    pub invocation_json: String,
    pub status: WorkflowRunStatus,
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub failure_code: Option<WorkflowRunFailureCode>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// The `workflow_run_steps` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowRunStepRecord {
    pub run_id: String,
    pub stage_index: i64,
    pub step_index: i64,
    pub status: WorkflowStepStatus,
    pub prompt_id: String,
    pub turn_id: Option<String>,
    pub failure_code: Option<WorkflowRunFailureCode>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// A resolved scalar argument value. Untagged so it round-trips as a bare JSON
/// scalar; the fixed variant order (bool, number, string) keeps parsing
/// unambiguous. `serde_json::Number` preserves integer-vs-float representation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WorkflowArgumentValue {
    Bool(bool),
    Number(serde_json::Number),
    String(String),
}

/// A declared scalar input type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowInputType {
    String,
    Number,
    Boolean,
}

/// Domain twin of a declared input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowInput {
    pub name: String,
    #[serde(rename = "type")]
    pub input_type: WorkflowInputType,
    pub required: bool,
}

/// Domain twin of the stage harness configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowHarnessConfig {
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
}

/// Domain twin of the single prompt step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPromptStep {
    pub kind: String,
    pub prompt: String,
}

/// Domain twin of a stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStage {
    pub harness_config: WorkflowHarnessConfig,
    pub steps: Vec<WorkflowPromptStep>,
}

/// Domain twin of the frozen definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub inputs: Vec<WorkflowInput>,
    pub stages: Vec<WorkflowStage>,
}

/// The un-normalized PUT input handed to the runtime by the API mapper. Carries
/// the still-open argument values so the service can raise typed validation
/// errors on type mismatches.
#[derive(Debug, Clone)]
pub struct PutWorkflowRunInput {
    pub schema_version: i64,
    pub workspace_id: String,
    pub definition: WorkflowDefinition,
    pub arguments: BTreeMap<String, serde_json::Value>,
}

/// The normalized invocation: workspace, frozen definition, and typed
/// arguments. Its `serde_json::to_string` IS the canonical `invocation_json` —
/// `BTreeMap` key order plus fixed struct field order normalize away incoming
/// whitespace and key ordering, while typed values and array order survive.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunInvocation {
    pub workspace_id: String,
    pub definition: WorkflowDefinition,
    pub arguments: BTreeMap<String, WorkflowArgumentValue>,
}

impl WorkflowRunInvocation {
    /// The canonical JSON serialization. Serialization of these fixed-shape
    /// deterministic types cannot fail, but the boundary is surfaced as a
    /// `serde_json::Result` for the one caller that persists it.
    pub fn to_canonical_json(&self) -> serde_json::Result<String> {
        serde_json::to_string(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_id_is_deterministic() {
        assert_eq!(workflow_prompt_id("abc"), "workflow:abc:0:0".to_string());
    }

    #[test]
    fn status_strings_round_trip() {
        for status in [
            WorkflowRunStatus::Accepted,
            WorkflowRunStatus::Running,
            WorkflowRunStatus::Completed,
            WorkflowRunStatus::Failed,
        ] {
            assert_eq!(WorkflowRunStatus::parse(status.as_str()), Some(status));
        }
        for status in [
            WorkflowStepStatus::Pending,
            WorkflowStepStatus::Running,
            WorkflowStepStatus::Completed,
            WorkflowStepStatus::Failed,
        ] {
            assert_eq!(WorkflowStepStatus::parse(status.as_str()), Some(status));
        }
    }

    #[test]
    fn failure_code_strings_round_trip() {
        for code in [
            WorkflowRunFailureCode::WorkspaceUnavailable,
            WorkflowRunFailureCode::SessionCreateFailed,
            WorkflowRunFailureCode::SessionStartFailed,
            WorkflowRunFailureCode::PromptDispatchFailed,
            WorkflowRunFailureCode::SessionTurnFailed,
            WorkflowRunFailureCode::SessionTurnCancelled,
            WorkflowRunFailureCode::RuntimeRestarted,
        ] {
            assert_eq!(WorkflowRunFailureCode::parse(code.as_str()), Some(code));
            assert!(code.as_str().len() <= 64);
        }
    }

    #[test]
    fn argument_values_preserve_numeric_form() {
        let integer: WorkflowArgumentValue = serde_json::from_value(serde_json::json!(3)).unwrap();
        assert!(matches!(integer, WorkflowArgumentValue::Number(_)));
        assert_eq!(serde_json::to_string(&integer).unwrap(), "3");

        let float: WorkflowArgumentValue = serde_json::from_value(serde_json::json!(3.5)).unwrap();
        assert_eq!(serde_json::to_string(&float).unwrap(), "3.5");

        let boolean: WorkflowArgumentValue =
            serde_json::from_value(serde_json::json!(true)).unwrap();
        assert_eq!(serde_json::to_string(&boolean).unwrap(), "true");

        let text: WorkflowArgumentValue = serde_json::from_value(serde_json::json!("hi")).unwrap();
        assert_eq!(serde_json::to_string(&text).unwrap(), "\"hi\"");
    }
}
