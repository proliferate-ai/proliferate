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
            flow_id: header_value(headers, FLOW_ID_HEADER),
            flow_kind: header_value(headers, FLOW_KIND_HEADER),
            flow_source: header_value(headers, FLOW_SOURCE_HEADER),
            prompt_id: header_value(headers, PROMPT_ID_HEADER),
            measurement_operation_id: header_value(headers, MEASUREMENT_OPERATION_ID_HEADER),
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

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)?
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    use super::FlowHeaders;

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
}
