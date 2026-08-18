//! The checkpoint retention duty: bound how many checkpoints a workspace keeps
//! and how old they get, and reap crash-leftover refs. Runs as a new duty of
//! the archive sweep (`sweep_leftovers`), after the deferred gcs.
//!
//! Flag-first: retention runs ONLY while `ANYHARNESS_CHECKPOINT_CAPTURE=on`, so
//! flag-off leaves existing checkpoints untouched until purge deletes the
//! workspace outright. This mirrors capture's flag: turning the feature off is a
//! clean freeze, not a mass deletion.
//!
//! Discipline copied from the archive sweep's duty 3: candidate workspaces come
//! from the TABLE, each is taken under `try_acquire_exclusive` (a busy workspace
//! skips to the next tick rather than queueing behind a user), rows are re-read
//! UNDER the lease, and every git call runs in `spawn_blocking`. Deletion is the
//! fail-safe direction (ADR 5.1): the row is marked `expired_at` FIRST, then the
//! three refs are deleted — so an unexpired row never has its refs reaped out
//! from under it.

use std::sync::Arc;
use std::time::Duration;

use super::flags::checkpoint_capture_enabled;
use super::{now, refs, CheckpointOrigin, CheckpointRecord, WorkspaceCheckpointService};

/// Keep at most this many unexpired checkpoints per workspace. An observation
/// value for Q-H3's observation period, an implementation constant rather than a
/// product promise.
pub const RETENTION_KEEP_N: usize = 20;

/// Cull any checkpoint older than this, even inside the newest N. Same
/// observation-period status as [`RETENTION_KEEP_N`].
pub const RETENTION_MAX_AGE: Duration = Duration::from_secs(14 * 24 * 60 * 60);

pub async fn sweep_retention(service: &Arc<WorkspaceCheckpointService>) {
    // Flag-first: retention is part of the same cost-observation feature as
    // capture, and a workspace's checkpoints are frozen (not deleted) while the
    // flag is off.
    if !checkpoint_capture_enabled() {
        return;
    }

    let workspace_ids = match service.store.list_workspace_ids_with_any_checkpoints() {
        Ok(ids) => ids,
        Err(error) => {
            tracing::error!(
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                error = %error,
                "checkpoint retention could not list workspaces"
            );
            return;
        }
    };

    for workspace_id in workspace_ids {
        sweep_one_workspace(service, &workspace_id).await;
    }
}

async fn sweep_one_workspace(service: &Arc<WorkspaceCheckpointService>, workspace_id: &str) {
    let Some(_lease) = service
        .operation_gate
        .try_acquire_exclusive(workspace_id)
        .await
    else {
        return;
    };
    // Re-read the workspace + repo root under the lease. A workspace that was
    // purged between listing and lease resolves to nothing and is skipped.
    let Ok(Some(workspace)) = service.store.find_workspace(workspace_id) else {
        return;
    };
    let Ok(repo_root) = service.repo_root_path(&workspace) else {
        return;
    };

    // Re-read the unexpired rows UNDER the lease, newest first.
    let unexpired = match service
        .store
        .list_unexpired_checkpoints_for_workspace(workspace_id)
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                error = %error,
                "checkpoint retention could not list a workspace's checkpoints"
            );
            return;
        }
    };

    // The newest origin='safety' row is the standing un-revert handle: exempt
    // from the N-cull, but NOT from the age cap.
    let newest_safety_id = unexpired
        .iter()
        .find(|record| record.origin == CheckpointOrigin::Safety)
        .map(|record| record.id.clone());

    for (index, record) in unexpired.iter().enumerate() {
        if should_retain(
            record,
            index,
            newest_safety_id.as_deref(),
            &service.inflight,
        ) {
            continue;
        }
        cull_checkpoint(service, workspace_id, &repo_root, &record.id).await;
    }

    // Orphan reap, same pass: delete any checkpoint ref whose row is absent or
    // expired. This reaps both the crash-between-steps leftovers and capture's
    // crash-before-row-insert leftovers, and (idempotently) the refs just culled
    // above. Never touches anything outside refs/proliferate/checkpoints/.
    reap_orphans(service, workspace_id, &repo_root).await;
}

