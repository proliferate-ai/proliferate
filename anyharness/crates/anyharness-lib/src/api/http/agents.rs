//! Agents transport handlers. Each handler: call ONE runtime use-case, errors
//! ride `?` through agents_errors.rs, wire mapping lives in agents_contract.rs.

use anyharness_contract::v1::{
    AgentLaunchOptionsResponse, AgentLoginTerminalRecord, AgentSummary, InstallAgentRequest,
    InstallAgentResponse, LoginCommand, ProblemDetails, ReconcileAgentsRequest,
    ReconcileAgentsResponse, StartAgentLoginRequest, StartAgentLoginResponse,
    StartAgentLoginTerminalResponse,
};
use axum::{
    extract::Query,
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use super::agents_contract::{
    agent_login_terminal_to_contract, install_request, launch_options_response,
    reconcile_snapshot_to_contract, to_installed_artifact_status, to_summary,
};
use super::agents_errors::map_launch_options_error;
use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::auth::login_terminal::{
    close_agent_login_terminal as close_agent_login_terminal_session,
    get_agent_login_terminal as get_agent_login_terminal_session,
    start_agent_login_terminal_session,
};

#[utoipa::path(
    get,
    path = "/v1/agents",
    responses(
        (status = 200, description = "List all supported agents with readiness state", body = Vec<AgentSummary>),
    ),
    tag = "agents"
)]
pub async fn list_agents(State(state): State<AppState>) -> Json<Vec<AgentSummary>> {
    let snapshot = state.agent_runtime.list_agents().await;
    let summaries: Vec<AgentSummary> = snapshot
        .agents
        .iter()
        .map(|agent| to_summary(agent, Some(&snapshot.reconcile_snapshot)))
        .collect();
    Json(summaries)
}

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "Agent readiness summary", body = AgentSummary),
        (status = 404, description = "Agent not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn get_agent(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<AgentSummary>, ApiError> {
    let snapshot = state.agent_runtime.get_agent(&kind).await?;
    Ok(Json(to_summary(
        &snapshot.agent,
        Some(&snapshot.reconcile_snapshot),
    )))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/install",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    request_body = InstallAgentRequest,
    responses(
        (status = 200, description = "Agent installed successfully", body = InstallAgentResponse),
        (status = 400, description = "Agent not installable or not found", body = ProblemDetails),
        (status = 500, description = "Install failed", body = ProblemDetails),
        (status = 502, description = "Download or registry failed", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn install_agent(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Json(req): Json<InstallAgentRequest>,
) -> Result<Json<InstallAgentResponse>, ApiError> {
    let outcome = state
        .agent_runtime
        .install_agent(&kind, install_request(req))
        .await?;
    Ok(Json(InstallAgentResponse {
        agent: to_summary(&outcome.agent, None),
        already_installed: outcome.already_installed,
        installed_artifacts: outcome
            .installed_artifacts
            .iter()
            .map(to_installed_artifact_status)
            .collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/login/start",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    request_body = StartAgentLoginRequest,
    responses(
        (status = 200, description = "Login instructions returned", body = StartAgentLoginResponse),
        (status = 400, description = "Login not supported", body = ProblemDetails),
        (status = 404, description = "Agent not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn start_agent_login(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Json(_req): Json<StartAgentLoginRequest>,
) -> Result<Json<StartAgentLoginResponse>, ApiError> {
    let login = state.agent_runtime.start_login(&kind).await?;
    Ok(Json(StartAgentLoginResponse {
        kind: login.kind,
        label: login.label,
        mode: "terminal_command".into(),
        command: LoginCommand {
            program: login.command.program,
            args: login.command.args,
        },
        reuses_user_state: login.reuses_user_state,
        message: login.message,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/login/terminal",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    request_body = StartAgentLoginRequest,
    responses(
        (status = 200, description = "Agent login terminal started", body = StartAgentLoginTerminalResponse),
        (status = 400, description = "Login not supported", body = ProblemDetails),
        (status = 404, description = "Agent not found", body = ProblemDetails),
        (status = 409, description = "Login command not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn start_agent_login_terminal(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Json(_req): Json<StartAgentLoginRequest>,
) -> Result<Json<StartAgentLoginTerminalResponse>, ApiError> {
    let login = start_agent_login_terminal_session(
        &state.agent_runtime,
        &kind,
        &state.agent_login_terminal_service,
    )
    .await?;
    Ok(Json(StartAgentLoginTerminalResponse {
        kind: login.kind,
        label: login.label,
        message: login.message,
        agent_login_terminal: agent_login_terminal_to_contract(login.terminal),
    }))
}

#[utoipa::path(
    get,
    path = "/v1/agents/login-terminals/{terminal_id}",
    params(("terminal_id" = String, Path, description = "Agent login terminal ID")),
    responses(
        (status = 200, description = "Agent login terminal", body = AgentLoginTerminalRecord),
        (status = 404, description = "Agent login terminal not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn get_agent_login_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
) -> Result<Json<AgentLoginTerminalRecord>, ApiError> {
    let terminal =
        get_agent_login_terminal_session(&terminal_id, &state.agent_login_terminal_service).await?;
    Ok(Json(agent_login_terminal_to_contract(terminal)))
}

#[utoipa::path(
    delete,
    path = "/v1/agents/login-terminals/{terminal_id}",
    params(("terminal_id" = String, Path, description = "Agent login terminal ID")),
    responses(
        (status = 204, description = "Agent login terminal closed"),
        (status = 404, description = "Agent login terminal not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn close_agent_login_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    close_agent_login_terminal_session(&terminal_id, &state.agent_login_terminal_service).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/v1/agents/reconcile",
    responses(
        (status = 200, description = "Current agent reconcile status", body = ReconcileAgentsResponse),
    ),
    tag = "agents"
)]
pub async fn get_reconcile_status(State(state): State<AppState>) -> Json<ReconcileAgentsResponse> {
    let snapshot = state.agent_runtime.reconcile_status().await;
    Json(reconcile_snapshot_to_contract(&snapshot))
}

#[utoipa::path(
    post,
    path = "/v1/agents/reconcile",
    request_body = ReconcileAgentsRequest,
    responses(
        (status = 202, description = "Agent reconcile started or reused", body = ReconcileAgentsResponse),
    ),
    tag = "agents"
)]
pub async fn reconcile_agents(
    State(state): State<AppState>,
    Json(req): Json<ReconcileAgentsRequest>,
) -> (StatusCode, Json<ReconcileAgentsResponse>) {
    let snapshot = state.agent_runtime.start_reconcile(req.reinstall).await;
    (
        StatusCode::ACCEPTED,
        Json(reconcile_snapshot_to_contract(&snapshot)),
    )
}

#[derive(Debug, serde::Deserialize)]
pub struct AgentLaunchOptionsQuery {
    pub workspace_id: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/agents/launch-options",
    params(("workspace_id" = Option<String>, Query, description = "Optional workspace scope: composes the workspace env into auth-context classification")),
    responses(
        (status = 200, description = "List launchable agents and model options", body = AgentLaunchOptionsResponse),
    ),
    tag = "agents"
)]
pub async fn get_agent_launch_options(
    State(state): State<AppState>,
    Query(query): Query<AgentLaunchOptionsQuery>,
) -> Result<Json<AgentLaunchOptionsResponse>, ApiError> {
    let options = state
        .session_service
        .resolved_workspace_launch_options(query.workspace_id.as_deref())
        .map_err(map_launch_options_error)?;
    Ok(Json(launch_options_response(query.workspace_id, options)))
}
