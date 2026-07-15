//! Fail-closed admission for mailbox request/result shapes. Called on both the
//! write side (the Worker refuses to emit a malformed request) and the read side
//! (the Supervisor refuses to act on one). Path-safety mirrors
//! `update/manifest.rs::validate_identifier`.

use crate::types::{UpdateRequestV1, UpdateResultV1};
use crate::ProtocolError;

/// Reject anything that could escape the mailbox directory or that is not a
/// safe filename fragment. Mirrors `manifest.rs::validate_identifier`.
pub(crate) fn validate_identifier(field: &'static str, value: &str) -> Result<(), ProtocolError> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'+'))
    {
        return Err(ProtocolError::InvalidField {
            field,
            value: value.to_string(),
        });
    }
    Ok(())
}

fn validate_sha256_hex(value: &str) -> Result<(), ProtocolError> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err(ProtocolError::InvalidField {
        field: "sha256",
        value: value.to_string(),
    })
}

fn validate_artifact_url(value: &str) -> Result<(), ProtocolError> {
    // Require TLS: the Supervisor fetches this exact URL over the network, so a
    // plaintext `http://` artifact (open to a MITM swapping the binary before
    // the sha256 re-verify even runs) is refused fail-closed. Loopback health
    // probes are `http://` but never flow through here (that URL is the
    // Supervisor's own config, not a mailbox field).
    if value.starts_with("https://") {
        return Ok(());
    }
    Err(ProtocolError::InvalidField {
        field: "artifactUrl",
        value: value.to_string(),
    })
}

/// Fail-closed admission for a request. Called on both write (Worker refuses to
/// emit a malformed request) and read (Supervisor refuses to act on one).
pub fn validate_request(request: &UpdateRequestV1) -> Result<(), ProtocolError> {
    validate_identifier("requestId", &request.request_id)?;
    validate_identifier("version", &request.version)?;
    validate_identifier("targetTriple", &request.target_triple)?;
    validate_sha256_hex(&request.sha256)?;
    validate_artifact_url(&request.artifact_url)?;
    if request.size_bytes == 0 {
        return Err(ProtocolError::InvalidField {
            field: "sizeBytes",
            value: "0".to_string(),
        });
    }
    if request.requested_at.trim().is_empty() {
        return Err(ProtocolError::InvalidField {
            field: "requestedAt",
            value: request.requested_at.clone(),
        });
    }
    Ok(())
}

/// Validate a result before it is written or trusted. `request_id` is
/// path-embedded, so it is identifier-checked; `observed_version` is too when
/// present (it may surface in logs/paths downstream).
pub fn validate_result(result: &UpdateResultV1) -> Result<(), ProtocolError> {
    validate_identifier("requestId", &result.request_id)?;
    if let Some(version) = &result.observed_version {
        validate_identifier("observedVersion", version)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::UpdateComponent;

    fn sample_request() -> UpdateRequestV1 {
        UpdateRequestV1 {
            request_id: "anyharness-0.2.16-abc123".to_string(),
            component: UpdateComponent::Anyharness,
            version: "0.2.16".to_string(),
            target_triple: "linux-x86_64".to_string(),
            artifact_url:
                "https://downloads.example.test/runtime/stable/0.2.16/linux-x86_64/anyharness"
                    .to_string(),
            sha256: "a".repeat(64),
            size_bytes: 4096,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn validate_rejects_path_traversal_and_bad_fields() {
        let mut request = sample_request();
        request.version = "../evil".to_string();
        assert!(validate_request(&request).is_err());

        let mut request = sample_request();
        request.request_id = "a/b".to_string();
        assert!(validate_request(&request).is_err());

        let mut request = sample_request();
        request.target_triple = "..".to_string();
        assert!(validate_request(&request).is_err());

        let mut request = sample_request();
        request.sha256 = "xyz".to_string();
        assert!(validate_request(&request).is_err());

        let mut request = sample_request();
        request.artifact_url = "file:///etc/passwd".to_string();
        assert!(validate_request(&request).is_err());

        // Plaintext http:// is refused — only https:// artifact URLs are admitted.
        let mut request = sample_request();
        request.artifact_url = "http://downloads.example.test/anyharness".to_string();
        assert!(validate_request(&request).is_err());

        let mut request = sample_request();
        request.size_bytes = 0;
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn validate_requires_https_artifact_url() {
        let mut request = sample_request();
        request.artifact_url = "https://downloads.example.test/anyharness".to_string();
        assert!(validate_request(&request).is_ok());
        request.artifact_url = "http://downloads.example.test/anyharness".to_string();
        assert!(validate_request(&request).is_err());
    }
}
