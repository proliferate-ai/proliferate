//! The forward orchestrator. Phase 1 is synchronous and every failure in it
//! aborts clean; the flip is the point of no return; phase 2 detaches.

use std::path::PathBuf;
use std::sync::Arc;

use crate::adapters::git::service::GitService;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState};

use super::types::{ArchiveError, ArchiveOptions, ArchiveOutcome};
use super::{now, phase2, quiesce, refs, WorkspaceArchiveService};

pub(super) async fn archive(
    service: &Arc<WorkspaceArchiveService>,
    workspace_id: &str,
    opts: ArchiveOptions,
) -> Result<ArchiveOutcome, ArchiveError> {
    // Already archived AND a phase-2 task is live? Answer BEFORE the gate.
    //
    // The lease-free read is safe not because the flip is irreversible (unarchive
    // reverses it) but because the race is benign and converges: the ROW is read
    // before the TOKEN MAP, so a concurrent unarchive — which fires the token
    // first and flips the row after — can at worst return a just-outdated
    // archived record, which the list poll corrects. It can never swallow a
    // cancel. Checking the token first would misfire in the register→flip window,
    // where a token exists moments before the row flips.
    //
    // This branch exists because the phase-2 window (0-300s of script) is exactly
    // when a user double-clicks, and an in-flight error here would reinstate the
    // sidebar row of a genuinely archived workspace.
    if let Some(workspace) = service.store.find_workspace(workspace_id)? {
        if workspace.lifecycle_state == WorkspaceLifecycleState::Archived
            && service.phase2_live(workspace_id)
        {
            return Ok(ArchiveOutcome {
                record: workspace,
                notices: Vec::new(),
            });
        }
    }

    // Bounded awaiting acquire. A raw try would fail spuriously against the
    // routine short shared leases a live workspace always has (a git-status
    // poll). On timeout, re-read the row FIRST: a double-click that queued behind
    // this workspace's own in-flight archive lands here just as that archive
    // flips the row, and answering "in flight" would reinstate the sidebar row of
    // a workspace that is now genuinely archived.
    let lease = match service
        .operation_gate
        .acquire_exclusive_bounded(workspace_id)
        .await
    {
        Ok(lease) => lease,
        Err(_) => {
            let workspace = service
                .store
                .find_workspace(workspace_id)?
                .ok_or_else(|| ArchiveError::NotFound(workspace_id.to_string()))?;
            if workspace.lifecycle_state == WorkspaceLifecycleState::Archived {
                return Ok(ArchiveOutcome {
                    record: workspace,
                    notices: Vec::new(),
                });
            }
            return Err(ArchiveError::OperationInFlight);
        }
    };

    // Load the row AFTER acquiring the lease, never before: a row read before a
    // wait is a row that may have changed during it.
    let workspace = service
        .store
        .find_workspace(workspace_id)?
        .ok_or_else(|| ArchiveError::NotFound(workspace_id.to_string()))?;
    let repo_root = service.repo_root_path(&workspace)?;
    let workspace_path = PathBuf::from(&workspace.path);

    // The workspace's repo root and target path enter the process-local in-flight
    // map here and leave on ANY exit (the Drop guard), phase 2 included. A gc
    // guard that only unarchives fed would let purge's gc race a sibling
    // ARCHIVE's capture.
    let Some(inflight) = service
        .inflight
        .try_claim(workspace_id, &repo_root, &workspace_path)
    else {
        return Err(ArchiveError::OperationInFlight);
    };

    // kind=local FIRST, before any re-entry or cleanup logic can run. Archive is
    // quiesce plus a row flip and nothing more here: the user's own main
    // directory is never touched — no snapshot, no refs, no archive script (there
    // is no worktree state to clean), no deletion, no branch ops. The sha stays
    // NULL, and unarchive is just `mark_active`.
    if workspace.kind == WorkspaceKind::Local {
        if workspace.lifecycle_state == WorkspaceLifecycleState::Archived {
            return Ok(ArchiveOutcome {
                record: workspace,
                notices: Vec::new(),
            });
        }
        // A quiesce timeout is deliberately tolerated on this branch: there is no
        // snapshot fidelity to protect, and the admission guards stop new work
        // from entering. Fidelity is the ONLY reason the worktree path below
        // aborts on a timeout.
        warn_on_quiesce_timeout(service, workspace_id).await;
        service
            .store
            .mark_archived(workspace_id, None, None, &now(), None)?;
        return Ok(ArchiveOutcome {
            record: service.store.require_workspace(workspace_id)?,
            notices: Vec::new(),
        });
    }

    // Idempotent re-entry: respond now and kick the KNOB-FREE leftover cleanup —
    // the exact subset the sweep runs, worktree removal only, behind the full
    // leftover predicate. The script and the branch delete had their chance with
    // the ORIGINAL request; a re-POST never re-runs either, because the request
    // that carries those knobs is gone and guessing them would be worse than
    // skipping them.
    if workspace.lifecycle_state == WorkspaceLifecycleState::Archived {
        phase2::spawn_phase2_cleanup(service.clone(), lease, inflight, workspace.clone());
        return Ok(ArchiveOutcome {
            record: workspace,
            notices: Vec::new(),
        });
    }

    // Directory already missing (deleted by hand, disk moved)? Nothing to
    // snapshot, nothing to clean.
    if workspace.checkout_directory_missing() {
        warn_on_quiesce_timeout(service, workspace_id).await;
        // Never clobber an earlier generation: if a sha and refs survive from a
        // prior archive (a restore that crashed before verification, then the
        // directory went missing) they are the only copy, so they are kept and
        // unarchive restores them normally. Writing NULL over a live sha would
        // strand the row in a state no restore tier handles.
        //
        // The branch is backfilled ONLY for the truly never-snapshotted shape.
        // On a sha-present row, `archived_branch` NULL is the detached-at-archive
        // MARKER, and an unconditional backfill would convert a detached archive
        // into a fake branch archive and manufacture spurious diverged 409s.
        let branch = if workspace.archived_head_sha.is_none() {
            workspace
                .archived_branch
                .as_deref()
                .or(workspace.current_branch.as_deref())
                .or(workspace.original_branch.as_deref())
        } else {
            workspace.archived_branch.as_deref()
        };
        service.store.mark_archived(
            workspace_id,
            workspace.archived_head_sha.as_deref(),
            branch,
            &now(),
            workspace.partial_capture_json.as_deref(),
        )?;
        return Ok(ArchiveOutcome {
            record: service.store.require_workspace(workspace_id)?,
            notices: Vec::new(),
        });
    }

    // ─── PHASE 1: synchronous, still active; every failure aborts clean ───

    // BEFORE quiesce: a refused archive must not have killed the user's running
    // processes. `snapshot_workspace` re-checks the same conditions
    // authoritatively below, because a conflict can begin during the kill window.
    let phase1_started = std::time::Instant::now();
    let probe_path = workspace_path.clone();
    blocking(move || GitService::probe_refusals(&probe_path)).await??;
    let probe_done = std::time::Instant::now();

    let quiesce_report =
        quiesce::stop_everything(&service.planes, workspace_id, service.quiesce_deadline())
            .await
            .map_err(|_| {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "ARCHIVE_QUIESCE_TIMEOUT",
                    "archive aborted: the workspace could not be quiesced within the deadline"
                );
                ArchiveError::Failed("the workspace could not be quiesced".to_string())
            })?;
    let quiesce_done = std::time::Instant::now();

    // Quiesce's own kills can CREATE refusal states, so the repair runs between
    // quiesce and capture. Without it, archive manufactures permanently
    // un-archivable workspaces out of its own SIGKILLs.
    let repair_path = workspace_path.clone();
    let repair_notices =
        blocking(move || GitService::repair_kill_debris(&repair_path, &quiesce_report))
            .await?
            .map_err(|error| {
                let error = ArchiveError::from(error);
                if let ArchiveError::GitLocked { file } = &error {
                    tracing::error!(
                        workspace_id = %workspace_id,
                        file = %file,
                        sentry_code = "ARCHIVE_GIT_LOCKED",
                        "archive aborted: a git lock file could not be reaped"
                    );
                }
                error
            })?;
    let repair_done = std::time::Instant::now();

    let snapshot_path = workspace_path.clone();
    let snapshot = blocking(move || GitService::snapshot_workspace(&snapshot_path))
        .await?
        .map_err(|error| {
            let error = ArchiveError::from(error);
            // The three business-rule refusals are the toasts working as designed
            // and are logged at info; only mechanical failure is a Sentry issue.
            if matches!(error, ArchiveError::Failed(_)) {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "ARCHIVE_SNAPSHOT_FAILED",
                    error = %error,
                    "archive aborted: the capture failed"
                );
            } else {
                tracing::info!(
                    workspace_id = %workspace_id,
                    refusal = %error,
                    "archive refused before any effect"
                );
            }
            error
        })?;
    let snapshot_done = std::time::Instant::now();

    {
        let repo_root = repo_root.clone();
        let id = workspace_id.to_string();
        let snapshot = snapshot.clone();
        blocking(move || {
            refs::write_archive_refs(&repo_root, &id, &snapshot)?;
            // A racing gc must fail phase 1 loudly rather than leave a row
            // pointing at objects that are already gone.
            refs::verify_archive_refs(&repo_root, &id, &snapshot)
        })
        .await?
        .map_err(|error| {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "ARCHIVE_REFS_VERIFY_FAILED",
                error = %error,
                "archive aborted: the archive refs did not verify"
            );
            ArchiveError::Failed(error.to_string())
        })?;
    }
    let refs_done = std::time::Instant::now();

    // Token BEFORE the flip: once any observer can read lifecycle=archived,
    // `cancel_phase2` must find something to fire, or a fast Undo racing this gap
    // cancels nothing and then times out on the gate.
    let token = service.register_phase2_token(workspace_id);

    // ─── POINT OF NO RETURN ───
    if let Err(error) = service.store.mark_archived(
        workspace_id,
        Some(&snapshot.head_sha),
        snapshot.branch.as_deref(),
        &now(),
        snapshot.partial_capture_json().as_deref(),
    ) {
        // A registered-but-never-flipped token would sit unresolvable and hang a
        // later unarchive's await.
        token.release();
        return Err(ArchiveError::Failed(error.to_string()));
    }

    // ─── RESPOND AT THE FLIP; PHASE 2 DETACHES ───
    let notices = [repair_notices, snapshot.notices.clone()].concat();
    let record = service.store.require_workspace(workspace_id)?;
    tracing::info!(
        workspace_id = %workspace_id,
        probe_ms = probe_done.duration_since(phase1_started).as_millis() as u64,
        quiesce_ms = quiesce_done.duration_since(probe_done).as_millis() as u64,
        repair_ms = repair_done.duration_since(quiesce_done).as_millis() as u64,
        snapshot_ms = snapshot_done.duration_since(repair_done).as_millis() as u64,
        refs_ms = refs_done.duration_since(snapshot_done).as_millis() as u64,
        flip_ms = refs_done.elapsed().as_millis() as u64,
        total_ms = phase1_started.elapsed().as_millis() as u64,
        "[anyharness-latency] workspace.archive.phase1_complete"
    );
    phase2::spawn_phase2(
        service.clone(),
        lease,
        inflight,
        token,
        workspace,
        repo_root,
        snapshot,
        opts,
    );
    Ok(ArchiveOutcome { record, notices })
}

/// The two branches with nothing to snapshot tolerate a quiesce deadline trip:
/// there is no fidelity to protect, so refusing to archive would be strictly
/// worse than archiving with a warning.
async fn warn_on_quiesce_timeout(service: &Arc<WorkspaceArchiveService>, workspace_id: &str) {
    if quiesce::stop_everything(&service.planes, workspace_id, service.quiesce_deadline())
        .await
        .is_err()
    {
        tracing::warn!(
            workspace_id = %workspace_id,
            sentry_code = "ARCHIVE_QUIESCE_TIMEOUT",
            "quiesce timed out on a branch with nothing to snapshot; the flip proceeds"
        );
    }
}

/// Every git and filesystem verb runs off the async runtime. The adapter's verbs
/// are synchronous child-process waits, and running them inline starves the very
/// timeouts this design depends on: the bounded gate acquires, the quiesce
/// deadline, the bounded cancel awaits.
pub(super) async fn blocking<T, F>(work: F) -> Result<T, ArchiveError>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| ArchiveError::Failed(error.to_string()))
}
