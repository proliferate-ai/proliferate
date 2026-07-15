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

use std::{collections::HashMap, fs, path::Path};

use proliferate_runtime_update_protocol::{
    list_request_files, read_request, result_exists, write_result, UpdateComponent, UpdateOutcome,
    UpdateRequestV1, UpdateResultV1,
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
/// When two or more pending requests target the SAME component (e.g. the pin
/// changed A -> B before A converged), the older ones are superseded — recorded
/// `Invalid` — and only the newest (by `requested_at`) is actionable (R9-003).
/// This keeps convergence semantic rather than lexicographic: without it a
/// stale `anyharness-0.2.9` could sort before a newer `anyharness-0.2.10` and
/// win, ending on the older version.
pub fn next_pending(request_dir: &Path) -> Result<Option<PendingUpdate>, SupervisorError> {
    let mut files = list_request_files(request_dir)?;
    files.sort();
    let mut parsed: Vec<UpdateRequestV1> = Vec::new();
    for path in files {
        match read_request(&path) {
            Ok(request) => parsed.push(request),
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
            }
        }
    }

    supersede_stale_same_component(request_dir, &parsed)?;

    for request in parsed {
        if result_exists(request_dir, &request.request_id) {
            // Already acted on (terminal result) or just superseded above.
            continue;
        }
        return Ok(Some(PendingUpdate { request }));
    }
    Ok(None)
}

/// For each component, keep only the newest pending request (by `requested_at`,
/// ties broken by `request_id` for determinism) and record `Invalid`
/// ("superseded") for the older ones so `next_pending` skips them and the drain
/// converges onto the intended latest version (R9-003).
fn supersede_stale_same_component(
    request_dir: &Path,
    parsed: &[UpdateRequestV1],
) -> Result<(), SupervisorError> {
    // The winner per component: the newest pending (no terminal result yet).
    let mut winners: HashMap<UpdateComponent, &UpdateRequestV1> = HashMap::new();
    for request in parsed {
        if result_exists(request_dir, &request.request_id) {
            continue;
        }
        winners
            .entry(request.component)
            .and_modify(|current| {
                if is_newer(request, current) {
                    *current = request;
                }
            })
            .or_insert(request);
    }
    for request in parsed {
        if result_exists(request_dir, &request.request_id) {
            continue;
        }
        if let Some(winner) = winners.get(&request.component) {
            if !std::ptr::eq(*winner, request) {
                record_invalid(
                    request_dir,
                    &request.request_id,
                    format!("superseded by newer request {}", winner.request_id),
                )?;
            }
        }
    }
    Ok(())
}

/// Is `a` newer than `b`? Newer `requested_at` wins; ties break on `request_id`
/// so the choice is deterministic across runs.
fn is_newer(a: &UpdateRequestV1, b: &UpdateRequestV1) -> bool {
    (a.requested_at.as_str(), a.request_id.as_str())
        > (b.requested_at.as_str(), b.request_id.as_str())
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

    use proliferate_runtime_update_protocol::{
        read_result, result_file_name, write_request, UpdateComponent,
    };

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
    fn next_pending_supersedes_older_same_component_request() {
        // Two pending requests for the same component (the pin changed before
        // the first converged): the newer one must win and the older must be
        // recorded Invalid (superseded) — even when the older sorts LATER
        // lexicographically (0.2.9 > 0.2.10 as strings).
        let dir = temp_dir();
        let mut older = sample_request();
        older.request_id = "anyharness-0.2.9".to_string();
        older.version = "0.2.9".to_string();
        older.requested_at = "2026-07-15T00:00:00Z".to_string();
        let mut newer = sample_request();
        newer.request_id = "anyharness-0.2.10".to_string();
        newer.version = "0.2.10".to_string();
        newer.requested_at = "2026-07-15T00:05:00Z".to_string();
        write_request(&dir.0, &older).expect("write older");
        write_request(&dir.0, &newer).expect("write newer");

        let pending = next_pending(&dir.0).expect("scan").expect("pending");
        assert_eq!(pending.request.version, "0.2.10", "the newest request wins");
        // The older one is now terminal (superseded), so it is never actioned.
        assert!(result_exists(&dir.0, "anyharness-0.2.9"));
        let superseded =
            read_result(&dir.0.join(result_file_name("anyharness-0.2.9"))).expect("read result");
        assert_eq!(superseded.outcome, UpdateOutcome::Invalid);
        assert!(superseded
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("superseded"));
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
