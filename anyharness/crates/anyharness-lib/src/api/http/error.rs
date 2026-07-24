use anyharness_contract::v1::ProblemDetails;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use uuid::Uuid;

use crate::domains::sessions::service::ModelGatedContext;
use crate::observability::RUNTIME_INCIDENT_TRACING_TARGET;

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
    pub fn model_gated(context: ModelGatedContext) -> Self {
        let incident_id = Uuid::new_v4();
        let instance = format!("urn:proliferate:anyharness:incident:{incident_id}");
        tracing::error!(
            target: RUNTIME_INCIDENT_TRACING_TARGET,
            incident_id = %incident_id,
            error_code = "SESSION_MODEL_GATED",
            fingerprint = "anyharness:session_model_gated",
            workspace_id = %context.workspace_id,
            attempted_session_id = context.attempted_session_id.as_deref(),
            agent_kind = %context.agent_kind,
            requested_model = %context.requested_model_id,
            canonical_model = %context.canonical_model_id,
            active_contexts = ?context.active_contexts,
            required_contexts = ?context.required_contexts,
            catalog_version = %context.catalog_version,
            selection_outcome = "model_gated",
            effective_model = "none",
            effective_route = "none",
            "handled runtime incident"
        );
        let detail = format!(
            "model '{}' for agent '{}' is gated behind auth contexts {:?}",
            context.requested_model_id, context.agent_kind, context.required_contexts
        );
        Self(
            StatusCode::BAD_REQUEST,
            ProblemDetails {
                type_url: "about:blank".into(),
                title: "Bad request".into(),
                status: 400,
                detail: Some(detail),
                instance: Some(instance),
                code: Some("SESSION_MODEL_GATED".into()),
                required_contexts: Some(context.required_contexts),
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
        Self::internal_with_safe_log(detail.clone(), detail)
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
                required_contexts: None,
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
    use std::io;
    use std::sync::{Arc, Mutex};

    use super::*;

    const INCIDENT_INSTANCE_PREFIX: &str = "urn:proliferate:anyharness:incident:";

    #[derive(Clone)]
    struct SharedLogWriter(Arc<Mutex<Vec<u8>>>);

    impl io::Write for SharedLogWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn gated_context() -> ModelGatedContext {
        ModelGatedContext {
            workspace_id: "workspace-1".to_string(),
            attempted_session_id: Some("session-1".to_string()),
            agent_kind: "claude".to_string(),
            requested_model_id: "long-opus".to_string(),
            canonical_model_id: "opus[1m]".to_string(),
            active_contexts: vec!["anthropic-oauth".to_string()],
            required_contexts: vec!["anthropic-api".to_string(), "gateway".to_string()],
            catalog_version: "2026-07-18".to_string(),
        }
    }

    #[test]
    fn model_gated_carries_code_contexts_and_valid_incident_receipt() {
        let err = ApiError::model_gated(gated_context());
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert_eq!(err.1.code.as_deref(), Some("SESSION_MODEL_GATED"));
        assert_eq!(
            err.1.required_contexts.as_deref(),
            Some(&["anthropic-api".to_string(), "gateway".to_string()][..])
        );
        let receipt = err.1.instance.as_deref().expect("incident receipt");
        let occurrence = receipt
            .strip_prefix(INCIDENT_INSTANCE_PREFIX)
            .expect("owned incident receipt prefix");
        let occurrence = Uuid::parse_str(occurrence).expect("receipt UUID");
        assert_eq!(occurrence.get_version_num(), 4);
    }

    #[test]
    fn model_gated_mints_a_unique_receipt_per_mapping() {
        let first = ApiError::model_gated(gated_context());
        let second = ApiError::model_gated(gated_context());

        assert_ne!(first.1.instance, second.1.instance);
    }

    #[test]
    fn model_gated_emits_one_authoritative_error_with_truthful_context() {
        let log_bytes = Arc::new(Mutex::new(Vec::new()));
        let log_writer = Arc::clone(&log_bytes);
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_target(true)
            .with_writer(move || SharedLogWriter(Arc::clone(&log_writer)))
            .finish();

        let error =
            tracing::subscriber::with_default(
                subscriber,
                || ApiError::model_gated(gated_context()),
            );
        let occurrence = error
            .instance()
            .and_then(|instance| instance.strip_prefix(INCIDENT_INSTANCE_PREFIX))
            .expect("owned incident receipt");

        let logged = String::from_utf8(
            log_bytes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone(),
        )
        .expect("formatted log is UTF-8");
        assert_eq!(logged.matches("handled runtime incident").count(), 1);
        assert!(
            logged.contains(occurrence),
            "returned receipt must identify the emitted event: {logged}"
        );
        for expected in [
            RUNTIME_INCIDENT_TRACING_TARGET,
            "incident_id=",
            "SESSION_MODEL_GATED",
            "anyharness:session_model_gated",
            "workspace-1",
            "session-1",
            "claude",
            "long-opus",
            "opus[1m]",
            "anthropic-oauth",
            "anthropic-api",
            "gateway",
            "2026-07-18",
            "model_gated",
            "effective_model=\"none\"",
            "effective_route=\"none\"",
        ] {
            assert!(
                logged.contains(expected),
                "missing {expected:?} in {logged}"
            );
        }
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
}
