use anyharness_contract::v1::InteractionKind;

use crate::live::sessions::{
    PermissionDecision, Resolution, ResolveInteractionCommandError, RevealMcpElicitationUrlError,
};

use super::{
    InteractionPermissionDecision, McpElicitationUrlReveal, ResolutionRequest,
    ResolveInteractionError, SessionRuntime,
};

impl SessionRuntime {
    pub async fn resolve_interaction_request(
        &self,
        session_id: &str,
        request_id: &str,
        resolution: ResolutionRequest,
    ) -> Result<(), ResolveInteractionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(ResolveInteractionError::Access)?;

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
            .plan_interaction_link_resolver
            .has_linked_interaction(session_id, request_id)
            .map_err(ResolveInteractionError::Internal)?
        {
            return Err(ResolveInteractionError::PlanLinkedInteraction(
                request_id.to_string(),
            ));
        }

        let kind_matches = matches!(
            (&resolution, pending_kind),
            (ResolutionRequest::Decision(_), InteractionKind::Permission)
                | (ResolutionRequest::OptionId(_), InteractionKind::Permission)
                | (
                    ResolutionRequest::Submitted { .. },
                    InteractionKind::UserInput
                )
                | (
                    ResolutionRequest::Accepted { .. },
                    InteractionKind::McpElicitation
                )
                | (ResolutionRequest::Declined, InteractionKind::McpElicitation)
                | (ResolutionRequest::Cancelled, _)
                | (ResolutionRequest::Dismissed, _)
        );
        if !kind_matches {
            return Err(ResolveInteractionError::InteractionKindMismatch(
                request_id.to_string(),
            ));
        }

        let actor_resolution = match resolution {
            ResolutionRequest::Decision(decision) => Resolution::Decision(match decision {
                InteractionPermissionDecision::Allow => PermissionDecision::Allow,
                InteractionPermissionDecision::Deny => PermissionDecision::Deny,
            }),
            ResolutionRequest::OptionId(option_id) => Resolution::Selected { option_id },
            ResolutionRequest::Submitted { answers } => Resolution::Submitted { answers },
            ResolutionRequest::Accepted { fields } => Resolution::Accepted { fields },
            ResolutionRequest::Declined => Resolution::Declined,
            ResolutionRequest::Cancelled => Resolution::Cancelled,
            ResolutionRequest::Dismissed => Resolution::Dismissed,
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
    ) -> Result<McpElicitationUrlReveal, ResolveInteractionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(ResolveInteractionError::Access)?;

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

        Ok(McpElicitationUrlReveal { url })
    }
}
