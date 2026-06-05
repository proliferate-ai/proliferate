use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use crate::{
    cloud_client::exposures::WorkerExposureSnapshot,
    control::reconcile::handlers::exposures::reconcile_exposure_snapshots, store::WorkerStore,
};

static NEXT_DB_ID: AtomicU64 = AtomicU64::new(1);

#[test]
fn reconciles_exposure_snapshots_into_tail_cursors() {
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

    let cursors = store.list_active_tail_cursors().expect("active cursors");
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
        .list_active_tail_cursors()
        .expect("active cursors after revoke");
    assert!(cursors.is_empty());
    assert!(store
        .list_cached_exposure_snapshots()
        .expect("cached exposures after revoke")
        .is_empty());
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
