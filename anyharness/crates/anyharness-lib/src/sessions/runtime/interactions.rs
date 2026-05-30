use anyharness_contract::v1::{InteractionKind, McpElicitationUrlRevealResponse};

use crate::live::sessions::{
    InteractionResolution, PermissionDecision, ResolveInteractionCommandError,
    RevealMcpElicitationUrlError,
};

use super::{
    InteractionPermissionDecision, InteractionResolutionRequest, ResolveInteractionError,
    SessionRuntime,
};

impl SessionRuntime {
    pub async fn resolve_interaction_request(
        &self,
        session_id: &str,
        request_id: &str,
        resolution: InteractionResolutionRequest,
    ) -> Result<(), ResolveInteractionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ResolveInteractionError::SessionNotLive(error.to_string()))?;

        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ResolveInteractionError::SessionNotLive(session_id.to_string()))?;

        let pending_kind = handle
            .execution_snapshot()
            .await
            .pending_interactions
            .iter()
            .find(|pending| pending.request_id == request_id)
            .map(|pending| pending.kind.clone())
            .ok_or_else(|| ResolveInteractionError::InteractionNotFound(request_id.to_string()))?;

        if self
            .plan_service
            .store()
            .find_link_by_request(session_id, request_id)
            .map_err(ResolveInteractionError::Internal)?
            .is_some()
        {
            return Err(ResolveInteractionError::PlanLinkedInteraction(
                request_id.to_string(),
            ));
        }

        let kind_matches = matches!(
            (&resolution, pending_kind),
            (
                InteractionResolutionRequest::Decision(_),
                InteractionKind::Permission
            ) | (
                InteractionResolutionRequest::OptionId(_),
                InteractionKind::Permission
            ) | (
                InteractionResolutionRequest::Submitted { .. },
                InteractionKind::UserInput
            ) | (
                InteractionResolutionRequest::Accepted { .. },
                InteractionKind::McpElicitation
            ) | (
                InteractionResolutionRequest::Declined,
                InteractionKind::McpElicitation
            ) | (InteractionResolutionRequest::Cancelled, _)
                | (InteractionResolutionRequest::Dismissed, _)
        );
        if !kind_matches {
            return Err(ResolveInteractionError::InteractionKindMismatch(
                request_id.to_string(),
            ));
        }

        let actor_resolution = match resolution {
            InteractionResolutionRequest::Decision(decision) => {
                InteractionResolution::Decision(match decision {
                    InteractionPermissionDecision::Allow => PermissionDecision::Allow,
                    InteractionPermissionDecision::Deny => PermissionDecision::Deny,
                })
            }
            InteractionResolutionRequest::OptionId(option_id) => {
                InteractionResolution::Selected { option_id }
            }
            InteractionResolutionRequest::Submitted { answers } => {
                InteractionResolution::Submitted { answers }
            }
            InteractionResolutionRequest::Accepted { fields } => {
                InteractionResolution::Accepted { fields }
            }
            InteractionResolutionRequest::Declined => InteractionResolution::Declined,
            InteractionResolutionRequest::Cancelled => InteractionResolution::Cancelled,
            InteractionResolutionRequest::Dismissed => InteractionResolution::Dismissed,
        };

        handle
            .resolve_interaction(request_id.to_string(), actor_resolution)
            .await
            .map_err(|error| match error {
                ResolveInteractionCommandError::NotFound => {
                    ResolveInteractionError::InteractionNotFound(request_id.to_string())
                }
                ResolveInteractionCommandError::KindMismatch => {
                    ResolveInteractionError::InteractionKindMismatch(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidOptionId => {
                    ResolveInteractionError::InvalidOptionId(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidQuestionId => {
                    ResolveInteractionError::InvalidQuestionId(request_id.to_string())
                }
                ResolveInteractionCommandError::DuplicateQuestionAnswer => {
                    ResolveInteractionError::DuplicateQuestionAnswer(request_id.to_string())
                }
                ResolveInteractionCommandError::MissingQuestionAnswer => {
                    ResolveInteractionError::MissingQuestionAnswer(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidSelectedOptionLabel => {
                    ResolveInteractionError::InvalidSelectedOptionLabel(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidMcpFieldId => {
                    ResolveInteractionError::InvalidMcpFieldId(request_id.to_string())
                }
                ResolveInteractionCommandError::DuplicateMcpField => {
                    ResolveInteractionError::DuplicateMcpField(request_id.to_string())
                }
                ResolveInteractionCommandError::MissingMcpField => {
                    ResolveInteractionError::MissingMcpField(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidMcpFieldValue => {
                    ResolveInteractionError::InvalidMcpFieldValue(request_id.to_string())
                }
                ResolveInteractionCommandError::NotMcpUrlElicitation => {
                    ResolveInteractionError::NotMcpUrlElicitation(request_id.to_string())
                }
                ResolveInteractionCommandError::ActorDead => {
                    ResolveInteractionError::SessionNotLive(session_id.to_string())
                }
            })?;

        Ok(())
    }

    pub async fn reveal_mcp_elicitation_url(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<McpElicitationUrlRevealResponse, ResolveInteractionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ResolveInteractionError::SessionNotLive(error.to_string()))?;

        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ResolveInteractionError::SessionNotLive(session_id.to_string()))?;

        let pending_kind = handle
            .execution_snapshot()
            .await
            .pending_interactions
            .iter()
            .find(|pending| pending.request_id == request_id)
            .map(|pending| pending.kind.clone())
            .ok_or_else(|| ResolveInteractionError::InteractionNotFound(request_id.to_string()))?;

        if pending_kind != InteractionKind::McpElicitation {
            return Err(ResolveInteractionError::InteractionKindMismatch(
                request_id.to_string(),
            ));
        }

        let url = self
            .acp_manager
            .reveal_mcp_elicitation_url(session_id, request_id)
            .await
            .map_err(|error| match error {
                RevealMcpElicitationUrlError::NotFound => {
                    ResolveInteractionError::InteractionNotFound(request_id.to_string())
                }
                RevealMcpElicitationUrlError::KindMismatch => {
                    ResolveInteractionError::InteractionKindMismatch(request_id.to_string())
                }
                RevealMcpElicitationUrlError::NotMcpUrlElicitation => {
                    ResolveInteractionError::NotMcpUrlElicitation(request_id.to_string())
                }
                RevealMcpElicitationUrlError::InvalidMcpFieldValue => {
                    ResolveInteractionError::InvalidMcpFieldValue(request_id.to_string())
                }
            })?;

        Ok(McpElicitationUrlRevealResponse { url })
    }
}
