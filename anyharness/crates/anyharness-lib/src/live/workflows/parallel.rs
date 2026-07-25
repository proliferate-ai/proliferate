//! Run worktree isolation (wave 2b) and per-lane worktree addressing (D-031c):
//! resolving/minting/adopting the per-run and per-lane git worktrees, and
//! crash-resume recovery of same. Lane merge-back at a clean parallel-group
//! join lives in [`super::merge`] (split out for line budget; same
//! orchestration cluster). Moved verbatim out of `executor.rs` (WS0B-R).

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::domains::workflows::cleanup::{
    WorkflowMaterializationBegin, WorkflowMaterializationIntent,
};
use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{Isolation, NO_LANE};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::origin::OriginContext;
use crate::process_env::complete_workflow_operation_env;

use super::executor::{failed_msg, WorkflowStepExecutorImpl};
use super::isolation::{
    cleanup_workflow_materialization, inspect_workflow_worktree, materialize_workflow_worktree,
    WorkflowProcessIdentity, WorkflowWorktreeInspectionRequest,
    WorkflowWorktreeMaterializationRequest,
};
use super::worktree_validation::validate_recovered_worktree_metadata;

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
                    worktree_base_workspace_id(scope, &self.workspace_id, &run_level_id)
                        .to_string();
                let mut guard = self.lane_workspaces.lock().await;
                if let Some(id) = guard.get(scope) {
                    return Ok(id.clone());
                }
                let id = self
                    .mint_worktree_for_scope(scope, base_workspace_id)
                    .await?;
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
    /// Materialization is a typed broker operation. Phase A has no platform
    /// adapter, so this fails closed rather than falling back to the runtime
    /// principal's `git worktree` implementation.
    pub(super) async fn mint_worktree_for_scope(
        &self,
        scope: &str,
        base_workspace_id: String,
    ) -> Result<String, StepOutcome> {
        mint_or_adopt_run_worktree(
            self,
            &self.workspace_id,
            &base_workspace_id,
            &self.run_id,
            scope,
        )
        .await
    }

    /// Exact operation-registration lookup for crash-resume adoption. The
    /// generation-bound receipt selects the workspace; broker inspection and
    /// the final branch guard then revalidate its live checkout. Returns `None`
    /// when this operation has no durable registration to adopt.
    pub(super) async fn lookup_run_worktree_for_resume(
        &self,
        scope: &str,
    ) -> Result<Option<AdoptedWorktree>, StepOutcome> {
        let pinned = self
            .deps
            .workspace_runtime
            .get_workspace(&self.workspace_id)
            .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?;
        let Some(_pinned) = pinned else {
            return Ok(None);
        };
        let Some(registration) = self
            .deps
            .workflow_service
            .registered_materialization_for_identity(
                &self.run_id,
                scope,
                self.isolation_capability.identity().execution_generation(),
                self.isolation_capability.broker_generation(),
            )
            .map_err(|error| {
                failed_msg(
                    "worktree_resume_lookup_failed",
                    format!("could not load exact materialization registration: {error}"),
                )
            })?
        else {
            return Ok(None);
        };
        let workspace_id = registration.workspace_id.ok_or_else(|| {
            failed_msg(
                "worktree_resume_lookup_failed",
                "registered materialization lost its workspace id",
            )
        })?;
        let record = self
            .inspect_existing_worktree_for_scope(scope, &workspace_id)
            .await?;
        Ok(Some((record.id, record.current_branch)))
    }

    pub(super) async fn inspect_existing_worktree_for_scope(
        &self,
        scope: &str,
        workspace_id: &str,
    ) -> Result<crate::domains::workspaces::model::WorkspaceRecord, StepOutcome> {
        let pinned = self
            .deps
            .workspace_runtime
            .get_workspace(&self.workspace_id)
            .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?
            .ok_or_else(|| {
                failed_msg(
                    "worktree_resume_lookup_failed",
                    "pinned workspace missing during broker revalidation",
                )
            })?;
        let expected_path = worktree_target_path_for_scope(&pinned.path, &self.run_id, scope)
            .ok_or_else(|| {
                failed_msg(
                    "worktree_resume_lookup_failed",
                    "could not derive expected workflow worktree path",
                )
            })?;
        let expected_branch = worktree_branch_for_scope(&self.run_id, scope);
        let registration = self
            .deps
            .workflow_service
            .registered_materialization_for_identity(
                &self.run_id,
                scope,
                self.isolation_capability.identity().execution_generation(),
                self.isolation_capability.broker_generation(),
            )
            .map_err(|error| {
                failed_msg(
                    "worktree_resume_lookup_failed",
                    format!("could not load exact materialization registration: {error}"),
                )
            })?
            .ok_or_else(|| {
                failed_msg(
                    "worktree_resume_lookup_failed",
                    "workspace is not bound to this exact materialization operation",
                )
            })?;
        if registration.workspace_id.as_deref() != Some(workspace_id)
            || registration.intent.source_repo_root_id != pinned.repo_root_id
            || registration.intent.target_root != expected_path
            || registration.intent.branch_name != expected_branch
        {
            return Err(failed_msg(
                "worktree_resume_lookup_failed",
                "workspace registration does not match source, path, branch, or generation",
            ));
        }
        let record = self
            .deps
            .workspace_runtime
            .get_workspace(workspace_id)
            .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?
            .ok_or_else(|| failed_msg("worktree_resume_lookup_failed", "worktree missing"))?;
        let expected_creator = WorkspaceCreatorContext::Automation {
            automation_id: None,
            automation_run_id: Some(self.run_id.clone()),
            label: Some("workflow-run".to_string()),
        };
        let canonical_record = validate_recovered_worktree_metadata(
            record.kind,
            &record.path,
            record.current_branch.as_deref(),
            record.creator_context.as_ref(),
            &expected_path,
            &expected_branch,
            &expected_creator,
        )?;
        // Stored metadata is necessary but never sufficient. Every recovered
        // session workspace is re-inspected by the current broker capability
        // before it is memoized or its session is relaunched.
        let inspected = inspect_workflow_worktree(
            self.deps.workflow_isolation_broker.as_ref(),
            &self.isolation_capability,
            WorkflowWorktreeInspectionRequest {
                identity: WorkflowProcessIdentity::try_materialization(
                    self.isolation_capability.identity().clone(),
                    scope,
                    &registration.intent.source_root,
                    &registration.intent.target_root,
                )
                .map_err(|error| {
                    failed_msg(
                        "worktree_resume_lookup_failed",
                        format!("invalid materialization identity: {error}"),
                    )
                })?,
                root: canonical_record,
            },
        )
        .await
        .map_err(|error| {
            failed_msg(
                "worktree_resume_lookup_failed",
                format!("broker worktree revalidation failed: {error}"),
            )
        })?;
        if inspected.branch != expected_branch {
            return Err(failed_msg(
                "worktree_resume_lookup_failed",
                "broker reported the wrong workflow worktree branch",
            ));
        }
        Ok(record)
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

/// Final branch guard for a worktree already selected by an exact durable
/// operation-registration lookup. This helper is not an ownership lookup: a
/// caller must establish run/scope/execution/broker/source provenance first.
pub(super) fn adoptable_run_worktree(
    found: Option<AdoptedWorktree>,
    expected_branch: &str,
) -> Option<String> {
    match found {
        Some((id, Some(branch))) if branch == expected_branch => Some(id),
        _ => None,
    }
}

/// Mint OR adopt the run's git worktree, returning its workspace id. All git
/// materialization runs through the attested broker; the runtime only performs
/// record lookup/registration around that trusted operation.
///
/// A prior executor may be adopted only through the exact generation-bound
/// operation registration committed atomically with its workspace row. A
/// path/branch/creator match alone is never sufficient, and an unregistered
/// checkout falls through to the fail-closed reconciliation path.
async fn mint_or_adopt_run_worktree(
    executor: &WorkflowStepExecutorImpl,
    pinned_workspace_id: &str,
    base_workspace_id: &str,
    run_id: &str,
    scope: &str,
) -> Result<String, StepOutcome> {
    let workspace_runtime = executor.deps.workspace_runtime.as_ref();
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

    // Base the worktree on the BASE workspace's CURRENT HEAD (exact commit), so
    // isolation is faithful even when the base is itself a branch/worktree. For
    // the run-level worktree the base IS the pinned checkout (wave 2b, unchanged);
    // for a parallel lane the base is the RUN-LEVEL worktree (M2a), so any
    // pre-group commit flows into every lane. The broker inspection must return
    // an exact HEAD oid; materialization never falls back to an ambient ref.
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
    let materialization_identity = || {
        WorkflowProcessIdentity::try_materialization(
            executor.isolation_capability.identity().clone(),
            scope,
            &base_path,
            &target_path,
        )
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("invalid materialization identity: {error}"),
            )
        })
    };
    let source = inspect_workflow_worktree(
        executor.deps.workflow_isolation_broker.as_ref(),
        &executor.isolation_capability,
        WorkflowWorktreeInspectionRequest {
            identity: materialization_identity()?,
            root: std::path::PathBuf::from(&base_path),
        },
    )
    .await
    .map_err(|error| {
        failed_msg(
            "worktree_mint_failed",
            format!("isolated source inspection failed: {error}"),
        )
    })?;
    let base_commit_oid = source.head_oid;
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
    let process_identity = materialization_identity()?;
    let intent = WorkflowMaterializationIntent {
        run_id: run_id.to_string(),
        scope_id: scope.to_string(),
        source_repo_root_id: pinned.repo_root_id.clone(),
        source_root: std::path::PathBuf::from(&base_path),
        target_root: std::path::PathBuf::from(&target_path),
        branch_name: branch_name.clone(),
        base_commit_oid: base_commit_oid.clone(),
        execution_generation: executor
            .isolation_capability
            .identity()
            .execution_generation(),
        broker_generation: executor.isolation_capability.broker_generation(),
    };
    if let Some(id) = executor
        .deps
        .workflow_service
        .registered_workspace_for_materialization(&intent)
        .map_err(|error| {
            failed_msg(
                "worktree_resume_lookup_failed",
                format!("could not load exact materialization registration: {error}"),
            )
        })?
    {
        executor
            .inspect_existing_worktree_for_scope(scope, &id)
            .await?;
        tracing::info!(
            run_id = %run_id,
            worktree_workspace_id = %id,
            branch = %branch_name,
            "workflow run adopted its exact generation-bound materialization"
        );
        return Ok(id);
    }
    prepare_materialization_operation(executor, &intent, &process_identity).await?;
    let request = WorkflowWorktreeMaterializationRequest {
        identity: process_identity.clone(),
        source_root: intent.source_root.clone(),
        target_root: intent.target_root.clone(),
        branch: intent.branch_name.clone(),
        base_commit_oid: intent.base_commit_oid.clone(),
        env: complete_workflow_operation_env(Vec::new()),
    };
    let materialized = match materialize_workflow_worktree(
        executor.deps.workflow_isolation_broker.as_ref(),
        &executor.isolation_capability,
        request,
    )
    .await
    {
        Ok(materialized) => materialized,
        Err(error) => {
            let journal_result = match error.cleanup_receipt {
                Some(receipt) => executor
                    .deps
                    .workflow_service
                    .record_materialization_cleanup_receipt(
                        &durable_materialization_cleanup_receipt(&intent, receipt),
                    ),
                None => executor
                    .deps
                    .workflow_service
                    .mark_materialization_cleanup_required(
                    &intent,
                    "broker materialization failed and operation artifacts could not be reconciled",
                ),
            };
            if let Err(journal_error) = journal_result {
                return Err(failed_msg(
                    "workflow_agent_isolation_unavailable",
                    format!(
                        "materialization cleanup evidence could not be persisted: {journal_error}"
                    ),
                ));
            }
            return Err(failed_msg(
                "worktree_mint_failed",
                format!("isolated worktree materialization failed: {}", error.cause),
            ));
        }
    };
    let result = match workspace_runtime.prepare_broker_materialized_worktree(
        &pinned.repo_root_id,
        &materialized.canonical_target_root.to_string_lossy(),
        &branch_name,
        &base_commit_oid,
        "standard",
        OriginContext::api_local_runtime(),
        Some(creator_context),
    ) {
        Ok(result) => result,
        Err(error) => {
            settle_materialization_cleanup(
                executor,
                &intent,
                process_identity,
                "workspace registration failed after broker materialization",
            )
            .await?;
            return Err(failed_msg(
                "worktree_mint_failed",
                format!("could not register broker-materialized worktree: {error}"),
            ));
        }
    };
    if let Err(error) = executor
        .deps
        .workflow_service
        .register_materialized_workspace(&intent, &result.workspace)
    {
        let committed = executor
            .deps
            .workflow_service
            .registered_workspace_for_materialization(&intent)
            .ok()
            .flatten();
        if committed.as_deref() != Some(result.workspace.id.as_str()) {
            settle_materialization_cleanup(
                executor,
                &intent,
                process_identity,
                "atomic workspace registration failed after broker materialization",
            )
            .await?;
            return Err(failed_msg(
                "workflow_agent_isolation_unavailable",
                format!("could not commit materialization ownership: {error}"),
            ));
        }
        tracing::warn!(
            run_id,
            workspace_id = %result.workspace.id,
            error = %error,
            "materialization registration response was lost after exact atomic commit"
        );
    }
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

