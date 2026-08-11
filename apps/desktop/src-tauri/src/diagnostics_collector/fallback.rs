use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use proliferate_diagnostics_protocol::v1::types::{FallbackHealthV1, FallbackStateV1};
use regex::Regex;
use serde_json::Value;

pub(crate) const FALLBACK_TOTAL_BYTES: u64 = 1_048_576;
pub(crate) const FALLBACK_SEGMENT_BYTES: u64 = 262_144;
pub(crate) const FALLBACK_ROTATED_SEGMENTS: usize = 3;

#[derive(Clone, Default)]
pub(crate) struct FallbackDiagnosticsWriter {
    inner: Option<Arc<Mutex<FallbackInner>>>,
}

struct FallbackInner {
    path: PathBuf,
    file: Option<File>,
    active: bool,
    degraded: bool,
    bytes: u64,
    dropped_records: u64,
    #[cfg(test)]
    fail_writes: bool,
    #[cfg(test)]
    fail_close: bool,
}

impl FallbackDiagnosticsWriter {
    pub(crate) fn open(path: PathBuf) -> Result<Self, String> {
        let parent = path
            .parent()
            .ok_or_else(|| format!("Fallback path {} has no parent", path.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        set_owner_only_dir(parent)?;
        remove_legacy_segments(&path)?;

        let mut dropped_records: u64 = 0;
        if fs::metadata(&path)
            .map(|metadata| metadata.len() > FALLBACK_SEGMENT_BYTES)
            .unwrap_or(false)
        {
            OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(&path)
                .map_err(|error| {
                    format!("Failed to cap legacy fallback {}: {error}", path.display())
                })?;
            dropped_records = 1;
        }
        for index in 1..=FALLBACK_ROTATED_SEGMENTS {
            let segment = rotated_path(&path, index);
            match fs::metadata(&segment) {
                Ok(metadata) if metadata.len() > FALLBACK_SEGMENT_BYTES => {
                    fs::remove_file(&segment).map_err(|error| {
                        format!(
                            "Failed to cap legacy fallback {}: {error}",
                            segment.display()
                        )
                    })?;
                    dropped_records = dropped_records.saturating_add(1);
                }
                Ok(_) => set_owner_only_file(&segment)?,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Failed to inspect legacy fallback {}: {error}",
                        segment.display()
                    ));
                }
            }
        }
        let file = open_append_owner_only(&path)
            .map_err(|error| format!("Failed to open fallback {}: {error}", path.display()))?;
        let bytes = retained_bytes(&path);
        Ok(Self {
            inner: Some(Arc::new(Mutex::new(FallbackInner {
                path,
                file: Some(file),
                active: true,
                degraded: false,
                bytes,
                dropped_records,
                #[cfg(test)]
                fail_writes: false,
                #[cfg(test)]
                fail_close: false,
            }))),
        })
    }

    pub(crate) fn set_active(&self, active: bool) {
        if let Some(inner) = &self.inner {
            if let Ok(mut inner) = inner.lock() {
                inner.active = active;
            }
        }
    }

    pub(crate) fn record(&self, serialized_record: &str) -> Result<(), String> {
        let Some(inner) = &self.inner else {
            return Err("fallback_unavailable".to_string());
        };
        let mut inner = inner
            .lock()
            .map_err(|_| "fallback_lock_poisoned".to_string())?;
        if !inner.active {
            return Ok(());
        }
        Self::record_locked(&mut inner, serialized_record)
    }

    pub(super) fn record_pre_dispatch_renderer(
        &self,
        serialized_record: &str,
    ) -> Result<(), String> {
        let Some(inner) = &self.inner else {
            return Err("fallback_unavailable".to_string());
        };
        let mut inner = inner
            .lock()
            .map_err(|_| "fallback_lock_poisoned".to_string())?;
        Self::record_locked(&mut inner, serialized_record)
    }

    fn record_locked(inner: &mut FallbackInner, serialized_record: &str) -> Result<(), String> {
        if serialized_record.len().saturating_add(1) as u64 > FALLBACK_SEGMENT_BYTES {
            inner.dropped_records = inner.dropped_records.saturating_add(1);
            return Ok(());
        }
        let sanitized = sanitize_fallback_record(serialized_record);
        let result = inner.write_record(&sanitized);
        if result.is_err() {
            inner.degraded = true;
            inner.dropped_records = inner.dropped_records.saturating_add(1);
        }
        result.map_err(|error| format!("fallback_write_failed: {error}"))
    }

    pub(crate) fn note_drop(&self, count: u64) {
        if let Some(inner) = &self.inner {
            if let Ok(mut inner) = inner.lock() {
                inner.dropped_records = inner.dropped_records.saturating_add(count);
            }
        }
    }

    pub(crate) fn health(&self) -> FallbackHealthV1 {
        let Some(inner) = &self.inner else {
            return FallbackHealthV1 {
                state: FallbackStateV1::Degraded,
                bytes: 0,
                dropped_records: 0,
            };
        };
        match inner.lock() {
            Ok(inner) => FallbackHealthV1 {
                state: if inner.degraded {
                    FallbackStateV1::Degraded
                } else if inner.active {
                    FallbackStateV1::Active
                } else {
                    FallbackStateV1::Inactive
                },
                bytes: inner.bytes.min(FALLBACK_TOTAL_BYTES),
                dropped_records: inner.dropped_records,
            },
            Err(_) => FallbackHealthV1 {
                state: FallbackStateV1::Degraded,
                bytes: 0,
                dropped_records: 1,
            },
        }
    }

    pub(crate) fn close(&self) -> Result<(), String> {
        let Some(inner) = &self.inner else {
            return Ok(());
        };
        let mut inner = inner
            .lock()
            .map_err(|_| "fallback_lock_poisoned".to_string())?;
        inner.active = false;
        #[cfg(test)]
        if inner.fail_close {
            inner.file.take();
            return Err("fallback_close_failed: injected fallback close failure".to_string());
        }
        if let Some(mut file) = inner.file.take() {
            file.flush()
                .and_then(|_| file.sync_data())
                .map_err(|error| format!("fallback_close_failed: {error}"))?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn open_for_test(path: PathBuf) -> Result<Self, String> {
        Self::open(path)
    }

    #[cfg(test)]
    pub(crate) fn inject_write_failure(&self) {
        if let Some(inner) = &self.inner {
            if let Ok(mut inner) = inner.lock() {
                inner.fail_writes = true;
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn inject_close_failure(&self) {
        if let Some(inner) = &self.inner {
            if let Ok(mut inner) = inner.lock() {
                inner.fail_close = true;
            }
        }
    }
}

fn sanitize_fallback_record(serialized_record: &str) -> String {
    let mut value = match serde_json::from_str::<Value>(serialized_record) {
        Ok(value) => value,
        Err(_) => return sanitize_native_diagnostic_text(serialized_record),
    };
    sanitize_json_value(&mut value);
    serde_json::to_string(&value).unwrap_or_else(|_| "{\"message\":\"[REDACTED]\"}".to_string())
}

fn sanitize_json_value(value: &mut Value) {
    match value {
        Value::String(text) => *text = sanitize_native_diagnostic_text(text),
        Value::Array(values) => values.iter_mut().for_each(sanitize_json_value),
        Value::Object(fields) => {
            for (key, value) in fields {
                let key = key.to_ascii_lowercase();
                if key.contains("capability")
                    || key.contains("authorization")
                    || key == "token"
                    || key == "token_reference"
                {
                    *value = Value::String("[REDACTED]".to_string());
                } else {
                    sanitize_json_value(value);
                }
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

pub(crate) fn sanitize_native_diagnostic_text(input: &str) -> String {
    endpoint_regex()
        .replace_all(
            &capability_regex().replace_all(
                &crate::diagnostics::scrub_diagnostic_text(input),
                "[REDACTED]",
            ),
            "[LOOPBACK_ENDPOINT]",
        )
        .into_owned()
}

fn endpoint_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"http://127\.0\.0\.1:\d{1,5}").expect("loopback endpoint regex is valid")
    })
}

fn capability_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\b[A-Za-z0-9_-]{43}\b").expect("capability regex is valid"))
}

impl FallbackInner {
    fn write_record(&mut self, serialized_record: &str) -> io::Result<()> {
        #[cfg(test)]
        if self.fail_writes {
            return Err(io::Error::other("injected fallback failure"));
        }
        let record_bytes = serialized_record.len().saturating_add(1) as u64;
        if record_bytes > FALLBACK_SEGMENT_BYTES {
            self.dropped_records = self.dropped_records.saturating_add(1);
            return Ok(());
        }
        let active_bytes = self
            .file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if active_bytes > 0 && active_bytes.saturating_add(record_bytes) > FALLBACK_SEGMENT_BYTES {
            self.rotate()?;
        }
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("fallback is closed"))?;
        file.write_all(serialized_record.as_bytes())?;
        file.write_all(b"\n")?;
        file.flush()?;
        self.bytes = retained_bytes(&self.path).min(FALLBACK_TOTAL_BYTES);
        Ok(())
    }

    fn rotate(&mut self) -> io::Result<()> {
        if let Some(mut file) = self.file.take() {
            file.flush()?;
            file.sync_data()?;
        }
        let oldest = rotated_path(&self.path, FALLBACK_ROTATED_SEGMENTS);
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..=FALLBACK_ROTATED_SEGMENTS).rev() {
            let source = if index == 1 {
                self.path.clone()
            } else {
                rotated_path(&self.path, index - 1)
            };
            if source.exists() {
                fs::rename(&source, rotated_path(&self.path, index))?;
            }
        }
        self.file = Some(open_append_owner_only(&self.path)?);
        self.bytes = retained_bytes(&self.path).min(FALLBACK_TOTAL_BYTES);
        Ok(())
    }
}

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(format!(".{index}"));
    PathBuf::from(value)
}

fn retained_bytes(path: &Path) -> u64 {
    (0..=FALLBACK_ROTATED_SEGMENTS)
        .map(|index| {
            let candidate = if index == 0 {
                path.to_path_buf()
            } else {
                rotated_path(path, index)
            };
            fs::metadata(candidate)
                .map(|metadata| metadata.len())
                .unwrap_or(0)
        })
        .sum()
}

fn remove_legacy_segments(path: &Path) -> Result<(), String> {
    for index in (FALLBACK_ROTATED_SEGMENTS + 1)..=5 {
        let legacy = rotated_path(path, index);
        match fs::remove_file(&legacy) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to remove legacy fallback {}: {error}",
                    legacy.display()
                ))
            }
        }
    }
    Ok(())
}

fn open_append_owner_only(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    set_owner_only_file(path).map_err(io::Error::other)?;
    Ok(file)
}

#[cfg(unix)]
fn set_owner_only_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Failed to chmod {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_owner_only_file(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Failed to chmod {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_owner_only_dir(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
#[path = "fallback_tests.rs"]
mod tests;
