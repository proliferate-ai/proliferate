//! The seven workflow command POSTs. Every command goes through the manager's
//! one door and its oneshot reply IS the response body (Illegal = the 409);
//! the pre-dispatch 404s — unknown run and unknown node carry distinct codes,
//! per the ADR — come from one cheap membership read, never a second full
//! projection.

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use utoipa::ToSchema;

use super::blocking::run_blocking;
use super::error::ApiError;
use super::workflow_runs::{map_command_error, NODE_NOT_FOUND, RUN_NOT_FOUND};
use crate::app::AppState;
use crate::domains::workflows::definition::NodeModel;
use crate::domains::workflows::model::WorkflowNodeType;
use crate::domains::workflows::projection::RunProjection;
use crate::domains::workflows::store::NodeMembership;
use crate::domains::workflows::transition::WorkflowCommand;

#[derive(Debug, Deserialize, ToSchema)]
pub struct WorkflowRunFailRedoRequest {
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub model: Option<NodeModel>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunFlipTypeRequest {
    pub node_type: WorkflowNodeType,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunAddAdhocNodeRequest {
    pub anchor_node_row_id: String,
    pub prompt: String,
    #[serde(default)]
    pub model: Option<NodeModel>,
}

async fn dispatch_command(
    state: &AppState,
    run_id: &str,
    node_row_id: Option<&str>,
    command: WorkflowCommand,
) -> Result<Json<RunProjection>, ApiError> {
    if let Some(node_row_id) = node_row_id {
        let store = state.workflow_store.clone();
        let owned_run_id = run_id.to_string();
        let owned_node_row_id = node_row_id.to_string();
        let membership = run_blocking("workflow_node_membership", move || {
            store.node_membership(&owned_run_id, &owned_node_row_id)
        })
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
        match membership {
            NodeMembership::RunMissing => {
                return Err(ApiError::not_found("workflow run not found", RUN_NOT_FOUND));
            }
            NodeMembership::NodeMissing => {
                return Err(ApiError::not_found(
                    format!("workflow node row {node_row_id} not found"),
                    NODE_NOT_FOUND,
                ));
            }
            NodeMembership::Present => {}
        }
    }
    let projection = state
        .workflow_manager
        .command(run_id, command)
        .await
        .map_err(map_command_error)?;
    Ok(Json(projection))
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/nodes/{node_row_id}/approve",
    responses(
        (status = 200, description = "Gate approved; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn approve_workflow_node(
    State(state): State<AppState>,
    Path((run_id, node_row_id)): Path<(String, String)>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&node_row_id),
        WorkflowCommand::ApproveGate {
            node_row_id: node_row_id.clone(),
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/nodes/{node_row_id}/fail-redo",
    request_body = WorkflowRunFailRedoRequest,
    responses(
        (status = 200, description = "Replacement row running; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn fail_redo_workflow_node(
    State(state): State<AppState>,
    Path((run_id, node_row_id)): Path<(String, String)>,
    Json(body): Json<WorkflowRunFailRedoRequest>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&node_row_id),
        WorkflowCommand::FailAndRedo {
            node_row_id: node_row_id.clone(),
            prompt: body.prompt,
            model: body.model,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/nodes/{node_row_id}/type",
    request_body = WorkflowRunFlipTypeRequest,
    responses(
        (status = 200, description = "Node type flipped; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn flip_workflow_node_type(
    State(state): State<AppState>,
    Path((run_id, node_row_id)): Path<(String, String)>,
    Json(body): Json<WorkflowRunFlipTypeRequest>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&node_row_id),
        WorkflowCommand::FlipType {
            node_row_id: node_row_id.clone(),
            node_type: body.node_type,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/undo-advance",
    responses(
        (status = 200, description = "Advance undone; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn undo_workflow_advance(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(&state, &run_id, None, WorkflowCommand::UndoAdvance).await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/resume",
    responses(
        (status = 200, description = "Run resumed; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn resume_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(&state, &run_id, None, WorkflowCommand::Resume).await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/adhoc-nodes",
    request_body = WorkflowRunAddAdhocNodeRequest,
    responses(
        (status = 200, description = "Adhoc row running beside the chain; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND (anchor)"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn add_workflow_adhoc_node(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(body): Json<WorkflowRunAddAdhocNodeRequest>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&body.anchor_node_row_id),
        WorkflowCommand::AddAdhocNode {
            anchor_node_row_id: body.anchor_node_row_id.clone(),
            prompt: body.prompt,
            model: body.model,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/cancel",
    responses(
        (status = 200, description = "Run cancelled; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn cancel_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(&state, &run_id, None, WorkflowCommand::Cancel).await
}
