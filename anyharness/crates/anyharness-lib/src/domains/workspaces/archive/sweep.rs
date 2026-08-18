//! The leftover sweep: the reconciler of last resort.
//!
//! Archive answers at the flip and lets its tail run detached, which means a
//! crash, a kill, or a failed step can leave a directory on disk that no longer
//! belongs to anything. "Leftover" is derived, never stored, so nothing needs
//! repairing — it just needs converging, and this is what converges it.
//!
//! Every row-keyed duty runs under one discipline: `try_acquire_exclusive` (busy
//! skips to the next tick, never queues behind a user), re-load the row UNDER the
//! lease, and re-evaluate there. The listing pass is only a hint: between listing
//! and lease the row may have been unarchived. The lease is also what makes the
//! refs duty safe against a live archive's write-refs→flip window and a live
//! unarchive's mark-active→release window.
//!
//! Two benign windows, listed so they read as designed rather than as bugs:
//!
//! - A crash after `restore_snapshot` but before `mark_active` leaves a row
//!   matching the full predicate, so the sweep may remove that fully-restored
//!   directory. Safe (the refs are intact and the retried unarchive restores
//!   again), just wasteful.
//! - A sweep mid-removal holds the gate past a user's ~3s bounded acquire, so an
//!   Undo landing in that window gets one in-flight answer and succeeds on retry.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::adapters::git::service::GitService;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};
use crate::domains::workspaces::path_identity::{same_path, same_path_strict};

use super::phase2;
use super::refs;
use super::WorkspaceArchiveService;

/// The periodic cadence. Slow on purpose: the request-driven convergence
/// (re-POST) and the boot pass carry the common cases, so this exists for the
/// long tail.
pub const SWEEP_TICK: Duration = Duration::from_secs(60 * 60);

/// A crashed restore's staging sibling is only debris once it is old enough that
/// no plausible restore is still using it. The in-flight map is the LIVENESS
/// signal (see below); this is the belt for a restore that died with the process.
pub const STAGING_AGE_GATE: Duration = Duration::from_secs(60 * 60);

/// The staging parent directory pattern the restore choreography creates. Matched
/// against registration PATHS, never names: the pattern names the staging PARENT
/// and the registered worktree is its child, so matching names finds nothing.
const STAGING_PATTERN: &str = ".proliferate-worktree-restore-";

impl WorkspaceArchiveService {
    /// The boot pass plus the periodic tick.
    ///
    /// Suppressed under `cfg(test)` at the wiring site, following the
    /// `AppState::automatic_poke_engine` precedent: a background pass that
    /// removes directories would otherwise land in the middle of suites that
    /// build real worktrees and count what is on disk. In production boots the
    /// pass runs unconditionally.
    pub fn spawn_startup_pass(self: Arc<Self>) {
        tokio::spawn(async move {
            self.sweep_leftovers().await;
            loop {
                tokio::time::sleep(SWEEP_TICK).await;
                self.sweep_leftovers().await;
            }
        });
    }

