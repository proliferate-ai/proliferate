//! The reverse orchestrator, in order.
//!
//! The ordering that matters, and why:
//!
//! - **Fire and AWAIT the phase-2 cancel BEFORE touching the gate.** The bounded
//!   ~3s acquire would otherwise time out against a gate the archive script still
//!   holds, and a TERM-ignoring script needs the full 5s escalation. Awaiting a
//!   handle that resolves only on confirmed process death is what keeps
//!   Undo-mid-script both deterministic and safe: the intact tier restores IN
//!   PLACE, and an in-place restore under a still-dying script's writes is a torn
//!   restore.
//! - **The post-restore verify runs AFTER `mark_active`.** A HEAD mismatch is an
//!   alarm about fidelity, not a reason to strand the user in archived.
//! - **`release_archive_state` clears the columns FIRST, then the refs are
//!   deleted.** A crash between the two leaves inert refs on a clean row, which
//!   the sweep converges. The inverse order would leave a sha pointing at deleted
//!   refs, manufacturing a false `snapshot_lost` on a healthy workspace.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::adapters::git::operations::worktree_restore::WorktreeRestoreOptions;
use crate::adapters::git::service::GitService;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};
use crate::domains::workspaces::setup_runtime::StartWorkspaceSetupInput;

use super::refs::{self, ArchiveRefSet};
use super::tiers::{self, BranchPlan, RestorePlan};
use super::tokens::Phase2CancelOutcome;
use super::types::{
    partial_capture_notices, UnarchiveError, UnarchiveNotice, UnarchiveOptions, UnarchiveOutcome,
    UnarchiveScenario, UnarchiveScenarioPayload,
};
use super::{now, WorkspaceArchiveService};

pub(super) async fn unarchive(
    service: &Arc<WorkspaceArchiveService>,
    workspace_id: &str,
    opts: UnarchiveOptions,
) -> Result<UnarchiveOutcome, UnarchiveError> {
    // 1. The cancel, awaited, before the gate.
    if service.cancel_phase2(workspace_id).await_completion().await == Phase2CancelOutcome::TimedOut
    {
        tracing::warn!(
            workspace_id = %workspace_id,
            "the phase-2 cancel await expired; answering in-flight rather than hanging"
        );
        return Err(UnarchiveError::OperationInFlight);
    }

    // 2. The bounded acquire. A timeout here is rare and honest: the removal step
    // runs to completion once started.
    let _lease = service
        .operation_gate
        .acquire_exclusive_bounded(workspace_id)
        .await
        .map_err(|_| UnarchiveError::OperationInFlight)?;

    let workspace = service
        .store
        .find_workspace(workspace_id)?
        .ok_or_else(|| UnarchiveError::NotFound(workspace_id.to_string()))?;

    // 3. Already active? Two genuinely different sub-cases.
    if workspace.lifecycle_state == WorkspaceLifecycleState::Active
        && workspace.archived_head_sha.is_none()
    {
        // Columns released: the idempotent re-POST.
        return Ok(UnarchiveOutcome {
            record: workspace,
            notices: Vec::new(),
        });
    }
    // Active WITH the columns still present (a failed verify, or a crash before
    // the release) is NOT a no-op: re-entering the tiers is exactly what makes
    // retrying a mismatch meaningful instead of a dead end.

    // 4. kind=local: the directory was never touched, so there is nothing to
    // restore.
    if workspace.kind == WorkspaceKind::Local {
        service.store.mark_active(workspace_id, &now())?;
        return Ok(UnarchiveOutcome {
            record: service.store.require_workspace(workspace_id)?,
            notices: Vec::new(),
        });
    }

    let repo_root = service.repo_root_path(&workspace)?;
    let workspace_path = PathBuf::from(&workspace.path);

    // The TARGET PATH enters the in-flight map before any tier decides, so two
    // unarchives claiming one path serialize on the map rather than both passing
    // the no-directory check and racing to create a worktree at the same place.
    let Some(_inflight) = service
        .inflight
        .try_claim(workspace_id, &repo_root, &workspace_path)
    else {
        return Err(UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::PathOccupied,
            occupant_name: None,
            occupant_lifecycle: None,
            strategies: Vec::new(),
        }));
    };

    // 5. Resolve the three refs, then tier.
    let archive_refs = {
        let repo_root = repo_root.clone();
        let workspace_id = workspace_id.to_string();
        tokio::task::spawn_blocking(move || refs::resolve_archive_refs(&repo_root, &workspace_id))
            .await
            .map_err(|error| UnarchiveError::Failed(error.to_string()))??
    };
    let facts = tiers::gather_facts(service, &workspace, &repo_root).await?;
    let plan =
        tiers::decide(&workspace, archive_refs.as_ref(), &opts, &facts).inspect_err(|error| {
            // Ref loss is a crashed-purge signature, so it goes to Sentry even
            // though the request itself is a clean 409. The other three scenarios
            // are the dialog working as designed and stay unlogged.
            if let UnarchiveError::Scenario(payload) = error {
                if payload.scenario == UnarchiveScenario::SnapshotLost {
                    tracing::error!(
                        workspace_id = %workspace_id,
                        sentry_code = "UNARCHIVE_SNAPSHOT_LOST",
                        "the archive refs are gone but the row records a snapshot"
                    );
                }
            }
        })?;
    if matches!(
        plan,
        RestorePlan::BranchTip {
            never_snapshotted: false,
            ..
        }
    ) {
        tracing::error!(
            workspace_id = %workspace_id,
            sentry_code = "UNARCHIVE_SNAPSHOT_LOST",
            "restoring at the branch tip: the recorded snapshot is unrecoverable"
        );
    }

    let mut notices = partial_capture_notices(workspace.partial_capture_json.as_deref());
    let restored = execute(
        service,
        &workspace,
        &repo_root,
        &workspace_path,
        archive_refs.as_ref(),
        plan,
        &mut notices,
    )
    .await
    .inspect_err(|error| {
        if let UnarchiveError::Failed(detail) = error {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "UNARCHIVE_RESTORE_FAILED",
                error = %detail,
                "the restore failed; the retry converges"
            );
        }
    })?;

    if restored.history_incomplete_relevant
        && service
            .session_service
            .workspace_history_incomplete(workspace_id)
            .unwrap_or(false)
    {
        notices.push(UnarchiveNotice::HistoryIncomplete);
    }

    // The setup rerun is fire-and-return, never awaited: setup status streams
    // exactly as it does after workspace creation, and making the response wait
    // for a multi-minute install would defeat the point of answering at all.
    if opts.rerun_setup {
        spawn_setup_rerun(service.clone(), workspace_id.to_string(), opts.setup_script);
    }

    Ok(UnarchiveOutcome {
        record: service.store.require_workspace(workspace_id)?,
        notices,
    })
}

