use anyharness_contract::v1::ProblemDetails;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::domains::agents::auth::AgentAuthSelectionRequired;

pub struct ApiError(StatusCode, ProblemDetails);

impl ApiError {
    /// General constructor for mappers that must preserve exact wire titles.
    pub fn new(
        status: StatusCode,
        title: impl Into<String>,
        detail: Option<String>,
        code: Option<&str>,
    ) -> Self {
        Self(
            status,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: title.into(),
                status: status.as_u16(),
                detail,
                instance: None,
                code: code.map(String::from),
                resolution_scope: None,
                agent_kind: None,
                selection_status: None,
            },
        )
    }

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

    pub fn forbidden(detail: impl Into<String>, code: &str) -> Self {
        Self(
            StatusCode::FORBIDDEN,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Forbidden".into(),
                status: 403,
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
        let detail = detail.into();
        // tower_http only logs the status code on failure; this is the one
        // place every 500 passes through, so the detail must be logged here
        // or it survives only in the response body.
        tracing::error!(detail = %detail, "internal API error");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Internal error".into(),
                status: 500,
                detail: Some(detail),
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
