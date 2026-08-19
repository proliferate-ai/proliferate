//! The checkpoint retention duty: bound how many checkpoints a workspace keeps
//! and how old they get, and reap crash-leftover refs. Runs as a new duty of
//! the archive sweep (`sweep_leftovers`), after the deferred gcs.
//!
//! Flag-first: keep-N/age culling runs only while
//! `ANYHARNESS_CHECKPOINT_CAPTURE=on`, so flag-off leaves live checkpoints
//! untouched until purge. Orphan cleanup still converges refs whose metadata is
//! already absent or expired; turning capture off must not strand a purge that
//! already crossed its expiry boundary.
//!
//! Candidate workspaces come from the metadata table plus a ref-derived
//! crash-recovery backstop. Each is taken under `try_acquire_exclusive` (a busy
//! workspace skips to the next tick rather than queueing behind a user), rows
//! are re-read UNDER the lease, and every git call runs in `spawn_blocking`.
//! Deletion is the fail-safe direction (ADR 5.1): the row is marked
//! `expired_at` FIRST, then the three refs are deleted — so an unexpired row
//! never has its refs reaped out from under it.

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

#[tracing::instrument(skip_all, fields(duty = "checkpoint_retention"))]
pub async fn sweep_retention(service: &Arc<WorkspaceCheckpointService>) {
    // Flag-first applies to policy culling, not convergence cleanup. Live rows
    // freeze while capture is off; already-expired or rowless refs remain safe
    // to reap.
    let apply_retention_policy = checkpoint_capture_enabled();

    let workspace_ids = match candidate_workspace_ids(service).await {
        Ok(ids) => ids,
        Err(_error) => {
            tracing::error!(
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "candidate_metadata_list",
                "checkpoint retention could not list workspaces"
            );
            return;
        }
    };

    for workspace_id in workspace_ids {
        sweep_one_workspace(service, &workspace_id, apply_retention_policy).await;
    }
}

async fn candidate_workspace_ids(
    service: &Arc<WorkspaceCheckpointService>,
) -> anyhow::Result<std::collections::BTreeSet<String>> {
    let mut candidates = service
        .store
        .list_workspace_ids_with_any_checkpoints()?
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();

    // A ref name is not authority to allocate a permanent operation-gate key.
    // Group current workspace rows by their exact repo root, enumerate only
    // those roots, and admit only ids owned by that root. This still discovers
    // a first capture that crashed before inserting metadata because the
    // workspace row necessarily exists before capture begins.
    let mut workspace_ids_by_root =
        std::collections::BTreeMap::<String, std::collections::BTreeSet<String>>::new();
    for workspace in service.store.list_all()? {
        workspace_ids_by_root
            .entry(workspace.repo_root_id)
            .or_default()
            .insert(workspace.id);
    }
    for (repo_root_id, owned_workspace_ids) in workspace_ids_by_root {
        let Some(repo_root) = service.repo_root_store.find_by_id(&repo_root_id)? else {
            tracing::error!(
                repo_root_id = %repo_root_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "candidate_repo_root_lookup",
                "checkpoint retention could not resolve a current repo root"
            );
            continue;
        };
        let path = std::path::PathBuf::from(repo_root.path);
        match tokio::task::spawn_blocking(move || refs::list_workspace_ids_for_repo(&path)).await {
            Ok(Ok(ref_workspace_ids)) => candidates.extend(
                ref_workspace_ids
                    .intersection(&owned_workspace_ids)
                    .cloned(),
            ),
            Ok(Err(_error)) => tracing::error!(
                repo_root_id = %repo_root_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "candidate_ref_list",
                "checkpoint retention could not enumerate ref-backed candidates"
            ),
            Err(_error) => tracing::error!(
                repo_root_id = %repo_root_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "candidate_ref_list_task",
                "checkpoint retention candidate-enumeration task failed"
            ),
        }
    }
    Ok(candidates)
}

