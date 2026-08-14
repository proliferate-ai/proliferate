//! The detached tail of an archive: the archive script, the worktree removal,
//! and the branch delete — plus the knob-free convergence cleanup a re-POST
//! kicks.
//!
//! Every step here is allowed to fail without failing the archive, because the
//! request already answered 200 at the flip and "leftover" is a derived listing
//! fact the sweep converges. "Non-fatal" must never mean "invisible", though, so
//! each failure still raises its own Sentry code.
//!
//! Cancellation is PER-STEP, not between steps:
//!
//! - The script is `select!`ed against the token and killed immediately.
//! - If the token fires before removal has STARTED, removal is skipped. The
//!   directory is intact and exactly right, so the following unarchive's
//!   intact-own-worktree tier restores it in place — which makes Undo-mid-script
//!   the cheapest path in the system rather than the most expensive.
//! - Once removal has started it runs to completion. A half-deleted directory is
//!   the one state nothing downstream can classify.
//! - The branch delete is skipped.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::adapters::git::operations::snapshot::WorkspaceSnapshot;
use crate::adapters::git::service::GitService;
use crate::adapters::git::types::WorktreeRemoveOutcome;
use crate::domains::workspaces::managed_root::is_managed_worktree_path;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};
use crate::domains::workspaces::operation_gate::WorkspaceExclusiveOperationLease;

use super::inflight::InFlightGuard;
use super::tokens::Phase2Registration;
use super::types::ArchiveOptions;
use super::WorkspaceArchiveService;

/// The archive request's phase 2. Holds the gate lease and the in-flight claim
/// for its whole duration.
#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_phase2(
    service: Arc<WorkspaceArchiveService>,
    lease: WorkspaceExclusiveOperationLease,
    inflight: InFlightGuard,
    token: Phase2Registration,
    workspace: WorkspaceRecord,
    repo_root: PathBuf,
    snapshot: WorkspaceSnapshot,
    opts: ArchiveOptions,
) {
    tokio::spawn(async move {
        let _lease = lease;
        let _inflight = inflight;
        let workspace_path = PathBuf::from(&workspace.path);

        // Step 1: the archive script. It runs AFTER the capture, so its own
        // effects are deliberately invisible to the snapshot, and it runs while
        // the worktree is still present because cleaning a directory that is
        // already gone is not a thing a script can do.
        if let Some(script) = opts.archive_script.as_deref() {
            run_archive_script(&service, &token, &workspace.id, script).await;
        }

        // Step 2: the removal. Skipped entirely if the token already fired.
        if token.is_cancelled() {
            tracing::info!(
                workspace_id = %workspace.id,
                "phase 2 cancelled before removal started; the directory is left intact for the in-place restore"
            );
            return;
        }
        remove_worktree(&repo_root, &workspace_path, &workspace.id).await;

        // Step 3: the branch delete. Only with the knob set, only the branch HEAD
        // actually held at snapshot time, and never after a cancel.
        if token.is_cancelled() || !opts.delete_branch {
            return;
        }
        let Some(branch) = snapshot.branch.clone() else {
            return;
        };
        delete_branch(&repo_root, &workspace_path, &workspace.id, &branch).await;
    });
}

/// The knob-free convergence cleanup a re-POST of `/archive` against an already
/// archived row kicks: worktree removal only, behind the full leftover predicate.
///
/// It registers a generation-tagged token like any other detached lease-holding
/// task. Without that, `phase2_live` would read false during its minutes-long
/// removal, a double-POST would fall through to the gate, and the answer would
/// reinstate the sidebar row of a genuinely archived workspace.
pub(super) fn spawn_phase2_cleanup(
    service: Arc<WorkspaceArchiveService>,
    lease: WorkspaceExclusiveOperationLease,
    inflight: InFlightGuard,
    workspace: WorkspaceRecord,
) {
    let token = service.register_phase2_token(&workspace.id);
    tokio::spawn(async move {
        let _lease = lease;
        let _inflight = inflight;
        let _token = token;
        if let Err(error) = converge_leftover(&service, &workspace).await {
            tracing::error!(
                workspace_id = %workspace.id,
                sentry_code = "ARCHIVE_WORKTREE_REMOVE_FAILED",
                error = %error,
                "the convergence cleanup could not remove the leftover worktree"
            );
        }
    });
}

