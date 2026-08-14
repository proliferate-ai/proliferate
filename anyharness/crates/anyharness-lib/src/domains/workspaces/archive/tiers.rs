//! Unarchive's scenario tiering: which of the restore shapes this row is in, or
//! which decision only the user can make.
//!
//! One structural ruling underpins all of it: **a workspace's path is stable for
//! its lifetime**. Native chat resume keys on the absolute worktree path, so
//! relocating a workspace to a sibling directory would silently break
//! model-memory resume for every session in it. That is why an occupied path is
//! a decision rather than a shrug.
//!
//! The evaluation ORDER is the safety property, and each slot has a reason:
//!
//! 1. **Adoption first**, so a sha-NULL row — whose surviving directory may hold
//!    the only copy of never-snapshotted work — can never reach destructive
//!    handling.
//! 2. **The other-row claim gate second**, before any tier that reads the
//!    directory. "Git-registered with a resolvable HEAD" is true of ANOTHER row's
//!    live worktree too (nothing in git ties a registration to a workspace row),
//!    so an intact tier evaluated first would restore A's snapshot over B's live
//!    work.
//! 3. **The intact-own-worktree tier third, HEAD-gated against the ROW's
//!    `archived_head_sha`** — deliberately BEFORE the refs check. An intact
//!    worktree already sitting at the archived SHA is the shape where the files
//!    on disk are already exactly right, and letting the refs check win would
//!    send a refs-missing version of it into `snapshot_lost`, whose only
//!    strategy clears the directory. Nothing may route live uncommitted work
//!    into an rm-rf on the strength of a missing ref.
//! 4. **The refs check fourth**, because every tier below it restores FROM the
//!    refs. Refs missing with an intact worktree is adoption in place; refs
//!    missing otherwise is the two shapes in [`decide_without_refs`].
//! 5. Own-debris reclaim, then the branch tiers, then the unclaimed-directory
//!    check immediately before the `worktree add`.
//!
//! One rule rides the order: the reclaim and overwrite re-entries re-run the
//! branch tiers before touching anything, because restore assumes HEAD is
//! already right and nothing destructive may proceed past an unchecked diverged
//! branch.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::adapters::git::service::GitService;
use crate::adapters::git::types::WorktreeRegistration;
use crate::domains::workspaces::managed_root::is_managed_worktree_path;
use crate::domains::workspaces::model::{WorkspaceLifecycleState, WorkspaceRecord};
use crate::domains::workspaces::path_identity::same_path_strict;

use super::refs::ArchiveRefSet;
use super::types::{
    BranchStrategy, OccupantLifecycle, UnarchiveError, UnarchiveOptions, UnarchiveScenario,
    UnarchiveScenarioPayload, UnarchiveStrategy,
};
use super::WorkspaceArchiveService;

