//! Agents transport handlers. Each handler: call ONE runtime use-case, errors
//! ride `?` through agents_errors.rs, wire mapping lives in agents_contract.rs.

use anyharness_contract::v1::{
    AgentLoginTerminalRecord, AgentLoginVariant, AgentSummary, ClaimAgentMintTokenResponse,
    InstallAgentRequest, InstallAgentResponse, LoginCommand, ProblemDetails,
    ReconcileAgentsRequest, ReconcileAgentsResponse, StartAgentLoginRequest,
    StartAgentLoginResponse, StartAgentLoginTerminalResponse,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use super::agents_contract::{
    agent_login_terminal_to_contract, install_request, reconcile_snapshot_to_contract,
    to_installed_artifact_status, to_summary,
};
use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::auth::login_terminal::{
    close_agent_login_terminal as close_agent_login_terminal_session,
    get_agent_login_terminal as get_agent_login_terminal_session,
    start_agent_login_terminal_session, AgentLoginVariant as DomainLoginVariant, MintClaimError,
};
use crate::domains::agents::launch_probe::{LaunchProbeService, PokeReason};

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
    // The status documents are the persisted machine truth (agent_auth spec
    // §2) — read here, never recomputed: the projection carries EXACTLY what
    // GET /v1/agent-auth/status serves, so the two surfaces cannot disagree.
    let auth_statuses: Vec<Option<anyharness_contract::v1::AgentAuthStatusDoc>> = snapshot
        .agents
        .iter()
        .map(|agent| {
            state
                .agent_status_service
                .read(agent.descriptor.kind.as_str())
                .map(super::agent_auth_contract::status_doc_to_contract)
        })
        .collect();
    // to_summary probes PATH per agent (userPathCopyDetected); keep that
    // synchronous IO off the async executor.
    let summaries = tokio::task::spawn_blocking(move || {
        snapshot
            .agents
            .iter()
            .zip(auth_statuses)
            .map(|(agent, auth_status)| {
                to_summary(agent, Some(&snapshot.reconcile_snapshot), auth_status)
            })
            .collect::<Vec<AgentSummary>>()
    })
    .await
    .unwrap_or_default();
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
    let auth_status = state
        .agent_status_service
        .read(&kind)
        .map(super::agent_auth_contract::status_doc_to_contract);
    let summary = tokio::task::spawn_blocking(move || {
        to_summary(
            &snapshot.agent,
            Some(&snapshot.reconcile_snapshot),
            auth_status,
        )
    })
    .await
    .map_err(|e| ApiError::internal(format!("agent summary task failed: {e}")))?;
    Ok(Json(summary))
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
    // Install-completed poke (model-catalog.md, "The snapshot reconciler": "both
    // places an install finishes"). A snapshot is version-bound, so a fresh install
    // is exactly when a harness's entries can have gone stale — and onboarding's
    // "checking for latest models" step is this poke rendered, not a separate
    // trigger. Fire-and-forget, after the response body is already decided.
    LaunchProbeService::poke_optional(
        &state.automatic_poke_engine,
        &kind,
        PokeReason::InstallCompleted,
    );
    let auth_status = state
        .agent_status_service
        .read(&kind)
        .map(super::agent_auth_contract::status_doc_to_contract);
    Ok(Json(InstallAgentResponse {
        agent: to_summary(&outcome.agent, None, auth_status),
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
    Json(req): Json<StartAgentLoginRequest>,
) -> Result<Json<StartAgentLoginTerminalResponse>, ApiError> {
    // The variant parameter (seats v1): `mint_seat` runs the seat-minting flow
    // — `claude setup-token` in an isolated dir with the in-memory capture
    // attached, single-flight per harness (a second mint returns — i.e.
    // focuses — the open terminal). Absent means the native login, unchanged.
    let variant = match req.variant.unwrap_or_default() {
        AgentLoginVariant::Native => DomainLoginVariant::Native,
        AgentLoginVariant::MintSeat => DomainLoginVariant::MintSeat,
    };
    let login = start_agent_login_terminal_session(
        &state.agent_runtime,
        &kind,
        variant,
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
    post,
    path = "/v1/agents/login-terminals/{terminal_id}/mint-token",
    params(("terminal_id" = String, Path, description = "Agent login terminal ID")),
    responses(
        (status = 200, description = "The captured seat token, exactly once", body = ClaimAgentMintTokenResponse),
        (status = 404, description = "Not a mint terminal, or not found", body = ProblemDetails),
        (status = 409, description = "Capture not complete (or already consumed)", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn claim_agent_login_terminal_mint_token(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
) -> Result<Json<ClaimAgentMintTokenResponse>, ApiError> {
    // The mint handoff (agent_auth spec §3 flow 2): the courier collects the
    // captured token in one read; serving it wipes the runtime's buffer, so
    // this response body is the only copy in flight. Never logged.
    match state
        .agent_login_terminal_service
        .claim_mint_token(&terminal_id)
        .await
    {
        Ok(token) => Ok(Json(ClaimAgentMintTokenResponse { token })),
        Err(MintClaimError::NotFound) => Err(ApiError::not_found(
            "Agent mint terminal not found",
            "AGENT_MINT_TERMINAL_NOT_FOUND",
        )),
        Err(MintClaimError::NotReady(status)) => Err(ApiError::new(
            axum::http::StatusCode::CONFLICT,
            "Mint capture not claimable",
            Some(format!(
                "The seat capture is not claimable right now (state: {status:?})."
            )),
            Some("AGENT_MINT_TOKEN_NOT_READY"),
        )),
    }
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
    // Read the record before closing: the poke below needs the harness kind, and
    // the close consumes the terminal.
    let terminal =
        get_agent_login_terminal_session(&terminal_id, &state.agent_login_terminal_service).await?;
    close_agent_login_terminal_session(&terminal_id, &state.agent_login_terminal_service).await?;
    // Login-terminal-closed poke (model-catalog.md, "Freshness is event-driven"):
    // a native login performed through the product's login terminal changes the
    // harness's own credentials, so terminal exit pokes the probe. Fire-and-forget
    // after the close is already decided. (A login performed entirely outside the
    // product has no event; the unconditional startup pass is the safety net.)
    LaunchProbeService::poke_optional(
        &state.automatic_poke_engine,
        &terminal.kind,
        PokeReason::LoginTerminal,
    );
    // A closed login terminal may have changed the harness's native world —
    // the status document's detection row re-reads it now.
    state.agent_status_service.refresh(
        &terminal.kind,
        crate::domains::agents::status::RefreshCause::LoginTerminal,
    );
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
        (status = 400, description = "Unknown agent kind", body = ProblemDetails),
        (status = 409, description = "An incompatible reconcile job is already active", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn reconcile_agents(
    State(state): State<AppState>,
    Json(req): Json<ReconcileAgentsRequest>,
) -> Result<(StatusCode, Json<ReconcileAgentsResponse>), ApiError> {
    let snapshot = state
        .agent_runtime
        .start_reconcile(req.reinstall, req.installed_only, req.agent_kinds)
        .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(reconcile_snapshot_to_contract(&snapshot)),
    ))
}
