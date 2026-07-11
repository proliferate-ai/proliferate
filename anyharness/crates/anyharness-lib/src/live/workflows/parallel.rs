//! Run worktree isolation (wave 2b) and per-lane worktree addressing (D-031c):
//! resolving/minting/adopting the per-run and per-lane git worktrees, and
//! crash-resume recovery of same. Lane merge-back at a clean parallel-group
//! join lives in [`super::merge`] (split out for line budget; same
//! orchestration cluster). Moved verbatim out of `executor.rs` (WS0B-R).

use std::path::Path;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{Isolation, NO_LANE};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceKind;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::origin::OriginContext;

use super::executor::{failed_msg, WorkflowStepExecutorImpl};

/// A worktree workspace record considered for run-scoped adoption: its id plus
/// the branch it is checked out on.
pub(super) type AdoptedWorktree = (String, Option<String>);

impl WorkflowStepExecutorImpl {
    /// The workspace every session / shell / emit of this run resolves to
    /// (wave 2b). Memoized and computed once:
    ///
    /// - [`Isolation::Workspace`]: the pinned `workspace_id`, unchanged.
    /// - [`Isolation::Worktree`]: mint a fresh per-run git worktree inside the
    ///   pinned checkout (once — all the run's slots share it) and return its
    ///   workspace id.
    ///
    /// A mint failure returns a structured `Failed` outcome; because every
    /// session-creating / workspace-using path calls this FIRST, a failed mint
    /// fails the run BEFORE any session is created in the shared checkout
    /// (deny-path: no silent fallback to the pinned workspace, which would
    /// defeat isolation). Holds the memo lock across the (async, `spawn_blocking`)
    /// mint so two slots can never race into two worktrees.
    pub(super) async fn effective_workspace_id(&self, scope: &str) -> Result<String, StepOutcome> {
        if scope == NO_LANE {
            return self.run_level_workspace_id().await;
        }
        // Per-lane worktree (D-031c). Under Workspace isolation everything still
        // shares the pinned checkout; under Worktree each lane mints its own.
        match self.isolation {
            Isolation::Workspace => Ok(self.workspace_id.clone()),
            Isolation::Worktree => {
                // M2(a): a lane worktree bases off the RUN-LEVEL worktree's HEAD,
                // not the pinned checkout — so any pre-group commit flows into
                // every lane. Ensure the run-level worktree exists first (mint it
                // lazily if no pre-group step already did).
                let run_level_id = self.run_level_workspace_id().await?;
                let base_workspace_id =
                    worktree_base_workspace_id(scope, &self.workspace_id, &run_level_id).to_string();
                let mut guard = self.lane_workspaces.lock().await;
                if let Some(id) = guard.get(scope) {
                    return Ok(id.clone());
                }
                let id = self.mint_worktree_for_scope(scope, base_workspace_id).await?;
                guard.insert(scope.to_string(), id.clone());
                Ok(id)
            }
        }
    }

    /// The run-level worktree ([`NO_LANE`], scope `-`): flat / out-of-group /
    /// post-group steps resolve here, and every lane worktree bases off it (M2).
    /// Byte-identical to wave 2b — same memo, same mint, same branch/path. Under
    /// `Worktree` isolation it bases off the pinned checkout's HEAD.
    pub(super) async fn run_level_workspace_id(&self) -> Result<String, StepOutcome> {
        let pinned = self.workspace_id.clone();
        resolve_effective_workspace(
            self.isolation,
            &self.workspace_id,
            &self.effective_workspace,
            || self.mint_worktree_for_scope(NO_LANE, pinned),
        )
        .await
    }

