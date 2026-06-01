use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::json;

use crate::{
    anyharness_client::events::SessionEventEnvelope,
    cloud_client::exposures::WorkerExposureSnapshot,
    store::{ProjectionCursor, WorkerStore},
};

use super::{first_sequence_gap, reconcile_exposure_snapshots, worker_event, EventSequenceGap};

static NEXT_DB_ID: AtomicU64 = AtomicU64::new(1);

#[test]
fn worker_event_uses_projection_cursor_workspace() {
    let cursor = projection_cursor("session-1", "workspace-1", 4);
    let event = SessionEventEnvelope {
        session_id: "session-1".to_string(),
        seq: 5,
        timestamp: None,
        turn_id: None,
        item_id: None,
        event: json!({ "type": "session_updated" }),
    };

    let event = worker_event(&cursor, event);
    assert_eq!(event.workspace_id.as_deref(), Some("workspace-1"));
    assert_eq!(event.session_id, "session-1");
    assert_eq!(event.seq, 5);
}

#[test]
fn detects_first_sequence_gap() {
    let events = vec![
        event("session-1", 5),
        event("session-1", 7),
        event("session-1", 8),
    ];
    assert_eq!(
        first_sequence_gap(4, &events),
        Some(EventSequenceGap {
            expected_seq: 6,
            first_observed_seq: 7,
        })
    );
}

#[test]
fn contiguous_sequences_have_no_gap() {
    let events = vec![
        event("session-1", 5),
        event("session-1", 6),
        event("session-1", 6),
        event("session-1", 7),
    ];
    assert_eq!(first_sequence_gap(4, &events), None);
}

#[test]
fn reconciles_exposure_snapshots_into_projection_cursors() {
    let store = test_store();
    reconcile_exposure_snapshots(
        &store,
        &[
            exposure_snapshot(
                Some("projection-1"),
                Some("session-1"),
                "workspace-1",
                "active",
                4,
            ),
            exposure_snapshot(None, None, "workspace-1", "active", 0),
        ],
    )
    .expect("reconcile exposures");

    let cursors = store
        .list_active_projection_cursors()
        .expect("active cursors");
    assert_eq!(cursors.len(), 1);
    assert_eq!(cursors[0].session_projection_id, "projection-1");
    assert_eq!(cursors[0].anyharness_session_id, "session-1");
    assert_eq!(cursors[0].last_uploaded_seq, 4);
    let cached = store
        .list_cached_exposure_snapshots()
        .expect("cached exposures");
    assert_eq!(cached.len(), 2);
    assert_eq!(
        cached
            .iter()
            .filter(|snapshot| snapshot.anyharness_session_id.is_none())
            .count(),
        1
    );
    assert!(
        store
            .load_worker_control_state()
            .expect("control state")
            .exposure_cache_initialized
    );

    reconcile_exposure_snapshots(&store, &[]).expect("reconcile empty exposures");
    let cursors = store
        .list_active_projection_cursors()
        .expect("active cursors after revoke");
    assert!(cursors.is_empty());
    assert!(store
        .list_cached_exposure_snapshots()
        .expect("cached exposures after revoke")
        .is_empty());
}

fn event(session_id: &str, seq: i64) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: session_id.to_string(),
        seq,
        timestamp: None,
        turn_id: None,
        item_id: None,
        event: json!({ "type": "session_updated" }),
    }
}

fn projection_cursor(
    session_id: &str,
    workspace_id: &str,
    last_uploaded_seq: i64,
) -> ProjectionCursor {
    ProjectionCursor {
        exposure_id: "exposure-1".to_string(),
        session_projection_id: "projection-1".to_string(),
        anyharness_workspace_id: workspace_id.to_string(),
        anyharness_session_id: session_id.to_string(),
        projection_level: "live".to_string(),
        commandable: true,
        last_uploaded_seq,
        last_ack_seq: last_uploaded_seq,
    }
}

fn exposure_snapshot(
    session_projection_id: Option<&str>,
    anyharness_session_id: Option<&str>,
    workspace_id: &str,
    status: &str,
    last_uploaded_seq: i64,
) -> WorkerExposureSnapshot {
    WorkerExposureSnapshot {
        exposure_id: "exposure-1".to_string(),
        target_id: "target-1".to_string(),
        cloud_workspace_id: "cloud-workspace-1".to_string(),
        session_projection_id: session_projection_id.map(str::to_string),
        anyharness_workspace_id: workspace_id.to_string(),
        anyharness_session_id: anyharness_session_id.map(str::to_string),
        projection_level: "live".to_string(),
        commandable: true,
        status: status.to_string(),
        revision: Some(1),
        last_uploaded_seq,
    }
}

fn test_store() -> WorkerStore {
    let id = NEXT_DB_ID.fetch_add(1, Ordering::Relaxed);
    let dir: PathBuf = std::env::temp_dir().join(format!(
        "proliferate-worker-tailer-test-{}-{id}.sqlite3",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    WorkerStore::open(dir.join("worker.sqlite3")).expect("store")
}