async fn prepare_materialization_operation(
    executor: &WorkflowStepExecutorImpl,
    intent: &WorkflowMaterializationIntent,
    identity: &WorkflowProcessIdentity,
) -> Result<(), StepOutcome> {
    match executor
        .deps
        .workflow_service
        .begin_materialization(intent)
        .map_err(|error| {
            failed_msg(
                "workflow_agent_isolation_unavailable",
                format!("could not durably own materialization intent: {error}"),
            )
        })? {
        WorkflowMaterializationBegin::Ready(_) => Ok(()),
        WorkflowMaterializationBegin::Registered(record) => Err(failed_msg(
            "workflow_agent_isolation_unavailable",
            format!(
                "materialization was registered as workspace {:?} but was not adoptable",
                record.workspace_id
            ),
        )),
        WorkflowMaterializationBegin::Retired(_) => Err(failed_msg(
            "workflow_agent_isolation_unavailable",
            "materialization operation identity is retired; a new execution generation is required",
        )),
        WorkflowMaterializationBegin::ReconcileFirst(_) => {
            // A prior call may have lost its response. Prove the deterministic
            // operation absent and retire the ambiguous identity.
            settle_materialization_cleanup(
                executor,
                intent,
                identity.clone(),
                "reconciling an ambiguous prior materialization before retry",
            )
            .await?;
            Err(failed_msg(
                "workflow_agent_isolation_unavailable",
                "ambiguous materialization was cleaned; retry requires a new execution generation",
            ))
        }
    }
}

