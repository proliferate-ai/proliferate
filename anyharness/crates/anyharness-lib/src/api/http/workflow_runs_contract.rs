//! Wire <-> domain mapping for workflow runs. Sync and dependency-less:
//! contract types stop here and never cross into the domain. Decoding the PUT
//! body through `serde_json::from_value::<PutWorkflowRunRequest>` guarantees a
//! strict-shape failure returns OUR coded 400 rather than axum's 422.

use std::collections::BTreeMap;

use anyharness_contract::v1::{
    PutWorkflowRunRequest, WorkflowRun, WorkflowRunDefinition, WorkflowRunHarnessConfig,
    WorkflowRunInput, WorkflowRunInputType, WorkflowRunPromptStep, WorkflowRunResponse,
    WorkflowRunStage, WorkflowRunStatus, WorkflowRunStep, WorkflowRunStepStatus,
};

use crate::domains::workflows::model::{
    PutWorkflowRunInput, WorkflowArgumentValue, WorkflowDefinition, WorkflowHarnessConfig,
    WorkflowInput, WorkflowInputType, WorkflowPromptStep, WorkflowRunFailureCode,
    WorkflowRunRecord, WorkflowRunStatus as DomainRunStatus, WorkflowRunStepRecord, WorkflowStage,
    WorkflowStepStatus,
};
use crate::domains::workflows::service::WorkflowRunView;

/// A strict-shape decode failure. Detail is intentionally generic so caller
/// argument values never leak back through the error body.
#[derive(Debug)]
pub struct WorkflowRunDecodeError;

/// Decode and normalize the PUT body into the runtime's domain input.
pub fn decode_put_workflow_run(
    body: serde_json::Value,
) -> Result<PutWorkflowRunInput, WorkflowRunDecodeError> {
    let request: PutWorkflowRunRequest =
        serde_json::from_value(body).map_err(|_| WorkflowRunDecodeError)?;
    Ok(PutWorkflowRunInput {
        schema_version: request.schema_version,
        workspace_id: request.workspace_id,
        definition: definition_to_domain(request.definition),
        arguments: request.arguments,
    })
}

/// Compose the wire response from the domain read view.
pub fn view_to_response(view: WorkflowRunView) -> WorkflowRunResponse {
    let WorkflowRunView {
        run,
        invocation,
        steps,
    } = view;
    WorkflowRunResponse {
        run: run_to_wire(run, invocation.definition, invocation.arguments),
        steps: steps.into_iter().map(step_to_wire).collect(),
    }
}

fn definition_to_domain(definition: WorkflowRunDefinition) -> WorkflowDefinition {
    WorkflowDefinition {
        inputs: definition.inputs.into_iter().map(input_to_domain).collect(),
        stages: definition.stages.into_iter().map(stage_to_domain).collect(),
    }
}

fn input_to_domain(input: WorkflowRunInput) -> WorkflowInput {
    WorkflowInput {
        name: input.name,
        input_type: input_type_to_domain(input.input_type),
        required: input.required,
    }
}

fn input_type_to_domain(input_type: WorkflowRunInputType) -> WorkflowInputType {
    match input_type {
        WorkflowRunInputType::String => WorkflowInputType::String,
        WorkflowRunInputType::Number => WorkflowInputType::Number,
        WorkflowRunInputType::Boolean => WorkflowInputType::Boolean,
    }
}

fn stage_to_domain(stage: WorkflowRunStage) -> WorkflowStage {
    WorkflowStage {
        harness_config: WorkflowHarnessConfig {
            agent_kind: stage.harness_config.agent_kind,
            model_id: stage.harness_config.model_id,
            mode_id: stage.harness_config.mode_id,
        },
        steps: stage.steps.into_iter().map(step_kind_to_domain).collect(),
    }
}

fn step_kind_to_domain(step: WorkflowRunPromptStep) -> WorkflowPromptStep {
    WorkflowPromptStep {
        kind: step.kind,
        prompt: step.prompt,
    }
}

