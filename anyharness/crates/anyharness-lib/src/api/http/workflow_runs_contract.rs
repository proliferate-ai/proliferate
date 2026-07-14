//! Wire <-> domain mapping for workflow runs. Sync and dependency-less:
//! contract types stop here and never cross into the domain. Decoding the PUT
//! body through `serde_json::from_value::<PutWorkflowRunRequest>` guarantees a
//! strict-shape failure returns OUR coded 400 rather than axum's 422.

use std::collections::BTreeMap;

use anyharness_contract::v1::{
    PutWorkflowRunRequest, PutWorkflowRunRequestV2, VersionedWorkflowRunResponse, WorkflowRun,
    WorkflowRunArgumentValue as WireArgumentValue, WorkflowRunDefinition,
    WorkflowRunDefinitionV2 as WireDefinitionV2, WorkflowRunFailureCode as WireFailureCode,
    WorkflowRunFailureCodeV2 as WireFailureCodeV2, WorkflowRunHarnessConfig,
    WorkflowRunHarnessConfigV2 as WireHarnessConfigV2, WorkflowRunInput, WorkflowRunInputType,
    WorkflowRunModelSelection as WireModelSelection,
    WorkflowRunPermissionPolicy as WirePermissionPolicy, WorkflowRunPromptStep,
    WorkflowRunResolvedHarnessV2, WorkflowRunResponse, WorkflowRunResponseV2, WorkflowRunStage,
    WorkflowRunStageV2 as WireStageV2, WorkflowRunStatus, WorkflowRunStep, WorkflowRunStepStatus,
    WorkflowRunStepV2, WorkflowRunV2,
};

use crate::domains::workflows::model::{
    PutWorkflowRunInput, PutWorkflowRunInputV2, VersionedPutWorkflowRunInput,
    WorkflowArgumentValue, WorkflowDefinition, WorkflowDefinitionV2, WorkflowHarnessConfig,
    WorkflowHarnessConfigV2, WorkflowInput, WorkflowInputType, WorkflowModelSelection,
    WorkflowPermissionPolicy, WorkflowPromptStep, WorkflowRunFailureCode, WorkflowRunRecord,
    WorkflowRunStatus as DomainRunStatus, WorkflowRunStepRecord, WorkflowStage, WorkflowStageV2,
    WorkflowStepStatus,
};
use crate::domains::workflows::service::{
    VersionedWorkflowRunView, WorkflowRunView, WorkflowRunViewV2,
};

/// A strict-shape decode failure. Detail is intentionally generic so caller
/// argument values never leak back through the error body.
#[derive(Debug)]
pub struct WorkflowRunDecodeError;

/// Stored v1 rows can never contain the v2-only failure code. Treat a corrupt
/// combination as an internal mapping failure instead of widening the frozen
/// v1 wire component or silently remapping the code.
#[derive(Debug)]
pub struct WorkflowRunEncodeError;

/// Decode and normalize the PUT body into the runtime's domain input.
pub fn decode_put_workflow_run(
    body: serde_json::Value,
) -> Result<VersionedPutWorkflowRunInput, WorkflowRunDecodeError> {
    let schema_version = body
        .get("schemaVersion")
        .and_then(serde_json::Value::as_i64)
        .ok_or(WorkflowRunDecodeError)?;
    match schema_version {
        1 => {
            let request: PutWorkflowRunRequest =
                serde_json::from_value(body).map_err(|_| WorkflowRunDecodeError)?;
            Ok(VersionedPutWorkflowRunInput::V1(PutWorkflowRunInput {
                schema_version: request.schema_version,
                workspace_id: request.workspace_id,
                definition: definition_to_domain(request.definition),
                arguments: arguments_to_domain(request.arguments),
            }))
        }
        2 => {
            let request: PutWorkflowRunRequestV2 =
                serde_json::from_value(body).map_err(|_| WorkflowRunDecodeError)?;
            Ok(VersionedPutWorkflowRunInput::V2(PutWorkflowRunInputV2 {
                schema_version: request.schema_version,
                workspace_id: request.workspace_id,
                definition: definition_v2_to_domain(request.definition),
                arguments: arguments_to_domain(request.arguments),
            }))
        }
        _ => Err(WorkflowRunDecodeError),
    }
}

/// Compose the wire response from the domain read view.
pub fn view_to_response(
    view: VersionedWorkflowRunView,
) -> Result<VersionedWorkflowRunResponse, WorkflowRunEncodeError> {
    match view {
        VersionedWorkflowRunView::V1(view) => {
            v1_view_to_response(view).map(VersionedWorkflowRunResponse::V1)
        }
        VersionedWorkflowRunView::V2(view) => {
            Ok(VersionedWorkflowRunResponse::V2(v2_view_to_response(view)))
        }
    }
}

