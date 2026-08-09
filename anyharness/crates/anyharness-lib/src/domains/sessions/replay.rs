use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use anyharness_contract::v1::{
    ReplayRecordingSummary, SessionEvent, SessionEventEnvelope, SessionStartedEvent,
};
use chrono::{DateTime, Utc};

use super::model::{SessionEventRecord, SessionRecord};

pub const REPLAY_ENABLED_ENV: &str = "ANYHARNESS_REPLAY_ENABLED";
pub const REPLAY_DIR_ENV: &str = "ANYHARNESS_REPLAY_DIR";
pub const MAX_REPLAY_RECORDING_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ReplayError {
    #[error("session replay is disabled")]
    Disabled,
    #[error("recording not found: {0}")]
    RecordingNotFound(String),
    #[error("invalid recording id: {0}")]
    InvalidRecordingId(String),
    #[error("invalid recording name: {0}")]
    InvalidRecordingName(String),
    #[error("recording already exists: {0}")]
    RecordingExists(String),
    #[error("recording is empty")]
    EmptyRecording,
    #[error("recording is too large")]
    RecordingTooLarge,
    #[error("recording JSON is invalid: {0}")]
    InvalidJson(String),
    #[error("recording timestamp is invalid at seq {seq}: {timestamp}")]
    InvalidTimestamp { seq: i64, timestamp: String },
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("session has no events: {0}")]
    SessionHasNoEvents(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("replay session is not live: {0}")]
    SessionNotLive(String),
    #[error("invalid replay speed")]
    InvalidSpeed,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub fn replay_enabled() -> bool {
    std::env::var(REPLAY_ENABLED_ENV)
        .map(|value| value.trim() == "1")
        .unwrap_or(false)
}

pub fn replay_dir(runtime_home: &Path) -> PathBuf {
    std::env::var(REPLAY_DIR_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| runtime_home.join("recordings"))
}

pub fn validate_speed(speed: Option<f32>) -> Result<f32, ReplayError> {
    let speed = speed.unwrap_or(1.0);
    if !speed.is_finite() || speed < 0.0 {
        return Err(ReplayError::InvalidSpeed);
    }
    Ok(speed)
}

pub fn list_recordings(runtime_home: &Path) -> Result<Vec<ReplayRecordingSummary>, ReplayError> {
    ensure_enabled()?;
    let dir = replay_dir(runtime_home);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let canonical_dir = canonical_replay_dir(&dir)?;
    let mut recordings = Vec::new();
    for entry in
        fs::read_dir(&canonical_dir).map_err(|error| ReplayError::Internal(error.into()))?
    {
        let entry = entry.map_err(|error| ReplayError::Internal(error.into()))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| ReplayError::Internal(error.into()))?;
        if file_type.is_symlink() {
            continue;
        }
        let id = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| ReplayError::InvalidRecordingId(path.display().to_string()))?
            .to_string();
        let metadata = entry
            .metadata()
            .map_err(|error| ReplayError::Internal(error.into()))?;
        if !metadata.is_file() || metadata.len() > MAX_REPLAY_RECORDING_BYTES {
            continue;
        }
        if !path
            .canonicalize()
            .map(|canonical_path| canonical_path.starts_with(&canonical_dir))
            .unwrap_or(false)
        {
            continue;
        }
        let created_at = metadata.modified().ok().map(system_time_to_rfc3339);
        let source_session_id = read_recording_source_session_id(&path).ok().flatten();
        recordings.push(ReplayRecordingSummary {
            label: label_from_recording_id(&id),
            id,
            created_at,
            source_session_id,
        });
    }
    recordings.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(recordings)
}