/// The leftover predicate — derived, never stored. EVERY term is load-bearing:
///
/// - the **kind guard**, because a `kind=local` row's directory is the user's own
///   checkout and legitimately exists;
/// - the **snapshot guard**, because sha-NULL rows never had a snapshot (absorbed
///   pre-archiving rows, old purge tombstones) and may hold unsnapshotted work,
///   so destructive cleanup must never touch them;
/// - the **path-ownership guard**, because cleaning "A's leftover" must never
///   delete B's live worktree.
///
/// Creation refuses archived rows' paths, so a reused path SHOULD be
/// unreachable. Prevention there and protection here are deliberate
/// defence-in-depth, not a contradiction: this guards the collisions creation
/// cannot see (rows that predate the clause, hand-made directories, path
/// aliases).
///
/// Evaluated ONLY on a freshly re-loaded row under the workspace's gate lease:
/// between listing and lease the row may have been unarchived.
pub(super) fn is_leftover(
    service: &WorkspaceArchiveService,
    workspace: &WorkspaceRecord,
) -> anyhow::Result<bool> {
    Ok(workspace.kind == WorkspaceKind::Worktree
        && workspace.lifecycle_state == WorkspaceLifecycleState::Archived
        && workspace.archived_head_sha.is_some()
        && !workspace.checkout_directory_missing()
        && !service.store.any_other_row_claims_path(workspace)?)
}

/// Re-load the row, re-evaluate the predicate, and remove the leftover worktree
/// if it still matches.
///
/// The managed-root containment check is unconditional, on BOTH callers. The
/// sweep and a re-POST of `/archive` run the identical knob-free cleanup, whose
/// documented fallback is an rm-rf, so a row recorded outside the managed
/// worktrees root has to refuse in both — a guard that a request can route
/// around is not a guard.
pub(super) async fn converge_leftover(
    service: &Arc<WorkspaceArchiveService>,
    workspace: &WorkspaceRecord,
) -> anyhow::Result<bool> {
    let workspace = service.store.require_workspace(&workspace.id)?;
    if !is_leftover(service, &workspace)? {
        return Ok(false);
    }
    let workspace_path = PathBuf::from(&workspace.path);
    {
        let runtime_home = service.runtime_home.clone();
        let candidate = workspace_path.clone();
        let managed = tokio::task::spawn_blocking(move || {
            is_managed_worktree_path(&runtime_home, &candidate)
        })
        .await?;
        // Unresolvable counts as "not managed": convergence never guesses its
        // way into an rm-rf.
        if !managed.unwrap_or(false) {
            tracing::warn!(
                workspace_id = %workspace.id,
                path = %workspace.path,
                "refusing to converge a leftover outside the managed worktrees root"
            );
            return Ok(false);
        }
    }
    let repo_root = service.repo_root_path(&workspace)?;
    tokio::task::spawn_blocking(move || {
        GitService::remove_worktree_force(
            &repo_root.display().to_string(),
            &workspace_path.display().to_string(),
        )
    })
    .await?
    .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(true)
}