struct Restored {
    history_incomplete_relevant: bool,
}

async fn execute(
    service: &Arc<WorkspaceArchiveService>,
    workspace: &WorkspaceRecord,
    repo_root: &Path,
    workspace_path: &Path,
    archive_refs: Option<&ArchiveRefSet>,
    plan: RestorePlan,
    notices: &mut Vec<UnarchiveNotice>,
) -> Result<Restored, UnarchiveError> {
    match plan {
        RestorePlan::AdoptInPlace => {
            service.store.mark_active(&workspace.id, &now())?;
            Ok(Restored {
                history_incomplete_relevant: true,
            })
        }
        RestorePlan::AdoptIntactWithoutRefs => {
            // The files are already exactly what a restore would have written
            // (HEAD is at the archived SHA and the worktree is our own live
            // registration), so nothing is written and nothing is removed. It
            // is terminal for the snapshot, though, so the columns are released
            // — a surviving sha with no refs behind it manufactures a false
            // `snapshot_lost` on the NEXT unarchive of a healthy workspace.
            service.store.mark_active(&workspace.id, &now())?;
            service.store.release_archive_state(&workspace.id, &now())?;
            Ok(Restored {
                history_incomplete_relevant: true,
            })
        }
        RestorePlan::BranchTip {
            branch,
            never_snapshotted,
        } => {
            // A no-op for the never-snapshotted shape (adoption already took
            // every path-exists case) beyond pruning a stale registration. For an
            // ANSWERED `snapshot_lost` it clears the row's own recorded path,
            // which is covered by the explicitly destructive confirm the user
            // already gave.
            clear_target_path(repo_root, workspace_path).await?;
            add_worktree(repo_root, workspace_path, Some(&branch), false).await?;
            service.store.mark_active(&workspace.id, &now())?;
            service
                .store
                .update_current_branch(&workspace.id, Some(&branch), &now())?;
            // EVERY terminal restore that abandons the snapshot also releases.
            // Without this, the surviving sha later manufactures a false
            // `snapshot_lost` alarm on a perfectly healthy workspace.
            service.store.release_archive_state(&workspace.id, &now())?;
            if never_snapshotted {
                notices.push(UnarchiveNotice::NoSnapshot);
            }
            Ok(Restored {
                history_incomplete_relevant: true,
            })
        }
        RestorePlan::InPlace { branch } => {
            let refs = require_refs(archive_refs)?;
            apply_branch_plan_in_place(
                service,
                workspace,
                repo_root,
                workspace_path,
                &branch,
                refs,
            )
            .await?;
            restore_trees(workspace_path, refs).await?;
            finish_restore(service, workspace, repo_root, workspace_path, refs, notices).await?;
            Ok(Restored {
                history_incomplete_relevant: false,
            })
        }
        RestorePlan::ReclaimThenAdd { branch }
        | RestorePlan::OverwriteThenAdd { branch }
        | RestorePlan::FreshAdd { branch } => {
            let refs = require_refs(archive_refs)?;
            clear_target_path(repo_root, workspace_path).await?;
            let checkout_branch =
                materialize_branch(service, workspace, repo_root, &branch, refs).await?;
            add_worktree(repo_root, workspace_path, checkout_branch.as_deref(), true).await?;
            if checkout_branch.is_none() {
                let path = workspace_path.to_path_buf();
                let sha = refs.head_sha.clone();
                blocking(move || GitService::detach_head_at_sha(&path, &sha)).await??;
            }
            restore_trees(workspace_path, refs).await?;
            finish_restore(service, workspace, repo_root, workspace_path, refs, notices).await?;
            Ok(Restored {
                history_incomplete_relevant: false,
            })
        }
    }
}

