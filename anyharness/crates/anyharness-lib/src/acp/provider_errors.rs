use anyharness_contract::v1::ErrorEventDetails;

const ANTHROPIC_PROVIDER: &str = "anthropic";
pub const PROVIDER_RATE_LIMIT_CODE: &str = "provider_rate_limit";
pub const OPUS_4_7_MODEL_ID: &str = "claude-opus-4-7";
pub const OPUS_4_6_FALLBACK_MODEL_ID: &str = "claude-opus-4-6";

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
}
