use anyharness_contract::v1::{InteractionKind, InteractionOutcome};

use crate::live::sessions::actor::command::ResolveInteractionCommandError;
use crate::live::sessions::interactions::broker::{
    InteractionBrokerOutcome, PermissionOutcome, ResolveInteractionError, UserInputOutcome,
};
use crate::live::sessions::interactions::mcp_elicitation::McpElicitationOutcome;

pub(in crate::live::sessions::actor) fn broker_outcome_to_interaction_event(
    outcome: InteractionBrokerOutcome,
) -> (InteractionKind, InteractionOutcome) {
    match outcome {
        InteractionBrokerOutcome::Permission(outcome) => (
            InteractionKind::Permission,
            permission_outcome_to_interaction_outcome(outcome),
        ),
        InteractionBrokerOutcome::UserInput(outcome) => (
            InteractionKind::UserInput,
            user_input_outcome_to_interaction_outcome(outcome),
        ),
        InteractionBrokerOutcome::McpElicitation(outcome) => (
            InteractionKind::McpElicitation,
            mcp_elicitation_outcome_to_interaction_outcome(outcome),
        ),
    }
}

fn permission_outcome_to_interaction_outcome(outcome: PermissionOutcome) -> InteractionOutcome {
    match outcome {
        PermissionOutcome::Selected { option_id } => InteractionOutcome::Selected { option_id },
        PermissionOutcome::Cancelled => InteractionOutcome::Cancelled,
        PermissionOutcome::Dismissed => InteractionOutcome::Dismissed,
    }
}

fn user_input_outcome_to_interaction_outcome(outcome: UserInputOutcome) -> InteractionOutcome {
    match outcome {
        UserInputOutcome::Submitted {
            answered_question_ids,
            ..
        } => InteractionOutcome::Submitted {
            answered_question_ids,
        },
        UserInputOutcome::Cancelled => InteractionOutcome::Cancelled,
        UserInputOutcome::Dismissed => InteractionOutcome::Dismissed,
    }
}

fn mcp_elicitation_outcome_to_interaction_outcome(
    outcome: McpElicitationOutcome,
) -> InteractionOutcome {
    match outcome {
        McpElicitationOutcome::Accepted {
            accepted_field_ids, ..
        } => InteractionOutcome::Accepted { accepted_field_ids },
        McpElicitationOutcome::Declined => InteractionOutcome::Declined,
        McpElicitationOutcome::Cancelled => InteractionOutcome::Cancelled,
        McpElicitationOutcome::Dismissed => InteractionOutcome::Dismissed,
    }
}

pub(in crate::live::sessions::actor) fn map_resolve_interaction_error(
    error: ResolveInteractionError,
) -> ResolveInteractionCommandError {
    match error {
        ResolveInteractionError::NotFound => ResolveInteractionCommandError::NotFound,
        ResolveInteractionError::KindMismatch => ResolveInteractionCommandError::KindMismatch,
        ResolveInteractionError::InvalidOptionId => ResolveInteractionCommandError::InvalidOptionId,
        ResolveInteractionError::InvalidQuestionId => {
            ResolveInteractionCommandError::InvalidQuestionId
        }
        ResolveInteractionError::DuplicateQuestionAnswer => {
            ResolveInteractionCommandError::DuplicateQuestionAnswer
        }
        ResolveInteractionError::MissingQuestionAnswer => {
            ResolveInteractionCommandError::MissingQuestionAnswer
        }
        ResolveInteractionError::InvalidSelectedOptionLabel => {
            ResolveInteractionCommandError::InvalidSelectedOptionLabel
        }
        ResolveInteractionError::InvalidMcpFieldId => {
            ResolveInteractionCommandError::InvalidMcpFieldId
        }
        ResolveInteractionError::DuplicateMcpField => {
            ResolveInteractionCommandError::DuplicateMcpField
        }
        ResolveInteractionError::MissingMcpField => ResolveInteractionCommandError::MissingMcpField,
        ResolveInteractionError::InvalidMcpFieldValue => {
            ResolveInteractionCommandError::InvalidMcpFieldValue
        }
        ResolveInteractionError::NotMcpUrlElicitation => {
            ResolveInteractionCommandError::NotMcpUrlElicitation
        }
    }
}