async fn sweep_one_workspace(
    service: &Arc<WorkspaceCheckpointService>,
    workspace_id: &str,
    apply_retention_policy: bool,
) {
    // Ref-derived candidates are attacker-controllable git strings. Confirm a
    // current workspace exists before `state_for` can allocate a permanent
    // operation-gate entry; the authoritative row is still re-read below once
    // the exclusive lease is held.
    match service.store.find_workspace(workspace_id) {
        Ok(Some(_)) => {}
        Ok(None) => return,
        Err(_error) => {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "workspace_preflight",
                "checkpoint retention could not validate its workspace candidate"
            );
            return;
        }
    }
    let Some(_lease) = service
        .workspace_operation_gate
        .try_acquire_exclusive(workspace_id)
        .await
    else {
        return;
    };
    // Re-read the workspace + repo root under the lease. A workspace that was
    // purged between listing and lease resolves to nothing and is skipped.
    let workspace = match service.store.find_workspace(workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => return,
        Err(_error) => {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "workspace_lookup",
                "checkpoint retention could not read its workspace candidate"
            );
            return;
        }
    };
    let repo_root = match service.repo_root_path(&workspace) {
        Ok(repo_root) => repo_root,
        Err(_error) => {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "CHECKPOINT_RETENTION_FAILED",
                failure_stage = "repo_root_resolution",
                "checkpoint retention could not resolve a workspace repo root"
            );
            return;
        }
    };

    if apply_retention_policy {
        // Re-read the unexpired rows UNDER the lease, newest first.
        let unexpired = match service
            .store
            .list_unexpired_checkpoints_for_workspace(workspace_id)
        {
            Ok(rows) => rows,
            Err(_error) => {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "checkpoint_list",
                    "checkpoint retention could not list a workspace's checkpoints"
                );
                return;
            }
        };

        // The newest origin='safety' row is the standing un-revert handle:
        // exempt from the N-cull, but NOT from the age cap.
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
    if let Err(_error) = service.store.mark_checkpoint_expired(checkpoint_id, &now()) {
        tracing::error!(
            workspace_id = %workspace_id,
            checkpoint_id = %checkpoint_id,
            sentry_code = "CHECKPOINT_RETENTION_FAILED",
            failure_stage = "row_expiry",
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
        Ok(Err(_error)) => tracing::error!(
            workspace_id = %workspace_id,
            checkpoint_id = %checkpoint_id,
            sentry_code = "CHECKPOINT_RETENTION_FAILED",
            failure_stage = "culled_ref_delete",
            "checkpoint retention could not delete a culled checkpoint's refs"
        ),
        Err(_error) => tracing::error!(
            workspace_id = %workspace_id,
            checkpoint_id = %checkpoint_id,
            sentry_code = "CHECKPOINT_RETENTION_FAILED",
            failure_stage = "culled_ref_delete_task",
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
    let entries =
        match tokio::task::spawn_blocking(move || refs::list_for_workspace(&probe_root, &probe_ws))
            .await
        {
            Ok(Ok(entries)) => entries,
            Ok(Err(_error)) => {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "orphan_ref_list",
                    "checkpoint retention could not list checkpoint refs"
                );
                return;
            }
            Err(_error) => {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "orphan_ref_list_task",
                    "the checkpoint ref-list task failed"
                );
                return;
            }
        };
    let checkpoint_ids = entries
        .into_iter()
        .map(|entry| entry.checkpoint_id)
        .collect::<std::collections::BTreeSet<_>>();
    let mut orphan_ids = std::collections::BTreeSet::new();
    for checkpoint_id in checkpoint_ids {
        let orphaned = match service.store.find_checkpoint(&checkpoint_id) {
            Ok(None) => true,
            Ok(Some(record)) if record.workspace_id == workspace_id => record.expired_at.is_some(),
            Ok(Some(_record)) => {
                tracing::error!(
                    workspace_id = %workspace_id,
                    checkpoint_id = %checkpoint_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "orphan_workspace_mismatch",
                    "checkpoint retention found checkpoint metadata owned by another workspace"
                );
                return;
            }
            Err(_error) => {
                // A read or row-mapping failure is not proof that metadata is
                // absent. Abort the whole reap before deleting anything so a
                // transient/corrupt read can never destroy live checkpoint
                // bytes.
                tracing::error!(
                    workspace_id = %workspace_id,
                    checkpoint_id = %checkpoint_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "orphan_row_classification",
                    "checkpoint retention could not classify a checkpoint ref set"
                );
                return;
            }
        };
        if orphaned {
            orphan_ids.insert(checkpoint_id);
        }
    }
    for checkpoint_id in orphan_ids {
        let repo_root = repo_root.to_path_buf();
        let workspace_id_owned = workspace_id.to_string();
        let deletion = tokio::task::spawn_blocking(move || {
            refs::delete_for(&repo_root, &workspace_id_owned, &checkpoint_id)
        })
        .await;
        match deletion {
            Ok(Ok(())) => {}
            Ok(Err(_error)) => {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "orphan_ref_delete",
                    "checkpoint retention could not reap an orphaned ref set"
                );
            }
            Err(_error) => {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "CHECKPOINT_RETENTION_FAILED",
                    failure_stage = "orphan_ref_delete_task",
                    "the orphaned checkpoint ref-deletion task failed"
                );
            }
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