pub fn export_recording(
    runtime_home: &Path,
    session: &SessionRecord,
    records: Vec<SessionEventRecord>,
    name: Option<String>,
) -> Result<ReplayRecordingSummary, ReplayError> {
    ensure_enabled()?;
    if records.is_empty() {
        return Err(ReplayError::SessionHasNoEvents(session.id.clone()));
    }

    let dir = replay_dir(runtime_home);
    fs::create_dir_all(&dir).map_err(|error| ReplayError::Internal(error.into()))?;
    let canonical_dir = canonical_replay_dir(&dir)?;
    let file_name = match name {
        Some(name) => normalize_requested_file_name(&name)?,
        None => generated_file_name(session),
    };
    let path = resolve_recording_path(&canonical_dir, &file_name)?;
    if path.exists() {
        return Err(ReplayError::RecordingExists(file_name));
    }

    let mut envelopes = records
        .into_iter()
        .filter_map(event_record_to_envelope)
        .collect::<Vec<_>>();
    envelopes.sort_by_key(|event| event.seq);
    validate_recording_events(&envelopes)?;

    let json = serde_json::to_string_pretty(&envelopes)
        .map_err(|error| ReplayError::Internal(error.into()))?;
    fs::write(&path, format!("{json}\n")).map_err(|error| ReplayError::Internal(error.into()))?;

    Ok(ReplayRecordingSummary {
        label: label_from_recording_id(&file_name),
        id: file_name,
        created_at: Some(system_time_to_rfc3339(SystemTime::now())),
        source_session_id: Some(session.id.clone()),
    })
}

pub fn load_recording(
    runtime_home: &Path,
    recording_id: &str,
) -> Result<Vec<SessionEventEnvelope>, ReplayError> {
    ensure_enabled()?;
    let dir = replay_dir(runtime_home);
    let canonical_dir = canonical_replay_dir(&dir)?;
    let path = resolve_recording_path(&canonical_dir, recording_id)?;
    if !path.exists() {
        return Err(ReplayError::RecordingNotFound(recording_id.to_string()));
    }
    let metadata = path
        .symlink_metadata()
        .map_err(|error| ReplayError::Internal(error.into()))?;
    if !metadata.is_file() {
        return Err(ReplayError::InvalidRecordingId(recording_id.to_string()));
    }
    let canonical_path = path
        .canonicalize()
        .map_err(|_| ReplayError::RecordingNotFound(recording_id.to_string()))?;
    if !canonical_path.starts_with(&canonical_dir) {
        return Err(ReplayError::InvalidRecordingId(recording_id.to_string()));
    }
    if metadata.len() > MAX_REPLAY_RECORDING_BYTES {
        return Err(ReplayError::RecordingTooLarge);
    }
    let bytes = fs::read(&path).map_err(|error| ReplayError::Internal(error.into()))?;
    let mut events = parse_recording_bytes(&bytes)?;
    events.sort_by_key(|event| event.seq);
    validate_recording_events(&events)?;
    Ok(events)
}

pub fn derive_source_agent_kind(events: &[SessionEventEnvelope]) -> Option<String> {
    events.iter().find_map(|envelope| match &envelope.event {
        SessionEvent::SessionStarted(SessionStartedEvent {
            source_agent_kind, ..
        }) => Some(source_agent_kind.clone()),
        SessionEvent::ItemStarted(event) => Some(event.item.source_agent_kind.clone()),
        SessionEvent::ItemCompleted(event) => Some(event.item.source_agent_kind.clone()),
        _ => None,
    })
}

fn ensure_enabled() -> Result<(), ReplayError> {
    if replay_enabled() {
        Ok(())
    } else {
        Err(ReplayError::Disabled)
    }
}

fn canonical_replay_dir(dir: &Path) -> Result<PathBuf, ReplayError> {
    fs::create_dir_all(dir).map_err(|error| ReplayError::Internal(error.into()))?;
    dir.canonicalize()
        .map_err(|error| ReplayError::Internal(error.into()))
}

fn resolve_recording_path(dir: &Path, recording_id: &str) -> Result<PathBuf, ReplayError> {
    validate_relative_json_path(recording_id)?;
    let joined = dir.join(recording_id);
    let parent = joined
        .parent()
        .ok_or_else(|| ReplayError::InvalidRecordingId(recording_id.to_string()))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| ReplayError::RecordingNotFound(recording_id.to_string()))?;
    if !canonical_parent.starts_with(dir) {
        return Err(ReplayError::InvalidRecordingId(recording_id.to_string()));
    }
    Ok(canonical_parent.join(
        joined
            .file_name()
            .ok_or_else(|| ReplayError::InvalidRecordingId(recording_id.to_string()))?,
    ))
}

