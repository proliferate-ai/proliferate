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
        .map(event_record_to_envelope)
        .collect::<Result<Vec<_>, _>>()?;
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
    let mut events = serde_json::from_slice::<Vec<SessionEventEnvelope>>(&bytes)
        .map_err(|error| ReplayError::InvalidJson(error.to_string()))?;
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
    serde_json::from_slice::<Vec<SessionEventEnvelope>>(&bytes)
        .map_err(|error| ReplayError::InvalidJson(error.to_string()))
}

fn event_record_to_envelope(
    record: SessionEventRecord,
) -> Result<SessionEventEnvelope, ReplayError> {
    let event = serde_json::from_str::<SessionEvent>(&record.payload_json)
        .map_err(|error| ReplayError::InvalidJson(error.to_string()))?;
    Ok(SessionEventEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        turn_id: record.turn_id,
        item_id: record.item_id,
        event,
    })
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
mod tests {
    use super::*;
    use anyharness_contract::v1::SessionStartedEvent;

    #[test]
    fn validate_speed_rejects_negative_and_nan() {
        assert_eq!(validate_speed(None).expect("default speed"), 1.0);
        assert_eq!(validate_speed(Some(0.0)).expect("instant speed"), 0.0);
        assert!(matches!(
            validate_speed(Some(-1.0)),
            Err(ReplayError::InvalidSpeed)
        ));
        assert!(matches!(
            validate_speed(Some(f32::NAN)),
            Err(ReplayError::InvalidSpeed)
        ));
    }

    #[test]
    fn validate_recording_id_rejects_unsafe_paths() {
        assert!(validate_relative_json_path("session.json").is_ok());
        assert!(validate_relative_json_path("nested/session.json").is_ok());
        assert!(matches!(
            validate_relative_json_path("../session.json"),
            Err(ReplayError::InvalidRecordingId(_))
        ));
        assert!(matches!(
            validate_relative_json_path("/tmp/session.json"),
            Err(ReplayError::InvalidRecordingId(_))
        ));
        assert!(matches!(
            validate_relative_json_path("session.txt"),
            Err(ReplayError::InvalidRecordingId(_))
        ));
    }

    #[test]
    fn validate_recording_events_rejects_empty_and_invalid_timestamps() {
        assert!(matches!(
            validate_recording_events(&[]),
            Err(ReplayError::EmptyRecording)
        ));
        let events = vec![SessionEventEnvelope {
            session_id: "old-session".to_string(),
            seq: 1,
            timestamp: "not-a-date".to_string(),
            turn_id: None,
            item_id: None,
            event: SessionEvent::SessionStarted(SessionStartedEvent {
                native_session_id: "native".to_string(),
                source_agent_kind: "codex".to_string(),
            }),
        }];
        assert!(matches!(
            validate_recording_events(&events),
            Err(ReplayError::InvalidTimestamp { seq: 1, .. })
        ));
    }

    #[test]
    fn derive_source_agent_kind_reads_session_started() {
        let events = vec![SessionEventEnvelope {
            session_id: "old-session".to_string(),
            seq: 1,
            timestamp: "2026-04-16T18:00:00Z".to_string(),
            turn_id: None,
            item_id: None,
            event: SessionEvent::SessionStarted(SessionStartedEvent {
                native_session_id: "native".to_string(),
                source_agent_kind: "claude".to_string(),
            }),
        }];

        assert_eq!(derive_source_agent_kind(&events).as_deref(), Some("claude"));
    }
}
