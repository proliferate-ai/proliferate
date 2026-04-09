use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::SessionLiveConfigSnapshot;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Starting,
    Idle,
    Running,
    Completed,
    Errored,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionExecutionPhase {
    Starting,
    Running,
    AwaitingPermission,
    Idle,
    Errored,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingApprovalSummary {
    pub request_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionSummary {
    pub phase: SessionExecutionPhase,
    pub has_live_handle: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_approval: Option<PendingApprovalSummary>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_config: Option<SessionLiveConfigSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<SessionExecutionSummary>,
    pub status: SessionStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub workspace_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_append: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionTitleRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PromptInputBlock {
    #[serde(rename = "text")]
    Text { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSessionRequest {
    pub blocks: Vec<PromptInputBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSessionResponse {
    pub session: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePermissionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<PermissionDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    Deny,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_session_request_serializes_model_mode_and_prompt() {
        let request = CreateSessionRequest {
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            model_id: Some("default".to_string()),
            mode_id: Some("bypassPermissions".to_string()),
            system_prompt_append: Some(vec!["Rename the branch".to_string()]),
        };

        let json = serde_json::to_value(&request).expect("serialize create request");
        assert_eq!(
            json,
            serde_json::json!({
                "workspaceId": "workspace-1",
                "agentKind": "claude",
                "modelId": "default",
                "modeId": "bypassPermissions",
                "systemPromptAppend": ["Rename the branch"]
            })
        );

        let round_tripped: CreateSessionRequest =
            serde_json::from_value(json).expect("deserialize create request");
        assert_eq!(round_tripped.model_id.as_deref(), Some("default"));
        assert_eq!(
            round_tripped.mode_id.as_deref(),
            Some("bypassPermissions")
        );
        assert_eq!(
            round_tripped.system_prompt_append,
            Some(vec!["Rename the branch".to_string()])
        );
    }

    #[test]
    fn session_omits_removed_thinking_fields() {
        let session = Session {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            model_id: Some("default".to_string()),
            requested_model_id: Some("default".to_string()),
            mode_id: Some("default".to_string()),
            requested_mode_id: Some("default".to_string()),
            title: Some("Fix auth refresh".to_string()),
            live_config: None,
            execution_summary: None,
            status: SessionStatus::Idle,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
        };

        let json = serde_json::to_value(&session).expect("serialize session");

        assert!(json.get("thinkingLevelId").is_none());
        assert!(json.get("thinkingBudgetTokens").is_none());
        assert_eq!(
            json.get("title"),
            Some(&serde_json::json!("Fix auth refresh"))
        );
    }

    #[test]
    fn update_session_title_request_serializes_title() {
        let request = UpdateSessionTitleRequest {
            title: "Tighten retry logic".to_string(),
        };

        let json = serde_json::to_value(&request).expect("serialize title update");
        assert_eq!(json, serde_json::json!({ "title": "Tighten retry logic" }));
    }
}
