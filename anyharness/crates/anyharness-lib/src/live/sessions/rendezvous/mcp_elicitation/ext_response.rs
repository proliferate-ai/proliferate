use std::collections::BTreeMap;
use std::fmt;

use agent_client_protocol as acp;
use serde::Serialize;
use serde_json::Value;

use super::McpElicitationOutcome;

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

pub fn standard_elicitation_response_from_outcome(
    outcome: McpElicitationOutcome,
) -> acp::schema::CreateElicitationResponse {
    use acp::schema::{ElicitationAcceptAction, ElicitationAction, ElicitationContentValue};

    match outcome {
        McpElicitationOutcome::Accepted { content, .. } => {
            let acp_content = content.and_then(|value| {
                value.as_object().map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| {
                            let elicitation_value = match v {
                                Value::String(s) => {
                                    Some(ElicitationContentValue::String(s.clone()))
                                }
                                Value::Number(n) => {
                                    if let Some(i) = n.as_i64() {
                                        Some(ElicitationContentValue::Integer(i))
                                    } else {
                                        n.as_f64().map(ElicitationContentValue::Number)
                                    }
                                }
                                Value::Bool(b) => Some(ElicitationContentValue::Boolean(*b)),
                                Value::Array(arr) => {
                                    let strings: Vec<String> = arr
                                        .iter()
                                        .filter_map(|v| v.as_str().map(str::to_string))
                                        .collect();
                                    Some(ElicitationContentValue::StringArray(strings))
                                }
                                _ => None,
                            };
                            elicitation_value.map(|v| (k.clone(), v))
                        })
                        .collect::<BTreeMap<_, _>>()
                })
            });
            acp::schema::CreateElicitationResponse::new(ElicitationAction::Accept(
                ElicitationAcceptAction::new().content(acp_content),
            ))
        }
        McpElicitationOutcome::Declined => {
            acp::schema::CreateElicitationResponse::new(ElicitationAction::Decline)
        }
        McpElicitationOutcome::Cancelled | McpElicitationOutcome::Dismissed => {
            acp::schema::CreateElicitationResponse::new(ElicitationAction::Cancel)
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
