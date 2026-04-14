use std::collections::{HashMap, HashSet};

use anyharness_contract::v1::UserInputSubmittedAnswer;

use super::{
    ResolveInteractionError, StoredPermissionOption, StoredPermissionOptionKind,
    StoredUserInputQuestion, USER_INPUT_OTHER_OPTION_LABEL,
};
use crate::acp::mcp_elicitation::McpElicitationValidationError;

pub(super) fn map_mcp_validation_error(
    error: McpElicitationValidationError,
) -> ResolveInteractionError {
    match error {
        McpElicitationValidationError::UnsupportedSchema
        | McpElicitationValidationError::InvalidValue => {
            ResolveInteractionError::InvalidMcpFieldValue
        }
        McpElicitationValidationError::InvalidFieldId => ResolveInteractionError::InvalidMcpFieldId,
        McpElicitationValidationError::DuplicateField => ResolveInteractionError::DuplicateMcpField,
        McpElicitationValidationError::MissingRequiredField => {
            ResolveInteractionError::MissingMcpField
        }
        McpElicitationValidationError::NotUrlElicitation => {
            ResolveInteractionError::NotMcpUrlElicitation
        }
    }
}

pub(super) fn validate_user_input_answers(
    questions: &[StoredUserInputQuestion],
    answers: &[UserInputSubmittedAnswer],
) -> Result<Vec<String>, ResolveInteractionError> {
    let question_by_id = questions
        .iter()
        .map(|question| (question.question_id.as_str(), question))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();

    for answer in answers {
        if !seen.insert(answer.question_id.as_str()) {
            return Err(ResolveInteractionError::DuplicateQuestionAnswer);
        }

        let question = question_by_id
            .get(answer.question_id.as_str())
            .ok_or(ResolveInteractionError::InvalidQuestionId)?;

        if let Some(selected_option_label) = answer.selected_option_label.as_deref() {
            let is_known_option = question
                .option_labels
                .iter()
                .any(|label| label == selected_option_label);
            let is_other_option =
                question.is_other && selected_option_label == USER_INPUT_OTHER_OPTION_LABEL;
            if !is_known_option && !is_other_option {
                return Err(ResolveInteractionError::InvalidSelectedOptionLabel);
            }
        }
    }

    if seen.len() != questions.len() {
        return Err(ResolveInteractionError::MissingQuestionAnswer);
    }

    Ok(questions
        .iter()
        .map(|question| question.question_id.clone())
        .collect())
}

pub(super) fn pick_option(
    options: &[StoredPermissionOption],
    preferred_kinds: &[StoredPermissionOptionKind],
) -> Option<String> {
    preferred_kinds.iter().find_map(|kind| {
        options
            .iter()
            .find(|option| option.kind == *kind)
            .map(|option| option.option_id.clone())
    })
}
