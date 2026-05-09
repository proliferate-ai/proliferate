use std::fmt;

use anyharness_contract::v1::SessionMcpBindingSummary;
use anyhow::Context;

const MAX_SUMMARY_IDENTIFIER_LEN: usize = 64;
const MAX_SUMMARY_DISPLAY_TEXT_LEN: usize = 128;

pub enum SessionMcpSummaryError {
    Invalid(String),
    Serialize(anyhow::Error),
}

impl fmt::Debug for SessionMcpSummaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(detail) => f
                .debug_tuple("SessionMcpSummaryError::Invalid")
                .field(detail)
                .finish(),
            Self::Serialize(error) => f
                .debug_tuple("SessionMcpSummaryError::Serialize")
                .field(&error.to_string())
                .finish(),
        }
    }
}

impl fmt::Display for SessionMcpSummaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(detail) => write!(f, "{detail}"),
            Self::Serialize(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for SessionMcpSummaryError {}

pub fn serialize_binding_summaries(
    summaries: Option<Vec<SessionMcpBindingSummary>>,
) -> Result<Option<String>, SessionMcpSummaryError> {
    let Some(summaries) = summaries else {
        return Ok(None);
    };
    validate_binding_summaries(&summaries)?;
    serde_json::to_string(&summaries)
        .map(Some)
        .context("serialize MCP binding summaries")
        .map_err(SessionMcpSummaryError::Serialize)
}

pub fn validate_binding_summaries(
    summaries: &[SessionMcpBindingSummary],
) -> Result<(), SessionMcpSummaryError> {
    for summary in summaries {
        validate_summary_identifier("id", &summary.id)?;
        validate_summary_display_text("serverName", &summary.server_name)?;
        if let Some(display_name) = summary.display_name.as_deref() {
            validate_summary_display_text("displayName", display_name)?;
        }
    }
    Ok(())
}

fn validate_summary_identifier(
    field: &'static str,
    value: &str,
) -> Result<(), SessionMcpSummaryError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(SessionMcpSummaryError::Invalid(format!(
            "{field} must not be blank"
        )));
    }
    if trimmed.len() > MAX_SUMMARY_IDENTIFIER_LEN {
        return Err(SessionMcpSummaryError::Invalid(format!(
            "{field} is too long"
        )));
    }
    let valid = trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'));
    if !valid {
        return Err(SessionMcpSummaryError::Invalid(format!(
            "{field} contains unsupported characters"
        )));
    }
    Ok(())
}

fn validate_summary_display_text(
    field: &'static str,
    value: &str,
) -> Result<(), SessionMcpSummaryError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(SessionMcpSummaryError::Invalid(format!(
            "{field} must not be blank"
        )));
    }
    if trimmed.len() > MAX_SUMMARY_DISPLAY_TEXT_LEN {
        return Err(SessionMcpSummaryError::Invalid(format!(
            "{field} is too long"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::{SessionMcpBindingOutcome, SessionMcpTransport};

    fn sample_summary() -> SessionMcpBindingSummary {
        SessionMcpBindingSummary {
            id: "connection-1".to_string(),
            server_name: "github".to_string(),
            display_name: Some("GitHub".to_string()),
            transport: SessionMcpTransport::Http,
            outcome: SessionMcpBindingOutcome::Applied,
            reason: None,
        }
    }

    #[test]
    fn binding_summary_validation_accepts_redacted_metadata() {
        let json = serialize_binding_summaries(Some(vec![sample_summary()]))
            .expect("valid summary")
            .expect("summary json");

        assert!(json.contains("GitHub"));
        assert!(!json.contains("https://"));
        assert!(!json.contains("secret"));
    }

    #[test]
    fn binding_summary_validation_allows_display_names_with_security_words() {
        let mut summary = sample_summary();
        summary.display_name = Some("Stripe OAuth Token".to_string());

        let json = serialize_binding_summaries(Some(vec![summary]))
            .expect("valid summary")
            .expect("summary json");

        assert!(json.contains("Stripe OAuth Token"));
    }

    #[test]
    fn binding_summary_validation_allows_display_server_names() {
        let mut summary = sample_summary();
        summary.server_name = "GitHub Filesystem".to_string();

        let json = serialize_binding_summaries(Some(vec![summary]))
            .expect("valid summary")
            .expect("summary json");

        assert!(json.contains("GitHub Filesystem"));
    }

    #[test]
    fn binding_summary_validation_rejects_non_identifier_fields() {
        let mut summary = sample_summary();
        summary.id = "https://mcp.example.com?token=secret".to_string();

        let error = serialize_binding_summaries(Some(vec![summary])).expect_err("invalid summary");

        assert!(matches!(error, SessionMcpSummaryError::Invalid(_)));
    }
}
