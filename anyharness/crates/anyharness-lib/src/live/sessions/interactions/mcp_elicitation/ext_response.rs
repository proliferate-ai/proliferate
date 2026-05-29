use std::fmt;

use serde::Serialize;
use serde_json::Value;

use super::McpElicitationOutcome;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpElicitationExtResponse {
    pub outcome: CodexMcpElicitationExtOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

impl fmt::Debug for CodexMcpElicitationExtResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CodexMcpElicitationExtResponse")
            .field("outcome", &self.outcome)
            .field("content_present", &self.content.is_some())
            .field("meta_present", &self.meta.is_some())
            .finish()
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexMcpElicitationExtOutcome {
    Accepted,
    Declined,
    Cancelled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMcpElicitationExtResponse {
    pub action: ClaudeMcpElicitationExtAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
}

impl fmt::Debug for ClaudeMcpElicitationExtResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClaudeMcpElicitationExtResponse")
            .field("action", &self.action)
            .field("content_present", &self.content.is_some())
            .finish()
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeMcpElicitationExtAction {
    Accept,
    Decline,
    Cancel,
}

pub fn codex_ext_response_from_outcome(
    outcome: McpElicitationOutcome,
) -> CodexMcpElicitationExtResponse {
    match outcome {
        McpElicitationOutcome::Accepted { content, .. } => CodexMcpElicitationExtResponse {
            outcome: CodexMcpElicitationExtOutcome::Accepted,
            content,
            meta: None,
        },
        McpElicitationOutcome::Declined => CodexMcpElicitationExtResponse {
            outcome: CodexMcpElicitationExtOutcome::Declined,
            content: None,
            meta: None,
        },
        McpElicitationOutcome::Cancelled | McpElicitationOutcome::Dismissed => {
            CodexMcpElicitationExtResponse {
                outcome: CodexMcpElicitationExtOutcome::Cancelled,
                content: None,
                meta: None,
            }
        }
    }
}

pub fn claude_ext_response_from_outcome(
    outcome: McpElicitationOutcome,
) -> ClaudeMcpElicitationExtResponse {
    match outcome {
        McpElicitationOutcome::Accepted { content, .. } => ClaudeMcpElicitationExtResponse {
            action: ClaudeMcpElicitationExtAction::Accept,
            content,
        },
        McpElicitationOutcome::Declined => ClaudeMcpElicitationExtResponse {
            action: ClaudeMcpElicitationExtAction::Decline,
            content: None,
        },
        McpElicitationOutcome::Cancelled | McpElicitationOutcome::Dismissed => {
            ClaudeMcpElicitationExtResponse {
                action: ClaudeMcpElicitationExtAction::Cancel,
                content: None,
            }
        }
    }
}