/// What HEAD should point at once the trees are restored. Applied HEAD-ONLY on
/// the in-place tier: no checkout and no `reset --hard`, either of which would
/// rewrite files the tree restore owns and destroy the ignored heavy state that
/// restoring in place exists to preserve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum BranchPlan {
    /// Detached at the archived SHA. Either the row was archived detached
    /// (`archived_branch` NULL, the marker) or the user chose it.
    Detached,
    /// The recorded branch is still exactly at the archived SHA.
    ExistingBranch(String),
    /// Create a NEW branch at the archived SHA, uniquified on collision. Never a
    /// force-move of the recorded branch, which keeps its commits.
    RecreatedBranch(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RestorePlan {
    /// A sha-NULL row whose directory survives: mark it active and touch
    /// nothing. Strictly richer than any branch-tip checkout.
    AdoptInPlace,
    /// Our own intact worktree at the recorded path with HEAD already at the
    /// archived SHA, but the refs are GONE. The files are already exactly what
    /// a restore would have written, so this adopts them and releases the
    /// archive columns — a terminal restore that abandons the snapshot, like
    /// [`Self::BranchTip`]. The alternative would be a `snapshot_lost` 409
    /// whose only strategy clears a directory holding live uncommitted work.
    AdoptIntactWithoutRefs,
    /// Our own intact worktree at the recorded path: restore in place, no
    /// removal and no `worktree add`, so the ignored heavy state survives.
    InPlace { branch: BranchPlan },
    /// Our own debris at the recorded path: force-remove, then a fresh add.
    ReclaimThenAdd { branch: BranchPlan },
    /// Nothing at the path.
    FreshAdd { branch: BranchPlan },
    /// A foreign directory the user explicitly confirmed overwriting — the one
    /// rm-rf in this feature that may act outside the managed root.
    OverwriteThenAdd { branch: BranchPlan },
    /// No snapshot to restore from: a plain checkout at a branch tip. Terminal
    /// for the snapshot, so the row's archive columns are released after it.
    BranchTip {
        branch: String,
        /// Whether the row never had a snapshot (a notice) as opposed to having
        /// lost one (an answered `snapshot_lost` 409).
        never_snapshotted: bool,
    },
}

/// The filesystem and git facts the tiers read, gathered in ONE blocking pass so
/// the decision below is pure and testable, and so the tiers cannot accidentally
/// re-read a moving target halfway through.
pub(super) struct TierFacts {
    pub(super) registrations: Vec<WorktreeRegistration>,
    pub(super) head_sha_at_path: Option<String>,
    pub(super) path_exists: bool,
    pub(super) path_is_managed: bool,
    pub(super) archived_branch_tip: Option<String>,
    pub(super) default_branch: Option<String>,
    /// Claimants of this row's path (active rows, or sha-NULL archived rows),
    /// paired with whether the claim is LIVE.
    pub(super) claims: Vec<(WorkspaceRecord, bool)>,
}

pub(super) async fn gather_facts(
    service: &Arc<WorkspaceArchiveService>,
    workspace: &WorkspaceRecord,
    repo_root: &Path,
) -> anyhow::Result<TierFacts> {
    let claimants = service.store.other_rows_claiming_path(workspace)?;
    let repo_root = repo_root.to_path_buf();
    let workspace_path = PathBuf::from(&workspace.path);
    let archived_branch = workspace.archived_branch.clone();
    let runtime_home = service.runtime_home.clone();
    tokio::task::spawn_blocking(move || {
        let registrations = GitService::list_worktree_registrations(&repo_root).unwrap_or_default();
        let path_exists = workspace_path.exists();
        let head_sha_at_path = if path_exists {
            GitService::resolve_ref_oid(&workspace_path, "HEAD").ok()
        } else {
            None
        };
        let path_is_managed =
            is_managed_worktree_path(&runtime_home, &workspace_path).unwrap_or(false);
        let archived_branch_tip = archived_branch
            .as_deref()
            .and_then(|branch| GitService::branch_tip_sha(&repo_root, branch).ok())
            .flatten();
        let default_branch = GitService::detect_default_branch(&repo_root);
        let claims = claimants
            .into_iter()
            .map(|claimant| {
                // The claim is live when the claimant is active, or when a
                // sha-NULL claimant's directory actually exists at the path. An
                // ARCHIVED claimant with NO directory is not an obstruction:
                // nothing exists to overwrite, so the restore proceeds and takes
                // the path. That liveness gate is what keeps "first unarchiver
                // wins" satisfiable at all.
                let live = claimant.lifecycle_state == WorkspaceLifecycleState::Active
                    || Path::new(&claimant.path).exists();
                (claimant, live)
            })
            .collect();
        Ok(TierFacts {
            registrations,
            head_sha_at_path,
            path_exists,
            path_is_managed,
            archived_branch_tip,
            default_branch,
            claims,
        })
    })
    .await?
}

/// The pure decision. `refs` is `None` when the archive refs are gone.
pub(super) fn decide(
    workspace: &WorkspaceRecord,
    refs: Option<&ArchiveRefSet>,
    opts: &UnarchiveOptions,
    facts: &TierFacts,
) -> Result<RestorePlan, UnarchiveError> {
    // ── 1. Adoption ──
    // An absorbed pre-archiving row whose retire crashed before removal: the
    // directory may hold the only copy of never-snapshotted work, so it is
    // adopted exactly as-is, with no prompt and no cleanup.
    if workspace.archived_head_sha.is_none() && facts.path_exists {
        return Ok(RestorePlan::AdoptInPlace);
    }

    // ── 2. The other-row claim gate ──
    if let Some((occupant, _)) = facts.claims.iter().find(|(_, live)| *live) {
        // No overwrite offer, whatever the client sent: an occupying row may hold
        // unsnapshotted work, and force-removing it under THIS workspace's lease
        // — with no quiesce of it and no snapshot of it — would be retire's loss
        // profile reintroduced through a dialog, leaving the occupant permanently
        // unrestorable under the stable-path rule.
        return Err(UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::PathOccupied,
            occupant_name: Some(occupant_label(occupant)),
            occupant_lifecycle: Some(match occupant.lifecycle_state {
                WorkspaceLifecycleState::Active => OccupantLifecycle::Active,
                WorkspaceLifecycleState::Archived => OccupantLifecycle::Archived,
            }),
            strategies: Vec::new(),
        }));
    }

    // ── 3. The intact-own-worktree tier, HEAD-gated ──
    //
    // Gated on the ROW's `archived_head_sha`, not on the refs, and evaluated
    // BEFORE the refs check: an intact worktree already at the archived SHA is
    // the one shape whose files need nothing written to them, so a missing ref
    // must never turn it into `snapshot_lost` — that scenario's only strategy
    // clears the target path, and the work standing in it is live.
    //
    // The HEAD gate itself is load-bearing: with HEAD moved past the archived
    // SHA an in-place restore writes the right files but reads as one giant
    // staged reversion against the wrong base. So a failed gate falls THROUGH
    // to the tiers below instead of restoring.
    //
    // `same_path_strict`, not `same_path`: a `true` answer here says "this
    // registration is OURS", which is what admits the reclaim below. An
    // unresolvable comparison must not hand us somebody else's worktree.
    let own_registration = facts
        .registrations
        .iter()
        .find(|registration| same_path_strict(&registration.path, Path::new(&workspace.path)));
    let intact = workspace.archived_head_sha.is_some()
        && own_registration.is_some_and(|registration| !registration.prunable)
        && facts.head_sha_at_path == workspace.archived_head_sha;

    // ── 4. The refs check ──
    let Some(refs) = refs else {
        if intact {
            return Ok(RestorePlan::AdoptIntactWithoutRefs);
        }
        return decide_without_refs(workspace, opts, facts);
    };
    let archived_sha = refs.head_sha.clone();

    if intact {
        // Re-run the branch tiers against the existing checkout: an archive
        // script may have committed, and divergence must still 409.
        let branch = decide_branch(workspace, &archived_sha, opts, facts)?;
        return Ok(RestorePlan::InPlace { branch });
    }

    // ── 5. Own-debris reclaim ──
    //
    // An occupant at the row's recorded path, inside the managed root, that no
    // other row claims and the intact tier did not take — git-registered or not,
    // including a dead registration whose directory is already gone (`worktree
    // list` reports those prunable, and they are debris to prune surgically,
    // never a claim; that case is exactly `own_registration.is_some()` with the
    // intact tier already passed, so it needs no disjunct of its own).
    if (facts.path_exists && facts.path_is_managed) || own_registration.is_some() {
        let branch = decide_branch(workspace, &archived_sha, opts, facts)?;
        return Ok(RestorePlan::ReclaimThenAdd { branch });
    }

    // ── 6. The branch tiers ──
    let branch = decide_branch(workspace, &archived_sha, opts, facts)?;

    // ── 7. The unclaimed-directory check, immediately before the add ──
    if facts.path_exists {
        if opts.overwrite {
            return Ok(RestorePlan::OverwriteThenAdd { branch });
        }
        return Err(UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::PathOccupied,
            occupant_name: None,
            occupant_lifecycle: None,
            strategies: vec![UnarchiveStrategy::Overwrite],
        }));
    }
    Ok(RestorePlan::FreshAdd { branch })
}

