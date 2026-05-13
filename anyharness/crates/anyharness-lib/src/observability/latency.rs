use axum::http::HeaderMap;

const FLOW_ID_HEADER: &str = "x-anyharness-flow-id";
const FLOW_KIND_HEADER: &str = "x-anyharness-flow-kind";
const FLOW_SOURCE_HEADER: &str = "x-anyharness-flow-source";
const PROMPT_ID_HEADER: &str = "x-anyharness-prompt-id";
const MEASUREMENT_OPERATION_ID_HEADER: &str = "x-proliferate-measurement-operation-id";

#[derive(Debug, Clone, Default)]
pub struct LatencyRequestContext {
    flow_id: Option<String>,
    flow_kind: Option<String>,
    flow_source: Option<String>,
    prompt_id: Option<String>,
    measurement_operation_id: Option<String>,
}

impl LatencyRequestContext {
    pub fn from_headers(headers: &HeaderMap) -> Option<Self> {
        let context = Self {
            flow_id: header_value(headers, FLOW_ID_HEADER),
            flow_kind: header_value(headers, FLOW_KIND_HEADER),
            flow_source: header_value(headers, FLOW_SOURCE_HEADER),
            prompt_id: header_value(headers, PROMPT_ID_HEADER),
            measurement_operation_id: header_value(headers, MEASUREMENT_OPERATION_ID_HEADER),
        };

        if context.flow_id.is_none()
            && context.flow_kind.is_none()
            && context.flow_source.is_none()
            && context.prompt_id.is_none()
            && context.measurement_operation_id.is_none()
        {
            return None;
        }

        Some(context)
    }

    pub fn flow_id(&self) -> Option<&str> {
        self.flow_id.as_deref()
    }

    pub fn flow_kind(&self) -> Option<&str> {
        self.flow_kind.as_deref()
    }

    pub fn flow_source(&self) -> Option<&str> {
        self.flow_source.as_deref()
    }

    pub fn prompt_id(&self) -> Option<&str> {
        self.prompt_id.as_deref()
    }

    pub fn measurement_operation_id(&self) -> Option<&str> {
        self.measurement_operation_id.as_deref()
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct LatencyTraceFields<'a> {
    pub flow_id: Option<&'a str>,
    pub flow_kind: Option<&'a str>,
    pub flow_source: Option<&'a str>,
    pub prompt_id: Option<&'a str>,
    pub measurement_operation_id: Option<&'a str>,
}

pub fn latency_trace_fields(latency: Option<&LatencyRequestContext>) -> LatencyTraceFields<'_> {
    LatencyTraceFields {
        flow_id: latency.and_then(LatencyRequestContext::flow_id),
        flow_kind: latency.and_then(LatencyRequestContext::flow_kind),
        flow_source: latency.and_then(LatencyRequestContext::flow_source),
        prompt_id: latency.and_then(LatencyRequestContext::prompt_id),
        measurement_operation_id: latency.and_then(LatencyRequestContext::measurement_operation_id),
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

    use super::LatencyRequestContext;

    #[test]
    fn parses_latency_request_headers() {
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

        let context = LatencyRequestContext::from_headers(&headers)
            .expect("expected latency request context");

        assert_eq!(context.flow_id(), Some("flow-123"));
        assert_eq!(context.flow_kind(), Some("prompt_submit"));
        assert_eq!(context.flow_source(), Some("composer_submit"));
        assert_eq!(context.prompt_id(), Some("prompt-456"));
        assert_eq!(context.measurement_operation_id(), Some("mop_123"));
    }

    #[test]
    fn ignores_empty_latency_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-anyharness-flow-id", HeaderValue::from_static("   "));

        assert!(LatencyRequestContext::from_headers(&headers).is_none());
    }
}
