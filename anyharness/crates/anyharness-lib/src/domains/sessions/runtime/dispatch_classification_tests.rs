//! Dispatch-classification unit tests, moved out of prompt.rs so the dispatch file stays under its size ratchet.

use super::prompt::{
    classify_text_prompt_command_error, durable_prompt_start_failure_code, TextPromptDispatchError,
};
use super::{SendPromptError, StartSessionError};
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError};

#[test]
fn send_message_start_failure_codes_do_not_expose_details() {
    let cases = [
        (
            StartSessionError::WorkspaceDirectoryMissing {
                path: "/secret/workspace".into(),
            },
            "workspace_directory_missing",
        ),
        (
            StartSessionError::AgentNotReady {
                agent_kind: "secret-agent".into(),
                status: ResolvedAgentStatus::Error,
                detail: Some("secret readiness detail".into()),
            },
            "agent_not_ready",
        ),
        (
            StartSessionError::Internal(anyhow::anyhow!("secret")),
            "internal",
        ),
        (
            StartSessionError::AcpStart(anyhow::anyhow!("secret")),
            "acp_start",
        ),
    ];

    for (error, expected) in cases {
        assert_eq!(durable_prompt_start_failure_code(&error), expected);
    }
}

#[test]
fn response_dropped_is_a_lost_acknowledgement() {
    assert!(matches!(
        classify_text_prompt_command_error(LiveSessionCommandError::ResponseDropped),
        TextPromptDispatchError::AcknowledgementLost
    ));
}

#[test]
fn actor_unavailable_and_rejection_are_failed_dispatch() {
    assert!(matches!(
        classify_text_prompt_command_error(LiveSessionCommandError::ActorUnavailable),
        TextPromptDispatchError::Dispatch(SendPromptError::Internal(_))
    ));
    assert!(matches!(
        classify_text_prompt_command_error(LiveSessionCommandError::Rejected(
            PromptAcceptError::EnqueueFailed("queue closed".to_string())
        )),
        TextPromptDispatchError::Dispatch(SendPromptError::Internal(_))
    ));
    assert!(matches!(
        classify_text_prompt_command_error(LiveSessionCommandError::Rejected(
            PromptAcceptError::ProductContextUnavailable {
                incident_id: "incident-1".to_string(),
                error: crate::live::sessions::product_context::AgentProductContextResolutionError::new(
                    anyhow::anyhow!("private")
                ),
            }
        )),
        TextPromptDispatchError::Dispatch(
            SendPromptError::ProductContextUnavailable { incident_id, .. }
        ) if incident_id == "incident-1"
    ));
}
