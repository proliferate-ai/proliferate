//! Stable prompt-command failure classification shared by queue and dispatch.

use super::{SendPromptError, StartSessionError};
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError};

/// A lost reply is not a failed dispatch: the actor may already have accepted
/// the turn or queue boundary, so callers must never terminalize it as failed.
#[derive(Debug)]
pub(crate) enum TextPromptDispatchError {
    AcknowledgementLost,
    Dispatch(SendPromptError),
}

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
