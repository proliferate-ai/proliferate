//! Schema-v2 portable workflow validation and prompt rendering. This is a
//! narrow split from the synchronous workflow service so the service stays
//! within the repository size limit; it owns no IO, persistence, resolution,
//! or execution behavior.

use std::collections::BTreeMap;

use crate::domains::workflows::model::{
    PutWorkflowRunInputV2, WorkflowArgumentValue, WorkflowInputType, WorkflowModelSelection,
    WorkflowRunStoredSourceV2,
};

use super::service::{coerce_argument, validate_run_id, WorkflowRunValidationError};

const AGENT_PROMPT_STEP_KIND: &str = "agent.prompt";
const MAX_RENDERED_PROMPT_BYTES: usize = 16_384;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub(super) struct ValidatedInvocationV2 {
    pub(super) source: WorkflowRunStoredSourceV2,
}

pub(super) fn validate_invocation_v2(
    run_id: &str,
    input: &PutWorkflowRunInputV2,
) -> Result<ValidatedInvocationV2, WorkflowRunValidationError> {
    validate_run_id(run_id)?;
    if input.schema_version != 2 {
        return Err(WorkflowRunValidationError::UnsupportedSchemaVersion(
            input.schema_version,
        ));
    }
    if input.workspace_id.trim().is_empty() {
        return Err(WorkflowRunValidationError::BlankWorkspaceId);
    }
    if input.definition.stages.len() != 1 {
        return Err(WorkflowRunValidationError::StageCount(
            input.definition.stages.len(),
        ));
    }
    let stage = &input.definition.stages[0];
    if stage.steps.len() != 1 {
        return Err(WorkflowRunValidationError::StepCount(stage.steps.len()));
    }
    let step = &stage.steps[0];
    if step.kind != AGENT_PROMPT_STEP_KIND {
        return Err(WorkflowRunValidationError::UnsupportedStepKind(
            step.kind.clone(),
        ));
    }

    let harness = &stage.harness_config;
    if harness.agent_kind.trim().is_empty() {
        return Err(WorkflowRunValidationError::BlankAgentKind);
    }
    if harness.agent_kind.trim() != harness.agent_kind {
        return Err(WorkflowRunValidationError::AgentKindSurroundingWhitespace);
    }
    if let WorkflowModelSelection::Exact { model_id } = &harness.model_selection {
        if model_id.trim().is_empty() {
            return Err(WorkflowRunValidationError::BlankModelId);
        }
    }
    if let Some(effort) = &harness.effort {
        if effort.trim().is_empty() {
            return Err(WorkflowRunValidationError::BlankEffort);
        }
        if !matches!(
            harness.model_selection,
            WorkflowModelSelection::Exact { .. }
        ) {
            return Err(WorkflowRunValidationError::EffortRequiresExactModel);
        }
    }

    let mut declared = BTreeMap::new();
    for input_decl in &input.definition.inputs {
        if input_decl.name.trim().is_empty() {
            return Err(WorkflowRunValidationError::BlankInputName);
        }
        if !is_identifier(&input_decl.name) {
            return Err(WorkflowRunValidationError::InvalidInputName(
                input_decl.name.clone(),
            ));
        }
        if declared
            .insert(input_decl.name.clone(), input_decl.input_type)
            .is_some()
        {
            return Err(WorkflowRunValidationError::DuplicateInputName(
                input_decl.name.clone(),
            ));
        }
    }

    let mut arguments = BTreeMap::new();
    for (name, value) in &input.arguments {
        let Some(declared_type) = declared.get(name) else {
            return Err(WorkflowRunValidationError::UndeclaredArgument(name.clone()));
        };
        let typed = coerce_argument(name, value, *declared_type)?;
        ensure_portable_number(&typed)?;
        arguments.insert(name.clone(), typed);
    }
    for input_decl in &input.definition.inputs {
        if input_decl.required && !arguments.contains_key(&input_decl.name) {
            return Err(WorkflowRunValidationError::MissingRequiredArgument(
                input_decl.name.clone(),
            ));
        }
    }

    Ok(ValidatedInvocationV2 {
        source: WorkflowRunStoredSourceV2 {
            workspace_id: input.workspace_id.clone(),
            definition: input.definition.clone(),
            arguments,
        },
    })
}

