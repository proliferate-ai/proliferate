use agent_client_protocol as acp;
use anyharness_contract::v1::ErrorEventDetails;

const ANTHROPIC_PROVIDER: &str = "anthropic";
pub const PROVIDER_RATE_LIMIT_CODE: &str = "provider_rate_limit";
pub const SEAT_USAGE_LIMIT_CODE: &str = "seat_usage_limit";
pub const NETWORK_CONNECTION_CODE: &str = "network_connection";
pub const PROVIDER_MODEL_UNAVAILABLE_CODE: &str = "provider_model_unavailable";
pub const PROVIDER_MODEL_CONFIGURATION_UNSUPPORTED_CODE: &str =
    "provider_model_configuration_unsupported";
pub const OPUS_4_7_MODEL_ID: &str = "claude-opus-4-7";
pub const OPUS_4_6_FALLBACK_MODEL_ID: &str = "claude-opus-4-6";

/// Substrings (matched case-insensitively) that indicate a network/connectivity
/// failure between the harness and the model provider, rather than an
/// application-level error such as a rate limit or invalid request.
///
/// NOTE: "connection closed before" and "connection reset" cannot reliably
/// distinguish a client-side network loss from a server-side stream termination.
/// Presentation copy consuming this classification must therefore stay
/// direction-neutral (see session-error-presentation.ts).
const NETWORK_CONNECTION_MARKERS: &[&str] = &[
    "connection closed before",
    "connection reset",
    "connection refused",
    "network is unreachable",
    "fetch failed",
    "failed to fetch",
    "getaddrinfo",
    "enotfound",
    "econnreset",
    "econnrefused",
    "etimedout",
    "dns lookup",
    "dns resolution",
    "socket hang up",
    "no internet",
];

pub fn classify_provider_rate_limit_error(message: &str) -> Option<ErrorEventDetails> {
    let lower = message.to_ascii_lowercase();
    if !lower.contains("rate limit") || !lower.contains("input tokens per minute") {
        return None;
    }

    let provider_model = extract_claude_model_id(message)?;
    if provider_model != OPUS_4_7_MODEL_ID {
        return None;
    }
    let limit = extract_input_tokens_per_minute_limit(message)?;

    Some(ErrorEventDetails::ProviderRateLimit {
        provider: ANTHROPIC_PROVIDER.to_string(),
        provider_model,
        limit,
        unit: "input_tokens_per_minute".to_string(),
        fallback_model_id: OPUS_4_6_FALLBACK_MODEL_ID.to_string(),
    })
}

/// What a classified seat usage-limit error carries: the provider's reset
/// instant when the message embedded one, and which limit window bound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatUsageLimitObservation {
    /// Epoch seconds of the provider-declared reset, when the message carried
    /// one (the classic `usage limit reached|<epoch>` shape). `None` → the
    /// caller applies the 5-hour-window rule.
    pub reset_at_epoch_s: Option<i64>,
    /// `"five_hour"` or `"seven_day"`.
    pub window: &'static str,
}

/// Classify a Claude.ai (seat) usage-limit error. Matched case-insensitively:
///
/// 1. the classic pipe shape `... usage limit reached|1756220400` — the
///    10-digit epoch after the pipe is the provider's reset instant;
/// 2. any message containing "usage limit reached", or both "reached your"
///    and "usage limit", or "5-hour limit reached", or "session limit
///    reached" — a limit hit with no parseable reset.
///
/// The window is `"seven_day"` iff the message mentions "week"/"weekly" or
/// "7-day"/"7 day", else `"five_hour"`. The CALLER gates this on the session
/// actually running on a seat — the prose alone must never cool a seat a
/// non-seat route merely mentioned.
pub fn classify_seat_usage_limit_error(message: &str) -> Option<SeatUsageLimitObservation> {
    let lower = message.to_ascii_lowercase();
    let is_limit = lower.contains("usage limit reached")
        || (lower.contains("reached your") && lower.contains("usage limit"))
        || lower.contains("5-hour limit reached")
        || lower.contains("session limit reached");
    if !is_limit {
        return None;
    }
    let window = if lower.contains("week") || lower.contains("7-day") || lower.contains("7 day") {
        "seven_day"
    } else {
        "five_hour"
    };
    Some(SeatUsageLimitObservation {
        reset_at_epoch_s: extract_piped_reset_epoch(&lower),
        window,
    })
}

/// The `usage limit reached|<10-digit epoch>` reset extraction. Anything but
/// exactly ten digits right after the pipe reads as no reset.
fn extract_piped_reset_epoch(lower: &str) -> Option<i64> {
    let marker = "usage limit reached|";
    let after = &lower[lower.find(marker)? + marker.len()..];
    let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
    if digits.len() != 10 {
        return None;
    }
    digits.parse().ok()
}

