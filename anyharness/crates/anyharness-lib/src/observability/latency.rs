//! Flow headers → tracing span, parsed once at the transport edge.
//!
//! Latency/flow context is observability data, not domain data: it never
//! appears in a domain signature. Each HTTP/SSE handler that receives the
//! `x-anyharness-flow-*` headers parses them into [`FlowHeaders`], opens the
//! [`FlowHeaders::span`] and instruments its own future with it. Everything
//! awaited inside the handler inherits the flow fields via span context.
//!
//! The session actor runs on its own thread/runtime, so the edge span does
//! NOT cross the command channel. Actor-side log lines carry `session_id`
//! (and `prompt_id` where it is real command data); operators correlate
//! actor lines with edge lines via `session_id` + `prompt_id`.

use axum::http::HeaderMap;

const FLOW_ID_HEADER: &str = "x-anyharness-flow-id";
const FLOW_KIND_HEADER: &str = "x-anyharness-flow-kind";
const FLOW_SOURCE_HEADER: &str = "x-anyharness-flow-source";
const PROMPT_ID_HEADER: &str = "x-anyharness-prompt-id";
const MEASUREMENT_OPERATION_ID_HEADER: &str = "x-proliferate-measurement-operation-id";
const MAX_CORRELATION_ID_BYTES: usize = 160;
const MAX_CORRELATION_SLUG_BYTES: usize = 64;

/// The flow fields a client may attach to a request for latency tracing.
/// Parsed at the transport edge and recorded once on a `session_flow` span.
#[derive(Debug, Clone, Default)]
pub struct FlowHeaders {
    pub flow_id: Option<String>,
    pub flow_kind: Option<String>,
    pub flow_source: Option<String>,
    pub prompt_id: Option<String>,
    pub measurement_operation_id: Option<String>,
}

impl FlowHeaders {
    pub fn from_headers(headers: &HeaderMap) -> Self {
        Self {
            flow_id: correlation_id_header(headers, FLOW_ID_HEADER),
            flow_kind: correlation_slug_header(headers, FLOW_KIND_HEADER),
            flow_source: correlation_slug_header(headers, FLOW_SOURCE_HEADER),
            prompt_id: correlation_id_header(headers, PROMPT_ID_HEADER),
            measurement_operation_id: measurement_operation_header(headers),
        }
    }

    /// The edge span carrying the flow fields. `Option::None` fields record
    /// nothing, so requests without flow headers get a bare span.
    pub fn span(&self) -> tracing::Span {
        tracing::info_span!(
            "session_flow",
            flow_id = self.flow_id.as_deref(),
            flow_kind = self.flow_kind.as_deref(),
            flow_source = self.flow_source.as_deref(),
            prompt_id = self.prompt_id.as_deref(),
            measurement_operation_id = self.measurement_operation_id.as_deref(),
        )
    }
}

fn raw_header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok().map(str::trim)
}

fn correlation_id_header(headers: &HeaderMap, name: &str) -> Option<String> {
    raw_header_value(headers, name)
        .filter(|value| safe_correlation_id(value))
        .map(ToOwned::to_owned)
}

fn correlation_slug_header(headers: &HeaderMap, name: &str) -> Option<String> {
    raw_header_value(headers, name)
        .filter(|value| safe_correlation_slug(value))
        .map(ToOwned::to_owned)
}

fn measurement_operation_header(headers: &HeaderMap) -> Option<String> {
    raw_header_value(headers, MEASUREMENT_OPERATION_ID_HEADER)
        .filter(|value| {
            value.starts_with("mop_")
                && safe_ascii_identifier(value, MAX_CORRELATION_ID_BYTES, true)
        })
        .map(ToOwned::to_owned)
}

fn safe_correlation_id(value: &str) -> bool {
    safe_ascii_identifier(value, MAX_CORRELATION_ID_BYTES, true)
}

fn safe_correlation_slug(value: &str) -> bool {
    safe_ascii_identifier(value, MAX_CORRELATION_SLUG_BYTES, false)
}

fn safe_ascii_identifier(value: &str, max_bytes: usize, allow_colon: bool) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !looks_like_secret(value)
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'_' | b'-' | b'.')
                || (allow_colon && byte == b':')
        })
}

