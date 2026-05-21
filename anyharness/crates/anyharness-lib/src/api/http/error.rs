use anyharness_contract::v1::ProblemDetails;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::domains::agents::auth_config::AgentAuthSelectionRequired;

pub struct ApiError(StatusCode, ProblemDetails);

impl ApiError {
    pub fn not_found(detail: impl Into<String>, code: &str) -> Self {
        Self(
            StatusCode::NOT_FOUND,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Not found".into(),
                status: 404,
                detail: Some(detail.into()),
                instance: None,
                code: Some(code.into()),
                resolution_scope: None,
                agent_kind: None,
                selection_status: None,
            },
        )
    }

    pub fn bad_request(detail: impl Into<String>, code: &str) -> Self {
        Self(
            StatusCode::BAD_REQUEST,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Bad request".into(),
                status: 400,
                detail: Some(detail.into()),
                instance: None,
                code: Some(code.into()),
                resolution_scope: None,
                agent_kind: None,
                selection_status: None,
            },
        )
    }

    pub fn conflict(detail: impl Into<String>, code: &str) -> Self {
        Self(
            StatusCode::CONFLICT,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Conflict".into(),
                status: 409,
                detail: Some(detail.into()),
                instance: None,
                code: Some(code.into()),
                resolution_scope: None,
                agent_kind: None,
                selection_status: None,
            },
        )
    }

    pub fn unauthorized(detail: impl Into<String>, code: &str) -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Unauthorized".into(),
                status: 401,
                detail: Some(detail.into()),
                instance: None,
                code: Some(code.into()),
                resolution_scope: None,
                agent_kind: None,
                selection_status: None,
            },
        )
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Internal error".into(),
                status: 500,
                detail: Some(detail.into()),
                instance: None,
                code: None,
                resolution_scope: None,
                agent_kind: None,
                selection_status: None,
            },
        )
    }

    pub fn agent_auth_selection_required(required: AgentAuthSelectionRequired) -> Self {
        Self(
            StatusCode::CONFLICT,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Agent auth selection required".into(),
                status: 409,
                detail: Some(required.detail),
                instance: None,
                code: Some("AGENT_AUTH_SELECTION_REQUIRED".into()),
                resolution_scope: required.resolution_scope,
                agent_kind: Some(required.agent_kind),
                selection_status: Some(required.selection_status),
            },
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}