    /// One full pass: the primary cleanup, then the five secondary duties.
    ///
    /// Takes `&Arc<Self>` rather than `&self` because the convergence helper the
    /// primary cleanup shares with the request-driven re-POST path needs an
    /// owned handle for its `spawn_blocking` calls. Sharing that helper is the
    /// point: "the sweep runs the exact subset a re-POST runs" has to be one
    /// code path, or the two drift.
    pub async fn sweep_leftovers(self: &Arc<Self>) {
        let archived = match self
            .store
            .list_by_lifecycle(WorkspaceLifecycleState::Archived)
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::error!(
                    sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                    error = %error,
                    "the sweep could not list archived workspaces"
                );
                return;
            }
        };

        let leftover_ids = leftover_census(&archived);
        for candidate in &archived {
            self.sweep_one_archived_row(candidate).await;
        }
        // The observability rule this rung ships as a sweep-side log line rather
        // than a listing change: a nonzero "archived but the directory still
        // exists" count mid-session means convergence is not keeping up.
        if !leftover_ids.is_empty() {
            tracing::warn!(
                count = leftover_ids.len(),
                workspace_ids = %leftover_ids.join(","),
                "archived workspaces still have a directory on disk"
            );
        }

        self.sweep_staging_siblings(&archived).await;
        self.sweep_orphaned_refs().await;
        self.run_deferred_gcs().await;
        // Duty 5 (Lane H): checkpoint retention. A no-op while
        // `ANYHARNESS_CHECKPOINT_CAPTURE` is off; it enumerates its own candidate
        // workspaces from the `workspace_checkpoints` table, so it does not lean
        // on the `archived` list above.
        self.checkpoints.sweep_retention().await;
    }

    /// The primary cleanup, plus duty 2 (a stale registration for an archived row
    /// whose directory is already gone — the state a crashed rm-rf fallback
    /// leaves, which blocks that workspace's unarchive forever if left unpruned).
    async fn sweep_one_archived_row(self: &Arc<Self>, candidate: &WorkspaceRecord) {
        let Some(_lease) = self
            .operation_gate
            .try_acquire_exclusive(&candidate.id)
            .await
        else {
            return;
        };
        let Ok(workspace) = self.store.require_workspace(&candidate.id) else {
            return;
        };
        // Registering a token makes `phase2_live` true for the duration, so a
        // double-POST answers 200 from the pre-gate check instead of falling
        // through to a gate this removal is holding.
        let _token = self.register_phase2_token(&workspace.id);

        match phase2::converge_leftover(self, &workspace).await {
            Ok(true) => tracing::info!(
                workspace_id = %workspace.id,
                "the sweep removed an archived workspace's leftover worktree"
            ),
            Ok(false) => self.prune_phantom_registration(&workspace).await,
            Err(error) => tracing::error!(
                workspace_id = %workspace.id,
                sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                error = %error,
                "the sweep could not remove a leftover worktree"
            ),
        }
    }

    /// Duty 2. Runs only when the predicate said "not a leftover" AND the reason
    /// is that the directory is gone: a registration with no directory behind it
    /// is what a crashed rm-rf fallback leaves, and git refuses the next
    /// `worktree add` at that path until it is pruned.
    async fn prune_phantom_registration(&self, workspace: &WorkspaceRecord) {
        if !workspace.checkout_directory_missing() {
            return;
        }
        let Ok(repo_root) = self.repo_root_path(workspace) else {
            return;
        };
        let workspace_path = PathBuf::from(&workspace.path);
        let probe_root = repo_root.clone();
        let probe_path = workspace_path.clone();
        // `same_path_strict`: a `true` answer here ADMITS the prune, so an
        // unresolvable comparison must read as somebody else's registration
        // rather than as ours.
        let registered = tokio::task::spawn_blocking(move || {
            GitService::list_worktree_registrations(&probe_root)
                .unwrap_or_default()
                .into_iter()
                .any(|registration| same_path_strict(&registration.path, &probe_path))
        })
        .await
        .unwrap_or(false);
        if !registered {
            return;
        }
        let removal = tokio::task::spawn_blocking(move || {
            GitService::remove_worktree_force(
                &repo_root.display().to_string(),
                &workspace_path.display().to_string(),
            )
        })
        .await;
        match removal {
            Ok(Ok(_)) => tracing::info!(
                workspace_id = %workspace.id,
                "the sweep pruned a stale worktree registration whose directory was gone"
            ),
            Ok(Err(error)) => tracing::error!(
                workspace_id = %workspace.id,
                sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                error = %error,
                "the sweep could not prune a stale worktree registration"
            ),
            Err(error) => tracing::error!(
                workspace_id = %workspace.id,
                sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                error = %error,
                "the stale-registration prune task failed"
            ),
        }
    }

    /// Duty 1: crashed restore staging siblings.
    ///
    /// Candidates have no owning row, so this duty leans on the in-flight map and
    /// the age gate instead of a lease. The in-flight map is the liveness signal
    /// because liveness must NEVER be inferred from mtimes here: a staging
    /// parent's mtime freezes at creation, so a live restore's staging directory
    /// looks arbitrarily old.
    async fn sweep_staging_siblings(&self, archived: &[WorkspaceRecord]) {
        let mut repo_roots = BTreeSet::new();
        for workspace in archived {
            if let Ok(repo_root) = self.repo_root_path(workspace) {
                repo_roots.insert(repo_root);
            }
        }
        for repo_root in repo_roots {
            let probe_root = repo_root.clone();
            let registrations = tokio::task::spawn_blocking(move || {
                GitService::list_worktree_registrations(&probe_root).unwrap_or_default()
            })
            .await
            .unwrap_or_default();
            for registration in registrations {
                let path = registration.path.clone();
                if !path.to_string_lossy().contains(STAGING_PATTERN) {
                    continue;
                }
                if self.claimed_by_any_row(&path) {
                    continue;
                }
                // The liveness question has to be asked with the key the
                // restore actually uses. Unarchive claims its TARGET path
                // (`archive/unarchive.rs`), never the staging path, and the
                // staged registration is a sibling of the target rather than a
                // descendant of it — so asking about the staged path answers
                // "not busy" for every live restore that exists, and this guard
                // would never fire. Derive the target and ask about THAT.
                let Some(target) = restore_target_of(&path) else {
                    // A staging-shaped path we cannot map back to a target is a
                    // path we cannot prove is dead. Leave it.
                    continue;
                };
                if self.inflight.path_busy(&target) || self.inflight.path_busy(&path) {
                    continue;
                }
                if !older_than(&path, STAGING_AGE_GATE) {
                    continue;
                }
                let staging_parent = staging_parent_of(&path);
                let repo_root_string = repo_root.display().to_string();
                let path_string = path.display().to_string();
                let removal = tokio::task::spawn_blocking(move || {
                    let outcome =
                        GitService::remove_worktree_force(&repo_root_string, &path_string);
                    // The emptied staging parent goes too; leaving it behind would
                    // accumulate one empty directory per crashed restore forever.
                    if let Some(parent) = staging_parent {
                        let _ = std::fs::remove_dir(parent);
                    }
                    outcome
                })
                .await;
                match removal {
                    Ok(Ok(_)) => tracing::info!(
                        path = %path.display(),
                        "the sweep removed a crashed restore's staging sibling"
                    ),
                    Ok(Err(error)) => tracing::error!(
                        path = %path.display(),
                        sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                        error = %error,
                        "the sweep could not remove a staging sibling"
                    ),
                    Err(error) => tracing::error!(
                        sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                        error = %error,
                        "the staging-sibling removal task failed"
                    ),
                }
            }
        }
    }

    /// Duty 3: `archive-*` refs whose workspace row is active with no in-flight
    /// unarchive.
    ///
    /// Two rules ride it. The duty releases refs and row columns TOGETHER —
    /// `release_archive_state` first, then the ref deletes — because deleting refs
    /// while a sha survives would manufacture the exact false `snapshot_lost` this
    /// duty exists to prevent. And it never touches `rescue/` names, skipping any
    /// workspace id that holds them entirely: those refs are the evidence of a
    /// failed verify, and reaping them would delete what the user is being told to
    /// look at.
    async fn sweep_orphaned_refs(&self) {
        let Ok(active) = self
            .store
            .list_by_lifecycle(WorkspaceLifecycleState::Active)
        else {
            return;
        };
        let mut repo_roots = BTreeSet::new();
        for workspace in &active {
            if let Ok(repo_root) = self.repo_root_path(workspace) {
                repo_roots.insert(repo_root);
            }
        }
        for repo_root in repo_roots {
            let probe_root = repo_root.clone();
            let Ok(Ok((entries, rescue_ids))) = tokio::task::spawn_blocking(move || {
                Ok::<_, anyhow::Error>((
                    refs::list_for_repo(&probe_root)?,
                    refs::rescue_ids_for_repo(&probe_root)?,
                ))
            })
            .await
            else {
                continue;
            };
            let ids: BTreeSet<String> = entries
                .into_iter()
                .map(|entry| entry.workspace_id)
                .filter(|id| !rescue_ids.contains(id))
                .collect();
            for workspace_id in ids {
                if self.inflight.repo_root_busy(&repo_root) {
                    continue;
                }
                let Some(_lease) = self
                    .operation_gate
                    .try_acquire_exclusive(&workspace_id)
                    .await
                else {
                    continue;
                };
                let Ok(Some(workspace)) = self.store.find_workspace(&workspace_id) else {
                    continue;
                };
                if workspace.lifecycle_state != WorkspaceLifecycleState::Active {
                    continue;
                }
                if let Err(error) = self
                    .store
                    .release_archive_state(&workspace_id, &super::now())
                {
                    tracing::error!(
                        workspace_id = %workspace_id,
                        sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                        error = %error,
                        "the refs duty could not release the row's archive columns"
                    );
                    continue;
                }
                let repo_root = repo_root.clone();
                let id = workspace_id.clone();
                let deletion =
                    tokio::task::spawn_blocking(move || refs::delete_for(&repo_root, &id)).await;
                match deletion {
                    Ok(Ok(())) => tracing::info!(
                        workspace_id = %workspace_id,
                        "the sweep released an orphaned archive ref set"
                    ),
                    Ok(Err(error)) => tracing::error!(
                        workspace_id = %workspace_id,
                        sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                        error = %error,
                        "the refs duty could not delete an orphaned ref set"
                    ),
                    Err(error) => tracing::error!(
                        sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                        error = %error,
                        "the orphaned-refs deletion task failed"
                    ),
                }
            }
        }
    }

    /// Duty 4: gcs handed off by purge. This tick's follow-up gc is the actual
    /// reclaim moment for the common archive-then-delete flow. R4 ships the runner
    /// and the process-local set; R5's purge is the enqueuer.
    async fn run_deferred_gcs(&self) {
        let pending: Vec<PathBuf> = {
            let mut deferred = self.deferred_gc.lock().expect("deferred gc set poisoned");
            let ready: Vec<PathBuf> = deferred
                .iter()
                .filter(|repo_root| !self.inflight.repo_root_busy(repo_root))
                .cloned()
                .collect();
            for repo_root in &ready {
                deferred.remove(repo_root);
            }
            ready
        };
        for repo_root in pending {
            let target = repo_root.clone();
            // `GitService::gc_repo`, never a bare `git gc`: the guarded call
            // carries `gc.worktreePruneExpire=never` and a spelled-out
            // `1.hour.ago` prune window, which is the whole point of deferring
            // this to a moment nothing else is claiming the repo root.
            let result = tokio::task::spawn_blocking(move || GitService::gc_repo(&target)).await;
            match result {
                Ok(Ok(_)) => tracing::info!(
                    repo_root = %repo_root.display(),
                    "ran a deferred repository gc"
                ),
                Ok(Err(error)) => tracing::error!(
                    repo_root = %repo_root.display(),
                    sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                    error = %error,
                    "a deferred repository gc failed"
                ),
                Err(error) => tracing::error!(
                    sentry_code = "ARCHIVE_SWEEP_CLEANUP_FAILED",
                    error = %error,
                    "the deferred gc task failed"
                ),
            }
        }
    }

    fn claimed_by_any_row(&self, path: &Path) -> bool {
        let Ok(rows) = self.store.list_all() else {
            // Unreadable store means every candidate is treated as claimed: the
            // sweep never guesses its way into a removal.
            return true;
        };
        rows.iter().any(|row| same_path(Path::new(&row.path), path))
    }
}

