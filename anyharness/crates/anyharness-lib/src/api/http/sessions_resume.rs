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
use crate::domains::sessions::runtime::SessionMcpRefresh;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

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
    let span = FlowHeaders::from_headers(&headers).span();
    // Parse (and validate) the optional body so legacy fields are still rejected.
    parse_optional_resume_request(body)?;
    async move {
        let has_live_session = state.session_runtime.has_live_session(&session_id).await;
        let mcp_refresh = if has_live_session {
            None
        } else {
            Some(SessionMcpRefresh {
                mcp_servers: Vec::new(),
                mcp_binding_summaries: None,
            })
        };
        let _lease = acquire_session_operation_lease(
            &state,
            &session_id,
            WorkspaceOperationKind::SessionResume,
        )
        .await?;
        let updated = state
            .session_runtime
            .ensure_live_session(&session_id, mcp_refresh)
            .await
            .map_err(map_ensure_live_session_error)?;

        Ok(Json(session_to_contract(&state, &updated).await?))
    }
    .instrument(span)
    .await
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
        if parse_optional_resume_request(Bytes::new()).is_err() {
            panic!("parse empty body");
        }
    }

    #[test]
    fn resume_request_accepts_empty_object() {
        if parse_optional_resume_request(Bytes::from_static(br#"{}"#)).is_err() {
            panic!("parse empty object");
        }
    }

    #[test]
    fn resume_request_accepts_null_body() {
        if parse_optional_resume_request(Bytes::from_static(br#" null "#)).is_err() {
            panic!("parse null body");
        }
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