/// The two refs-missing shapes. They are genuinely different: a sha-NULL row
/// never had a snapshot and is auto-resolved, while a sha-BEARING row has LOST
/// one, which is never a benign case.
fn decide_without_refs(
    workspace: &WorkspaceRecord,
    opts: &UnarchiveOptions,
    facts: &TierFacts,
) -> Result<RestorePlan, UnarchiveError> {
    let branch = workspace
        .archived_branch
        .clone()
        .filter(|_| facts.archived_branch_tip.is_some())
        .or_else(|| facts.default_branch.clone())
        .ok_or_else(|| {
            UnarchiveError::Failed(
                "no branch is available to restore this workspace at".to_string(),
            )
        })?;
    if workspace.archived_head_sha.is_none() {
        return Ok(RestorePlan::BranchTip {
            branch,
            never_snapshotted: true,
        });
    }
    if opts.branch_strategy == Some(BranchStrategy::RestoreBranchTip) {
        return Ok(RestorePlan::BranchTip {
            branch,
            never_snapshotted: false,
        });
    }
    Err(UnarchiveError::Scenario(UnarchiveScenarioPayload {
        scenario: UnarchiveScenario::SnapshotLost,
        occupant_name: None,
        occupant_lifecycle: None,
        strategies: vec![UnarchiveStrategy::RestoreBranchTip],
    }))
}

