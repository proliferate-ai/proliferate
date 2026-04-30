use anyharness_contract::v1;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceCreatorContext {
    Human {
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    Automation {
        #[serde(rename = "automationId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        automation_id: Option<String>,
        #[serde(rename = "automationRunId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        automation_run_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    Agent {
        #[serde(rename = "sourceSessionId")]
        source_session_id: String,
        #[serde(rename = "sourceSessionWorkspaceId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_session_workspace_id: Option<String>,
        #[serde(rename = "sessionLinkId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        session_link_id: Option<String>,
        #[serde(rename = "sourceWorkspaceId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_workspace_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

impl WorkspaceCreatorContext {
    pub fn from_contract(context: v1::WorkspaceCreatorContext) -> Self {
        match context {
            v1::WorkspaceCreatorContext::Human { label } => Self::Human { label },
            v1::WorkspaceCreatorContext::Automation {
                automation_id,
                automation_run_id,
                label,
            } => Self::Automation {
                automation_id,
                automation_run_id,
                label,
            },
            v1::WorkspaceCreatorContext::Agent {
                source_session_id,
                source_session_workspace_id,
                session_link_id,
                source_workspace_id,
                label,
            } => Self::Agent {
                source_session_id,
                source_session_workspace_id,
                session_link_id,
                source_workspace_id,
                label,
            },
        }
    }

    pub fn to_contract(&self) -> v1::WorkspaceCreatorContext {
        match self {
            Self::Human { label } => v1::WorkspaceCreatorContext::Human {
                label: label.clone(),
            },
            Self::Automation {
                automation_id,
                automation_run_id,
                label,
            } => v1::WorkspaceCreatorContext::Automation {
                automation_id: automation_id.clone(),
                automation_run_id: automation_run_id.clone(),
                label: label.clone(),
            },
            Self::Agent {
                source_session_id,
                source_session_workspace_id,
                session_link_id,
                source_workspace_id,
                label,
            } => v1::WorkspaceCreatorContext::Agent {
                source_session_id: source_session_id.clone(),
                source_session_workspace_id: source_session_workspace_id.clone(),
                session_link_id: session_link_id.clone(),
                source_workspace_id: source_workspace_id.clone(),
                label: label.clone(),
            },
        }
    }
}

pub fn encode_creator_context_json(
    context: &Option<WorkspaceCreatorContext>,
) -> rusqlite::Result<Option<String>> {
    context
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

pub fn decode_creator_context_json(
    table: &'static str,
    row_id: &str,
    context_json: Option<String>,
) -> Option<WorkspaceCreatorContext> {
    let value = context_json.as_deref()?.trim();
    if value.is_empty() {
        return None;
    }
    match serde_json::from_str(value) {
        Ok(context) => Some(context),
        Err(error) => {
            tracing::warn!(
                table,
                row_id,
                error = %error,
                "invalid workspace creator context JSON; omitting display provenance"
            );
            None
        }
    }
}