/// `mark_active`, then the post-restore HEAD verify, then either the release or
/// the rescue.
async fn finish_restore(
    service: &Arc<WorkspaceArchiveService>,
    workspace: &WorkspaceRecord,
    repo_root: &Path,
    workspace_path: &Path,
    refs: &ArchiveRefSet,
    notices: &mut Vec<UnarchiveNotice>,
) -> Result<(), UnarchiveError> {
    service.store.mark_active(&workspace.id, &now())?;

    let verify_path = workspace_path.to_path_buf();
    let head = blocking(move || GitService::resolve_ref_oid(&verify_path, "HEAD"))
        .await?
        .unwrap_or_default();
    // The mismatch branch below is only reachable in production when something
    // moved HEAD under a restore that had already been decided against it — a
    // torn restore or a concurrent branch move. There is no way to stage that
    // race deterministically from a test, so the observed HEAD is the one value
    // the suite may substitute; everything downstream of it (the rescue copy,
    // the retained columns, the notice, the sweep's skip) is the real code.
    #[cfg(test)]
    let head = service
        .head_verify_override
        .lock()
        .expect("head verify override poisoned")
        .clone()
        .unwrap_or(head);
    if head == refs.head_sha {
        // The verify is the proof the snapshot is redundant. Columns first, then
        // refs — and without the release, a feature about disk permanently grows
        // disk.
        service.store.release_archive_state(&workspace.id, &now())?;
        let repo_root = repo_root.to_path_buf();
        let workspace_id = workspace.id.clone();
        blocking(move || refs::delete_for(&repo_root, &workspace_id)).await??;
        return Ok(());
    }

    // On a MISMATCH: four things and NO release. The retained columns are what arm
    // the retry — the next `/unarchive` re-enters the tiers and whatever moved
    // HEAD surfaces as an honest scenario 409 (typically diverged) instead of a
    // deterministic no-op "try again" loop.
    {
        let repo_root = repo_root.to_path_buf();
        let workspace_id = workspace.id.clone();
        let head_sha = refs.head_sha.clone();
        if let Err(error) =
            blocking(move || refs::copy_to_rescue(&repo_root, &workspace_id, &head_sha)).await?
        {
            tracing::error!(
                workspace_id = %workspace.id,
                error = %error,
                "the rescue copy of the archive refs failed"
            );
        }
    }
    tracing::error!(
        workspace_id = %workspace.id,
        expected_head = %refs.head_sha,
        observed_head = %head,
        sentry_code = "UNARCHIVE_HEAD_MISMATCH",
        "the post-restore HEAD verify failed; the snapshot is retained as evidence"
    );
    notices.push(UnarchiveNotice::HeadMismatch);
    Ok(())
}

/// The HEAD-only re-entry of the in-place tier: no checkout, no `reset --hard`.
async fn apply_branch_plan_in_place(
    service: &Arc<WorkspaceArchiveService>,
    workspace: &WorkspaceRecord,
    repo_root: &Path,
    workspace_path: &Path,
    branch: &BranchPlan,
    refs: &ArchiveRefSet,
) -> Result<(), UnarchiveError> {
    let branch_name = materialize_branch(service, workspace, repo_root, branch, refs).await?;
    let path = workspace_path.to_path_buf();
    let sha = refs.head_sha.clone();
    let target = branch_name.clone();
    blocking(move || match target {
        Some(name) => GitService::point_head_at_branch(&path, &name),
        None => GitService::detach_head_at_sha(&path, &sha),
    })
    .await??;
    service
        .store
        .update_current_branch(&workspace.id, branch_name.as_deref(), &now())?;
    Ok(())
}

