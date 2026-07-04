use anyharness_contract::v1::ErrorEventDetails;

const ANTHROPIC_PROVIDER: &str = "anthropic";
pub const PROVIDER_RATE_LIMIT_CODE: &str = "provider_rate_limit";
pub const NETWORK_CONNECTION_CODE: &str = "network_connection";
pub const OPUS_4_7_MODEL_ID: &str = "claude-opus-4-7";
pub const OPUS_4_6_FALLBACK_MODEL_ID: &str = "claude-opus-4-6";

/// Substrings (matched case-insensitively) that indicate a network/connectivity
/// failure between the harness and the model provider, rather than an
/// application-level error such as a rate limit or invalid request.
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
            classify_network_connection_error(
                "fetch failed while streaming from claude-opus-4-7",
            )
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
        assert!(classify_network_connection_error("failed to load from cdns.cloudflare.com").is_none());
        assert!(classify_network_connection_error("adns library error").is_none());
        // Server-initiated stream close is NOT a client-side network failure
        assert!(classify_network_connection_error("connection closed by server after max_duration").is_none());
        assert!(classify_network_connection_error("SSE connection closed due to load shedding").is_none());
    }
}
