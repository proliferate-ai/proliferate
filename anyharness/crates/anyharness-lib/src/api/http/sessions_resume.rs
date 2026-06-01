use anyharness_contract::v1::{ResumeSessionRequest, Session};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use super::sessions_contract::session_to_contract;
use super::sessions_errors::map_ensure_live_session_error;
use super::sessions_leases::acquire_session_operation_lease;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::observability::latency::LatencyRequestContext;
use crate::sessions::runtime::SessionMcpRefresh;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/resume",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = Option<ResumeSessionRequest>,
    responses(
        (status = 200, description = "Session resumed", body = Session),
        (status = 409, description = "Session must be restarted before applying resume changes", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn resume_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    body: Bytes,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let latency = LatencyRequestContext::from_headers(&headers);
    let req = parse_optional_resume_request(body)?;
    let has_live_session = state.session_runtime.has_live_session(&session_id).await;
    if req.expected_runtime_config_revision.is_some() && has_live_session {
        return Err(ApiError::conflict(
            "runtime config changes require restarting the session",
            "RUNTIME_CONFIG_RESUME_UNSUPPORTED",
        ));
    }
    if let Some(expected) = req.expected_runtime_config_revision.as_ref() {
        state
            .runtime_config_service
            .assert_session_context_matches(&session_id, expected)
            .map_err(super::runtime_config::map_runtime_config_error)?;
    }
    let mcp_refresh = if has_live_session {
        None
    } else {
        Some(SessionMcpRefresh {
            mcp_servers: Vec::new(),
            mcp_binding_summaries: None,
        })
    };
    let _lease =
        acquire_session_operation_lease(&state, &session_id, WorkspaceOperationKind::SessionResume)
            .await?;
    let updated = state
        .session_runtime
        .ensure_live_session(&session_id, mcp_refresh, latency.as_ref())
        .await
        .map_err(map_ensure_live_session_error)?;

    Ok(Json(session_to_contract(&state, &updated).await?))
}

fn parse_optional_resume_request(body: Bytes) -> Result<ResumeSessionRequest, ApiError> {
    if body.is_empty() {
        return Ok(ResumeSessionRequest::default());
    }
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(ResumeSessionRequest::default());
    }
    if body.as_ref().trim_ascii() == b"null" {
        return Ok(ResumeSessionRequest::default());
    }
    serde_json::from_slice::<ResumeSessionRequest>(&body).map_err(|error| {
        ApiError::bad_request(
            format!("invalid resume request: {error}"),
            "INVALID_RESUME_REQUEST",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn resume_request_accepts_missing_body() {
        let request = match parse_optional_resume_request(Bytes::new()) {
            Ok(request) => request,
            Err(_) => panic!("parse empty body"),
        };

        assert!(request.expected_runtime_config_revision.is_none());
    }

    #[test]
    fn resume_request_accepts_empty_object() {
        let request = match parse_optional_resume_request(Bytes::from_static(br#"{}"#)) {
            Ok(request) => request,
            Err(_) => panic!("parse empty object"),
        };

        assert!(request.expected_runtime_config_revision.is_none());
    }

    #[test]
    fn resume_request_accepts_null_body() {
        let request = match parse_optional_resume_request(Bytes::from_static(br#" null "#)) {
            Ok(request) => request,
            Err(_) => panic!("parse null body"),
        };

        assert!(request.expected_runtime_config_revision.is_none());
    }

    #[test]
    fn resume_request_rejects_legacy_mcp_servers() {
        let error = parse_optional_resume_request(Bytes::from_static(br#"{"mcpServers":[]}"#))
            .expect_err("legacy MCP server list should be rejected");

        assert_eq!(
            error.into_response().status(),
            axum::http::StatusCode::BAD_REQUEST
        );
    }
}