pub(super) async fn settle_materialization_cleanup(
    executor: &WorkflowStepExecutorImpl,
    intent: &WorkflowMaterializationIntent,
    identity: WorkflowProcessIdentity,
    reason: &str,
) -> Result<(), StepOutcome> {
    settle_materialization_cleanup_with(
        executor.deps.workflow_service.as_ref(),
        executor.deps.workflow_isolation_broker.as_ref(),
        &executor.isolation_capability,
        intent,
        identity,
        reason,
    )
    .await
}

pub(super) async fn settle_materialization_cleanup_with(
    service: &crate::domains::workflows::service::WorkflowService,
    broker: &dyn super::isolation::WorkflowIsolationBroker,
    capability: &super::isolation::WorkflowIsolationCapability,
    intent: &WorkflowMaterializationIntent,
    identity: WorkflowProcessIdentity,
    reason: &str,
) -> Result<(), StepOutcome> {
    match cleanup_workflow_materialization(
        broker,
        capability,
        super::isolation::WorkflowWorktreeCleanupRequest {
            identity,
            source_root: intent.source_root.clone(),
            target_root: intent.target_root.clone(),
            branch: intent.branch_name.clone(),
            base_commit_oid: intent.base_commit_oid.clone(),
        },
    )
    .await
    {
        Ok(receipt) => service
            .record_materialization_cleanup_receipt(&durable_materialization_cleanup_receipt(
                intent, receipt,
            ))
            .map_err(|error| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    format!("cleanup succeeded but its durable receipt was not recorded: {error}"),
                )
            }),
        Err(error) => {
            let detail = format!("{reason}: {error}");
            let _ = service.mark_materialization_cleanup_required(intent, &detail);
            Err(failed_msg(
                "workflow_agent_isolation_unavailable",
                format!("materialization cleanup required: {detail}"),
            ))
        }
    }
}

