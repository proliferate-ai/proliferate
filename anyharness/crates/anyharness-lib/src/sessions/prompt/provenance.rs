use anyharness_contract::v1::PromptProvenance as PublicPromptProvenance;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PromptProvenance {
    #[serde(rename_all = "camelCase")]
    AgentSession {
        source_session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_link_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Automation {
        automation_run_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SubagentWake {
        session_link_id: String,
        completion_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    LinkWake {
        relation: String,
        session_link_id: String,
        completion_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ReviewFeedback {
        review_run_id: String,
        review_round_id: String,
        feedback_job_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    System {
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

impl PromptProvenance {
    pub(crate) fn to_public(&self) -> Option<PublicPromptProvenance> {
        match self {
            PromptProvenance::AgentSession {
                source_session_id,
                session_link_id,
                label,
            } => Some(PublicPromptProvenance::AgentSession {
                source_session_id: source_session_id.clone(),
                session_link_id: session_link_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::SubagentWake {
                session_link_id,
                completion_id,
                label,
            } => Some(PublicPromptProvenance::SubagentWake {
                session_link_id: session_link_id.clone(),
                completion_id: completion_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::LinkWake {
                relation,
                session_link_id,
                completion_id,
                label,
            } => Some(PublicPromptProvenance::LinkWake {
                relation: relation.clone(),
                session_link_id: session_link_id.clone(),
                completion_id: completion_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::ReviewFeedback {
                review_run_id,
                review_round_id,
                feedback_job_id,
                label,
            } => Some(PublicPromptProvenance::ReviewFeedback {
                review_run_id: review_run_id.clone(),
                review_round_id: review_round_id.clone(),
                feedback_job_id: feedback_job_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::Automation { label, .. } => {
                label.as_ref().map(|label| PublicPromptProvenance::System {
                    label: Some(label.clone()),
                })
            }
            PromptProvenance::System { label } => {
                if label.as_deref() == Some("subagent_wake") {
                    return None;
                }
                Some(PublicPromptProvenance::System {
                    label: label.clone(),
                })
            }
        }
    }
}

pub(super) fn decode_prompt_provenance(value: Option<&str>) -> Option<PromptProvenance> {
    let value = value.map(str::trim).filter(|value| !value.is_empty())?;
    match serde_json::from_str(value) {
        Ok(provenance) => Some(provenance),
        Err(error) => {
            tracing::warn!(error = %error, "invalid pending prompt provenance JSON");
            None
        }
    }
}