/// Classifies an error message as a network/connectivity failure.
///
/// This must only be consulted after [`classify_provider_rate_limit_error`]
/// returns `None`, so that provider rate-limit errors keep their richer
/// classification even if their message happens to contain a network marker.
pub fn classify_network_connection_error(message: &str) -> Option<ErrorEventDetails> {
    let lower = message.to_ascii_lowercase();
    if !NETWORK_CONNECTION_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return None;
    }

    Some(ErrorEventDetails::NetworkConnection {
        provider: extract_claude_model_id(message).map(|_| ANTHROPIC_PROVIDER.to_string()),
    })
}

/// Reduces the two bounded provider-model failures exposed by the ACP adapter
/// to stable product error codes. The adapter currently preserves the
/// provider message and an `APIError`/`session` discriminator, but not the
/// provider HTTP status or retryability. Require that full surviving envelope
/// so similar prose from another harness cannot acquire this classification.
pub fn classify_provider_model_error(agent_kind: &str, error: &acp::Error) -> Option<&'static str> {
    if agent_kind != "opencode"
        || !matches!(error.code, acp::ErrorCode::InternalError)
        || !has_opencode_session_api_error_data(error.data.as_ref())
    {
        return None;
    }

    let message = error.message.to_ascii_lowercase();
    if message.contains("provided model identifier is invalid") {
        return Some(PROVIDER_MODEL_UNAVAILABLE_CODE);
    }
    if message.contains("the model returned the following errors")
        && message.contains("thinking.type.enabled")
        && message.contains("is not supported for this model")
        && message.contains("thinking.type.adaptive")
        && message.contains("output_config.effort")
    {
        return Some(PROVIDER_MODEL_CONFIGURATION_UNSUPPORTED_CODE);
    }

    None
}

fn has_opencode_session_api_error_data(data: Option<&serde_json::Value>) -> bool {
    data.and_then(serde_json::Value::as_object)
        .is_some_and(|data| {
            data.get("errorName").and_then(serde_json::Value::as_str) == Some("APIError")
                && data.get("service").and_then(serde_json::Value::as_str) == Some("session")
        })
}

fn extract_claude_model_id(message: &str) -> Option<String> {
    message
        .split(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | ',' | ';' | ')' | '(')
        })
        .map(|token| token.trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-'))
        .find(|token| token.starts_with("claude-") && token.len() > "claude-".len())
        .map(ToOwned::to_owned)
}

