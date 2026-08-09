use std::ffi::OsString;

use anyharness_contract::v1::SessionStartedEvent;

use crate::domains::sessions::model::SessionMcpBindingPolicy;

use super::*;

// A `session_link_turn_completed` row exactly as cowork persisted it
// (`live/sessions/manager/runtime_events.rs`), copied from the contract
// round-trip test that existed before the variant was deleted.
const RETIRED_LINK_EVENT_JSON: &str = r#"{
    "type": "session_link_turn_completed",
    "relation": "cowork_coding_session",
    "completionId": "completion-1",
    "sessionLinkId": "link-1",
    "parentSessionId": "parent-1",
    "childSessionId": "child-1",
    "childTurnId": "turn-child-1",
    "childLastEventSeq": 42,
    "outcome": "failed",
    "label": "Fixer"
}"#;

const STARTED_EVENT_JSON: &str = r#"{
    "type": "session_started",
    "nativeSessionId": "native-1",
    "sourceAgentKind": "claude"
}"#;

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "anyharness-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct EnvGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }

    fn remove(key: &'static str) -> Self {
        let previous = std::env::var_os(key);
        std::env::remove_var(key);
        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn session_record() -> SessionRecord {
    SessionRecord {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-04-16T18:00:00Z".to_string(),
        updated_at: "2026-04-16T18:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn event_record(seq: i64, event_type: &str, payload_json: &str) -> SessionEventRecord {
    SessionEventRecord {
        id: seq,
        session_id: "session-1".to_string(),
        seq,
        timestamp: "2026-04-16T18:00:00Z".to_string(),
        event_type: event_type.to_string(),
        turn_id: None,
        item_id: None,
        payload_json: payload_json.to_string(),
    }
}

/// `session_link_turn_completed` and `review_run_updated` were deleted from
/// the `SessionEvent` contract, but rows carrying them are durable in
/// `session_events` for every session that existed before the deletion.
/// Export must drop them the way the HTTP/SSE read paths do rather than
/// fail the whole recording, and what it writes must load back.
#[test]
fn export_drops_retired_event_rows_and_the_recording_still_loads() {
    let dir = TempDir::new("replay-retired-events");
    let _enabled = EnvGuard::set(REPLAY_ENABLED_ENV, "1");
    let _replay_dir = EnvGuard::remove(REPLAY_DIR_ENV);

    let session = session_record();
    let records = vec![
        event_record(1, "session_started", STARTED_EVENT_JSON),
        event_record(2, "session_link_turn_completed", RETIRED_LINK_EVENT_JSON),
    ];

    let summary = export_recording(&dir.path, &session, records, None)
        .expect("export a recording that carries a retired event row");

    let events = load_recording(&dir.path, &summary.id).expect("load the exported recording");
    assert_eq!(events.len(), 1, "the retired row must be dropped, not kept");
    assert_eq!(events[0].seq, 1);
    assert!(matches!(events[0].event, SessionEvent::SessionStarted(_)));
}

/// The on-disk half: a recording written before an event type retired must
/// still load, minus the retired envelopes. Malformed JSON stays a hard
/// error.
#[test]
fn parse_recording_bytes_drops_retired_envelopes_but_not_malformed_files() {
    let bytes = format!(
        r#"[
            {{"sessionId":"session-1","seq":1,"timestamp":"2026-04-16T18:00:00Z","event":{STARTED_EVENT_JSON}}},
            {{"sessionId":"session-1","seq":2,"timestamp":"2026-04-16T18:00:01Z","event":{RETIRED_LINK_EVENT_JSON}}}
        ]"#
    );

    let events = parse_recording_bytes(bytes.as_bytes()).expect("parse legacy recording");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].seq, 1);

    assert!(matches!(
        parse_recording_bytes(b"not json"),
        Err(ReplayError::InvalidJson(_))
    ));
}

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