async fn run_archive_script(
    service: &Arc<WorkspaceArchiveService>,
    token: &Phase2Registration,
    workspace_id: &str,
    script: &str,
) {
    if script.trim().is_empty() {
        return;
    }
    let cancelled = token.token();
    let run = service
        .planes
        .setup
        .run_archive_script(workspace_id, script);
    tokio::select! {
        result = run => {
            if let Err(error) = result {
                tracing::error!(
                    workspace_id = %workspace_id,
                    sentry_code = "ARCHIVE_SCRIPT_FAILED",
                    error = %error,
                    "the archive script failed; the archive itself is unaffected"
                );
            }
        }
        _ = cancelled.cancelled() => {
            // Await CONFIRMED process death, not merely "we noticed the token".
            // The unarchive waiting on this handle restores IN PLACE, and an
            // in-place restore under a still-dying script's writes is a torn
            // restore that can then pass a HEAD-only verify.
            if let Err(error) = service.planes.setup.kill_setup_run(workspace_id).await {
                tracing::warn!(
                    workspace_id = %workspace_id,
                    error = %error,
                    "cancelling the archive script reported an error; treating it as already dead"
                );
            }
        }
    }
}

async fn remove_worktree(repo_root: &Path, workspace_path: &Path, workspace_id: &str) {
    let repo_root = repo_root.display().to_string();
    let path = workspace_path.display().to_string();
    let removal =
        tokio::task::spawn_blocking(move || GitService::remove_worktree_force(&repo_root, &path))
            .await;
    match removal {
        Ok(Ok(WorktreeRemoveOutcome::Removed | WorktreeRemoveOutcome::AlreadyGone)) => {}
        Ok(Err(error)) => tracing::error!(
            workspace_id = %workspace_id,
            sentry_code = "ARCHIVE_WORKTREE_REMOVE_FAILED",
            error = %error,
            "the archived worktree could not be removed; the sweep will converge it"
        ),
        Err(error) => tracing::error!(
            workspace_id = %workspace_id,
            sentry_code = "ARCHIVE_WORKTREE_REMOVE_FAILED",
            error = %error,
            "the worktree removal task failed"
        ),
    }
}

/// The branch delete, with its two skip conditions.
async fn delete_branch(repo_root: &Path, workspace_path: &Path, workspace_id: &str, branch: &str) {
    let repo_root = repo_root.to_path_buf();
    let workspace_path = workspace_path.to_path_buf();
    let branch = branch.to_string();
    let workspace_id = workspace_id.to_string();
    let result = tokio::task::spawn_blocking(move || {
        // Skip 1: never the repo default branch. `detect_default_branch` resolves
        // `symbolic-ref refs/remotes/origin/HEAD` and STRIPS the
        // `refs/remotes/origin/` prefix — an unstripped ref path never equals a
        // local branch name, so an unstripped guard silently never fires and
        // deletes main. Its literal main/master fallback covers older gits and
        // never-fetched clones, where `origin/HEAD` is absent.
        if GitService::detect_default_branch(&repo_root).as_deref() == Some(branch.as_str()) {
            tracing::info!(
                workspace_id = %workspace_id,
                branch = %branch,
                "skipping the branch delete: it is the repository default branch"
            );
            return Ok(());
        }
        // Skip 2: never a branch checked out at the repo root. Git's own
        // checked-out protection is gone by this point, because the worktree that
        // held the branch was just removed.
        let registrations = GitService::list_worktree_registrations(&repo_root)?;
        let checked_out_elsewhere = registrations.iter().any(|registration| {
            !registration.prunable
                && registration.branch.as_deref() == Some(branch.as_str())
                && registration.path != workspace_path
        });
        if checked_out_elsewhere {
            tracing::info!(
                workspace_id = %workspace_id,
                branch = %branch,
                "skipping the branch delete: the branch is checked out in another worktree"
            );
            return Ok(());
        }
        GitService::delete_branch_force(&repo_root, &branch)
    })
    .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::error!(
            sentry_code = "ARCHIVE_BRANCH_DELETE_FAILED",
            error = %error,
            "the archived branch could not be deleted"
        ),
        Err(error) => tracing::error!(
            sentry_code = "ARCHIVE_BRANCH_DELETE_FAILED",
            error = %error,
            "the branch delete task failed"
        ),
    }
}
