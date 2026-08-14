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
            },
        )
    }

    pub(super) fn service_unavailable_runtime_incident(
        detail: &'static str,
        code: &'static str,
        incident_id: &str,
    ) -> Self {
        tracing::error!(
            target: crate::observability::RUNTIME_INCIDENT_TRACING_TARGET,
            incident_id,
            error_code = code,
            failure_surface = "prompt_product_context",
            "handled runtime incident"
        );
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Service unavailable".into(),
                status: 503,
                detail: Some(detail.into()),
                instance: Some(format!("urn:proliferate:anyharness:incident:{incident_id}")),
                code: Some(code.into()),
            },
        )
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        let detail = detail.into();
        Self::internal_with_safe_log(detail.clone(), detail)
    }

    pub(super) fn internal_runtime_incident(detail: &'static str, code: &'static str) -> Self {
        let incident_id = uuid::Uuid::new_v4();
        tracing::error!(
            target: crate::observability::RUNTIME_INCIDENT_TRACING_TARGET,
            incident_id = %incident_id,
            error_code = code,
            failure_surface = "session_startup",
            "handled runtime incident"
        );
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Internal error".into(),
                status: 500,
                detail: Some(detail.into()),
                instance: Some(format!("urn:proliferate:anyharness:incident:{incident_id}")),
                code: Some(code.into()),
            },
        )
    }

    /// Return an authenticated caller detail while logging only a separately
    /// supplied telemetry-safe summary.
    pub(super) fn internal_with_safe_log(
        caller_detail: impl Into<String>,
        telemetry_safe_detail: impl Into<String>,
    ) -> Self {
        Self::internal_with_safe_log_and_code(caller_detail, telemetry_safe_detail, None)
    }

    /// Return an authenticated caller detail while logging only a separately
    /// supplied telemetry-safe summary and exposing an optional stable code.
    pub(super) fn internal_with_safe_log_and_code(
        caller_detail: impl Into<String>,
        telemetry_safe_detail: impl Into<String>,
        code: Option<&str>,
    ) -> Self {
        let caller_detail = caller_detail.into();
        let telemetry_safe_detail = telemetry_safe_detail.into();
        // tower_http only logs the status code on failure; this is the one
        // place every 500 passes through, so the detail must be logged here
        // or it survives only in the response body.
        tracing::error!(detail = %telemetry_safe_detail, "internal API error");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Internal error".into(),
                status: 500,
                detail: Some(caller_detail),
                instance: None,
                code: code.map(String::from),
            },
        )
    }
}

impl ApiError {
    /// HTTP status for this error. Test/introspection accessor.
    #[cfg(test)]
    pub(crate) fn status(&self) -> StatusCode {
        self.0
    }

    /// Stable machine code (RFC 7807 extension), if any. Test/introspection
    /// accessor so mapping tests can assert the wire code, not just the status.
    #[cfg(test)]
    pub(crate) fn code(&self) -> Option<&str> {
        self.1.code.as_deref()
    }

    /// RFC 7807 detail. Test/introspection accessor.
    #[cfg(test)]
    pub(crate) fn detail(&self) -> Option<&str> {
        self.1.detail.as_deref()
    }

    /// RFC 7807 occurrence receipt, if any. Test/introspection accessor.
    #[cfg(test)]
    pub(crate) fn instance(&self) -> Option<&str> {
        self.1.instance.as_deref()
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
    fn internal_error_can_separate_caller_and_telemetry_details() {
        let err = ApiError::internal_with_safe_log("caller diagnostic", "safe summary");
        assert_eq!(err.1.detail.as_deref(), Some("caller diagnostic"));
        assert!(err.1.code.is_none());
    }

    #[test]
    fn internal_error_can_carry_a_telemetry_safe_code() {
        let err = ApiError::internal_with_safe_log_and_code(
            "caller diagnostic",
            "safe summary",
            Some("AGENT_STARTUP_FAILED"),
        );
        assert_eq!(err.1.detail.as_deref(), Some("caller diagnostic"));
        assert_eq!(err.1.code.as_deref(), Some("AGENT_STARTUP_FAILED"));
    }

    #[test]
    fn runtime_incident_has_an_exact_uuid_v4_receipt() {
        let err = ApiError::internal_runtime_incident(
            "Workspace MCP could not be attached to the session.",
            "WORKSPACE_MCP_ATTACHMENT_FAILED",
        );
        let instance = err.1.instance.as_deref().expect("incident receipt");
        let incident_id = instance
            .strip_prefix("urn:proliferate:anyharness:incident:")
            .expect("AnyHarness incident URN");
        let uuid = uuid::Uuid::parse_str(incident_id).expect("UUID receipt");

        assert_eq!(uuid.get_version_num(), 4);
        assert_eq!(err.0, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(err.1.title, "Internal error");
        assert_eq!(
            err.1.detail.as_deref(),
            Some("Workspace MCP could not be attached to the session.")
        );
        assert_eq!(
            err.1.code.as_deref(),
            Some("WORKSPACE_MCP_ATTACHMENT_FAILED")
        );
    }

    #[test]
    fn unavailable_runtime_incident_preserves_the_actor_receipt() {
        let incident_id = uuid::Uuid::new_v4().to_string();
        let err = ApiError::service_unavailable_runtime_incident(
            "Agent product context is temporarily unavailable; retry the prompt.",
            "AGENT_PRODUCT_CONTEXT_UNAVAILABLE",
            &incident_id,
        );

        assert_eq!(err.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(err.1.title, "Service unavailable");
        assert_eq!(
            err.1.instance.as_deref(),
            Some(format!("urn:proliferate:anyharness:incident:{incident_id}").as_str())
        );
        assert_eq!(
            err.1.code.as_deref(),
            Some("AGENT_PRODUCT_CONTEXT_UNAVAILABLE")
        );
    }
}
