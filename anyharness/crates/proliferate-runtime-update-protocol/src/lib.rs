//! Frozen wire contract for the Supervisor-owned runtime update mailbox.
//!
//! The Worker (write side) and the Supervisor (consume side) exchange update
//! intent through JSON files in the sandbox mailbox directory
//! `.proliferate/supervisor/updates`. This crate is the ONLY code shared
//! between the two target binaries: it owns the request/result shapes, their
//! path-safety validation, the atomic file IO, and the filename conventions.
//!
//! Ownership boundary (see `specs/codebase/structures/proliferate-supervisor`):
//! the Supervisor must never depend on Worker internals, and the Worker must
//! not gain any Supervisor internals. A small shared protocol crate — depended
//! on by *both* — is the clean way to make the two sides agree on one wire
//! shape without either importing the other. Neither the request nor the
//! result carries behavior; activation policy lives entirely in the Supervisor.
//!
//! Flow (frozen contract):
//! ```text
//! Worker observes divergence -> write_request() (atomic, idempotent by name)
//!   -> Supervisor list_request_files() -> read_request() (validated)
//!   -> verify/download/re-verify/stage/activate/health-gate
//!   -> Supervisor write_result() -> Worker read_result() -> heartbeat converged
//! ```

use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Wire schema version. Encoded in the type names (`*V1`) and in the on-disk
/// filenames. A breaking change introduces `UpdateRequestV2` + a new filename
/// prefix rather than mutating these shapes in place, so a straddling
/// worker/supervisor pair never silently misreads a foreign schema.
pub const PROTOCOL_VERSION: u32 = 1;

const REQUEST_FILE_PREFIX: &str = "request-";
const RESULT_FILE_PREFIX: &str = "result-";
const FILE_SUFFIX: &str = ".json";

/// The components a mailbox request may target. Deliberately excludes
/// `supervisor`: the Supervisor is image-bound and never self-updates, so a
/// request naming it is unrepresentable rather than merely rejected. Being an
/// enum also makes the component inherently path-safe (no traversal possible).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateComponent {
    Anyharness,
    Worker,
}

impl UpdateComponent {
    pub fn as_str(self) -> &'static str {
        match self {
            UpdateComponent::Anyharness => "anyharness",
            UpdateComponent::Worker => "worker",
        }
    }
}

/// One durable update request written by the Worker when a heartbeat ack
/// diverges from what the sandbox runs. Serialized camelCase to match the rest
/// of the cloud wire. `version` is the *artifact* version to converge onto (not
/// the schema version — that is fixed by the `V1` type name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequestV1 {
    /// Idempotency + result-correlation key. Path-safe (it is embedded in the
    /// result filename). A replayed heartbeat that produces the same
    /// (component, version) reuses the same `request_id` so the file overwrites
    /// itself and the Supervisor activates exactly once.
    pub request_id: String,
    pub component: UpdateComponent,
    /// The artifact version to converge the component onto, e.g. `"0.2.16"`.
    pub version: String,
    /// Platform target triple/token, e.g. `"linux-x86_64"`.
    pub target_triple: String,
    /// The exact URL the Supervisor may fetch (only this URL, nothing derived).
    pub artifact_url: String,
    /// Lowercase hex SHA-256 the downloaded bytes must match.
    pub sha256: String,
    /// Expected artifact size in bytes; re-checked after download.
    pub size_bytes: u64,
    /// RFC3339 timestamp the Worker stamped the request. Informational; not
    /// path-embedded, so it is not identifier-validated.
    pub requested_at: String,
}

/// The terminal outcome the Supervisor reports for a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateOutcome {
    /// New version staged, activated, and health-gated healthy.
    Activated,
    /// Activation was attempted but unhealthy; last-good was restored. The
    /// component keeps serving the prior version.
    RolledBack,
    /// Request failed admission (malformed, unsafe, wrong checksum/size/
    /// component, missing artifact); nothing was activated.
    Invalid,
}

