use crate::domains::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError};

use super::prompt::TextPromptDispatchError;
use super::{SendPromptError, SessionLifecycleError, StartSessionError};

/// Pure classification of a live-session command failure for the text-prompt
/// seam: `ResponseDropped` is the one ambiguous case — it proves the command
/// was enqueued to the actor's mailbox, not that the actor processed it, and
/// the reply was lost either way; `ActorUnavailable` (command never enqueued)
/// and an explicit rejection are safe to report as failed dispatch.
pub(super) fn classify_text_prompt_command_error(
    error: LiveSessionCommandError<PromptAcceptError>,
) -> TextPromptDispatchError {
    match error {
        LiveSessionCommandError::ResponseDropped => TextPromptDispatchError::AcknowledgementLost,
        LiveSessionCommandError::ActorUnavailable => TextPromptDispatchError::Dispatch(
            SendPromptError::Internal(anyhow::anyhow!("session actor channel closed")),
        ),
        LiveSessionCommandError::Rejected(PromptAcceptError::EnqueueFailed(detail)) => {
            TextPromptDispatchError::Dispatch(SendPromptError::Internal(anyhow::anyhow!(
                "failed to enqueue prompt: {detail}"
            )))
        }
        LiveSessionCommandError::Rejected(PromptAcceptError::ProductContextUnavailable {
            incident_id,
            error,
        }) => TextPromptDispatchError::Dispatch(SendPromptError::ProductContextUnavailable {
            incident_id,
            error,
        }),
    }
}

pub(super) fn map_lifecycle_error_to_prompt(error: SessionLifecycleError) -> SendPromptError {
    match error {
        SessionLifecycleError::SessionNotFound(session_id) => {
            SendPromptError::SessionNotFound(session_id)
        }
        SessionLifecycleError::Internal(error) => SendPromptError::Internal(error),
    }
}

pub(super) fn durable_prompt_start_failure_code(error: &StartSessionError) -> &'static str {
    match error {
        StartSessionError::WorkspaceNotFound => "workspace_not_found",
        StartSessionError::WorkspaceDirectoryMissing { .. } => "workspace_directory_missing",
        StartSessionError::AgentDescriptorNotFound(_) => "agent_descriptor_not_found",
        StartSessionError::Closed => "session_closed",
        StartSessionError::MissingDataKey => "missing_data_key",
        StartSessionError::RestartRequired(_) => "restart_required",
        StartSessionError::WorkspaceMcpAttachmentFailed(_) => "workspace_mcp_attachment_failed",
        StartSessionError::RouteAuth(_) => "route_auth",
        StartSessionError::AgentNotReady { .. } => "agent_not_ready",
        StartSessionError::Internal(_) => "internal",
        StartSessionError::AcpStart(_) => "acp_start",
    }
}

pub(super) fn map_start_error_to_prompt(error: StartSessionError) -> SendPromptError {
    match error {
        StartSessionError::WorkspaceNotFound => {
            SendPromptError::Internal(anyhow::anyhow!("workspace not found for session"))
        }
        StartSessionError::WorkspaceDirectoryMissing { path } => {
            SendPromptError::WorkspaceDirectoryMissing { path }
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            SendPromptError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::Closed => SendPromptError::SessionClosed,
        StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
            SendPromptError::Internal(anyhow::anyhow!(SESSION_RESTART_REQUIRED_DETAIL))
        }
        StartSessionError::WorkspaceMcpAttachmentFailed(error) => {
            SendPromptError::WorkspaceMcpAttachmentFailed(error)
        }
        // Lazy-start on prompt: surface the typed agent-auth code so clients
        // can distinguish the fail-closed launch refusal from generic errors.
        StartSessionError::RouteAuth(error) => SendPromptError::InvalidPrompt(
            crate::domains::sessions::prompt::PromptValidationError::new(
                error.code(),
                error.to_string(),
            ),
        ),
        // A9 Scope C: lazy-start on prompt hits the same live-start readiness
        // gate as resume/fork/create now. SendPromptError has no dedicated
        // readiness variant, so this rides InvalidPrompt with a stable
        // AGENT_NOT_READY code, same shape as the RouteAuth arm above.
        StartSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => {
            let message = match detail {
                Some(detail) => {
                    format!("agent '{agent_kind}' is not ready (status: {status:?}): {detail}")
                }
                None => format!("agent '{agent_kind}' is not ready (status: {status:?})"),
            };
            SendPromptError::InvalidPrompt(
                crate::domains::sessions::prompt::PromptValidationError::new(
                    "AGENT_NOT_READY",
                    message,
                ),
            )
        }
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            SendPromptError::Internal(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}

#[cfg(test)]
mod prompt_start_error_tests {
    use super::*;
    use crate::domains::agents::model::ResolvedAgentStatus;

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
    fn workspace_missing_start_failure_uses_stable_code() {
        let code = durable_prompt_start_failure_code(&StartSessionError::WorkspaceNotFound);
        assert_eq!(code, "workspace_not_found");
    }
}