pub(super) fn render_source_prompt_v2(
    source: &WorkflowRunStoredSourceV2,
) -> Result<String, WorkflowRunValidationError> {
    let declared = source
        .definition
        .inputs
        .iter()
        .map(|input| (input.name.clone(), input.input_type))
        .collect();
    let prompt = &source.definition.stages[0].steps[0].prompt;
    let rendered = render_prompt(prompt, &declared, &source.arguments)?;
    if rendered.trim().is_empty() {
        return Err(WorkflowRunValidationError::BlankRenderedPrompt);
    }
    if rendered.len() > MAX_RENDERED_PROMPT_BYTES {
        return Err(WorkflowRunValidationError::RenderedPromptTooLarge(
            rendered.len(),
        ));
    }
    Ok(rendered)
}

fn render_prompt(
    prompt: &str,
    declared: &BTreeMap<String, WorkflowInputType>,
    arguments: &BTreeMap<String, WorkflowArgumentValue>,
) -> Result<String, WorkflowRunValidationError> {
    const OPEN: &str = "{{";
    const CLOSE: &str = "}}";
    let mut rendered = String::with_capacity(prompt.len());
    let mut rest = prompt;

    while let Some(open_idx) = rest.find(OPEN) {
        if rest[..open_idx].contains(CLOSE) {
            return Err(WorkflowRunValidationError::MalformedTemplate);
        }
        rendered.push_str(&rest[..open_idx]);
        let after_open = &rest[open_idx + OPEN.len()..];
        let Some(close_idx) = after_open.find(CLOSE) else {
            return Err(WorkflowRunValidationError::MalformedTemplate);
        };
        let inner = &after_open[..close_idx];
        let Some(name) = inner.strip_prefix("inputs.") else {
            return Err(WorkflowRunValidationError::UnknownPortableTemplateReference);
        };
        if name.is_empty() || !declared.contains_key(name) {
            return Err(WorkflowRunValidationError::UnknownPortableTemplateReference);
        }
        let Some(value) = arguments.get(name) else {
            return Err(WorkflowRunValidationError::MissingReferencedArgument(
                name.to_string(),
            ));
        };
        rendered.push_str(&render_value(value)?);
        rest = &after_open[close_idx + CLOSE.len()..];
    }
    if rest.contains(CLOSE) {
        return Err(WorkflowRunValidationError::MalformedTemplate);
    }
    rendered.push_str(rest);
    Ok(rendered)
}

fn render_value(value: &WorkflowArgumentValue) -> Result<String, WorkflowRunValidationError> {
    match value {
        WorkflowArgumentValue::String(text) => Ok(text.clone()),
        WorkflowArgumentValue::Bool(flag) => Ok(if *flag { "true" } else { "false" }.to_string()),
        WorkflowArgumentValue::Number(number) => {
            serde_jcs::to_string(number).map_err(|_| WorkflowRunValidationError::NonPortableNumber)
        }
    }
}

fn ensure_portable_number(value: &WorkflowArgumentValue) -> Result<(), WorkflowRunValidationError> {
    let WorkflowArgumentValue::Number(number) = value else {
        return Ok(());
    };
    if let Some(integer) = number.as_i64() {
        if !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&integer) {
            return Err(WorkflowRunValidationError::NonPortableNumber);
        }
        return Ok(());
    }
    if let Some(integer) = number.as_u64() {
        if integer > MAX_SAFE_INTEGER as u64 {
            return Err(WorkflowRunValidationError::NonPortableNumber);
        }
        return Ok(());
    }
    if let Some(float) = number.as_f64().filter(|float| float.is_finite()) {
        if float.fract() == 0.0 && float.abs() > MAX_SAFE_INTEGER as f64 {
            return Err(WorkflowRunValidationError::NonPortableNumber);
        }
        return Ok(());
    }
    Err(WorkflowRunValidationError::NonPortableNumber)
}

fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}