fn validate_relative_json_path(recording_id: &str) -> Result<(), ReplayError> {
    let path = Path::new(recording_id);
    if recording_id.trim().is_empty()
        || path.is_absolute()
        || path.extension().and_then(|ext| ext.to_str()) != Some("json")
    {
        return Err(ReplayError::InvalidRecordingId(recording_id.to_string()));
    }
    for component in path.components() {
        match component {
            Component::Normal(part) if !part.is_empty() => {}
            _ => return Err(ReplayError::InvalidRecordingId(recording_id.to_string())),
        }
    }
    Ok(())
}

fn normalize_requested_file_name(name: &str) -> Result<String, ReplayError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ReplayError::InvalidRecordingName(name.to_string()));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(ReplayError::InvalidRecordingName(name.to_string()));
    }
    let with_ext = if trimmed.ends_with(".json") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.json")
    };
    if with_ext.starts_with('.') {
        return Err(ReplayError::InvalidRecordingName(name.to_string()));
    }
    if !with_ext
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(ReplayError::InvalidRecordingName(name.to_string()));
    }
    validate_relative_json_path(&with_ext)
        .map_err(|_| ReplayError::InvalidRecordingName(name.to_string()))?;
    Ok(with_ext)
}

fn generated_file_name(session: &SessionRecord) -> String {
    let stem_source = session
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(&session.agent_kind);
    let stem = slugify(stem_source);
    let short_id = session.id.chars().take(8).collect::<String>();
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S%.3f");
    format!("{stem}-{short_id}-{timestamp}.json")
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_' | ' ') && !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "session".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn label_from_recording_id(id: &str) -> String {
    Path::new(id)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(id)
        .replace(['-', '_'], " ")
}

fn system_time_to_rfc3339(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339()
}

fn read_recording_source_session_id(path: &Path) -> Result<Option<String>, ReplayError> {
    let events = load_recording_from_path(path)?;
    Ok(events.first().map(|event| event.session_id.clone()))
}

fn load_recording_from_path(path: &Path) -> Result<Vec<SessionEventEnvelope>, ReplayError> {
    let metadata = path
        .metadata()
        .map_err(|error| ReplayError::Internal(error.into()))?;
    if metadata.len() > MAX_REPLAY_RECORDING_BYTES {
        return Err(ReplayError::RecordingTooLarge);
    }
    let bytes = fs::read(path).map_err(|error| ReplayError::Internal(error.into()))?;
    parse_recording_bytes(&bytes)
}

/// Drops rows the current `SessionEvent` contract cannot parse, exactly like
/// the HTTP and SSE read paths (`api/http/sessions_events.rs`,
/// `api/sse/sessions.rs`) do.
///
/// WHY: retired event types live in shipped rows forever. `session_events` is
/// durable and append-only, so variants deleted from the contract — today
/// `session_link_turn_completed` and `review_run_updated`, tomorrow whatever
/// else retires — are still on disk in every pre-deletion session. Propagating
/// the parse error instead would make export fail outright for those sessions
/// rather than emit a recording of the events that still exist.
fn event_record_to_envelope(record: SessionEventRecord) -> Option<SessionEventEnvelope> {
    let event = serde_json::from_str::<SessionEvent>(&record.payload_json).ok()?;
    Some(SessionEventEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        turn_id: record.turn_id,
        item_id: record.item_id,
        event,
    })
}

/// Same tolerance for recordings already written to disk: a file captured
/// before an event type retired must still load, minus the retired envelopes.
/// A file that is not a JSON array at all is still a hard `InvalidJson`.
fn parse_recording_bytes(bytes: &[u8]) -> Result<Vec<SessionEventEnvelope>, ReplayError> {
    let values = serde_json::from_slice::<Vec<serde_json::Value>>(bytes)
        .map_err(|error| ReplayError::InvalidJson(error.to_string()))?;
    Ok(values
        .into_iter()
        .filter_map(|value| serde_json::from_value::<SessionEventEnvelope>(value).ok())
        .collect())
}

fn validate_recording_events(events: &[SessionEventEnvelope]) -> Result<(), ReplayError> {
    if events.is_empty() {
        return Err(ReplayError::EmptyRecording);
    }
    for event in events {
        chrono::DateTime::parse_from_rfc3339(&event.timestamp).map_err(|_| {
            ReplayError::InvalidTimestamp {
                seq: event.seq,
                timestamp: event.timestamp.clone(),
            }
        })?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "replay_tests.rs"]
mod tests;
