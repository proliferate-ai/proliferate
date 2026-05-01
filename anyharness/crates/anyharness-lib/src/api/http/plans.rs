use anyharness_contract::v1::{
    HandoffPlanRequest, HandoffPlanResponse, ListProposedPlansResponse, PlanDecisionRequest,
    PlanDecisionResponse, ProposedPlanDetail, ProposedPlanDocumentResponse,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use super::access::{assert_workspace_mutable, assert_workspace_not_retired, map_access_error};
use super::error::ApiError;
use crate::app::AppState;
use crate::plans::runtime::{GetPlanError, HandoffPlanError};
use crate::plans::service::{plan_to_summary, PlanDecisionError};
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[derive(Debug, Deserialize)]
pub struct PlanDocumentQuery {
    pub materialize: Option<bool>,
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/plans",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses((status = 200, description = "Workspace proposed plans", body = ListProposedPlansResponse)),
    tag = "plans"
)]
pub async fn list_workspace_plans(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<ListProposedPlansResponse>, ApiError> {
    ensure_workspace_access(&state, &workspace_id)?;
    let plans = state
        .plan_service
        .list_by_workspace(&workspace_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .iter()
        .map(plan_to_summary)
        .collect();
    Ok(Json(ListProposedPlansResponse { plans }))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/plans/{plan_id}",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("plan_id" = String, Path, description = "Plan ID")
    ),
    responses(
        (status = 200, description = "Proposed plan detail", body = ProposedPlanDetail),
        (status = 404, description = "Plan not found", body = anyharness_contract::v1::ProblemDetails)
    ),
    tag = "plans"
)]
pub async fn get_plan(
    State(state): State<AppState>,
    Path((workspace_id, plan_id)): Path<(String, String)>,
) -> Result<Json<ProposedPlanDetail>, ApiError> {
    ensure_workspace_access(&state, &workspace_id)?;
    state
        .plan_runtime
        .get_detail(&workspace_id, &plan_id)
        .map(Json)
        .map_err(map_get_plan_error)
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/plans/{plan_id}/document",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("plan_id" = String, Path, description = "Plan ID")
    ),
    responses((status = 200, description = "Proposed plan markdown document", body = ProposedPlanDocumentResponse)),
    tag = "plans"
)]
pub async fn get_plan_document(
    State(state): State<AppState>,
    Path((workspace_id, plan_id)): Path<(String, String)>,
    Query(query): Query<PlanDocumentQuery>,
) -> Result<Json<ProposedPlanDocumentResponse>, ApiError> {
    ensure_workspace_access(&state, &workspace_id)?;
    let _lease = if query.materialize.unwrap_or(false) {
        let lease = state
            .workspace_operation_gate
            .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
            .await;
        assert_workspace_not_retired(&state, &workspace_id)?;
        Some(lease)
    } else {
        None
    };
    state
        .plan_runtime
        .document(&workspace_id, &plan_id, query.materialize.unwrap_or(false))
        .map(Json)
        .map_err(map_get_plan_error)
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/plans/{plan_id}/approve",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("plan_id" = String, Path, description = "Plan ID")
    ),
    request_body = PlanDecisionRequest,
    responses((status = 200, description = "Approved proposed plan", body = PlanDecisionResponse)),
    tag = "plans"
)]
pub async fn approve_plan(
    State(state): State<AppState>,
    Path((workspace_id, plan_id)): Path<(String, String)>,
    Json(req): Json<PlanDecisionRequest>,
) -> Result<Json<PlanDecisionResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::PlanWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    state
        .plan_runtime
        .approve(&workspace_id, &plan_id, req.expected_decision_version)
        .await
        .map(Json)
        .map_err(map_decision_error)
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/plans/{plan_id}/reject",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("plan_id" = String, Path, description = "Plan ID")
    ),
    request_body = PlanDecisionRequest,
    responses((status = 200, description = "Rejected proposed plan", body = PlanDecisionResponse)),
    tag = "plans"
)]
pub async fn reject_plan(
    State(state): State<AppState>,
    Path((workspace_id, plan_id)): Path<(String, String)>,
    Json(req): Json<PlanDecisionRequest>,
) -> Result<Json<PlanDecisionResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::PlanWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    state
        .plan_runtime
        .reject(&workspace_id, &plan_id, req.expected_decision_version)
        .await
        .map(Json)
        .map_err(map_decision_error)
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/plans/{plan_id}/handoff",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("plan_id" = String, Path, description = "Plan ID")
    ),
    request_body = HandoffPlanRequest,
    responses((status = 200, description = "Handed off proposed plan", body = HandoffPlanResponse)),
    tag = "plans"
)]
pub async fn handoff_plan(
    State(state): State<AppState>,
    Path((workspace_id, plan_id)): Path<(String, String)>,
    Json(req): Json<HandoffPlanRequest>,
) -> Result<Json<HandoffPlanResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::PlanWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    state
        .plan_runtime
        .handoff(&workspace_id, &plan_id, req)
        .await
        .map(Json)
        .map_err(map_handoff_error)
}

fn ensure_workspace_access(state: &AppState, workspace_id: &str) -> Result<(), ApiError> {
    state
        .workspace_access_gate
        .runtime_state(workspace_id)
        .map(|_| ())
        .map_err(map_access_error)
}

fn map_get_plan_error(error: GetPlanError) -> ApiError {
    match error {
        GetPlanError::NotFound => ApiError::not_found("Plan not found", "PLAN_NOT_FOUND"),
        GetPlanError::Store(error) => ApiError::internal(error.to_string()),
    }
}

fn map_decision_error(error: PlanDecisionError) -> ApiError {
    match error {
        PlanDecisionError::NotFound => ApiError::not_found("Plan not found", "PLAN_NOT_FOUND"),
        PlanDecisionError::StaleVersion => ApiError::conflict(
            "Stale plan decision version",
            "PLAN_DECISION_VERSION_CONFLICT",
        ),
        PlanDecisionError::TerminalState => ApiError::conflict(
            "Plan decision is already terminal",
            "PLAN_DECISION_TERMINAL",
        ),
        PlanDecisionError::Store(error) => ApiError::internal(error.to_string()),
    }
}

fn map_handoff_error(error: HandoffPlanError) -> ApiError {
    match error {
        HandoffPlanError::PlanNotFound => ApiError::not_found("Plan not found", "PLAN_NOT_FOUND"),
        HandoffPlanError::AgentKindRequired => ApiError::bad_request(
            "agentKind is required when targetSessionId is not provided",
            "PLAN_HANDOFF_AGENT_KIND_REQUIRED",
        ),
        HandoffPlanError::SessionNotFound => {
            ApiError::not_found("Target session not found", "SESSION_NOT_FOUND")
        }
        HandoffPlanError::CreateSession(error) => {
            tracing::error!(error = ?error, "failed to create proposed-plan handoff session");
            ApiError::internal("Failed to create handoff session")
        }
        HandoffPlanError::Store(error) => ApiError::internal(error.to_string()),
        HandoffPlanError::Prompt(error) => {
            tracing::error!(error = ?error, "failed to send proposed-plan handoff prompt");
            ApiError::internal("Failed to send handoff prompt")
        }
    }
}
