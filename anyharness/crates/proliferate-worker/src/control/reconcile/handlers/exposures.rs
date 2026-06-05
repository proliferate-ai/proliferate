use tracing::debug;

use crate::{
    cloud_client::exposures::WorkerExposureSnapshot as CloudWorkerExposureSnapshot,
    control::reconcile::manager::{DesiredRevision, ReconcileManager},
    error::WorkerError,
    store::{
        ReconcileDomain, TailCursorUpsert, WorkerExposureSnapshot as CachedWorkerExposureSnapshot,
        WorkerStore,
    },
};

pub(crate) fn reconcile_exposure_snapshots(
    store: &WorkerStore,
    exposures: &[CloudWorkerExposureSnapshot],
) -> Result<(), WorkerError> {
    let cached_exposures = exposures
        .iter()
        .map(cached_exposure_snapshot)
        .collect::<Vec<_>>();
    let max_revision = exposures
        .iter()
        .filter_map(|snapshot| snapshot.revision)
        .max();
    let first_target_id = exposures
        .first()
        .map(|snapshot| snapshot.target_id.as_str());
    let first_cloud_workspace_id = exposures
        .first()
        .map(|snapshot| snapshot.cloud_workspace_id.as_str());
    let exposure_count = exposures.len();
    let workspace_exposure_count = exposures
        .iter()
        .filter(|snapshot| snapshot.anyharness_session_id.is_none())
        .count();
    let cursors = exposures
        .iter()
        .map(cached_exposure_snapshot)
        .filter_map(|snapshot| tail_cursor_upsert(&snapshot))
        .collect::<Vec<_>>();
    let session_cursor_count = cursors.len();
    let manager = ReconcileManager::new(store);
    if let Some(revision) = max_revision {
        manager.note_desired(DesiredRevision {
            domain: ReconcileDomain::Exposures,
            revision,
        })?;
    }
    store.reconcile_exposure_snapshots(&cached_exposures, &cursors)?;
    if let Some(revision) = max_revision {
        manager.mark_applied(ReconcileDomain::Exposures, revision)?;
    }
    debug!(
        exposure_count,
        workspace_exposure_count,
        session_cursor_count,
        max_revision,
        first_target_id,
        first_cloud_workspace_id,
        "reconciled worker tail cursors"
    );
    Ok(())
}

fn cached_exposure_snapshot(
    snapshot: &CloudWorkerExposureSnapshot,
) -> CachedWorkerExposureSnapshot {
    CachedWorkerExposureSnapshot {
        exposure_id: snapshot.exposure_id.clone(),
        target_id: snapshot.target_id.clone(),
        cloud_workspace_id: snapshot.cloud_workspace_id.clone(),
        session_projection_id: snapshot.session_projection_id.clone(),
        anyharness_workspace_id: snapshot.anyharness_workspace_id.clone(),
        anyharness_session_id: snapshot.anyharness_session_id.clone(),
        projection_level: snapshot.projection_level.clone(),
        commandable: snapshot.commandable,
        status: snapshot.status.clone(),
        revision: snapshot.revision,
        last_uploaded_seq: snapshot.last_uploaded_seq,
    }
}

fn tail_cursor_upsert(snapshot: &CachedWorkerExposureSnapshot) -> Option<TailCursorUpsert> {
    Some(TailCursorUpsert {
        exposure_id: snapshot.exposure_id.clone(),
        session_projection_id: snapshot.session_projection_id.clone()?,
        anyharness_workspace_id: snapshot.anyharness_workspace_id.clone(),
        anyharness_session_id: snapshot.anyharness_session_id.clone()?,
        projection_level: snapshot.projection_level.clone(),
        commandable: snapshot.commandable,
        last_uploaded_seq: snapshot.last_uploaded_seq,
        status: snapshot.status.clone(),
    })
}