/// Which archived rows are "archived but the directory is still there" for the
/// purposes of the convergence-lag warning.
///
/// The two exclusions are the difference between a signal and an hourly lie:
/// a `kind=local` row's directory is the user's own checkout and exists
/// forever, and a sha-NULL row's directory is protected BY the predicate, so
/// neither will ever converge and neither is lagging. Counting them means any
/// user with one archived local workspace is warned every hour for the life of
/// the process. The terms mirror the leftover predicate's own kind and snapshot
/// guards; the path-ownership term is deliberately not re-evaluated here,
/// because the census is a log line, not a decision, and it must not run a
/// store query per row.
pub(super) fn leftover_census(archived: &[WorkspaceRecord]) -> Vec<String> {
    archived
        .iter()
        .filter(|candidate| {
            candidate.kind == WorkspaceKind::Worktree
                && candidate.archived_head_sha.is_some()
                && !candidate.checkout_directory_missing()
        })
        .map(|candidate| candidate.id.clone())
        .collect()
}

fn older_than(path: &Path, age: Duration) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        // Gone already: nothing to protect.
        return true;
    };
    let Ok(created) = metadata.modified() else {
        return false;
    };
    SystemTime::now()
        .duration_since(created)
        .map(|elapsed| elapsed >= age)
        .unwrap_or(false)
}

/// The TARGET path a staged registration is on its way to.
///
/// The restore choreography stages at
/// `<target_parent>/.proliferate-worktree-restore-<uuid>/<target_name>`
/// (`adapters/git/operations/worktree_restore.rs`), so the target is the
/// staging parent's parent joined with the staged leaf name. That target is the
/// only path an unarchive ever registers in the in-flight map, which makes it
/// the only key the liveness check can ask about.
fn restore_target_of(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?;
    Some(staging_parent_of(path)?.parent()?.join(name))
}

/// The registered worktree is the CHILD of the staging parent, so the parent is
/// the directory whose name carries the pattern.
fn staging_parent_of(path: &Path) -> Option<PathBuf> {
    let mut cursor = path;
    while let Some(parent) = cursor.parent() {
        if parent
            .file_name()
            .is_some_and(|name| name.to_string_lossy().contains(STAGING_PATTERN))
        {
            return Some(parent.to_path_buf());
        }
        cursor = parent;
    }
    None
}
