use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TerminalPurpose {
    General,
    Run,
    Setup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TerminalCommandRunStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Interrupted,
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TerminalCommandOutputMode {
    Separate,
    Combined,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandRunSummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
    pub workspace_id: String,
    pub purpose: TerminalPurpose,
    pub command: String,
    pub status: TerminalCommandRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub output_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandRunDetail {
    #[serde(flatten)]
    pub summary: TerminalCommandRunSummary,
    pub output_mode: TerminalCommandOutputMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub combined_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecord {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub purpose: TerminalPurpose,
    pub cwd: String,
    pub status: TerminalStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_run: Option<TerminalCommandRunSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<TerminalPurpose>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_command_env: Option<std::collections::BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_command_timeout_ms: Option<u64>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalCommandRequest {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalCommandResponse {
    pub terminal: TerminalRecord,
    pub command_run: TerminalCommandRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalRequest {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTerminalTitleRequest {
    pub title: String,
}

#[cfg(test)]
mod tests {
    use super::{CreateTerminalRequest, TerminalPurpose, UpdateTerminalTitleRequest};

    #[test]
    fn terminal_purpose_serializes_as_snake_case() {
        let value = serde_json::to_value(TerminalPurpose::Run).expect("serialize purpose");
        assert_eq!(value, serde_json::json!("run"));
    }

    #[test]
    fn create_terminal_request_omits_missing_purpose() {
        let value = serde_json::to_value(CreateTerminalRequest {
            cwd: None,
            shell: None,
            title: None,
            purpose: None,
            startup_command: None,
            startup_command_env: None,
            startup_command_timeout_ms: None,
            cols: 120,
            rows: 40,
        })
        .expect("serialize create request");

        assert_eq!(value.get("purpose"), None);
        assert_eq!(value["cols"], 120);
        assert_eq!(value["rows"], 40);
    }

    #[test]
    fn update_terminal_title_request_serializes_title() {
        let value = serde_json::to_value(UpdateTerminalTitleRequest {
            title: "Dev server".to_string(),
        })
        .expect("serialize title update");

        assert_eq!(value, serde_json::json!({ "title": "Dev server" }));
    }
}