/// All scenario comparisons use `archived_branch` — the name HEAD actually held
/// at snapshot time — never the possibly-stale `original_branch` or
/// `current_branch` columns.
fn decide_branch(
    workspace: &WorkspaceRecord,
    archived_sha: &str,
    opts: &UnarchiveOptions,
    facts: &TierFacts,
) -> Result<BranchPlan, UnarchiveError> {
    // Detached at archive: `archived_branch` NULL with a sha present is the
    // marker, and the branch scenarios are skipped entirely.
    let Some(archived_branch) = workspace.archived_branch.as_deref() else {
        return Ok(BranchPlan::Detached);
    };
    match opts.branch_strategy {
        Some(BranchStrategy::RestoreDetached) => return Ok(BranchPlan::Detached),
        Some(BranchStrategy::RecreateAtSha) => {
            return Ok(BranchPlan::RecreatedBranch(archived_branch.to_string()))
        }
        _ => {}
    }
    let Some(tip) = facts.archived_branch_tip.as_deref() else {
        // Branch missing: auto-resolved, no prompt. Recreating it at the archived
        // SHA restores exactly the name the snapshot was taken on.
        return Ok(BranchPlan::RecreatedBranch(archived_branch.to_string()));
    };
    if tip != archived_sha {
        return Err(UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::BranchDiverged,
            occupant_name: None,
            occupant_lifecycle: None,
            strategies: vec![
                UnarchiveStrategy::RecreateAtSha,
                UnarchiveStrategy::RestoreDetached,
            ],
        }));
    }
    // The in-use check IGNORES any registration carrying a prunable line or
    // sitting at this workspace's own recorded path: the first is debris to prune,
    // the second is us. `same_path_strict` for the same reason as above — an
    // unresolvable comparison that read as "us" would suppress the 409 and
    // restore onto a branch genuinely checked out somewhere else.
    let checked_out_elsewhere = facts.registrations.iter().any(|registration| {
        !registration.prunable
            && registration.branch.as_deref() == Some(archived_branch)
            && !same_path_strict(&registration.path, Path::new(&workspace.path))
    });
    if checked_out_elsewhere {
        return Err(UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::CheckedOutElsewhere,
            occupant_name: None,
            occupant_lifecycle: None,
            // Recreating would be legal here too, but the branch is genuinely in
            // use somewhere; detached is the answer that cannot surprise the
            // other worktree.
            strategies: vec![UnarchiveStrategy::RestoreDetached],
        }));
    }
    Ok(BranchPlan::ExistingBranch(archived_branch.to_string()))
}

fn occupant_label(occupant: &WorkspaceRecord) -> String {
    occupant
        .display_name
        .clone()
        .unwrap_or_else(|| occupant.id.clone())
}