    /// Mint (or ADOPT) the worktree for a given scope and return its workspace
    /// id. Scope [`NO_LANE`] is the run-level worktree (wave 2b); a lane name is
    /// a per-lane worktree (D-031c).
    ///
    /// The blocking git (`std::process::Command`) + synchronous DB work runs on a
    /// `spawn_blocking` pool thread, never on the async executor worker (matching
    /// every other `create_worktree` consumer in this crate); the memo lock is an
    /// async [`tokio::sync::Mutex`] held across this await, so no `std` guard is
    /// pinned across `.await`.
    pub(super) async fn mint_worktree_for_scope(
        &self,
        scope: &str,
        base_workspace_id: String,
    ) -> Result<String, StepOutcome> {
        let workspace_runtime = self.deps.workspace_runtime.clone();
        let pinned_workspace_id = self.workspace_id.clone();
        let run_id = self.run_id.clone();
        let scope = scope.to_string();
        tokio::task::spawn_blocking(move || {
            mint_or_adopt_run_worktree_blocking(
                &workspace_runtime,
                &pinned_workspace_id,
                &base_workspace_id,
                &run_id,
                &scope,
            )
        })
        .await
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("worktree mint task failed: {error}"),
            )
        })?
    }

    /// Blocking lookup of the run's own worktree record for crash-resume
    /// adoption: load the pinned checkout, derive this run's deterministic
    /// worktree path, and return the active worktree workspace record there (id +
    /// its checked-out branch) if one exists. Returns `None` (never an error that
    /// would fail resume) when there's simply nothing to adopt; the run-scoped
    /// branch gate is applied by [`adoptable_run_worktree`] in the caller.
    pub(super) fn lookup_run_worktree_for_resume(
        &self,
        scope: &str,
    ) -> Result<Option<AdoptedWorktree>, StepOutcome> {
        let pinned = self
            .deps
            .workspace_runtime
            .get_workspace(&self.workspace_id)
            .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?;
        let Some(pinned) = pinned else {
            return Ok(None);
        };
        let Some(target_path) = worktree_target_path_for_scope(&pinned.path, &self.run_id, scope)
        else {
            return Ok(None);
        };
        Ok(lookup_run_worktree_record(&self.deps.workspace_runtime, &target_path)?)
    }
}

/// The memoized effective-workspace resolution, decoupled from live deps so the
/// dispatch + memoization + mint-error propagation can be driven directly by
/// tests. Under `Workspace` isolation the pinned `workspace_id` is returned and
/// `mint` is NEVER called; under `Worktree` isolation `mint` is called AT MOST
/// once (the result is memoized), so every slot/shell of the run shares one
/// worktree and a mint failure propagates before any session is created.
///
/// The memo is a [`tokio::sync::Mutex`] held across the (async, `spawn_blocking`)
/// mint await: an async-aware lock is required so we never pin a `std` guard
/// across `.await` (which would block the runtime worker). Only one actor drives
/// a run, so holding the memo across the await is both correct and the simplest
/// way to keep "mint once, no session in the shared checkout" intact.
pub(super) async fn resolve_effective_workspace<F, Fut>(
    isolation: Isolation,
    workspace_id: &str,
    memo: &tokio::sync::Mutex<Option<String>>,
    mint: F,
) -> Result<String, StepOutcome>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<String, StepOutcome>>,
{
    let mut guard = memo.lock().await;
    if let Some(id) = guard.as_ref() {
        return Ok(id.clone());
    }
    let resolved = match isolation {
        Isolation::Workspace => workspace_id.to_string(),
        Isolation::Worktree => mint().await?,
    };
    *guard = Some(resolved.clone());
    Ok(resolved)
}

/// The run-scoped adoption gate (wave 2b crash-recovery hardening, finding 1): a
/// worktree record `found` at the run's DETERMINISTIC path is adopted ONLY when
/// it is the run's OWN worktree — its branch is exactly `expected_branch`
/// (`workflow-run/<run_id>`). A record at that path on any OTHER branch is a
/// foreign squatter and must NOT be adopted (the caller falls through to an
/// honest mint, which then conflicts on the occupied path). This is never a
/// general conflict-tolerant adopt — only the run's own run-scoped identifiers.
pub(super) fn adoptable_run_worktree(
    found: Option<AdoptedWorktree>,
    expected_branch: &str,
) -> Option<String> {
    match found {
        Some((id, Some(branch))) if branch == expected_branch => Some(id),
        _ => None,
    }
}

