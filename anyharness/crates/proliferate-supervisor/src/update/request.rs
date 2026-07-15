//! Supervisor-side mailbox consumer over the shared
//! `proliferate-runtime-update-protocol` crate.
//!
//! The frozen wire shapes (`UpdateRequestV1`, `UpdateResultV1`,
//! `UpdateOutcome`, `UpdateComponent`), their path-safe validation, and the
//! atomic file IO all live in that shared crate, so this module does NOT
//! re-declare them (no barrel/re-export). It owns only the Supervisor's
//! *consumption* policy over the contract: picking the next actionable request,
//! deduping against an already-written result, and recording terminal results.
//!
//! Deviation from the freeze's literal wording (which named this file as the
//! definer of `UpdateRequestV1`): the definitions were hoisted into a shared
//! member crate instead, because defining them here and having the Worker
//! depend on the whole Supervisor crate would make the Worker pull in Supervisor
//! internals — the exact coupling the boundary model forbids. See BRIEF.md
//! §Protocol.

use std::{fs, path::Path};

use proliferate_runtime_update_protocol::{
    list_request_files, read_request, result_exists, write_result, UpdateOutcome, UpdateRequestV1,
    UpdateResultV1,
};

use crate::error::SupervisorError;

/// A validated request that has NOT yet been acted on (no result on disk).
#[derive(Debug, Clone)]
pub struct PendingUpdate {
    pub request: UpdateRequestV1,
}

/// Scan the mailbox and return the next actionable request, skipping any whose
/// `request_id` already has a `result-*.json` (idempotent: activate once). A
/// file that fails validation is turned into an `Invalid` result in place
/// (fail-closed) and skipped, never returned as pending.
///
/// The scan is ordered (`request_file_name` is deterministic, so sorting the
/// paths gives a stable drain order across runs).
pub fn next_pending(request_dir: &Path) -> Result<Option<PendingUpdate>, SupervisorError> {
    let mut files = list_request_files(request_dir)?;
    files.sort();
    for path in files {
        match read_request(&path) {
            Ok(request) => {
                if result_exists(request_dir, &request.request_id) {
                    // Already acted on (result terminal); do not re-activate.
                    continue;
                }
                return Ok(Some(PendingUpdate { request }));
            }
            Err(error) => {
                // Fail-closed: a malformed/unsafe request (bad component, path
                // traversal, bad checksum shape, unparseable JSON) never becomes
                // pending. Record an `Invalid` result keyed by a best-effort
                // path-safe id so it is not reprocessed every cycle.
                if let Some(request_id) = salvage_request_id(&path) {
                    if !result_exists(request_dir, &request_id) {
                        let _ = record_invalid(
                            request_dir,
                            &request_id,
                            format!("invalid update request: {error}"),
                        );
                    }
                }
                continue;
            }
        }
    }
    Ok(None)
}

/// Write the terminal result for a request (Activated | RolledBack | Invalid).
/// Atomic + validated by the protocol crate; once written the request is
/// terminal and `next_pending` skips it.
pub fn record_result(
    request_dir: &Path,
    result: &UpdateResultV1,
) -> Result<(), SupervisorError> {
    write_result(request_dir, result)?;
    Ok(())
}

/// Emit a fail-closed `Invalid` result for a request. `request_id` must be
/// path-safe (the protocol crate validates it on write); an unsafe id is
/// rejected rather than allowed to escape the mailbox directory.
pub fn record_invalid(
    request_dir: &Path,
    request_id: &str,
    error: impl Into<String>,
) -> Result<(), SupervisorError> {
    let result = UpdateResultV1 {
        request_id: request_id.to_string(),
        outcome: UpdateOutcome::Invalid,
        observed_version: None,
        error: Some(error.into()),
    };
    write_result(request_dir, &result)?;
    Ok(())
}

/// Best-effort recovery of a path-safe `request_id` from a request file that
/// failed strict validation, so its `Invalid` result can be keyed and not
/// reprocessed. Prefers the JSON `requestId`; falls back to the filename stem
/// (`request-<stem>.json`). Returns `None` if neither yields a path-safe id
/// (protocol `write_result` would reject an unsafe one anyway).
fn salvage_request_id(path: &Path) -> Option<String> {
    if let Ok(contents) = fs::read_to_string(path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) {
            if let Some(id) = value.get("requestId").and_then(|v| v.as_str()) {
                if is_path_safe(id) {
                    return Some(id.to_string());
                }
            }
        }
    }
    let stem = path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("request-"))
        .and_then(|name| name.strip_suffix(".json"))?;
    if is_path_safe(stem) {
        Some(stem.to_string())
    } else {
        None
    }
}

/// Mirror of the protocol crate's identifier admission (kept local so we can
/// probe safety before handing an id to `write_result`, which would otherwise
/// error on an unsafe value).
fn is_path_safe(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.contains('/')
        && !value.contains('\\')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'+'))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::{path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

    use proliferate_runtime_update_protocol::{write_request, UpdateComponent};

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-request-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    fn sample_request() -> UpdateRequestV1 {
        UpdateRequestV1 {
            request_id: "anyharness-0.2.16".to_string(),
            component: UpdateComponent::Anyharness,
            version: "0.2.16".to_string(),
            target_triple: "linux-x86_64".to_string(),
            artifact_url: "https://downloads.example.test/anyharness".to_string(),
            sha256: "a".repeat(64),
            size_bytes: 4096,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn next_pending_returns_a_written_request() {
        let dir = temp_dir();
        write_request(&dir.0, &sample_request()).expect("write request");
        let pending = next_pending(&dir.0).expect("scan").expect("pending");
        assert_eq!(pending.request.version, "0.2.16");
    }

    #[test]
    fn next_pending_skips_a_request_with_a_result() {
        let dir = temp_dir();
        let request = sample_request();
        write_request(&dir.0, &request).expect("write request");
        record_result(
            &dir.0,
            &UpdateResultV1 {
                request_id: request.request_id.clone(),
                outcome: UpdateOutcome::Activated,
                observed_version: Some("0.2.16".to_string()),
                error: None,
            },
        )
        .expect("record result");
        assert!(next_pending(&dir.0).expect("scan").is_none());
    }

    #[test]
    fn next_pending_records_invalid_for_a_malformed_request_and_skips_it() {
        let dir = temp_dir();
        // A request whose component is not representable by the enum: the read
        // fails, so it must never be returned as pending, and an Invalid result
        // must be recorded so it is not reprocessed.
        let path = dir.0.join("request-supervisor-9.9.9.json");
        fs::write(
            &path,
            br#"{"requestId":"supervisor-9.9.9","component":"supervisor","version":"9.9.9","targetTriple":"linux-x86_64","artifactUrl":"https://x.test/a","sha256":"aaaa","sizeBytes":1,"requestedAt":"2026-07-15T00:00:00Z"}"#,
        )
        .expect("write malformed request");
        assert!(next_pending(&dir.0).expect("scan").is_none());
        assert!(result_exists(&dir.0, "supervisor-9.9.9"));
    }

    #[test]
    fn next_pending_records_invalid_for_a_path_traversal_version() {
        let dir = temp_dir();
        let path = dir.0.join("request-anyharness-evil.json");
        fs::write(
            &path,
            br#"{"requestId":"anyharness-evil","component":"anyharness","version":"../evil","targetTriple":"linux-x86_64","artifactUrl":"https://x.test/a","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1,"requestedAt":"2026-07-15T00:00:00Z"}"#,
        )
        .expect("write request");
        assert!(next_pending(&dir.0).expect("scan").is_none());
        assert!(result_exists(&dir.0, "anyharness-evil"));
    }
}
