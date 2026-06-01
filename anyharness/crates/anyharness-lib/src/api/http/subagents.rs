use anyharness_contract::v1::{
    ChildSubagentSummary, ParentSubagentLinkSummary, ProblemDetails, ScheduleSubagentWakeRequest,
    ScheduleSubagentWakeResponse, SessionStatus, SessionSubagentsResponse,
    SubagentCompletionSummary as ContractSubagentCompletionSummary, SubagentTurnOutcome,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

use super::access::{assert_session_auth_scope, assert_workspace_mutable};
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::subagents::model::{
    ChildSubagentContext, ParentSubagentLinkContext, SessionSubagentsContext,
    SubagentCompletionSummary,
};
use crate::domains::sessions::subagents::service::SubagentError;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/subagents",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Subagent parent/child context", body = SessionSubagentsResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_session_subagents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionSubagentsResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let context = state
        .subagent_service
        .subagent_context(&session_id)
        .map_err(map_subagent_error)?;
    Ok(Json(session_subagents_to_contract(context)))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/subagents/{child_session_id}/wake",
    params(
        ("session_id" = String, Path, description = "Parent session ID"),
        ("child_session_id" = String, Path, description = "Child subagent session ID"),
    ),
    request_body = ScheduleSubagentWakeRequest,
    responses(
        (status = 200, description = "Scheduled a one-shot parent wake for the child subagent", body = ScheduleSubagentWakeResponse),
        (status = 400, description = "Invalid subagent wake request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Workspace or subagent state blocks wake scheduling", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn schedule_subagent_wake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, child_session_id)): Path<(String, String)>,
    Json(_body): Json<ScheduleSubagentWakeRequest>,
) -> Result<Json<ScheduleSubagentWakeResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let parent = state
        .session_service
        .get_session(&session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Session not found", "SESSION_NOT_FOUND"))?;
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&parent.workspace_id, WorkspaceOperationKind::SubagentWrite)
        .await;
    assert_workspace_mutable(&state, &parent.workspace_id)?;

    let (link, inserted) = state
        .subagent_service
        .schedule_wake_for_child(&session_id, &child_session_id)
        .map_err(map_subagent_error)?;

    Ok(Json(ScheduleSubagentWakeResponse {
        parent_session_id: session_id,
        subagent_id: link.public_id,
        child_session_id,
        session_link_id: link.id,
        wake_scheduled: true,
        already_scheduled: !inserted,
    }))
}

#[allow(dead_code)]
fn _problem_details_reference(_: ProblemDetails) {}

fn session_subagents_to_contract(context: SessionSubagentsContext) -> SessionSubagentsResponse {
    SessionSubagentsResponse {
        parent: context.parent.map(parent_subagent_to_contract),
        children: context
            .children
            .into_iter()
            .map(child_subagent_to_contract)
            .collect(),
    }
}

fn parent_subagent_to_contract(parent: ParentSubagentLinkContext) -> ParentSubagentLinkSummary {
    ParentSubagentLinkSummary {
        subagent_id: parent.subagent_id,
        session_link_id: parent.session_link_id,
        parent_session_id: parent.parent_session_id,
        parent_title: parent.parent_title,
        parent_agent_kind: parent.parent_agent_kind,
        parent_model_id: parent.parent_model_id,
        label: parent.label,
        link_created_at: parent.link_created_at,
        link_closed_at: parent.link_closed_at,
    }
}

fn child_subagent_to_contract(child: ChildSubagentContext) -> ChildSubagentSummary {
    ChildSubagentSummary {
        subagent_id: child.subagent_id,
        session_link_id: child.session_link_id,
        child_session_id: child.child_session_id,
        title: child.title,
        label: child.label,
        status: session_status_to_contract(&child.status),
        agent_kind: child.agent_kind,
        model_id: child.model_id,
        mode_id: child.mode_id,
        link_created_at: child.link_created_at,
        link_closed_at: child.link_closed_at,
        child_created_at: child.child_created_at,
        latest_completion: child.latest_completion.map(subagent_completion_to_contract),
        wake_scheduled: child.wake_scheduled,
    }
}

fn subagent_completion_to_contract(
    completion: SubagentCompletionSummary,
) -> ContractSubagentCompletionSummary {
    ContractSubagentCompletionSummary {
        completion_id: completion.completion_id,
        child_turn_id: completion.child_turn_id,
        outcome: match completion.outcome {
            SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
            SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
            SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
        },
        child_last_event_seq: completion.child_last_event_seq,
        created_at: completion.created_at,
        parent_event_seq: completion.parent_event_seq,
        parent_prompt_seq: completion.parent_prompt_seq,
    }
}

fn session_status_to_contract(status: &str) -> SessionStatus {
    match status {
        "starting" => SessionStatus::Starting,
        "idle" => SessionStatus::Idle,
        "running" => SessionStatus::Running,
        "completed" => SessionStatus::Completed,
        "closed" => SessionStatus::Closed,
        _ => SessionStatus::Errored,
    }
}

fn map_subagent_error(error: SubagentError) -> ApiError {
    match error {
        SubagentError::ParentNotFound(session_id) | SubagentError::ChildNotFound(session_id) => {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        }
        SubagentError::WorkspaceNotFound(workspace_id) => ApiError::not_found(
            format!("Workspace not found: {workspace_id}"),
            "WORKSPACE_NOT_FOUND",
        ),
        SubagentError::NotOwned => ApiError::conflict(
            "Child session is not owned by this parent session.",
            "SUBAGENT_NOT_OWNED",
        ),
        SubagentError::TargetRequired => ApiError::bad_request(
            "subagentId or childSessionId is required.",
            "SUBAGENT_TARGET_REQUIRED",
        ),
        SubagentError::ConflictingTarget => ApiError::bad_request(
            "subagentId and childSessionId refer to different subagents.",
            "SUBAGENT_TARGET_CONFLICT",
        ),
        SubagentError::Closed => ApiError::conflict("Subagent is closed.", "SUBAGENT_CLOSED"),
        SubagentError::IneligibleWorkspace => ApiError::conflict(
            "Subagents are only available in standard workspaces.",
            "SUBAGENT_INELIGIBLE_WORKSPACE",
        ),
        SubagentError::CrossWorkspace => ApiError::conflict(
            "Subagent child must be in the same workspace.",
            "SUBAGENT_CROSS_WORKSPACE",
        ),
        SubagentError::DepthLimit => ApiError::conflict(
            "Subagent children cannot create subagents.",
            "SUBAGENT_DEPTH_LIMIT",
        ),
        SubagentError::FanoutLimit => ApiError::conflict(
            "Parent already has the maximum number of subagents.",
            "SUBAGENT_FANOUT_LIMIT",
        ),
        SubagentError::MutationBlocked(_) => ApiError::conflict(
            "Workspace is not writable right now.",
            "WORKSPACE_MUTATION_BLOCKED",
        ),
        other => ApiError::internal(other.to_string()),
    }
}
