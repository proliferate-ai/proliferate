//! Bounded artifact fetch — the Supervisor's one and only outbound HTTP client.
//!
//! Downloads ONLY the `artifact_url` named in an already-validated request,
//! into memory bounded by `max_artifact_bytes` (a chunked read that aborts the
//! moment the running total would exceed the cap, so a server that omits or
//! lies about `Content-Length` cannot force an unbounded buffer). Redirects are
//! disabled so the fetch stays pinned to exactly the named URL. The bytes are
//! handed back for the activation state machine to re-verify (sha256 + size)
//! and stage; checksum policy deliberately does NOT live here (see
//! `update/staging.rs` + `update/manifest.rs::verify_sha256`).
//!
//! `reqwest` is scoped to this module (the Supervisor's only artifact HTTP
//! client). The activation health gate polls loopback `/health` without
//! `reqwest` (see `process/health.rs`).

use std::time::Duration;

use proliferate_runtime_update_protocol::UpdateRequestV1;

use crate::error::SupervisorError;

/// Fetch the exact `request.artifact_url` into a bounded in-memory buffer.
///
/// Rejects non-2xx responses (`DownloadArtifact`), a declared or streamed body
/// larger than `max_bytes` (`ArtifactTooLarge`), and any transport failure
/// (`DownloadArtifact`). The whole request is bounded by `timeout_secs`.
pub async fn download_artifact(
    request: &UpdateRequestV1,
    max_bytes: u64,
    timeout_secs: u64,
) -> Result<Vec<u8>, SupervisorError> {
    let url = request.artifact_url.clone();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        // Stay pinned to the single verified URL — never chase a redirect to
        // some other host/path.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|source| SupervisorError::DownloadArtifact {
            url: url.clone(),
            message: source.to_string(),
        })?;

    let mut response =
        client
            .get(&url)
            .send()
            .await
            .map_err(|source| SupervisorError::DownloadArtifact {
                url: url.clone(),
                message: source.to_string(),
            })?;

    if !response.status().is_success() {
        return Err(SupervisorError::DownloadArtifact {
            url,
            message: format!("unexpected status {}", response.status()),
        });
    }

    // Pre-check the declared length; the streamed cap below is the real guard.
    if let Some(declared) = response.content_length() {
        if declared > max_bytes {
            return Err(SupervisorError::ArtifactTooLarge { max: max_bytes });
        }
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|source| SupervisorError::DownloadArtifact {
            url: url.clone(),
            message: source.to_string(),
        })?
    {
        if body.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err(SupervisorError::ArtifactTooLarge { max: max_bytes });
        }
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}
