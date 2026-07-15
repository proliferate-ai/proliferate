use anyharness_contract::v1::ProblemDetails;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

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
                required_contexts: None,
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
                required_contexts: None,
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
                required_contexts: None,
            },
        )
    }

    /// A known model gated behind inactive auth contexts. It is an HTTP 400
    /// like the other selection rejections, but has its own machine code
    /// (`SESSION_MODEL_GATED`) and carries the unlock condition
    /// (`required_contexts`, the model's `availability.anyOf`) as an RFC 7807
    /// extension. An unresolvable model uses `SESSION_MODEL_UNSUPPORTED`.
    pub fn model_gated(detail: impl Into<String>, required_contexts: Vec<String>) -> Self {
        Self(
            StatusCode::BAD_REQUEST,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Bad request".into(),
                status: 400,
                detail: Some(detail.into()),
                instance: None,
                code: Some("SESSION_MODEL_GATED".into()),
                required_contexts: Some(required_contexts),
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
                required_contexts: None,
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
                required_contexts: None,
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
                required_contexts: None,
            },
        )
    }

    pub fn service_unavailable(detail: impl Into<String>, code: &str) -> Self {
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Service unavailable".into(),
                status: 503,
                detail: Some(detail.into()),
                instance: None,
                code: Some(code.into()),
                required_contexts: None,
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
                required_contexts: None,
            },
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_gated_carries_code_and_required_contexts() {
        let err = ApiError::model_gated(
            "gated",
            vec!["anthropic-api".to_string(), "gateway".to_string()],
        );
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert_eq!(err.1.code.as_deref(), Some("SESSION_MODEL_GATED"));
        assert_eq!(
            err.1.required_contexts.as_deref(),
            Some(&["anthropic-api".to_string(), "gateway".to_string()][..])
        );
    }

    #[test]
    fn ordinary_errors_omit_required_contexts() {
        // Only the gated error carries the extension member; everything else
        // stays byte-identical to before the amendment.
        assert!(ApiError::bad_request("x", "SOME_CODE")
            .1
            .required_contexts
            .is_none());
        assert!(ApiError::internal("y").1.required_contexts.is_none());
    }
}