pub fn view_workspace_id(view: &VersionedWorkflowRunView) -> &str {
    match view {
        VersionedWorkflowRunView::V1(view) => &view.run.workspace_id,
        VersionedWorkflowRunView::V2(view) => &view.run.workspace_id,
    }
}

pub fn input_workspace_id(input: &VersionedPutWorkflowRunInput) -> &str {
    match input {
        VersionedPutWorkflowRunInput::V1(input) => &input.workspace_id,
        VersionedPutWorkflowRunInput::V2(input) => &input.workspace_id,
    }
}

fn v1_view_to_response(
    view: WorkflowRunView,
) -> Result<WorkflowRunResponse, WorkflowRunEncodeError> {
    let WorkflowRunView {
        run,
        invocation,
        steps,
    } = view;
    Ok(WorkflowRunResponse {
        run: run_to_wire(run, invocation.definition, invocation.arguments)?,
        steps: steps
            .into_iter()
            .map(step_to_wire)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn v2_view_to_response(view: WorkflowRunViewV2) -> WorkflowRunResponseV2 {
    let WorkflowRunViewV2 {
        run,
        source,
        resolved_plan,
        steps,
    } = view;
    WorkflowRunResponseV2 {
        run: run_v2_to_wire(run, source.definition, source.arguments),
        steps: steps.into_iter().map(step_v2_to_wire).collect(),
        resolved_harness: WorkflowRunResolvedHarnessV2 {
            agent_kind: resolved_plan.agent_kind,
            model_id: resolved_plan.model_id,
            mode_id: resolved_plan.mode_id,
            effort: resolved_plan.effort_config.map(|effort| effort.value),
        },
    }
}

fn arguments_to_domain(
    arguments: BTreeMap<String, WireArgumentValue>,
) -> BTreeMap<String, serde_json::Value> {
    arguments
        .into_iter()
        .map(|(name, value)| (name, wire_argument_to_value(value)))
        .collect()
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

fn definition_v2_to_domain(definition: WireDefinitionV2) -> WorkflowDefinitionV2 {
    WorkflowDefinitionV2 {
        inputs: definition.inputs.into_iter().map(input_to_domain).collect(),
        stages: definition
            .stages
            .into_iter()
            .map(stage_v2_to_domain)
            .collect(),
    }
}

fn stage_v2_to_domain(stage: WireStageV2) -> WorkflowStageV2 {
    WorkflowStageV2 {
        harness_config: WorkflowHarnessConfigV2 {
            agent_kind: stage.harness_config.agent_kind,
            model_selection: match stage.harness_config.model_selection {
                WireModelSelection::TargetDefault => WorkflowModelSelection::TargetDefault,
                WireModelSelection::Exact { model_id } => {
                    WorkflowModelSelection::Exact { model_id }
                }
            },
            effort: stage.harness_config.effort,
            permission_policy: match stage.harness_config.permission_policy {
                WirePermissionPolicy::WorkflowDefault => WorkflowPermissionPolicy::WorkflowDefault,
            },
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

fn definition_v2_to_wire(definition: WorkflowDefinitionV2) -> WireDefinitionV2 {
    WireDefinitionV2 {
        inputs: definition.inputs.into_iter().map(input_to_wire).collect(),
        stages: definition
            .stages
            .into_iter()
            .map(stage_v2_to_wire)
            .collect(),
    }
}

fn stage_v2_to_wire(stage: WorkflowStageV2) -> WireStageV2 {
    WireStageV2 {
        harness_config: WireHarnessConfigV2 {
            agent_kind: stage.harness_config.agent_kind,
            model_selection: match stage.harness_config.model_selection {
                WorkflowModelSelection::TargetDefault => WireModelSelection::TargetDefault,
                WorkflowModelSelection::Exact { model_id } => {
                    WireModelSelection::Exact { model_id }
                }
            },
            effort: stage.harness_config.effort,
            permission_policy: match stage.harness_config.permission_policy {
                WorkflowPermissionPolicy::WorkflowDefault => WirePermissionPolicy::WorkflowDefault,
            },
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

fn wire_argument_to_value(value: WireArgumentValue) -> serde_json::Value {
    match value {
        WireArgumentValue::Boolean(flag) => serde_json::Value::Bool(flag),
        WireArgumentValue::Number(number) => serde_json::Value::Number(number),
        WireArgumentValue::String(text) => serde_json::Value::String(text),
    }
}

fn argument_to_wire(value: WorkflowArgumentValue) -> WireArgumentValue {
    match value {
        WorkflowArgumentValue::Bool(flag) => WireArgumentValue::Boolean(flag),
        WorkflowArgumentValue::Number(number) => WireArgumentValue::Number(number),
        WorkflowArgumentValue::String(text) => WireArgumentValue::String(text),
    }
}

fn run_to_wire(
    run: WorkflowRunRecord,
    definition: WorkflowDefinition,
    arguments: BTreeMap<String, WorkflowArgumentValue>,
) -> Result<WorkflowRun, WorkflowRunEncodeError> {
    Ok(WorkflowRun {
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
        failure_code: run.failure_code.map(failure_code_to_wire).transpose()?,
        created_at: run.created_at,
        updated_at: run.updated_at,
        started_at: run.started_at,
        finished_at: run.finished_at,
    })
}

fn step_to_wire(step: WorkflowRunStepRecord) -> Result<WorkflowRunStep, WorkflowRunEncodeError> {
    Ok(WorkflowRunStep {
        stage_index: step.stage_index,
        step_index: step.step_index,
        status: step_status_to_wire(step.status),
        prompt_id: step.prompt_id,
        turn_id: step.turn_id,
        failure_code: step.failure_code.map(failure_code_to_wire).transpose()?,
        created_at: step.created_at,
        updated_at: step.updated_at,
        started_at: step.started_at,
        finished_at: step.finished_at,
    })
}

fn run_v2_to_wire(
    run: WorkflowRunRecord,
    definition: WorkflowDefinitionV2,
    arguments: BTreeMap<String, WorkflowArgumentValue>,
) -> WorkflowRunV2 {
    WorkflowRunV2 {
        id: run.id,
        schema_version: run.schema_version,
        definition: definition_v2_to_wire(definition),
        arguments: arguments
            .into_iter()
            .map(|(name, value)| (name, argument_to_wire(value)))
            .collect(),
        status: run_status_to_wire(run.status),
        workspace_id: run.workspace_id,
        session_id: run.session_id,
        failure_code: run.failure_code.map(failure_code_v2_to_wire),
        created_at: run.created_at,
        updated_at: run.updated_at,
        started_at: run.started_at,
        finished_at: run.finished_at,
    }
}

fn step_v2_to_wire(step: WorkflowRunStepRecord) -> WorkflowRunStepV2 {
    WorkflowRunStepV2 {
        stage_index: step.stage_index,
        step_index: step.step_index,
        status: step_status_to_wire(step.status),
        prompt_id: step.prompt_id,
        turn_id: step.turn_id,
        failure_code: step.failure_code.map(failure_code_v2_to_wire),
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

fn failure_code_to_wire(
    code: WorkflowRunFailureCode,
) -> Result<WireFailureCode, WorkflowRunEncodeError> {
    Ok(match code {
        WorkflowRunFailureCode::WorkspaceUnavailable => WireFailureCode::WorkspaceUnavailable,
        WorkflowRunFailureCode::SessionCreateFailed => WireFailureCode::SessionCreateFailed,
        WorkflowRunFailureCode::SessionStartFailed => WireFailureCode::SessionStartFailed,
        WorkflowRunFailureCode::PromptDispatchFailed => WireFailureCode::PromptDispatchFailed,
        WorkflowRunFailureCode::SessionTurnFailed => WireFailureCode::SessionTurnFailed,
        WorkflowRunFailureCode::SessionTurnCancelled => WireFailureCode::SessionTurnCancelled,
        WorkflowRunFailureCode::RuntimeRestarted => WireFailureCode::RuntimeRestarted,
        WorkflowRunFailureCode::SessionConfigApplyFailed => {
            return Err(WorkflowRunEncodeError);
        }
    })
}

fn failure_code_v2_to_wire(code: WorkflowRunFailureCode) -> WireFailureCodeV2 {
    match code {
        WorkflowRunFailureCode::WorkspaceUnavailable => WireFailureCodeV2::WorkspaceUnavailable,
        WorkflowRunFailureCode::SessionCreateFailed => WireFailureCodeV2::SessionCreateFailed,
        WorkflowRunFailureCode::SessionStartFailed => WireFailureCodeV2::SessionStartFailed,
        WorkflowRunFailureCode::PromptDispatchFailed => WireFailureCodeV2::PromptDispatchFailed,
        WorkflowRunFailureCode::SessionTurnFailed => WireFailureCodeV2::SessionTurnFailed,
        WorkflowRunFailureCode::SessionTurnCancelled => WireFailureCodeV2::SessionTurnCancelled,
        WorkflowRunFailureCode::RuntimeRestarted => WireFailureCodeV2::RuntimeRestarted,
        WorkflowRunFailureCode::SessionConfigApplyFailed => {
            WireFailureCodeV2::SessionConfigApplyFailed
        }
    }
}
