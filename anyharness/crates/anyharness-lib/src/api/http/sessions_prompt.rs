use std::time::Instant;

use anyharness_contract::v1::{PromptSessionRequest, PromptSessionResponse};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use super::sessions_contract::session_to_contract;
use super::sessions_errors::map_send_prompt_error;
use super::sessions_leases::acquire_session_operation_lease;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::runtime::SendPromptOutcome;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

const PROMPT_ID_MAX_BYTES: usize = 256;

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
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(req): Json<PromptSessionRequest>,
) -> Result<Json<PromptSessionResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let flow = FlowHeaders::from_headers(&headers);
    let span = flow.span();
    let prompt_id = request_prompt_id(req.prompt_id.as_deref(), flow.prompt_id.as_deref())?;
    async move {
        let prompt_id_for_trace = prompt_id.clone();
        let started = Instant::now();
        tracing::info!(
            session_id = %session_id,
            block_count = req.blocks.len(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.http.prompt.request_received"
        );

        let _lease = acquire_session_operation_lease(
            &state,
            &session_id,
            WorkspaceOperationKind::SessionPrompt,
        )
        .await?;
        if let Some(expected) = req.expected_runtime_config_revision.as_ref() {
            state
                .runtime_config_service
                .assert_session_context_matches(&session_id, expected)
                .map_err(super::runtime_config::map_runtime_config_error)?;
        }
        let outcome = state
            .session_runtime
            .send_prompt(&session_id, req.blocks, prompt_id)
            .await
            .map_err(map_send_prompt_error)?;

        tracing::info!(
            session_id = %session_id,
            elapsed_ms = started.elapsed().as_millis(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.http.prompt.completed"
        );

        let (record, status, queued_seq) = match outcome {
            SendPromptOutcome::Running { session, .. } => (
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
            session: session_to_contract(&state, &record).await?,
            status,
            queued_seq,
        }))
    }
    .instrument(span)
    .await
}

fn request_prompt_id(
    body_prompt_id: Option<&str>,
    header_prompt_id: Option<&str>,
) -> Result<Option<String>, ApiError> {
    match normalize_prompt_id(body_prompt_id)? {
        Some(prompt_id) => Ok(Some(prompt_id)),
        None => normalize_prompt_id(header_prompt_id),
    }
}

fn normalize_prompt_id(prompt_id: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(prompt_id) = prompt_id else {
        return Ok(None);
    };
    let prompt_id = prompt_id.trim();
    if prompt_id.is_empty() {
        return Ok(None);
    }
    if prompt_id.len() > PROMPT_ID_MAX_BYTES {
        return Err(ApiError::bad_request(
            format!("promptId must be {PROMPT_ID_MAX_BYTES} bytes or fewer"),
            "INVALID_PROMPT_ID",
        ));
    }
    if prompt_id.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "promptId cannot contain control characters",
            "INVALID_PROMPT_ID",
        ));
    }
    Ok(Some(prompt_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_request_ignores_unknown_provenance_field() {
        // This intentionally relies on serde's default unknown-field
        // tolerance. Public prompt requests must not be able to claim
        // privileged internal provenance; until a reviewed public provenance
        // surface exists, extra provenance JSON is accepted and discarded.
        let request: PromptSessionRequest = serde_json::from_str(
            r#"{
                "blocks": [{"type": "text", "text": "hello"}],
                "provenance": {"kind": "system", "label": "not trusted"}
            }"#,
        )
        .expect("deserialize prompt request");

        assert_eq!(request.blocks.len(), 1);
    }

    #[test]
    fn prompt_request_accepts_body_prompt_id() {
        let request: PromptSessionRequest = serde_json::from_str(
            r#"{
                "promptId": "prompt-body",
                "blocks": [{"type": "text", "text": "hello"}]
            }"#,
        )
        .expect("deserialize prompt request");

        assert_eq!(request.prompt_id.as_deref(), Some("prompt-body"));
        assert_eq!(request.blocks.len(), 1);
    }

    #[test]
    fn request_prompt_id_prefers_body_over_header() {
        let prompt_id = unwrap_prompt_id(request_prompt_id(
            Some(" body-prompt "),
            Some("header-prompt"),
        ));

        assert_eq!(prompt_id.as_deref(), Some("body-prompt"));
    }

    #[test]
    fn request_prompt_id_uses_header_fallback() {
        let prompt_id = unwrap_prompt_id(request_prompt_id(Some(" "), Some(" header-prompt ")));

        assert_eq!(prompt_id.as_deref(), Some("header-prompt"));
    }

    #[test]
    fn request_prompt_id_rejects_oversized_or_control_values() {
        let oversized = "a".repeat(PROMPT_ID_MAX_BYTES + 1);

        assert!(normalize_prompt_id(Some(&oversized)).is_err());
        assert!(normalize_prompt_id(Some("bad\nid")).is_err());
    }

    fn unwrap_prompt_id(result: Result<Option<String>, ApiError>) -> Option<String> {
        match result {
            Ok(prompt_id) => prompt_id,
            Err(_) => panic!("expected valid prompt id"),
        }
    }
}