/// Mint OR adopt the run's git worktree, returning its workspace id. Runs the
/// blocking git (`std::process::Command`) + synchronous DB work; the caller
/// wraps it in `spawn_blocking`.
///
/// Adoption (finding 1): a prior executor may have already minted this run's
/// worktree AND its workspace record before crashing — e.g. a `shell.run` /
/// `scm.open_pr` prefix that persisted NO session to recover from. Re-minting
/// would hit the deterministic branch/path under the `Fail` conflict policy and
/// strand the completed work, failing the run terminally on every retry. So if a
/// workspace RECORD already exists at this run's OWN deterministic path+branch,
/// adopt it (return its id). Run-scoped only. A git worktree on disk with NO
/// record (half-created) is NOT adopted: we fall through to the mint, which
/// fails honestly on the occupied path — never adopt untracked state.
fn mint_or_adopt_run_worktree_blocking(
    workspace_runtime: &WorkspaceRuntime,
    pinned_workspace_id: &str,
    base_workspace_id: &str,
    run_id: &str,
    scope: &str,
) -> Result<String, StepOutcome> {
    let pinned = workspace_runtime
        .get_workspace(pinned_workspace_id)
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("could not load pinned workspace: {error}"),
            )
        })?
        .ok_or_else(|| {
            failed_msg(
                "worktree_mint_failed",
                format!("pinned workspace {pinned_workspace_id} not found"),
            )
        })?;
    let target_path =
        worktree_target_path_for_scope(&pinned.path, run_id, scope).ok_or_else(|| {
            failed_msg(
                "worktree_mint_failed",
                format!("could not derive a worktree path from {}", pinned.path),
            )
        })?;
    let branch_name = worktree_branch_for_scope(run_id, scope);

    // Crash-recovery adoption: return the run's own already-minted worktree if a
    // record for it exists (run-scoped by path + branch).
    if let Some(id) = lookup_run_worktree_record(workspace_runtime, &target_path)?
        .and_then(|found| adoptable_run_worktree(Some(found), &branch_name))
    {
        tracing::info!(
            run_id = %run_id,
            worktree_workspace_id = %id,
            branch = %branch_name,
            "workflow run adopted its existing per-run worktree (isolation=worktree, crash-recovery)"
        );
        return Ok(id);
    }

    // Base the worktree on the BASE workspace's CURRENT HEAD (exact commit), so
    // isolation is faithful even when the base is itself a branch/worktree. For
    // the run-level worktree the base IS the pinned checkout (wave 2b, unchanged);
    // for a parallel lane the base is the RUN-LEVEL worktree (M2a), so any
    // pre-group commit flows into every lane. Falls back to the source repo's HEAD
    // when the SHA can't be read (base_branch=None → git's default HEAD).
    let base_path = if base_workspace_id == pinned_workspace_id {
        pinned.path.clone()
    } else {
        workspace_runtime
            .get_workspace(base_workspace_id)
            .map_err(|error| {
                failed_msg(
                    "worktree_mint_failed",
                    format!("could not load base workspace: {error}"),
                )
            })?
            .ok_or_else(|| {
                failed_msg(
                    "worktree_mint_failed",
                    format!("base workspace {base_workspace_id} not found"),
                )
            })?
            .path
    };
    let base_ref = run_worktree_base_ref(&base_path);
    // Finding 3: tag the worktree with the run as its creator (there is no
    // free-form origin/label on `OriginContext`, but `WorkspaceCreatorContext`
    // carries `automationRunId` + `label`), so a future retention reaper can
    // distinguish and prune orphaned workflow-run worktrees. The deterministic
    // `wf-run-*` path / `workflow-run/*` branch prefixes are the other key such a
    // reaper can match on. Automatic pruning is a follow-up (no retention rule
    // invented here).
    let creator_context = WorkspaceCreatorContext::Automation {
        automation_id: None,
        automation_run_id: Some(run_id.to_string()),
        label: Some("workflow-run".to_string()),
    };
    let result = workspace_runtime
        .create_worktree_with_surface(
            &pinned.repo_root_id,
            &target_path,
            &branch_name,
            base_ref.as_deref(),
            None,
            "standard",
            WorktreeNameConflictPolicy::Fail,
            OriginContext::api_local_runtime(),
            Some(creator_context),
        )
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("git worktree add failed: {error}"),
            )
        })?;
    tracing::info!(
        run_id = %run_id,
        pinned_workspace_id = %pinned_workspace_id,
        worktree_workspace_id = %result.workspace.id,
        worktree_path = %result.workspace.path,
        branch = %branch_name,
        "workflow run minted a per-run worktree (isolation=worktree)"
    );
    Ok(result.workspace.id)
}

/// Look up the active worktree workspace record at the run's deterministic
/// `target_path` (id + its checked-out branch), for run-scoped adoption. The
/// stored record path is the CANONICALIZED worktree path, so we canonicalize our
/// deterministic target the same way when it exists on disk (a fresh run's path
/// won't exist → raw path → no match → the caller mints). The run-scoped branch
/// gate is applied by [`adoptable_run_worktree`] in the caller.
fn lookup_run_worktree_record(
    workspace_runtime: &WorkspaceRuntime,
    target_path: &str,
) -> Result<Option<AdoptedWorktree>, StepOutcome> {
    let lookup_path = std::fs::canonicalize(target_path)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| target_path.to_string());
    let found = workspace_runtime
        .find_active_workspace_by_path_and_kind(&lookup_path, WorkspaceKind::Worktree)
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("worktree adoption lookup failed: {error}"),
            )
        })?
        .map(|record| (record.id, record.current_branch));
    Ok(found)
}

