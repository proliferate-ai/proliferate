use std::time::Instant;

use anyharness_contract::v1::{
    CreateSessionRequest, EditPendingPromptRequest, GetSessionLiveConfigResponse,
    InteractionDecision, PromptInputBlock, PromptSessionRequest, PromptSessionResponse,
    ResolveInteractionRequest, Session, SessionEventEnvelope, SessionRawNotificationEnvelope,
    SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, UpdateSessionTitleRequest,
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue},
    Json,
};
use serde::Deserialize;

use super::access::assert_session_mutable;
use super::error::ApiError;
use super::latency::{latency_trace_fields, LatencyRequestContext};
use crate::acp::permission_broker::PermissionDecision;
use crate::app::AppState;
use crate::sessions::mcp::bindings_from_contract;
use crate::sessions::runtime::{
    CreateAndStartSessionError, EnsureLiveSessionError, InteractionResolutionRequest,
    PendingPromptMutationError, ResolveInteractionError, SendPromptError, SendPromptOutcome,
    SessionLifecycleError, SetSessionConfigOptionError,
};
use crate::sessions::service::{GetLiveConfigSnapshotError, UpdateSessionTitleError};

#[derive(Debug, Deserialize)]
pub struct ListSessionsQuery {
    pub workspace_id: Option<String>,
    pub include_dismissed: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ListSessionEventsQuery {
    pub after_seq: Option<i64>,
}

// ---------------------------------------------------------------------------
// Create session — eager: spawns the ACP actor before returning
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions",
    request_body = CreateSessionRequest,
    responses(
        (status = 200, description = "Created session with live ACP actor", body = Session),
        (status = 400, description = "Invalid request", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<Session>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    let workspace_id = req.workspace_id.clone();
    let agent_kind = req.agent_kind.clone();
    let model_id = req.model_id.clone();
    let mode_id = req.mode_id.clone();
    let mcp_servers = bindings_from_contract(req.mcp_servers.clone().unwrap_or_default());
    let system_prompt_append_count = req
        .system_prompt_append
        .as_ref()
        .map(|entries| entries.len())
        .unwrap_or(0);
    let mcp_server_count = mcp_servers.len();
    tracing::info!(
        workspace_id = %workspace_id,
        agent_kind = %agent_kind,
        model_id = ?model_id,
        mode_id = ?mode_id,
        system_prompt_append_count,
        mcp_server_count,
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.create.request_received"
    );
    let record = state
        .session_runtime
        .create_and_start_session(
            &workspace_id,
            &agent_kind,
            model_id.as_deref(),
            mode_id.as_deref(),
            req.system_prompt_append,
            mcp_servers,
            latency.as_ref(),
        )
        .await
        .map_err(map_create_session_error)?;

    tracing::info!(
        workspace_id = %workspace_id,
        session_id = %record.id,
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.create.completed"
    );

    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    patch,
    path = "/v1/sessions/{session_id}/title",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = UpdateSessionTitleRequest,
    responses(
        (status = 200, description = "Updated session title", body = Session),
        (status = 400, description = "Invalid title", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn update_session_title(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(req): Json<UpdateSessionTitleRequest>,
) -> Result<Json<Session>, ApiError> {
    assert_session_mutable(&state, &session_id)?;
    let record = state
        .session_service
        .update_session_title(&session_id, &req.title)
        .map_err(map_update_session_title_error)?;

    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/live-config",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Current live config snapshot", body = GetSessionLiveConfigResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_live_session_config(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<GetSessionLiveConfigResponse>, ApiError> {
    let live_config = state
        .session_service
        .get_live_config_snapshot_checked(&session_id)
        .map_err(map_get_live_config_snapshot_error)?;
    Ok(Json(GetSessionLiveConfigResponse { live_config }))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/config-options",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = SetSessionConfigOptionRequest,
    responses(
        (status = 200, description = "Session config option applied or queued", body = SetSessionConfigOptionResponse),
        (status = 400, description = "Invalid config option", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn set_session_config_option(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(req): Json<SetSessionConfigOptionRequest>,
) -> Result<Json<SetSessionConfigOptionResponse>, ApiError> {
    tracing::debug!(
        session_id = %session_id,
        config_id = %req.config_id,
        value = %req.value,
        "Setting session config option"
    );
    let (session, live_config, apply_state) = state
        .session_runtime
        .set_live_session_config_option(&session_id, &req.config_id, &req.value)
        .await
        .map_err(map_set_session_config_option_error)?;
    tracing::debug!(
        session_id = %session_id,
        config_id = %req.config_id,
        value = %req.value,
        apply_state = ?apply_state,
        "Session config option set"
    );
    Ok(Json(SetSessionConfigOptionResponse {
        session: state
            .session_runtime
            .session_to_contract_with_live_config(&session, live_config.clone())
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
        live_config,
        apply_state,
    }))
}

// ---------------------------------------------------------------------------
// Prompt session — ack-and-stream: returns quickly, output flows over SSE
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/prompt",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = anyharness_contract::v1::PromptSessionRequest,
    responses(
        (status = 200, description = "Prompt accepted (running or queued)", body = anyharness_contract::v1::PromptSessionResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn prompt_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(req): Json<PromptSessionRequest>,
) -> Result<Json<PromptSessionResponse>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    let text = extract_prompt_text(&req.blocks);
    tracing::info!(
        session_id = %session_id,
        block_count = req.blocks.len(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.prompt.request_received"
    );

    let outcome = state
        .session_runtime
        .send_prompt(&session_id, text, latency.as_ref())
        .await
        .map_err(map_send_prompt_error)?;

    tracing::info!(
        session_id = %session_id,
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.prompt.completed"
    );

    let (record, status, queued_seq) = match outcome {
        SendPromptOutcome::Running { session } => (
            session,
            anyharness_contract::v1::PromptSessionStatus::Running,
            None,
        ),
        SendPromptOutcome::Queued { session, seq } => (
            session,
            anyharness_contract::v1::PromptSessionStatus::Queued,
            Some(seq),
        ),
    };

    Ok(Json(PromptSessionResponse {
        session: state
            .session_runtime
            .session_to_contract(&record)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
        status,
        queued_seq,
    }))
}

// ---------------------------------------------------------------------------
// Pending-prompt queue mutations — edit and delete queued prompts
// ---------------------------------------------------------------------------

#[utoipa::path(
    patch,
    path = "/v1/sessions/{session_id}/pending-prompts/{seq}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("seq" = i64, Path, description = "Queue row sequence number"),
    ),
    request_body = anyharness_contract::v1::EditPendingPromptRequest,
    responses(
        (status = 200, description = "Pending prompt updated", body = Session),
        (status = 404, description = "Session or pending prompt not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn edit_pending_prompt(
    State(state): State<AppState>,
    Path((session_id, seq)): Path<(String, i64)>,
    Json(req): Json<EditPendingPromptRequest>,
) -> Result<Json<Session>, ApiError> {
    let updated = state
        .session_runtime
        .edit_pending_prompt(&session_id, seq, req.text)
        .await
        .map_err(map_pending_prompt_mutation_error)?;
    Ok(Json(session_to_contract(&state, &updated).await?))
}

#[utoipa::path(
    delete,
    path = "/v1/sessions/{session_id}/pending-prompts/{seq}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("seq" = i64, Path, description = "Queue row sequence number"),
    ),
    responses(
        (status = 200, description = "Pending prompt deleted", body = Session),
        (status = 404, description = "Session or pending prompt not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn delete_pending_prompt(
    State(state): State<AppState>,
    Path((session_id, seq)): Path<(String, i64)>,
) -> Result<Json<Session>, ApiError> {
    let updated = state
        .session_runtime
        .delete_pending_prompt(&session_id, seq)
        .await
        .map_err(map_pending_prompt_mutation_error)?;
    Ok(Json(session_to_contract(&state, &updated).await?))
}

// ---------------------------------------------------------------------------
// Resume session — idempotent: starts the actor if cold
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/resume",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session resumed", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn resume_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let updated = state
        .session_runtime
        .ensure_live_session(&session_id, latency.as_ref())
        .await
        .map_err(map_ensure_live_session_error)?;

    Ok(Json(session_to_contract(&state, &updated).await?))
}

// ---------------------------------------------------------------------------
// Cancel session — sends cancel to the live actor
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/cancel",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session cancelled", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn cancel_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    let updated = state
        .session_runtime
        .cancel_live_session(&session_id)
        .await
        .map_err(map_session_lifecycle_error)?;

    Ok(Json(session_to_contract(&state, &updated).await?))
}

// ---------------------------------------------------------------------------
// Close session — shuts down the actor and marks closed
// Retained for compatibility; no current first-party client flow calls this.
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/close",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session closed", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn close_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    let record = state
        .session_runtime
        .close_live_session(&session_id)
        .await
        .map_err(map_session_lifecycle_error)?;
    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/dismiss",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session dismissed", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn dismiss_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    let record = state
        .session_runtime
        .dismiss_live_session(&session_id)
        .await
        .map_err(map_session_lifecycle_error)?;
    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/sessions/restore",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Restored most recently dismissed session", body = Option<Session>),
    ),
    tag = "sessions"
)]
pub async fn restore_dismissed_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Option<Session>>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    tracing::info!(
        workspace_id = %workspace_id,
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.restore.request_received"
    );
    let restored = state
        .session_runtime
        .restore_dismissed_session(&workspace_id, latency.as_ref())
        .await
        .map_err(map_session_lifecycle_error)?;
    tracing::info!(
        workspace_id = %workspace_id,
        restored = restored.is_some(),
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.restore.completed"
    );

    match restored {
        Some(record) => Ok(Json(Some(session_to_contract(&state, &record).await?))),
        None => Ok(Json(None)),
    }
}

// ---------------------------------------------------------------------------
// List / get / events / permissions (unchanged)
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/v1/sessions",
    params(("workspace_id" = Option<String>, Query, description = "Filter by workspace")),
    responses(
        (status = 200, description = "List sessions", body = Vec<Session>),
    ),
    tag = "sessions"
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<ListSessionsQuery>,
) -> Result<Json<Vec<Session>>, ApiError> {
    let records = state
        .session_service
        .list_sessions(
            query.workspace_id.as_deref(),
            query.include_dismissed.unwrap_or(false),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut sessions = Vec::with_capacity(records.len());
    for record in &records {
        sessions.push(session_to_contract(&state, record).await?);
    }
    Ok(Json(sessions))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    let record = state
        .session_service
        .get_session(&session_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;
    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/events",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("after_seq" = Option<i64>, Query, description = "Return only events with seq greater than this value"),
    ),
    responses(
        (status = 200, description = "Session event history", body = Vec<SessionEventEnvelope>),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_session_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(query): Query<ListSessionEventsQuery>,
) -> Result<Json<Vec<SessionEventEnvelope>>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    let after_seq = query.after_seq.map(|seq| seq.max(0));
    tracing::info!(
        session_id = %session_id,
        after_seq,
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.events.start"
    );
    let event_records = state
        .session_service
        .list_session_event_records(&session_id, after_seq)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;

    let envelopes: Vec<SessionEventEnvelope> = event_records
        .iter()
        .filter_map(|r| {
            let event = serde_json::from_str(&r.payload_json).ok()?;
            Some(SessionEventEnvelope {
                session_id: r.session_id.clone(),
                seq: r.seq,
                timestamp: r.timestamp.clone(),
                turn_id: r.turn_id.clone(),
                item_id: r.item_id.clone(),
                event,
            })
        })
        .collect();

    tracing::info!(
        session_id = %session_id,
        event_count = envelopes.len(),
        after_seq,
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.http.events.completed"
    );

    Ok(Json(envelopes))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/raw-notifications",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("after_seq" = Option<i64>, Query, description = "Return only raw notifications with seq greater than this value"),
    ),
    responses(
        (status = 200, description = "Raw ACP notification history", body = Vec<SessionRawNotificationEnvelope>),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_session_raw_notifications(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<ListSessionEventsQuery>,
) -> Result<Json<Vec<SessionRawNotificationEnvelope>>, ApiError> {
    let raw_records = state
        .session_service
        .list_session_raw_notification_records(&session_id, query.after_seq.map(|seq| seq.max(0)))
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;

    let notifications = raw_records
        .into_iter()
        .filter_map(raw_notification_record_to_envelope)
        .collect();

    Ok(Json(notifications))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/interactions/{request_id}/resolve",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("request_id" = String, Path, description = "Interaction request ID"),
    ),
    request_body = anyharness_contract::v1::ResolveInteractionRequest,
    responses(
        (status = 200, description = "Interaction resolved"),
        (status = 400, description = "Invalid interaction resolution", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn resolve_interaction(
    State(state): State<AppState>,
    Path((session_id, request_id)): Path<(String, String)>,
    Json(req): Json<ResolveInteractionRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let resolution = resolve_interaction_input(req);

    state
        .session_runtime
        .resolve_interaction_request(&session_id, &request_id, resolution)
        .await
        .map_err(map_resolve_interaction_error)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/interactions/{request_id}/mcp-url/reveal",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("request_id" = String, Path, description = "Interaction request ID"),
    ),
    responses(
        (status = 200, description = "MCP elicitation URL revealed", body = anyharness_contract::v1::McpElicitationUrlRevealResponse),
        (status = 400, description = "Invalid interaction kind", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn reveal_mcp_elicitation_url(
    State(state): State<AppState>,
    Path((session_id, request_id)): Path<(String, String)>,
) -> Result<
    (
        HeaderMap,
        Json<anyharness_contract::v1::McpElicitationUrlRevealResponse>,
    ),
    ApiError,
> {
    let response = state
        .session_runtime
        .reveal_mcp_elicitation_url(&session_id, &request_id)
        .await
        .map_err(map_resolve_interaction_error)?;

    let mut headers = HeaderMap::new();
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    Ok((headers, Json(response)))
}

fn extract_prompt_text(blocks: &[PromptInputBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            PromptInputBlock::Text { text } => Some(text.as_str()),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn raw_notification_record_to_envelope(
    record: crate::sessions::model::SessionRawNotificationRecord,
) -> Option<SessionRawNotificationEnvelope> {
    let notification = serde_json::from_str(&record.payload_json).ok()?;
    Some(SessionRawNotificationEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        notification,
    })
}

fn resolve_interaction_input(request: ResolveInteractionRequest) -> InteractionResolutionRequest {
    match request {
        ResolveInteractionRequest::Selected { option_id } => {
            InteractionResolutionRequest::OptionId(option_id)
        }
        ResolveInteractionRequest::Decision {
            decision: InteractionDecision::Allow,
        } => InteractionResolutionRequest::Decision(PermissionDecision::Allow),
        ResolveInteractionRequest::Decision {
            decision: InteractionDecision::Deny,
        } => InteractionResolutionRequest::Decision(PermissionDecision::Deny),
        ResolveInteractionRequest::Submitted { answers } => {
            InteractionResolutionRequest::Submitted { answers }
        }
        ResolveInteractionRequest::Accepted { fields } => {
            InteractionResolutionRequest::Accepted { fields }
        }
        ResolveInteractionRequest::Declined => InteractionResolutionRequest::Declined,
        ResolveInteractionRequest::Cancelled => InteractionResolutionRequest::Cancelled,
        ResolveInteractionRequest::Dismissed => InteractionResolutionRequest::Dismissed,
    }
}

fn map_resolve_interaction_error(error: ResolveInteractionError) -> ApiError {
    match error {
        ResolveInteractionError::SessionNotLive(session_id) => {
            ApiError::not_found(format!("No live session: {session_id}"), "SESSION_NOT_LIVE")
        }
        ResolveInteractionError::InteractionNotFound(request_id) => ApiError::not_found(
            format!("No pending interaction request: {request_id}"),
            "INTERACTION_NOT_FOUND",
        ),
        ResolveInteractionError::PlanLinkedInteraction(request_id) => ApiError::conflict(
            format!("Interaction request is linked to a proposed plan: {request_id}"),
            "PLAN_LINKED_INTERACTION",
        ),
        ResolveInteractionError::InteractionKindMismatch(request_id) => ApiError::bad_request(
            format!("Resolution outcome does not match interaction kind: {request_id}"),
            "INTERACTION_KIND_MISMATCH",
        ),
        ResolveInteractionError::InvalidOptionId(request_id) => ApiError::bad_request(
            format!("Invalid option for interaction request: {request_id}"),
            "INTERACTION_OPTION_NOT_FOUND",
        ),
        ResolveInteractionError::InvalidQuestionId(request_id) => ApiError::bad_request(
            format!("Invalid question for interaction request: {request_id}"),
            "INTERACTION_QUESTION_NOT_FOUND",
        ),
        ResolveInteractionError::DuplicateQuestionAnswer(request_id) => ApiError::bad_request(
            format!("Duplicate question answer for interaction request: {request_id}"),
            "INTERACTION_DUPLICATE_QUESTION_ANSWER",
        ),
        ResolveInteractionError::MissingQuestionAnswer(request_id) => ApiError::bad_request(
            format!("Missing question answer for interaction request: {request_id}"),
            "INTERACTION_MISSING_QUESTION_ANSWER",
        ),
        ResolveInteractionError::InvalidSelectedOptionLabel(request_id) => ApiError::bad_request(
            format!("Invalid selected option label for interaction request: {request_id}"),
            "INTERACTION_OPTION_LABEL_NOT_FOUND",
        ),
        ResolveInteractionError::InvalidMcpFieldId(request_id) => ApiError::bad_request(
            format!("Invalid MCP field for interaction request: {request_id}"),
            "INTERACTION_MCP_FIELD_NOT_FOUND",
        ),
        ResolveInteractionError::DuplicateMcpField(request_id) => ApiError::bad_request(
            format!("Duplicate MCP field for interaction request: {request_id}"),
            "INTERACTION_DUPLICATE_MCP_FIELD",
        ),
        ResolveInteractionError::MissingMcpField(request_id) => ApiError::bad_request(
            format!("Missing MCP field for interaction request: {request_id}"),
            "INTERACTION_MISSING_MCP_FIELD",
        ),
        ResolveInteractionError::InvalidMcpFieldValue(request_id) => ApiError::bad_request(
            format!("Invalid MCP field value for interaction request: {request_id}"),
            "INTERACTION_INVALID_MCP_FIELD_VALUE",
        ),
        ResolveInteractionError::NotMcpUrlElicitation(request_id) => ApiError::bad_request(
            format!("Interaction request is not an MCP URL elicitation: {request_id}"),
            "INTERACTION_NOT_MCP_URL_ELICITATION",
        ),
        ResolveInteractionError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_create_session_error(error: CreateAndStartSessionError) -> ApiError {
    match error {
        CreateAndStartSessionError::Invalid(detail) => {
            ApiError::bad_request(detail, "SESSION_CREATE_FAILED")
        }
        CreateAndStartSessionError::WorkspaceNotFound => {
            ApiError::bad_request("workspace not found", "WORKSPACE_NOT_FOUND")
        }
        CreateAndStartSessionError::WorkspaceSingleSession { session_id } => ApiError::conflict(
            format!("workspace only allows a single session; existing session: {session_id}"),
            "WORKSPACE_SINGLE_SESSION",
        ),
        CreateAndStartSessionError::MissingDataKey => ApiError::internal(
            crate::sessions::mcp::SessionMcpBindingsError::missing_data_key_detail(),
        ),
        CreateAndStartSessionError::StartFailed(error) => {
            ApiError::internal(format!("ACP session start failed: {error}"))
        }
        CreateAndStartSessionError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_ensure_live_session_error(error: EnsureLiveSessionError) -> ApiError {
    match error {
        EnsureLiveSessionError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        EnsureLiveSessionError::RestartRequired(detail) => {
            ApiError::conflict(detail, "SESSION_RESTART_REQUIRED")
        }
        EnsureLiveSessionError::Internal(error) => {
            ApiError::internal(format!("resume failed: {error}"))
        }
    }
}

fn map_set_session_config_option_error(error: SetSessionConfigOptionError) -> ApiError {
    match error {
        SetSessionConfigOptionError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        SetSessionConfigOptionError::Rejected(detail) => {
            ApiError::bad_request(detail, "SESSION_CONFIG_REJECTED")
        }
        SetSessionConfigOptionError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_send_prompt_error(error: SendPromptError) -> ApiError {
    match error {
        SendPromptError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        SendPromptError::EmptyPrompt => ApiError::bad_request("empty prompt", "EMPTY_PROMPT"),
        SendPromptError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_pending_prompt_mutation_error(error: PendingPromptMutationError) -> ApiError {
    match error {
        PendingPromptMutationError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        PendingPromptMutationError::NotFound => {
            ApiError::not_found("Pending prompt not found", "PENDING_PROMPT_NOT_FOUND")
        }
        PendingPromptMutationError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_get_live_config_snapshot_error(error: GetLiveConfigSnapshotError) -> ApiError {
    match error {
        GetLiveConfigSnapshotError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        GetLiveConfigSnapshotError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_update_session_title_error(error: UpdateSessionTitleError) -> ApiError {
    match error {
        UpdateSessionTitleError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        UpdateSessionTitleError::EmptyTitle => {
            ApiError::bad_request("session title cannot be empty", "SESSION_TITLE_EMPTY")
        }
        UpdateSessionTitleError::TitleTooLong(limit) => ApiError::bad_request(
            format!("session title cannot exceed {limit} characters"),
            "SESSION_TITLE_TOO_LONG",
        ),
        UpdateSessionTitleError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_session_lifecycle_error(error: SessionLifecycleError) -> ApiError {
    match error {
        SessionLifecycleError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        SessionLifecycleError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

async fn session_to_contract(
    state: &AppState,
    record: &crate::sessions::model::SessionRecord,
) -> Result<Session, ApiError> {
    state
        .session_runtime
        .session_to_contract(record)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))
}
