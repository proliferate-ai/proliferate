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
    /// A workflow step injected this prompt/command (C10 / E9). Replaces the
    /// dead `Automation` variant; surfaces faithfully via [`to_public`] (the old
    /// variant lossily collapsed to `System` and dropped the ids — that bug dies
    /// here).
    #[serde(rename_all = "camelCase")]
    Workflow {
        run_id: String,
        step_key: String,
        // NB: the enum's serde tag is `kind`, so the step-kind slug is stored
        // under `step_kind` here; it surfaces as the public `kind` field.
        step_kind: String,
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
            PromptProvenance::Workflow {
                run_id,
                step_key,
                step_kind,
                label,
            } => Some(PublicPromptProvenance::Workflow {
                run_id: run_id.clone(),
                step_key: step_key.clone(),
                kind: step_kind.clone(),
                label: label.clone(),
            }),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_provenance_surfaces_faithfully_to_public() {
        let internal = PromptProvenance::Workflow {
            run_id: "run-1".to_string(),
            step_key: "0.-.2".to_string(),
            step_kind: "agent.prompt".to_string(),
            label: Some("Investigate the issue".to_string()),
        };
        match internal.to_public() {
            Some(PublicPromptProvenance::Workflow {
                run_id,
                step_key,
                kind,
                label,
            }) => {
                assert_eq!(run_id, "run-1");
                assert_eq!(step_key, "0.-.2");
                // The step-kind slug surfaces as the public `kind` field.
                assert_eq!(kind, "agent.prompt");
                assert_eq!(label.as_deref(), Some("Investigate the issue"));
            }
            other => panic!("expected faithful Workflow provenance, got {other:?}"),
        }
    }

    #[test]
    fn workflow_provenance_round_trips_through_json_with_kind_tag() {
        // The enum's serde tag is `kind`; the slug is carried under `stepKind`.
        let internal = PromptProvenance::Workflow {
            run_id: "run-9".to_string(),
            step_key: "1.-.0".to_string(),
            step_kind: "agent.emit".to_string(),
            label: None,
        };
        let json = serde_json::to_string(&internal).unwrap();
        assert!(json.contains("\"kind\":\"workflow\""), "json was {json}");
        assert!(json.contains("\"stepKind\":\"agent.emit\""), "json was {json}");
        let back: PromptProvenance = serde_json::from_str(&json).unwrap();
        assert_eq!(back, internal);
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
