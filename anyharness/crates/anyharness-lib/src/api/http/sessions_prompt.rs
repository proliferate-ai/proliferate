use crate::api::http::access::admit_session_mutation;
use crate::domains::sessions::admission::SessionMutationKind;
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
use crate::domains::sessions::prompt::SUBAGENT_COMPLETION_PROMPT_ID_PREFIX;
use crate::domains::sessions::runtime::SendPromptOutcome;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

const PROMPT_ID_MAX_BYTES: usize = 256;
const PROMPT_ID_HEADER: &str = "x-anyharness-prompt-id";

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/prompt",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = anyharness_contract::v1::PromptSessionRequest,
    responses(
        (status = 400, description = "Invalid or reserved prompt id", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
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
    let _admission_permit =
        admit_session_mutation(&state, &session_id, SessionMutationKind::Prompt).await?;
    let flow = FlowHeaders::from_headers(&headers);
    let span = flow.span();
    let header_prompt_id = raw_prompt_id_header(&headers)?;
    let prompt_id = request_prompt_id(req.prompt_id.as_deref(), header_prompt_id)?;
    async move {
        let prompt_id_for_trace = prompt_id.clone();
        let started = Instant::now();
        tracing::info!(
            session_id = %session_id,
            block_count = req.blocks.len(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.http.prompt.request_received"
        );

        let lease = acquire_session_operation_lease(
            &state,
            &session_id,
            WorkspaceOperationKind::SessionPrompt,
        )
        .await?;
        let prompt_title = prompt_fallback_title(&req.blocks);
        let outcome = state
            .session_runtime
            .send_prompt_under_workspace_lease(
                lease.workspace_id(),
                &session_id,
                req.blocks,
                prompt_id,
            )
            .await
            .map_err(map_send_prompt_error)?;

        tracing::info!(
            session_id = %session_id,
            elapsed_ms = started.elapsed().as_millis(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.http.prompt.completed"
        );

        let (mut record, status, queued_seq) = match outcome {
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

        // An untitled session takes its prompt text as the title so every
        // surface shows something meaningful right away; a generated summary
        // or user rename replaces it later via the title endpoint.
        if let Some(title) = prompt_title {
            if state
                .session_service
                .update_session_title_if_absent(&session_id, &title)
                .unwrap_or(false)
            {
                record.title = Some(title);
            }
        }

        Ok(Json(PromptSessionResponse {
            session: session_to_contract(&state, &record).await?,
            status,
            queued_seq,
        }))
    }
    .instrument(span)
    .await
}

const PROMPT_TITLE_MAX_CHARS: usize = 160;

fn prompt_fallback_title(
    blocks: &[anyharness_contract::v1::PromptInputBlock],
) -> Option<String> {
    let text = blocks.iter().find_map(|block| match block {
        anyharness_contract::v1::PromptInputBlock::Text { text } => {
            let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
            (!collapsed.is_empty()).then_some(collapsed)
        }
        _ => None,
    })?;
    Some(
        text.chars()
            .take(PROMPT_TITLE_MAX_CHARS)
            .collect::<String>()
            .trim_end()
            .to_string(),
    )
}

fn request_prompt_id(
    body_prompt_id: Option<&str>,
    header_prompt_id: Option<&str>,
) -> Result<Option<String>, ApiError> {
    // Normalize both independently before precedence so a reserved header
    // cannot hide behind an ordinary body id (and vice versa).
    let body_prompt_id = normalize_prompt_id(body_prompt_id)?;
    let header_prompt_id = normalize_prompt_id(header_prompt_id)?;
    Ok(body_prompt_id.or(header_prompt_id))
}

fn raw_prompt_id_header(headers: &HeaderMap) -> Result<Option<&str>, ApiError> {
    headers
        .get(PROMPT_ID_HEADER)
        .map(|value| {
            value.to_str().map_err(|_| {
                ApiError::bad_request(
                    "x-anyharness-prompt-id must be valid text",
                    "INVALID_PROMPT_ID",
                )
            })
        })
        .transpose()
}

fn normalize_prompt_id(prompt_id: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(prompt_id) = prompt_id else {
        return Ok(None);
    };
    let prompt_id = prompt_id.trim();
    if prompt_id.is_empty() {
        return Ok(None);
    }
    if prompt_id.starts_with(SUBAGENT_COMPLETION_PROMPT_ID_PREFIX) {
        return Err(ApiError::bad_request(
            "promptId uses a reserved internal prefix",
            "RESERVED_PROMPT_ID",
        ));
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
    fn prompt_fallback_title_collapses_whitespace_and_caps_length() {
        let blocks = vec![
            anyharness_contract::v1::PromptInputBlock::Text {
                text: "  Fix\n\nthe   login \tflow  ".to_string(),
            },
        ];
        assert_eq!(
            prompt_fallback_title(&blocks).as_deref(),
            Some("Fix the login flow")
        );

        let long = vec![anyharness_contract::v1::PromptInputBlock::Text {
            text: "word ".repeat(64),
        }];
        let title = prompt_fallback_title(&long).expect("title");
        assert!(title.chars().count() <= PROMPT_TITLE_MAX_CHARS);
        assert!(!title.ends_with(' '));

        assert_eq!(prompt_fallback_title(&[]), None);
        let blank = vec![anyharness_contract::v1::PromptInputBlock::Text {
            text: "   ".to_string(),
        }];
        assert_eq!(prompt_fallback_title(&blank), None);
    }

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

    #[test]
    fn request_prompt_id_rejects_reserved_body_and_header_independently() {
        for result in [
            request_prompt_id(Some("subagent_completion:forged"), None),
            request_prompt_id(None, Some(" subagent_completion:forged ")),
            request_prompt_id(
                Some("ordinary-body"),
                Some("subagent_completion:hidden-header"),
            ),
            request_prompt_id(
                Some("subagent_completion:hidden-body"),
                Some("ordinary-header"),
            ),
            request_prompt_id(
                Some(&format!(
                    "subagent_completion:{}",
                    "x".repeat(PROMPT_ID_MAX_BYTES)
                )),
                None,
            ),
        ] {
            let error = result.expect_err("reserved prompt id");
            assert_eq!(error.status(), axum::http::StatusCode::BAD_REQUEST);
            assert_eq!(error.code(), Some("RESERVED_PROMPT_ID"));
        }
    }

    #[test]
    fn raw_oversized_reserved_header_is_rejected_even_when_tracing_drops_it() {
        let mut headers = HeaderMap::new();
        let reserved = format!(
            "subagent_completion:{}/{}",
            "x".repeat(PROMPT_ID_MAX_BYTES),
            "unsafe-for-correlation"
        );
        headers.insert(
            PROMPT_ID_HEADER,
            reserved.parse().expect("valid HTTP header value"),
        );
        assert!(
            FlowHeaders::from_headers(&headers).prompt_id.is_none(),
            "observability filtering must not become command validation"
        );

        let raw = match raw_prompt_id_header(&headers) {
            Ok(Some(value)) => value,
            _ => panic!("expected text prompt id header"),
        };
        let error = request_prompt_id(None, Some(raw)).expect_err("reserved header");
        assert_eq!(error.status(), axum::http::StatusCode::BAD_REQUEST);
        assert_eq!(error.code(), Some("RESERVED_PROMPT_ID"));
    }

    fn unwrap_prompt_id(result: Result<Option<String>, ApiError>) -> Option<String> {
        match result {
            Ok(prompt_id) => prompt_id,
            Err(_) => panic!("expected valid prompt id"),
        }
    }
}