fn extract_input_tokens_per_minute_limit(message: &str) -> Option<u64> {
    let lower = message.to_ascii_lowercase();
    let marker_index = lower.find("input tokens per minute")?;
    let prefix = &message[..marker_index];
    prefix.split_whitespace().rev().find_map(|token| {
        token
            .trim_matches(|ch: char| !ch.is_ascii_digit() && ch != ',')
            .replace(',', "")
            .parse()
            .ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_anthropic_input_tokens_per_minute_limit() {
        let message = "This request would exceed your organization's rate limit of 30,000 input tokens per minute for claude-opus-4-7.";

        let Some(ErrorEventDetails::ProviderRateLimit {
            provider,
            provider_model,
            limit,
            unit,
            fallback_model_id,
        }) = classify_provider_rate_limit_error(message)
        else {
            panic!("expected provider rate limit details");
        };

        assert_eq!(provider, "anthropic");
        assert_eq!(provider_model, OPUS_4_7_MODEL_ID);
        assert_eq!(limit, 30_000);
        assert_eq!(unit, "input_tokens_per_minute");
        assert_eq!(fallback_model_id, OPUS_4_6_FALLBACK_MODEL_ID);
    }

    #[test]
    fn ignores_unrelated_errors() {
        assert!(classify_provider_rate_limit_error("connection closed").is_none());
        assert!(classify_provider_rate_limit_error(
            "This request exceeded a server timeout for claude-opus-4-7"
        )
        .is_none());
        assert!(classify_provider_rate_limit_error(
            "This request would exceed your organization's rate limit of 30,000 input tokens per minute for claude-sonnet-4-6."
        )
        .is_none());
    }

    #[test]
    fn classifies_network_connection_failures() {
        for message in [
            "Connection closed before message completed",
            "read ECONNRESET",
            "connect ECONNREFUSED 127.0.0.1:443",
            "connection reset by peer",
            "connection refused",
            "network is unreachable",
            "TypeError: fetch failed",
            "TypeError: Failed to fetch",
            "getaddrinfo ENOTFOUND api.anthropic.com",
            "request to https://api.anthropic.com failed, reason: ENOTFOUND",
            "connect ETIMEDOUT",
            "getaddrinfo EAI_AGAIN api.anthropic.com (DNS lookup failed)",
            "socket hang up",
            "No internet connection",
        ] {
            assert!(
                matches!(
                    classify_network_connection_error(message),
                    Some(ErrorEventDetails::NetworkConnection { .. })
                ),
                "expected network connection details for {message:?}",
            );
        }
    }

    #[test]
    fn network_classifier_populates_provider_when_model_present() {
        let Some(ErrorEventDetails::NetworkConnection { provider }) =
            classify_network_connection_error("fetch failed while streaming from claude-opus-4-7")
        else {
            panic!("expected network connection details");
        };
        assert_eq!(provider.as_deref(), Some("anthropic"));
    }

    #[test]
    fn network_classifier_ignores_non_network_errors() {
        assert!(classify_network_connection_error("invalid request").is_none());
        assert!(classify_network_connection_error(
            "This request would exceed your organization's rate limit of 30,000 input tokens per minute for claude-opus-4-7."
        )
        .is_none());
    }

    #[test]
    fn network_classifier_rejects_false_positives() {
        // "dns" as a bare substring should NOT match (e.g. CDN URLs, library names)
        assert!(
            classify_network_connection_error("failed to load from cdns.cloudflare.com").is_none()
        );
        assert!(classify_network_connection_error("adns library error").is_none());
        // Server-initiated stream close is NOT a client-side network failure
        assert!(classify_network_connection_error(
            "connection closed by server after max_duration"
        )
        .is_none());
        assert!(
            classify_network_connection_error("SSE connection closed due to load shedding")
                .is_none()
        );
    }

    #[test]
    fn classifies_opencode_provider_model_failures() {
        let invalid_model = opencode_session_api_error(
            "Internal error: undefined: The provided model identifier is invalid.",
        );
        assert_eq!(
            classify_provider_model_error("opencode", &invalid_model),
            Some(PROVIDER_MODEL_UNAVAILABLE_CODE),
        );

        let unsupported_configuration = opencode_session_api_error(
            "Internal error: undefined: The model returned the following errors: \"thinking.type.enabled\" is not supported for this model. Use \"thinking.type.adaptive\" and \"output_config.effort\" to control thinking behavior.",
        );
        assert_eq!(
            classify_provider_model_error("opencode", &unsupported_configuration),
            Some(PROVIDER_MODEL_CONFIGURATION_UNSUPPORTED_CODE),
        );
    }

    #[test]
    fn provider_model_classifier_requires_the_opencode_session_api_envelope() {
        let message = "Internal error: undefined: The provided model identifier is invalid.";
        let exact = opencode_session_api_error(message);
        assert_eq!(classify_provider_model_error("claude", &exact), None);

        let wrong_service = acp::Error::internal_error().data(serde_json::json!({
            "errorName": "APIError",
            "service": "auth",
        }));
        assert_eq!(
            classify_provider_model_error("opencode", &wrong_service),
            None,
        );

        let wrong_code = acp::Error::new(-32602, message).data(serde_json::json!({
            "errorName": "APIError",
            "service": "session",
        }));
        assert_eq!(classify_provider_model_error("opencode", &wrong_code), None,);
        assert_eq!(
            classify_provider_model_error(
                "opencode",
                &opencode_session_api_error("Internal error: undefined: Request failed."),
            ),
            None,
        );
        assert_eq!(
            classify_provider_model_error(
                "opencode",
                &opencode_session_api_error(
                    "Internal error: undefined: The model returned the following errors: tools are not supported for this model.",
                ),
            ),
            None,
        );
    }

    fn opencode_session_api_error(message: &str) -> acp::Error {
        acp::Error::new(-32603, message).data(serde_json::json!({
            "errorName": "APIError",
            "service": "session",
        }))
    }

    #[test]
    fn seat_limit_classifier_extracts_the_piped_epoch() {
        let observation = classify_seat_usage_limit_error("Claude AI usage limit reached|1756220400")
            .expect("classic pipe shape");
        assert_eq!(observation.reset_at_epoch_s, Some(1_756_220_400));
        assert_eq!(observation.window, "five_hour");
    }

    #[test]
    fn seat_limit_classifier_matches_the_prose_shapes_without_a_reset() {
        for message in [
            "Usage limit reached — try again later",
            "You've reached your Claude usage limit.",
            "5-hour limit reached ∙ resets 3pm",
            "Session limit reached. Your limit will reset at 8pm.",
        ] {
            let observation =
                classify_seat_usage_limit_error(message).unwrap_or_else(|| panic!("{message:?}"));
            assert_eq!(observation.reset_at_epoch_s, None, "{message:?}");
            assert_eq!(observation.window, "five_hour", "{message:?}");
        }
    }

    #[test]
    fn seat_limit_classifier_reads_the_weekly_window() {
        for message in [
            "Weekly usage limit reached",
            "You've reached your 7-day usage limit",
            "usage limit reached for this week",
            "You have reached your 7 day usage limit",
        ] {
            let observation =
                classify_seat_usage_limit_error(message).unwrap_or_else(|| panic!("{message:?}"));
            assert_eq!(observation.window, "seven_day", "{message:?}");
        }
    }

    #[test]
    fn seat_limit_classifier_rejects_non_limit_and_malformed_epochs() {
        assert!(classify_seat_usage_limit_error("connection closed").is_none());
        assert!(classify_seat_usage_limit_error(
            "This request would exceed your organization's rate limit of 30,000 input tokens per minute for claude-opus-4-7."
        )
        .is_none());
        // A pipe with a non-10-digit tail still matches as a limit, but with
        // no parseable reset.
        let observation = classify_seat_usage_limit_error("usage limit reached|123")
            .expect("still a limit hit");
        assert_eq!(observation.reset_at_epoch_s, None);
    }
}
