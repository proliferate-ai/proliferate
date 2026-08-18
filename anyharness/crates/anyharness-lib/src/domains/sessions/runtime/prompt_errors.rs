use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError};

use super::prompt::TextPromptDispatchError;
use super::SendPromptError;

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