pub(super) fn durable_materialization_cleanup_receipt(
    intent: &WorkflowMaterializationIntent,
    receipt: super::isolation::WorkflowWorktreeCleanupOutput,
) -> crate::domains::workflows::cleanup::WorkflowMaterializationCleanupReceipt {
    crate::domains::workflows::cleanup::WorkflowMaterializationCleanupReceipt::from_validated_broker(
        intent.clone(),
        receipt.canonical_source_root,
        receipt.canonical_target_root,
        receipt.branch,
        receipt.base_commit_oid,
        receipt.checkout_absent,
        receipt.branch_ref_absent,
        receipt.all_operation_artifacts_absent,
        receipt.execution_generation,
        receipt.broker_generation,
    )
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

/// Platform-safe defense-in-depth projection. Accepted plans already use the
/// lowercase `[a-z0-9_-]` alphabet and remain byte-identical. Invalid internal
/// values become a fixed-length lowercase digest, so case-insensitive filesystems
/// and component-length limits cannot alias or reject their derived path/ref.
fn worktree_identity_token(value: &str) -> String {
    if crate::domains::workflows::plan::valid_worktree_identity_token(value) {
        return value.to_string();
    }
    // This 74-byte form is longer than the 64-byte accepted grammar, making
    // the invalid projection domain disjoint from every accepted token.
    format!("x-invalid-{:x}", Sha256::digest(value.as_bytes()))
}

/// The run-scoped branch name for a per-run worktree: `workflow-run/<run_id>`.
/// Run-scoped so two runs on the same pinned workspace get distinct branches
/// (no collision).
pub(super) fn run_worktree_branch_name(run_id: &str) -> String {
    format!("workflow-run/{}", worktree_identity_token(run_id))
}

/// The run-scoped worktree checkout path: a sibling of the pinned checkout named
/// `wf-run-<run_id>`. Run-scoped so two runs get distinct paths. `None` when the
/// pinned path has no parent (a filesystem root — never a real checkout).
pub(super) fn run_worktree_target_path(pinned_path: &str, run_id: &str) -> Option<String> {
    Path::new(pinned_path).parent().map(|parent| {
        parent
            .join(format!("wf-run-{}", worktree_identity_token(run_id)))
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
            worktree_identity_token(run_id),
            worktree_identity_token(scope)
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
                worktree_identity_token(run_id),
                worktree_identity_token(scope)
            ))
            .to_string_lossy()
            .to_string()
    })
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
