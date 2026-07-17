//! Filename conventions + atomic mailbox file IO (tmp + rename, private
//! permissions). A crash mid-write leaves either the old file or nothing — never
//! a partial mailbox file.

use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};

use crate::types::{UpdateRequestV1, UpdateResultV1};
use crate::validation::{validate_identifier, validate_request, validate_result};
use crate::ProtocolError;

const REQUEST_FILE_PREFIX: &str = "request-";
const RESULT_FILE_PREFIX: &str = "result-";
const FILE_SUFFIX: &str = ".json";

/// `request-<component>-<version>.json`. Idempotent by construction: the same
/// (component, version) always maps to the same file, so a replayed heartbeat
/// overwrites rather than accumulates. Caller must have validated `version`.
pub fn request_file_name(component: crate::types::UpdateComponent, version: &str) -> String {
    format!(
        "{REQUEST_FILE_PREFIX}{}-{version}{FILE_SUFFIX}",
        component.as_str()
    )
}

/// `result-<request_id>.json`. Caller must have validated `request_id`.
pub fn result_file_name(request_id: &str) -> String {
    format!("{RESULT_FILE_PREFIX}{request_id}{FILE_SUFFIX}")
}

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
    file.write_all(bytes)
        .map_err(|source| ProtocolError::Write {
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
    use crate::types::{UpdateComponent, UpdateOutcome, UpdateResultV1};

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
            artifact_url:
                "https://downloads.example.test/runtime/stable/0.2.16/linux-x86_64/anyharness"
                    .to_string(),
            sha256: "a".repeat(64),
            size_bytes: 4096,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        }
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
        assert!(list_request_files(&missing)
            .expect("missing dir is empty")
            .is_empty());
    }
}