/// Whether a checkpoint survives this tick. `index` is its position in the
/// newest-first unexpired list.
fn should_retain(
    record: &CheckpointRecord,
    index: usize,
    newest_safety_id: Option<&str>,
    inflight: &super::inflight::InFlightReverts,
) -> bool {
    // A revert relying on this checkpoint's bytes exempts it unconditionally.
    if inflight.is_claimed(&record.id) {
        return true;
    }
    // The age cap culls even the newest safety row and even inside the newest N.
    if past_age_cap(&record.created_at) {
        return false;
    }
    // The standing safety handle is exempt from the N-cull.
    if Some(record.id.as_str()) == newest_safety_id {
        return true;
    }
    index < RETENTION_KEEP_N
}

/// Cull one checkpoint: row-expiry FIRST (fail-safe), then its three refs.
async fn cull_checkpoint(
    service: &Arc<WorkspaceCheckpointService>,
    workspace_id: &str,
    repo_root: &std::path::Path,
    checkpoint_id: &str,
) {
    if let Err(error) = service.store.mark_checkpoint_expired(checkpoint_id, &now()) {
        tracing::error!(
            workspace_id = %workspace_id,
            checkpoint_id = %checkpoint_id,
            sentry_code = "CHECKPOINT_RETENTION_FAILED",
            error = %error,
            "checkpoint retention could not expire a row"
        );
        return;
    }
    let repo_root = repo_root.to_path_buf();
    let workspace_id_owned = workspace_id.to_string();
    let checkpoint_id_owned = checkpoint_id.to_string();
    let deletion = tokio::task::spawn_blocking(move || {
        refs::delete_for(&repo_root, &workspace_id_owned, &checkpoint_id_owned)
    })
    .await;
    match deletion {
        Ok(Ok(())) => tracing::info!(
            workspace_id = %workspace_id,
            checkpoint_id = %checkpoint_id,
            "checkpoint retention culled a checkpoint"
        ),
        Ok(Err(error)) => tracing::error!(
            workspace_id = %workspace_id,
            checkpoint_id = %checkpoint_id,
            sentry_code = "CHECKPOINT_RETENTION_FAILED",
            error = %error,
            "checkpoint retention could not delete a culled checkpoint's refs"
        ),
        Err(error) => tracing::error!(
            sentry_code = "CHECKPOINT_RETENTION_FAILED",
            error = %error,
            "the checkpoint ref-deletion task failed"
        ),
    }
}

/// Delete any checkpoint ref whose row is absent or already expired.
async fn reap_orphans(
    service: &Arc<WorkspaceCheckpointService>,
    workspace_id: &str,
    repo_root: &std::path::Path,
) {
    let probe_root = repo_root.to_path_buf();
    let probe_ws = workspace_id.to_string();
    let Ok(Ok(entries)) =
        tokio::task::spawn_blocking(move || refs::list_for_workspace(&probe_root, &probe_ws)).await
    else {
        return;
    };
    let mut orphan_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for entry in entries {
        let row = service.store.find_checkpoint(&entry.checkpoint_id).ok().flatten();
        let orphaned = match row {
            None => true,
            Some(record) => record.expired_at.is_some(),
        };
        if orphaned {
            orphan_ids.insert(entry.checkpoint_id);
        }
    }
    for checkpoint_id in orphan_ids {
        let repo_root = repo_root.to_path_buf();
        let workspace_id_owned = workspace_id.to_string();
        let deletion = tokio::task::spawn_blocking(move || {
            refs::delete_for(&repo_root, &workspace_id_owned, &checkpoint_id)
        })
        .await;
        if let Ok(Err(error)) = deletion {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                error = %error,
                "checkpoint retention could not reap an orphaned ref set"
            );
        }
    }
}

/// Whether an rfc3339 `created_at` is older than [`RETENTION_MAX_AGE`]. An
/// unparseable timestamp reads as NOT past the cap: retention never culls on a
/// timestamp it cannot understand.
fn past_age_cap(created_at: &str) -> bool {
    let Ok(created) = chrono::DateTime::parse_from_rfc3339(created_at) else {
        return false;
    };
    let age = chrono::Utc::now().signed_duration_since(created.with_timezone(&chrono::Utc));
    age.to_std()
        .map(|elapsed| elapsed >= RETENTION_MAX_AGE)
        .unwrap_or(false)
}
