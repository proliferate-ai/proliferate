use anyharness_contract::v1::{ForkChildStartStatus, ForkSessionRequest, ForkSessionResponse};
use axum::{
    body::Bytes,
    extract::{Path, State},
    Extension, Json,
};

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use super::sessions_contract::session_to_contract;
use super::sessions_errors::map_fork_session_error;
use super::sessions_leases::acquire_session_exclusive_operation_lease;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::runtime::view::session_link_to_summary;
use crate::domains::sessions::runtime::ForkSessionError;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/fork",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = Option<ForkSessionRequest>,
    responses(
        (status = 200, description = "Forked session", body = ForkSessionResponse),
        (status = 400, description = "Invalid fork request or target session", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot be forked now", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Fork failed", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn fork_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    body: Bytes,
) -> Result<Json<ForkSessionResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let req = parse_optional_fork_request(body)?;
    let _lease = acquire_session_exclusive_operation_lease(
        &state,
        &session_id,
        WorkspaceOperationKind::SessionFork,
    )
    .await?;
    let outcome = match state
        .session_runtime
        .fork_session(&session_id, req.target)
        .await
    {
        Ok(outcome) => outcome,
        Err(ForkSessionError::StartFailed {
            session,
            link,
            error,
        }) => {
            tracing::warn!(
                parent_session_id = %session_id,
                child_session_id = %session.id,
                session_link_id = %link.id,
                error = %error,
                "fork child session failed to start"
            );
            let session_contract = session_to_contract(&state, &session).await?;
            return Ok(Json(ForkSessionResponse {
                session: session_contract,
                session_link: session_link_to_summary(&link),
                child_start: Some(anyharness_contract::v1::ForkChildStartSummary {
                    status: ForkChildStartStatus::Failed,
                    error_code: Some("FORK_CHILD_START_FAILED".to_string()),
                    session_id: Some(session.id),
                }),
            }));
        }
        Err(error) => return Err(map_fork_session_error(error)),
    };
    Ok(Json(ForkSessionResponse {
        session: session_to_contract(&state, &outcome.session).await?,
        session_link: session_link_to_summary(&outcome.link),
        child_start: Some(anyharness_contract::v1::ForkChildStartSummary {
            status: ForkChildStartStatus::Started,
            error_code: None,
            session_id: Some(outcome.session.id),
        }),
    }))
}

fn parse_optional_fork_request(body: Bytes) -> Result<ForkSessionRequest, ApiError> {
    if body.is_empty() || body.iter().all(u8::is_ascii_whitespace) {
        return Ok(ForkSessionRequest::default());
    }
    if body.as_ref().trim_ascii() == b"null" {
        return Ok(ForkSessionRequest::default());
    }
    serde_json::from_slice::<ForkSessionRequest>(&body).map_err(|error| {
        ApiError::bad_request(
            format!("invalid fork request: {error}"),
            "INVALID_FORK_REQUEST",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_request_accepts_missing_body() {
        let request = match parse_optional_fork_request(Bytes::new()) {
            Ok(request) => request,
            Err(_) => panic!("parse empty body"),
        };

        assert!(request.target.is_none());
    }

    #[test]
    fn fork_request_accepts_null_body() {
        let request = match parse_optional_fork_request(Bytes::from_static(br#" null "#)) {
            Ok(request) => request,
            Err(_) => panic!("parse null body"),
        };

        assert!(request.target.is_none());
    }
}