fn looks_like_secret(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "sk-",
        "sk_",
        "ghp_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "npm_",
        "akia",
        "eyj",
        "bearer",
        "basic",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    use super::{FlowHeaders, MAX_CORRELATION_ID_BYTES};

    #[test]
    fn parses_flow_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-anyharness-flow-id", HeaderValue::from_static("flow-123"));
        headers.insert(
            "x-anyharness-flow-kind",
            HeaderValue::from_static("prompt_submit"),
        );
        headers.insert(
            "x-anyharness-flow-source",
            HeaderValue::from_static("composer_submit"),
        );
        headers.insert(
            "x-anyharness-prompt-id",
            HeaderValue::from_static("prompt-456"),
        );
        headers.insert(
            "x-proliferate-measurement-operation-id",
            HeaderValue::from_static("mop_123"),
        );

        let flow = FlowHeaders::from_headers(&headers);

        assert_eq!(flow.flow_id.as_deref(), Some("flow-123"));
        assert_eq!(flow.flow_kind.as_deref(), Some("prompt_submit"));
        assert_eq!(flow.flow_source.as_deref(), Some("composer_submit"));
        assert_eq!(flow.prompt_id.as_deref(), Some("prompt-456"));
        assert_eq!(flow.measurement_operation_id.as_deref(), Some("mop_123"));
    }

    #[test]
    fn ignores_empty_flow_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-anyharness-flow-id", HeaderValue::from_static("   "));

        let flow = FlowHeaders::from_headers(&headers);

        assert!(flow.flow_id.is_none());
        assert!(flow.prompt_id.is_none());
    }

    #[test]
    fn rejects_content_secret_and_oversized_flow_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-anyharness-flow-id",
            HeaderValue::from_static("customer@example.com"),
        );
        headers.insert(
            "x-anyharness-flow-kind",
            HeaderValue::from_static("prompt submit"),
        );
        headers.insert(
            "x-anyharness-flow-source",
            HeaderValue::from_static("sk-ant-private"),
        );
        headers.insert(
            "x-anyharness-prompt-id",
            HeaderValue::from_str(&"p".repeat(MAX_CORRELATION_ID_BYTES + 1))
                .expect("valid oversized header"),
        );
        headers.insert(
            "x-proliferate-measurement-operation-id",
            HeaderValue::from_static("operation-without-prefix"),
        );

        let flow = FlowHeaders::from_headers(&headers);

        assert!(flow.flow_id.is_none());
        assert!(flow.flow_kind.is_none());
        assert!(flow.flow_source.is_none());
        assert!(flow.prompt_id.is_none());
        assert!(flow.measurement_operation_id.is_none());
    }

    #[test]
    fn rejects_jwt_like_flow_header_values_case_insensitively() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-anyharness-flow-id",
            HeaderValue::from_static("eyJhbGciOiJIUzI1NiJ9.payload.signature"),
        );
        headers.insert(
            "x-anyharness-prompt-id",
            HeaderValue::from_static("eyjhbGciOiJIUzI1NiJ9.payload.signature"),
        );

        let flow = FlowHeaders::from_headers(&headers);

        assert!(flow.flow_id.is_none());
        assert!(flow.prompt_id.is_none());
    }

    #[test]
    fn preserves_canonical_flow_header_vocabularies() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-anyharness-flow-id",
            HeaderValue::from_static("prompt_submit:1721320000000:abc123"),
        );
        headers.insert(
            "x-anyharness-flow-kind",
            HeaderValue::from_static("prompt_submit"),
        );
        headers.insert(
            "x-anyharness-flow-source",
            HeaderValue::from_static("plan-handoff-restore"),
        );
        headers.insert(
            "x-anyharness-prompt-id",
            HeaderValue::from_static("prompt-123"),
        );
        headers.insert(
            "x-proliferate-measurement-operation-id",
            HeaderValue::from_static("mop_test-123"),
        );

        let flow = FlowHeaders::from_headers(&headers);

        assert_eq!(
            flow.flow_id.as_deref(),
            Some("prompt_submit:1721320000000:abc123")
        );
        assert_eq!(flow.flow_kind.as_deref(), Some("prompt_submit"));
        assert_eq!(flow.flow_source.as_deref(), Some("plan-handoff-restore"));
        assert_eq!(flow.prompt_id.as_deref(), Some("prompt-123"));
        assert_eq!(
            flow.measurement_operation_id.as_deref(),
            Some("mop_test-123")
        );
    }
}