/// Crash-resume recovery of the run's effective worktree (finding 1, belt-and-
/// suspenders in `hydrate_from_run`), decoupled from live deps so it can be
/// driven directly by tests. A persisted session already living in the worktree
/// wins (`session_recovered`, its workspace IS the effective one); otherwise —
/// the session-less crash hole — ADOPT the run's own worktree record if one
/// exists (run-scoped by `expected_branch`). `None` when there's nothing to adopt
/// yet (the first step will mint).
pub(super) async fn recover_resume_worktree<L, LFut>(
    session_recovered: Option<String>,
    expected_branch: &str,
    lookup: L,
) -> Result<Option<String>, StepOutcome>
where
    L: FnOnce() -> LFut,
    LFut: std::future::Future<Output = Result<Option<AdoptedWorktree>, StepOutcome>>,
{
    if let Some(workspace_id) = session_recovered {
        return Ok(Some(workspace_id));
    }
    Ok(adoptable_run_worktree(lookup().await?, expected_branch))
}

/// Sanitize a run id into a path/branch-safe token (alphanumerics, `-`, `_`
/// kept; everything else → `-`). Run ids are already uuid/`run-…`-shaped, so
/// this is a belt-and-braces guard, not a real transform.
fn sanitize_run_token(run_id: &str) -> String {
    run_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// The run-scoped branch name for a per-run worktree: `workflow-run/<run_id>`.
/// Run-scoped so two runs on the same pinned workspace get distinct branches
/// (no collision).
pub(super) fn run_worktree_branch_name(run_id: &str) -> String {
    format!("workflow-run/{}", sanitize_run_token(run_id))
}

/// The run-scoped worktree checkout path: a sibling of the pinned checkout named
/// `wf-run-<run_id>`. Run-scoped so two runs get distinct paths. `None` when the
/// pinned path has no parent (a filesystem root — never a real checkout).
pub(super) fn run_worktree_target_path(pinned_path: &str, run_id: &str) -> Option<String> {
    Path::new(pinned_path)
        .parent()
        .map(|parent| {
            parent
                .join(format!("wf-run-{}", sanitize_run_token(run_id)))
                .to_string_lossy()
                .to_string()
        })
}

/// The branch name for a worktree SCOPE (D-031c): the run-level worktree
/// ([`NO_LANE`]) is `workflow-run/<run_id>` (byte-identical to wave 2b); a
/// parallel lane is `workflow-run/<run_id>/<lane>`, so sibling lanes never
/// collide on a branch.
pub(super) fn worktree_branch_for_scope(run_id: &str, scope: &str) -> String {
    if scope == NO_LANE {
        run_worktree_branch_name(run_id)
    } else {
        format!(
            "workflow-run/{}/{}",
            sanitize_run_token(run_id),
            sanitize_run_token(scope)
        )
    }
}

/// The checkout path for a worktree SCOPE (D-031c): the run-level worktree is
/// `wf-run-<run_id>` (unchanged); a parallel lane is `wf-run-<run_id>-<lane>`,
/// so sibling lanes never collide on a path. `None` when the pinned path has no
/// parent.
pub(super) fn worktree_target_path_for_scope(
    pinned_path: &str,
    run_id: &str,
    scope: &str,
) -> Option<String> {
    if scope == NO_LANE {
        return run_worktree_target_path(pinned_path, run_id);
    }
    Path::new(pinned_path).parent().map(|parent| {
        parent
            .join(format!(
                "wf-run-{}-{}",
                sanitize_run_token(run_id),
                sanitize_run_token(scope)
            ))
            .to_string_lossy()
            .to_string()
    })
}

/// The pinned checkout's current HEAD commit SHA, used as the exact base for the
/// per-run worktree ("off the checkout's current HEAD"). `None` when it can't be
/// read, in which case the caller lets git default to the source repo's HEAD.
pub(super) fn run_worktree_base_ref(pinned_path: &str) -> Option<String> {
    crate::adapters::git::operations::worktrees::stdout_result(
        Path::new(pinned_path),
        &["rev-parse", "HEAD"],
    )
    .ok()
    .filter(|sha| !sha.is_empty())
}

/// Which workspace a scope's worktree bases off at mint time (M2a), pure so the
/// "a lane bases off the run-level worktree, not the pinned checkout" contract is
/// unit-testable: the run-level worktree ([`NO_LANE`]) bases off the pinned
/// checkout (wave 2b, unchanged); a parallel lane bases off the RUN-LEVEL
/// worktree, so any pre-group commit flows into every lane.
pub(super) fn worktree_base_workspace_id<'a>(
    scope: &str,
    pinned_workspace_id: &'a str,
    run_level_workspace_id: &'a str,
) -> &'a str {
    if scope == NO_LANE {
        pinned_workspace_id
    } else {
        run_level_workspace_id
    }
}