/// Create the branch a plan needs, if any, and return the name HEAD should point
/// at (`None` = detached).
async fn materialize_branch(
    service: &Arc<WorkspaceArchiveService>,
    workspace: &WorkspaceRecord,
    repo_root: &Path,
    branch: &BranchPlan,
    refs: &ArchiveRefSet,
) -> Result<Option<String>, UnarchiveError> {
    match branch {
        BranchPlan::Detached => {
            service
                .store
                .update_current_branch(&workspace.id, None, &now())?;
            Ok(None)
        }
        BranchPlan::ExistingBranch(name) => Ok(Some(name.clone())),
        BranchPlan::RecreatedBranch(desired) => {
            let repo_root = repo_root.to_path_buf();
            let desired = desired.clone();
            let sha = refs.head_sha.clone();
            // Uniquified: `recreate_at_sha` means a NEW branch at the archived
            // SHA, never a force-move of the diverged branch, which keeps its
            // commits.
            let created = blocking(move || {
                GitService::create_branch_at_sha_uniquified(&repo_root, &desired, &sha)
            })
            .await??;
            Ok(Some(created))
        }
    }
}

/// Force-remove whatever sits at the target path so a fresh `worktree add` can
/// land. Registered debris goes through the git verb (which clears the
/// registration); an unregistered directory is removed outright, which is the one
/// rm-rf in this feature that may act outside the managed root — and it only ever
/// runs behind an explicit user confirm.
async fn clear_target_path(repo_root: &Path, workspace_path: &Path) -> Result<(), UnarchiveError> {
    let repo_root_string = repo_root.display().to_string();
    let path_string = workspace_path.display().to_string();
    let path = workspace_path.to_path_buf();
    blocking(move || {
        if let Err(error) = GitService::remove_worktree_force(&repo_root_string, &path_string) {
            tracing::info!(
                path = %path_string,
                detail = %error,
                "the target path is not a removable registration; clearing the directory directly"
            );
        }
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|error| anyhow::anyhow!("could not clear {}: {error}", path.display()))?;
        }
        Ok::<(), anyhow::Error>(())
    })
    .await??;
    Ok(())
}

async fn add_worktree(
    repo_root: &Path,
    workspace_path: &Path,
    branch: Option<&str>,
    no_checkout: bool,
) -> Result<(), UnarchiveError> {
    let repo_root = repo_root.to_path_buf();
    let target = workspace_path.to_path_buf();
    let branch = branch.map(str::to_string);
    blocking(move || {
        GitService::restore_worktree(
            &repo_root,
            &target,
            WorktreeRestoreOptions {
                branch: branch.as_deref(),
                no_checkout,
                // Prune only the TARGET PATH's own stale registration. A repo-global
                // prune from this unarchive can eat a sibling workspace's
                // mid-choreography registration.
                prune_target_registration: true,
            },
        )
    })
    .await?
    .map_err(|error| UnarchiveError::Failed(error.to_string()))?;
    Ok(())
}

async fn restore_trees(workspace_path: &Path, refs: &ArchiveRefSet) -> Result<(), UnarchiveError> {
    let path = workspace_path.to_path_buf();
    let work_tree = refs.work_tree.clone();
    let index_tree = refs.index_tree.clone();
    blocking(move || GitService::restore_trees(&path, &work_tree, &index_tree)).await??;
    Ok(())
}

fn require_refs(archive_refs: Option<&ArchiveRefSet>) -> Result<&ArchiveRefSet, UnarchiveError> {
    archive_refs.ok_or_else(|| {
        UnarchiveError::Failed("the archive refs vanished between tiering and restore".to_string())
    })
}

fn spawn_setup_rerun(
    service: Arc<WorkspaceArchiveService>,
    workspace_id: String,
    setup_script: Option<String>,
) {
    tokio::spawn(async move {
        let result = match setup_script {
            Some(command) if !command.trim().is_empty() => {
                service
                    .planes
                    .setup
                    .start_setup(StartWorkspaceSetupInput {
                        workspace_id: workspace_id.clone(),
                        command,
                        base_ref: None,
                    })
                    .await
            }
            _ => service.planes.setup.rerun_setup(workspace_id.clone()).await,
        };
        if let Err(error) = result {
            tracing::warn!(
                workspace_id = %workspace_id,
                error = %error,
                "the post-unarchive setup rerun could not start"
            );
        }
    });
}

async fn blocking<T, F>(work: F) -> Result<T, UnarchiveError>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| UnarchiveError::Failed(error.to_string()))
}