fn definition_to_wire(definition: WorkflowDefinition) -> WorkflowRunDefinition {
    WorkflowRunDefinition {
        inputs: definition.inputs.into_iter().map(input_to_wire).collect(),
        stages: definition.stages.into_iter().map(stage_to_wire).collect(),
    }
}

fn input_to_wire(input: WorkflowInput) -> WorkflowRunInput {
    WorkflowRunInput {
        name: input.name,
        input_type: match input.input_type {
            WorkflowInputType::String => WorkflowRunInputType::String,
            WorkflowInputType::Number => WorkflowRunInputType::Number,
            WorkflowInputType::Boolean => WorkflowRunInputType::Boolean,
        },
        required: input.required,
    }
}

fn stage_to_wire(stage: WorkflowStage) -> WorkflowRunStage {
    WorkflowRunStage {
        harness_config: WorkflowRunHarnessConfig {
            agent_kind: stage.harness_config.agent_kind,
            model_id: stage.harness_config.model_id,
            mode_id: stage.harness_config.mode_id,
        },
        steps: stage
            .steps
            .into_iter()
            .map(|step| WorkflowRunPromptStep {
                kind: step.kind,
                prompt: step.prompt,
            })
            .collect(),
    }
}

fn argument_to_wire(value: WorkflowArgumentValue) -> serde_json::Value {
    match value {
        WorkflowArgumentValue::Bool(flag) => serde_json::Value::Bool(flag),
        WorkflowArgumentValue::Number(number) => serde_json::Value::Number(number),
        WorkflowArgumentValue::String(text) => serde_json::Value::String(text),
    }
}

fn run_to_wire(
    run: WorkflowRunRecord,
    definition: WorkflowDefinition,
    arguments: BTreeMap<String, WorkflowArgumentValue>,
) -> WorkflowRun {
    WorkflowRun {
        id: run.id,
        schema_version: run.schema_version,
        definition: definition_to_wire(definition),
        arguments: arguments
            .into_iter()
            .map(|(name, value)| (name, argument_to_wire(value)))
            .collect(),
        status: run_status_to_wire(run.status),
        workspace_id: run.workspace_id,
        session_id: run.session_id,
        failure_code: run.failure_code.map(failure_code_to_wire),
        created_at: run.created_at,
        updated_at: run.updated_at,
        started_at: run.started_at,
        finished_at: run.finished_at,
    }
}

fn step_to_wire(step: WorkflowRunStepRecord) -> WorkflowRunStep {
    WorkflowRunStep {
        stage_index: step.stage_index,
        step_index: step.step_index,
        status: step_status_to_wire(step.status),
        prompt_id: step.prompt_id,
        turn_id: step.turn_id,
        failure_code: step.failure_code.map(failure_code_to_wire),
        created_at: step.created_at,
        updated_at: step.updated_at,
        started_at: step.started_at,
        finished_at: step.finished_at,
    }
}

fn run_status_to_wire(status: DomainRunStatus) -> WorkflowRunStatus {
    match status {
        DomainRunStatus::Accepted => WorkflowRunStatus::Accepted,
        DomainRunStatus::Running => WorkflowRunStatus::Running,
        DomainRunStatus::Completed => WorkflowRunStatus::Completed,
        DomainRunStatus::Failed => WorkflowRunStatus::Failed,
    }
}

fn step_status_to_wire(status: WorkflowStepStatus) -> WorkflowRunStepStatus {
    match status {
        WorkflowStepStatus::Pending => WorkflowRunStepStatus::Pending,
        WorkflowStepStatus::Running => WorkflowRunStepStatus::Running,
        WorkflowStepStatus::Completed => WorkflowRunStepStatus::Completed,
        WorkflowStepStatus::Failed => WorkflowRunStepStatus::Failed,
    }
}

fn failure_code_to_wire(code: WorkflowRunFailureCode) -> String {
    code.as_str().to_string()
}