/// The result the Supervisor writes once a request reaches a terminal outcome.
/// The Worker reads it only to reconcile logs/telemetry; convergence itself is
/// reported back to Cloud through the existing heartbeat version fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResultV1 {
    pub request_id: String,
    pub outcome: UpdateOutcome,
    /// The version actually running after the outcome (new on `Activated`,
    /// prior on `RolledBack`, unchanged/absent on `Invalid`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_version: Option<String>,
    /// Human-readable failure detail for `RolledBack` / `Invalid`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid update mailbox field {field}: {value}")]
    InvalidField { field: &'static str, value: String },
    #[error("failed to serialize update mailbox json")]
    Serialize(#[source] serde_json::Error),
    #[error("failed to parse update mailbox json at {path}")]
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("failed to read update mailbox file at {path}")]
    Read { path: PathBuf, source: io::Error },
    #[error("failed to write update mailbox file at {path}")]
    Write { path: PathBuf, source: io::Error },
    #[error("failed to create update mailbox directory at {path}")]
    CreateDir { path: PathBuf, source: io::Error },
    #[error("failed to set private permissions on {path}")]
    SetPermissions { path: PathBuf, source: io::Error },
}

// --- Validation (path-safety reused from `update/manifest.rs` patterns) ---

/// Reject anything that could escape the mailbox directory or that is not a
/// safe filename fragment. Mirrors `manifest.rs::validate_identifier`.
fn validate_identifier(field: &'static str, value: &str) -> Result<(), ProtocolError> {
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
    if value.starts_with("https://") || value.starts_with("http://") {
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

// --- Filenames ---

/// `request-<component>-<version>.json`. Idempotent by construction: the same
/// (component, version) always maps to the same file, so a replayed heartbeat
/// overwrites rather than accumulates. Caller must have validated `version`.
pub fn request_file_name(component: UpdateComponent, version: &str) -> String {
    format!("{REQUEST_FILE_PREFIX}{}-{version}{FILE_SUFFIX}", component.as_str())
}

/// `result-<request_id>.json`. Caller must have validated `request_id`.
pub fn result_file_name(request_id: &str) -> String {
    format!("{RESULT_FILE_PREFIX}{request_id}{FILE_SUFFIX}")
}

// --- Atomic file IO (tmp + rename, private permissions) ---

/// Worker write side: atomically publish a validated request into `dir`.
/// Returns the final path. Overwriting an existing same-named file is the
/// idempotent replay case.
pub fn write_request(dir: &Path, request: &UpdateRequestV1) -> Result<PathBuf, ProtocolError> {
    validate_request(request)?;
    let name = request_file_name(request.component, &request.version);
    atomic_write_json(dir, &name, request)
}

/// Supervisor read side: parse and validate a request file. A malformed or
/// unsafe request is an error the caller turns into an `Invalid` result.
pub fn read_request(path: &Path) -> Result<UpdateRequestV1, ProtocolError> {
    let request: UpdateRequestV1 = read_json(path)?;
    validate_request(&request)?;
    Ok(request)
}

/// Supervisor write side: atomically publish a validated result into `dir`.
pub fn write_result(dir: &Path, result: &UpdateResultV1) -> Result<PathBuf, ProtocolError> {
    validate_result(result)?;
    let name = result_file_name(&result.request_id);
    atomic_write_json(dir, &name, result)
}

/// Worker read side: parse and validate a result file.
pub fn read_result(path: &Path) -> Result<UpdateResultV1, ProtocolError> {
    let result: UpdateResultV1 = read_json(path)?;
    validate_result(&result)?;
    Ok(result)
}

/// Idempotency probe: has the Supervisor already produced a result for this
/// `request_id`? The consumer skips re-activation when true, so a request that
/// survives a crash/restart activates exactly once. Returns `false` for an
/// unsafe `request_id` rather than touching the filesystem with it.
pub fn result_exists(dir: &Path, request_id: &str) -> bool {
    if validate_identifier("requestId", request_id).is_err() {
        return false;
    }
    dir.join(result_file_name(request_id)).is_file()
}

/// List request files in `dir` (newest-first not guaranteed; caller orders).
/// Ignores the result files, temp files, and anything not matching the prefix.
/// A missing directory is an empty list, not an error.
pub fn list_request_files(dir: &Path) -> Result<Vec<PathBuf>, ProtocolError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(source) if source.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(source) => {
            return Err(ProtocolError::Read {
                path: dir.to_path_buf(),
                source,
            })
        }
    };
    let mut paths = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(REQUEST_FILE_PREFIX) && name.ends_with(FILE_SUFFIX) {
            paths.push(entry.path());
        }
    }
    Ok(paths)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, ProtocolError> {
    let contents = fs::read_to_string(path).map_err(|source| ProtocolError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&contents).map_err(|source| ProtocolError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

/// Serialize `value` and write it to `dir/file_name` atomically: a private
/// temp file (`.<name>.tmp.<pid>.<nanos>`) is written, fsynced, then renamed
/// over the target and the parent dir fsynced. A crash mid-write leaves either
/// the old file or nothing — never a partial mailbox file.
fn atomic_write_json<T: Serialize>(
    dir: &Path,
    file_name: &str,
    value: &T,
) -> Result<PathBuf, ProtocolError> {
    fs::create_dir_all(dir).map_err(|source| ProtocolError::CreateDir {
        path: dir.to_path_buf(),
        source,
    })?;
    set_private_dir_permissions(dir)?;
    let bytes = serde_json::to_vec_pretty(value).map_err(ProtocolError::Serialize)?;
    let path = dir.join(file_name);
    let temp_path = dir.join(temp_file_name(file_name));
    write_private_file(&temp_path, &bytes)?;
    fs::rename(&temp_path, &path).map_err(|source| {
        let _ = fs::remove_file(&temp_path);
        ProtocolError::Write {
            path: path.clone(),
            source,
        }
    })?;
    sync_parent_dir(dir);
    Ok(path)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), ProtocolError> {
    let mut file = File::create(path).map_err(|source| ProtocolError::Write {
        path: path.to_path_buf(),
        source,
    })?;
    file.write_all(bytes).map_err(|source| ProtocolError::Write {
        path: path.to_path_buf(),
        source,
    })?;
    file.sync_all().map_err(|source| ProtocolError::Write {
        path: path.to_path_buf(),
        source,
    })?;
    set_private_file_permissions(path)
}

fn temp_file_name(file_name: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(".{file_name}.tmp.{}.{}", std::process::id(), nanos)
}

fn sync_parent_dir(parent: &Path) {
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<(), ProtocolError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|source| {
        ProtocolError::SetPermissions {
            path: path.to_path_buf(),
            source,
        }
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<(), ProtocolError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), ProtocolError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|source| {
        ProtocolError::SetPermissions {
            path: path.to_path_buf(),
            source,
        }
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), ProtocolError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-runtime-update-protocol-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    fn sample_request() -> UpdateRequestV1 {
        UpdateRequestV1 {
            request_id: "anyharness-0.2.16-abc123".to_string(),
            component: UpdateComponent::Anyharness,
            version: "0.2.16".to_string(),
            target_triple: "linux-x86_64".to_string(),
            artifact_url: "https://downloads.example.test/runtime/stable/0.2.16/linux-x86_64/anyharness".to_string(),
            sha256: "a".repeat(64),
            size_bytes: 4096,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn request_round_trips_camel_case() {
        let request = sample_request();
        let value = serde_json::to_value(&request).expect("serialize");
        assert_eq!(value["requestId"], "anyharness-0.2.16-abc123");
        assert_eq!(value["component"], "anyharness");
        assert_eq!(value["targetTriple"], "linux-x86_64");
        assert_eq!(value["sizeBytes"], 4096);
        let parsed: UpdateRequestV1 = serde_json::from_value(value).expect("parse");
        assert_eq!(parsed, request);
    }

    #[test]
    fn result_outcome_serializes_snake_case() {
        let result = UpdateResultV1 {
            request_id: "abc123".to_string(),
            outcome: UpdateOutcome::RolledBack,
            observed_version: Some("0.2.15".to_string()),
            error: Some("unhealthy after activation".to_string()),
        };
        let value = serde_json::to_value(&result).expect("serialize");
        assert_eq!(value["outcome"], "rolled_back");
        assert_eq!(value["observedVersion"], "0.2.15");
        let parsed: UpdateResultV1 = serde_json::from_value(value).expect("parse");
        assert_eq!(parsed, result);
    }

    #[test]
    fn supervisor_is_not_a_representable_component() {
        // Image-bound: a request can never name the supervisor.
        assert!(serde_json::from_str::<UpdateComponent>("\"supervisor\"").is_err());
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

        let mut request = sample_request();
        request.size_bytes = 0;
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn file_names_follow_the_frozen_convention() {
        assert_eq!(
            request_file_name(UpdateComponent::Anyharness, "0.2.16"),
            "request-anyharness-0.2.16.json"
        );
        assert_eq!(
            request_file_name(UpdateComponent::Worker, "0.3.0"),
            "request-worker-0.3.0.json"
        );
        assert_eq!(result_file_name("abc123"), "result-abc123.json");
    }

    #[test]
    fn write_then_read_request_round_trips_and_leaves_no_temp() {
        let dir = temp_dir();
        let request = sample_request();
        let path = write_request(&dir.0, &request).expect("write");
        assert_eq!(
            path.file_name().unwrap().to_str().unwrap(),
            "request-anyharness-0.2.16.json"
        );
        let read = read_request(&path).expect("read");
        assert_eq!(read, request);
        // No leftover temp files in the mailbox.
        let leftovers: Vec<_> = fs::read_dir(&dir.0)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_str().unwrap().contains(".tmp."))
            .collect();
        assert!(leftovers.is_empty());
        #[cfg(unix)]
        {
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn replayed_write_overwrites_same_file() {
        let dir = temp_dir();
        let request = sample_request();
        let first = write_request(&dir.0, &request).expect("write once");
        let second = write_request(&dir.0, &request).expect("write again");
        assert_eq!(first, second);
        let files = list_request_files(&dir.0).expect("list");
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn result_exists_reflects_written_result_and_is_traversal_safe() {
        let dir = temp_dir();
        assert!(!result_exists(&dir.0, "abc123"));
        write_result(
            &dir.0,
            &UpdateResultV1 {
                request_id: "abc123".to_string(),
                outcome: UpdateOutcome::Activated,
                observed_version: Some("0.2.16".to_string()),
                error: None,
            },
        )
        .expect("write result");
        assert!(result_exists(&dir.0, "abc123"));
        // An unsafe id never probes the filesystem and is reported absent.
        assert!(!result_exists(&dir.0, "../secret"));
    }

    #[test]
    fn list_request_files_ignores_results_and_missing_dir() {
        let dir = temp_dir();
        write_request(&dir.0, &sample_request()).expect("write request");
        write_result(
            &dir.0,
            &UpdateResultV1 {
                request_id: "abc123".to_string(),
                outcome: UpdateOutcome::Activated,
                observed_version: None,
                error: None,
            },
        )
        .expect("write result");
        let files = list_request_files(&dir.0).expect("list");
        assert_eq!(files.len(), 1);
        assert!(files[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("request-"));

        let missing = dir.0.join("does-not-exist");
        assert!(list_request_files(&missing).expect("missing dir is empty").is_empty());
    }
}
