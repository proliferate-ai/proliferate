//! Where an agent may put a NEW workspace, and how one gets made.
//!
//! Two tools live here, and they are the first half of ADR §5's flow 4:
//! `get_workspace_options` describes what a spawned workspace can be, and
//! `spawn_workspace` makes one. The agent then calls `spawn_agent` with the new
//! `workspaceId`. Two steps by design — the ADR's alternatives section rejects
//! exposing the full creation surface, so this is three arguments and
//! server-side policy for everything else.
//!
//! Nothing here re-implements workspace creation. A `worktree` spawn goes
//! through `WorkspaceWorktreeRuntime::create_worktree`, the same call
//! `POST /v1/workspaces/worktrees` makes; a `local` spawn goes through
//! `WorkspaceRuntime::create_workspace_with_origin_and_creator_context`, the
//! same call `POST /v1/workspaces` makes. What this module adds is the three
//! things the human routes do not need:
//!
//! 1. the local-only gate (ADR §1 requirement 7, §3.3) — agents may only make
//!    workspaces that are real local checkouts on this machine;
//! 2. creator stamping — `WorkspaceCreatorContext::Agent` with the calling
//!    session id, so "created by agent X" is a durable fact and not a guess;
//! 3. server-side defaults for everything §3.4 keeps away from the agent: base
//!    branch, name-conflict policy, and the setup script.
//!
//! What is deliberately NOT here is any way to un-make a workspace. Ruling 11
//! keeps retirement human-only, and
//! `no_agent_ops_tool_can_retire_or_delete_a_workspace`
//! in `tools.rs` is the ratchet that keeps it that way.

use std::path::Path;

use serde_json::{json, Value};

use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::domains::workspaces::worktree_runtime::{
    CreateWorktreeWorkflowInput, WorkspaceWorktreeRuntime,
};
use crate::origin::OriginContext;

use super::peer_ops::assert_workspace_can_be_mutated;
use super::tools::SpawnWorkspaceArgs;

/// The two shapes a workspace comes in, as the agent names them. Deliberately
/// the same two words the human picker uses and `WorkspaceKind` stores.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WorkspaceSpawnMode {
    /// A new branch in its own checkout, made with `git worktree add`. The
    /// default: it is the only mode that leaves the caller's own checkout
    /// alone.
    Worktree,
    /// The repo root's existing checkout, opened in place. No new files, no new
    /// branch — a second workspace over the same directory.
    Local,
}

impl WorkspaceSpawnMode {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Worktree => "worktree",
            Self::Local => "local",
        }
    }

    fn parse(value: Option<&str>) -> anyhow::Result<Self> {
        match value.map(str::trim).filter(|value| !value.is_empty()) {
            None | Some("worktree") => Ok(Self::Worktree),
            Some("local") => Ok(Self::Local),
            Some(other) => anyhow::bail!(
                "unknown mode {other:?}; use \"worktree\" for a new branch in its own checkout, \
                 or \"local\" to open the repo's existing checkout in place"
            ),
        }
    }
}

/// Why an agent may not put a workspace here.
///
/// One rule stated three ways, which is the "if running locally" gate of ADR §1
/// requirement 7 and §3.3: **the workspace an agent spawns has to be a real
/// local checkout on this machine, made from a repo this machine actually
/// has.** Nothing enforced this before — `has_local_checkout()` existed as a
/// predicate with no caller — so this is the whole of the gate.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(super) enum WorkspacePlacementRefusal {
    #[error(
        "spawn_workspace only works for an agent running on a local checkout. This session's \
         workspace ({workspace_id}) is not one, so there is no local repo to branch from — ask a \
         person to open a workspace instead."
    )]
    CallerIsNotLocal { workspace_id: String },
    #[error(
        "this session's own checkout is gone from disk ({path}), so there is nothing here to \
         create a workspace from. Ask a person to restore it first."
    )]
    CallerCheckoutMissing { workspace_id: String, path: String },
    #[error(
        "repo {repo_root_id} is not checked out on this machine ({path}), so a workspace cannot \
         be created for it here. Use get_workspace_options to see the repos that are."
    )]
    RepoRootNotOnThisMachine { repo_root_id: String, path: String },
}

/// The local-only gate (ADR §3.3), as a pure decision.
///
/// The filesystem facts arrive as booleans rather than being read here, so the
/// rule itself is testable and so that each is read exactly once by the caller.
///
/// The first arm is the structural one: `has_local_checkout()` is true for both
/// workspace kinds that exist today, so it does not fire yet — it is the guard
/// that a future remote/cloud-style workspace kind trips the moment it is added,
/// which is exactly the shape ADR §2 describes ("a future remote/cloud-style
/// kind would return false here"). The second and third arms are the ones that
/// bite today: a checkout that has been deleted, and a repo root this machine
/// does not have.
pub(super) fn assert_local_placement(
    caller_workspace: &WorkspaceRecord,
    caller_checkout_missing: bool,
    repo_root: &RepoRootRecord,
    repo_root_checkout_present: bool,
) -> Result<(), WorkspacePlacementRefusal> {
    if !caller_workspace.has_local_checkout() {
        return Err(WorkspacePlacementRefusal::CallerIsNotLocal {
            workspace_id: caller_workspace.id.clone(),
        });
    }
    if caller_checkout_missing {
        return Err(WorkspacePlacementRefusal::CallerCheckoutMissing {
            workspace_id: caller_workspace.id.clone(),
            path: caller_workspace.path.clone(),
        });
    }
    if !repo_root_checkout_present {
        return Err(WorkspacePlacementRefusal::RepoRootNotOnThisMachine {
            repo_root_id: repo_root.id.clone(),
            path: repo_root.path.clone(),
        });
    }
    Ok(())
}

/// What `spawn_workspace` stamps on every workspace it makes (ADR §3.4).
///
/// `WorkspaceCreatorContext::Agent` already existed with exactly these fields —
/// ADR §2 says "'Created by agent X' = filling a field, not building anything" —
/// so this fills them rather than inventing a provenance shape. The calling
/// session id is the load-bearing one: it is what §4's transcript receipt and
/// the workspace's provenance display resolve back to an agent.
///
/// `session_link_id` stays `None` on purpose. A workspace is not the far end of
/// a `session_links` row; the link that eventually matters is the one
/// `spawn_agent` writes for the agent placed here, and claiming one here would
/// point at a relationship that does not exist.
pub(super) fn agent_creator_context(
    caller: &SessionRecord,
    label: Option<String>,
) -> WorkspaceCreatorContext {
    WorkspaceCreatorContext::Agent {
        source_session_id: caller.id.clone(),
        source_session_workspace_id: Some(caller.workspace_id.clone()),
        session_link_id: None,
        source_workspace_id: Some(caller.workspace_id.clone()),
        label,
    }
}

/// The repo's name as a person would say it: what the human picker shows.
fn repo_root_name(repo_root: &RepoRootRecord) -> String {
    repo_root
        .display_name
        .clone()
        .or_else(|| repo_root.remote_repo_name.clone())
        .unwrap_or_else(|| {
            Path::new(&repo_root.path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("repo")
                .to_string()
        })
}

fn repo_root_checkout_present(repo_root: &RepoRootRecord) -> bool {
    Path::new(&repo_root.path).is_dir()
}

/// `get_workspace_options` (ADR §3.4): the configured local repo roots and, per
/// root, the two creation modes.
///
/// Read-only and permit-free — it opens no lease and touches no record. Roots
/// this machine does not actually have are still listed, marked unavailable
/// with the reason, rather than hidden: an agent that cannot see why a repo is
/// missing has no way to say anything useful about it.
pub(super) fn get_workspace_options(
    workspace_runtime: &WorkspaceRuntime,
    repo_roots: &RepoRootService,
    caller: &SessionRecord,
) -> anyhow::Result<Value> {
    let caller_workspace = workspace_runtime
        .get_workspace(&caller.workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found: {}", caller.workspace_id))?;
    let caller_checkout_missing = caller_workspace.checkout_directory_missing();
    let roots = repo_roots.list_repo_roots()?;

    let mut options = Vec::with_capacity(roots.len());
    for root in &roots {
        let present = repo_root_checkout_present(root);
        let refusal =
            assert_local_placement(&caller_workspace, caller_checkout_missing, root, present).err();
        // Reading the branch shells out to git, so only for roots that are
        // actually here.
        let current_branch = present
            .then(|| crate::domains::workspaces::resolver::resolve_git_context(&root.path).ok())
            .flatten()
            .and_then(|context| context.current_branch);
        options.push(json!({
            "repoRootId": root.id,
            "name": repo_root_name(root),
            "path": root.path,
            "defaultBranch": root.default_branch,
            "currentBranch": current_branch,
            "isCallersRepo": root.id == caller_workspace.repo_root_id,
            "modes": [
                WorkspaceSpawnMode::Worktree.as_str(),
                WorkspaceSpawnMode::Local.as_str(),
            ],
            "available": refusal.is_none(),
            "unavailableReason": refusal.map(|refusal| refusal.to_string()),
        }));
    }

    Ok(json!({
        "callerSessionId": caller.id,
        "callerWorkspaceId": caller_workspace.id,
        "defaultRepoRootId": caller_workspace.repo_root_id,
        "repoRoots": options,
        "modes": [
            {
                "mode": WorkspaceSpawnMode::Worktree.as_str(),
                "requiresBranchName": true,
                "description": "A new branch in its own checkout, made with git worktree add. \
                                Leaves every existing checkout untouched.",
                "runsSetupScript": true,
            },
            {
                "mode": WorkspaceSpawnMode::Local.as_str(),
                "requiresBranchName": false,
                "description": "The repo's existing checkout, opened in place as a second \
                                workspace. Shares files and git state with whoever else is in it.",
                "runsSetupScript": false,
            },
        ],
        "notes": [
            "Workspaces you spawn are yours to use, not to remove: only a person can retire one.",
            "Base branch and name-conflict handling are decided server-side; a branch name that \
             is taken gets a numeric suffix rather than failing.",
            "The setup script for a worktree is whatever this machine last ran for your own \
             workspace. You never pass one, and none runs for mode=local.",
            "Put an agent in a workspace you spawned with spawn_agent and its workspaceId.",
        ],
    }))
}

/// `spawn_workspace` (ADR §3.4).
///
/// ## Gating
///
/// No route lease, and none is possible: the workspace this creates does not
/// exist yet, so there is nothing to take a `WorkspaceOperationKind` lease on —
/// which is exactly why the tool is absent from `tools::MUTATING_TOOL_NAMES`.
/// What it takes instead is what the human worktree route takes for the same
/// reason (`api/http/workspaces_worktrees.rs`): the ACCESS gate on the repo
/// root, plus the caller's own workspace being mutable. There is no target
/// session either, so no admission permit — with one gate and no lease there is
/// no lock order to get wrong (PR1227-LOCK-01 is satisfied vacuously).
pub(super) async fn spawn_workspace(
    workspace_runtime: &WorkspaceRuntime,
    worktree_runtime: &WorkspaceWorktreeRuntime,
    repo_roots: &RepoRootService,
    access_gate: &WorkspaceAccessGate,
    caller: &SessionRecord,
    args: SpawnWorkspaceArgs,
) -> anyhow::Result<Value> {
    let mode = WorkspaceSpawnMode::parse(args.mode.as_deref())?;
    let caller_workspace = workspace_runtime
        .get_workspace(&caller.workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found: {}", caller.workspace_id))?;
    let repo_root_id = args
        .repo_root_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        // ADR §3.4: defaults to the caller's own root — "the same git repo" of
        // requirement 7.
        .unwrap_or_else(|| caller_workspace.repo_root_id.clone());
    let repo_root = repo_roots
        .get_repo_root(&repo_root_id)?
        .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

    // The local-only gate, before any access check: "you cannot make one of
    // these here" is a clearer refusal than "that repo is read-only".
    assert_local_placement(
        &caller_workspace,
        caller_workspace.checkout_directory_missing(),
        &repo_root,
        repo_root_checkout_present(&repo_root),
    )?;

    // The caller has to be somewhere it may still act, and the repo root has to
    // be mutable — the same access assertion the human worktree route makes.
    assert_workspace_can_be_mutated(access_gate, &caller.workspace_id)?;
    access_gate.assert_can_mutate_for_repo_root(&repo_root.id)?;

    let label = args
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    match mode {
        WorkspaceSpawnMode::Worktree => {
            spawn_worktree_workspace(
                workspace_runtime,
                worktree_runtime,
                caller,
                &caller_workspace,
                &repo_root,
                args.branch_name.as_deref(),
                label,
            )
            .await
        }
        WorkspaceSpawnMode::Local => {
            spawn_local_workspace(workspace_runtime, caller, &repo_root, label)
        }
    }
}

fn validate_branch_name(branch_name: Option<&str>) -> anyhow::Result<String> {
    let branch_name = branch_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!("branchName is required for mode=worktree — name the branch to create")
        })?;
    if branch_name.starts_with('-')
        || branch_name.starts_with('/')
        || branch_name.ends_with('/')
        || branch_name.contains("..")
        || branch_name.contains(char::is_whitespace)
    {
        anyhow::bail!(
            "branchName {branch_name:?} is not a usable git branch name; use something like \
             \"fix-webhook-retry\""
        );
    }
    Ok(branch_name.to_string())
}

/// The base branch a person would have picked: the repo's default, then
/// whatever the caller's own workspace came from. `main` is the last resort and
/// matches what cowork's creation path already assumes.
fn base_branch_for(repo_root: &RepoRootRecord, caller_workspace: &WorkspaceRecord) -> String {
    repo_root
        .default_branch
        .as_deref()
        .or(caller_workspace.original_branch.as_deref())
        .or(caller_workspace.current_branch.as_deref())
        .unwrap_or("main")
        .to_string()
}

async fn spawn_worktree_workspace(
    workspace_runtime: &WorkspaceRuntime,
    worktree_runtime: &WorkspaceWorktreeRuntime,
    caller: &SessionRecord,
    caller_workspace: &WorkspaceRecord,
    repo_root: &RepoRootRecord,
    branch_name: Option<&str>,
    label: Option<String>,
) -> anyhow::Result<Value> {
    let branch_name = validate_branch_name(branch_name)?;
    let base_branch = base_branch_for(repo_root, caller_workspace);
    let target_path = workspace_runtime
        .default_worktree_destination_path(&repo_root.id, &branch_name)
        .map_err(|error| {
            anyhow::anyhow!("failed to resolve a destination for the new worktree: {error}")
        })?;
    if let Some(parent) = target_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            anyhow::anyhow!("failed to create the managed worktree destination: {error}")
        })?;
    }
    // ADR §3.4: the setup script "runs automatically for worktrees … the agent
    // never thinks about it". The one this machine last ran for the caller's
    // own workspace IS the setup this repo uses here, so it is reused rather
    // than re-derived from a detector the human flow drives interactively.
    let setup_script = worktree_runtime
        .latest_setup_command(&caller_workspace.id)
        .unwrap_or_else(|error| {
            tracing::warn!(
                workspace_id = %caller_workspace.id,
                error = ?error,
                "could not read the last setup command; spawning the worktree without setup"
            );
            None
        });

    let created = worktree_runtime
        .create_worktree(CreateWorktreeWorkflowInput {
            repo_root_id: repo_root.id.clone(),
            target_path: target_path.to_string_lossy().to_string(),
            new_branch_name: branch_name.clone(),
            base_branch: Some(base_branch.clone()),
            checkout_mode: WorktreeCheckoutMode::NewBranch,
            setup_script: setup_script.clone(),
            surface: "standard".to_string(),
            // Server-side policy (ADR §3.4): a name an agent picked that is
            // already taken gets a suffix instead of an error it would have to
            // retry around.
            name_conflict_policy: WorktreeNameConflictPolicy::SuffixPathAndBranch,
            origin: OriginContext::system_local_runtime(),
            creator_context: Some(agent_creator_context(caller, label)),
        })
        .await?;

    Ok(spawn_result(
        &created.worktree.workspace,
        repo_root,
        WorkspaceSpawnMode::Worktree,
        caller,
        Some(base_branch),
        json!({
            "started": created.setup_started,
            "command": setup_script,
            "source": "the setup this machine last ran for your workspace",
        }),
    ))
}

fn spawn_local_workspace(
    workspace_runtime: &WorkspaceRuntime,
    caller: &SessionRecord,
    repo_root: &RepoRootRecord,
    label: Option<String>,
) -> anyhow::Result<Value> {
    let created = workspace_runtime.create_workspace_with_origin_and_creator_context(
        &repo_root.path,
        OriginContext::system_local_runtime(),
        Some(agent_creator_context(caller, label)),
    )?;
    Ok(spawn_result(
        &created.workspace,
        repo_root,
        WorkspaceSpawnMode::Local,
        caller,
        None,
        // ADR §3.4: never for local. Opening an existing checkout in place has
        // nothing to set up — the files are already there, and running a setup
        // command would act on somebody else's working tree.
        json!({ "started": false, "command": null, "source": "not run for mode=local" }),
    ))
}

fn spawn_result(
    workspace: &WorkspaceRecord,
    repo_root: &RepoRootRecord,
    mode: WorkspaceSpawnMode,
    caller: &SessionRecord,
    base_branch: Option<String>,
    setup: Value,
) -> Value {
    json!({
        // The handle for the next step, named the way `spawn_agent` takes it.
        "workspaceId": workspace.id,
        "repoRootId": repo_root.id,
        "repoName": repo_root_name(repo_root),
        "mode": mode.as_str(),
        "kind": match workspace.kind {
            WorkspaceKind::Local => "local",
            WorkspaceKind::Worktree => "worktree",
        },
        "path": workspace.path,
        "branchName": workspace.current_branch,
        "baseBranch": base_branch,
        "createdBySessionId": caller.id,
        "setupScript": setup,
        "notes": [
            "Call spawn_agent with this workspaceId to put an agent in it.",
            "You cannot retire or delete this workspace; only a person can.",
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceSurface,
    };

    fn workspace(kind: WorkspaceKind) -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind,
            repo_root_id: "root-1".to_string(),
            path: "/repos/proliferate".to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
        }
    }

    fn repo_root() -> RepoRootRecord {
        RepoRootRecord {
            id: "root-1".to_string(),
            kind: "external".to_string(),
            path: "/repos/proliferate".to_string(),
            display_name: Some("proliferate".to_string()),
            default_branch: Some("main".to_string()),
            remote_provider: None,
            remote_owner: None,
            remote_repo_name: None,
            remote_url: None,
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
        }
    }

    fn session() -> SessionRecord {
        use crate::domains::sessions::model::SessionMcpBindingPolicy;
        SessionRecord {
            id: "ses_caller".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some("Schema audit".to_string()),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    // --- the local-only gate (ADR §1 requirement 7, §3.3) ----------------

    #[test]
    fn a_local_caller_with_a_checked_out_repo_may_spawn() {
        for kind in [WorkspaceKind::Local, WorkspaceKind::Worktree] {
            assert_local_placement(&workspace(kind), false, &repo_root(), true)
                .expect("both local kinds may spawn");
        }
    }

    #[test]
    fn a_repo_this_machine_does_not_have_is_refused() {
        // The arm that bites today: a repo root row whose checkout is not on
        // this machine is not somewhere a local workspace can be made, and
        // creating one would leave a record pointing at nothing.
        let error = assert_local_placement(
            &workspace(WorkspaceKind::Worktree),
            false,
            &repo_root(),
            false,
        )
        .err()
        .expect("a repo root with no checkout here is refused");

        assert_eq!(
            error,
            WorkspacePlacementRefusal::RepoRootNotOnThisMachine {
                repo_root_id: "root-1".to_string(),
                path: "/repos/proliferate".to_string(),
            }
        );
        assert!(error
            .to_string()
            .contains("not checked out on this machine"));
    }

    #[test]
    fn a_caller_whose_own_checkout_is_gone_is_refused() {
        let error = assert_local_placement(
            &workspace(WorkspaceKind::Worktree),
            true,
            &repo_root(),
            true,
        )
        .err()
        .expect("a deleted caller checkout is refused");

        assert!(matches!(
            error,
            WorkspacePlacementRefusal::CallerCheckoutMissing { .. }
        ));
        // And it is checked BEFORE the repo root, so the agent is told about
        // its own situation rather than about the repo.
        let both_broken =
            assert_local_placement(&workspace(WorkspaceKind::Local), true, &repo_root(), false)
                .err()
                .expect("refused");
        assert!(matches!(
            both_broken,
            WorkspacePlacementRefusal::CallerCheckoutMissing { .. }
        ));
    }

    #[test]
    fn the_gate_reads_the_local_checkout_predicate_the_adr_names() {
        // ADR §2/§3.3: `has_local_checkout()` is THE predicate, and a future
        // remote/cloud-style workspace kind returning false from it must be
        // refused. Both kinds that exist today return true, so this pins that
        // the gate is wired to that predicate rather than to a kind list that
        // would silently admit a new kind.
        for kind in [WorkspaceKind::Local, WorkspaceKind::Worktree] {
            let caller = workspace(kind);
            assert!(caller.has_local_checkout());
            assert!(assert_local_placement(&caller, false, &repo_root(), true).is_ok());
        }
    }

    // --- creator stamping (ADR §3.4) --------------------------------------

    #[test]
    fn every_spawned_workspace_records_the_session_that_asked_for_it() {
        let context = agent_creator_context(&session(), Some("billing hotfix".to_string()));

        assert_eq!(
            context,
            WorkspaceCreatorContext::Agent {
                source_session_id: "ses_caller".to_string(),
                source_session_workspace_id: Some("workspace-1".to_string()),
                // A workspace is not the far end of a link row.
                session_link_id: None,
                source_workspace_id: Some("workspace-1".to_string()),
                label: Some("billing hotfix".to_string()),
            }
        );
        // Not Human, and not Automation: those are the two provenances a person
        // reading the workspace would take at face value.
        assert!(!matches!(context, WorkspaceCreatorContext::Human { .. }));
    }

    #[test]
    fn the_creator_stamp_survives_a_workspace_with_no_label() {
        let context = agent_creator_context(&session(), None);
        match context {
            WorkspaceCreatorContext::Agent {
                source_session_id,
                label,
                ..
            } => {
                assert_eq!(source_session_id, "ses_caller");
                assert_eq!(label, None);
            }
            other => panic!("expected agent provenance, got {other:?}"),
        }
    }

    #[test]
    fn both_creation_paths_actually_stamp_the_context_they_build() {
        // `agent_creator_context` being right is worth nothing if a creation
        // path passes `None` — and `creator_context` is an `Option`, so that
        // compiles. Every call this module makes into the human creation
        // services has to carry the stamp.
        let source = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/domains/sessions/agent_ops/workspace_ops.rs"),
        )
        .expect("read workspace_ops.rs");
        // Only the shipping half: this test's own needles live below the split.
        let source = source
            .split_once("#[cfg(test)]")
            .expect("workspace_ops.rs has a test module")
            .0;
        assert_eq!(
            source.matches("Some(agent_creator_context(").count(),
            2,
            "both creation paths — worktree and local — must pass \
             Some(agent_creator_context(..)); `creator_context` is an Option, so dropping the \
             stamp compiles"
        );
        assert!(
            !source.contains("creator_context: None"),
            "no creation path here may go out unstamped"
        );
    }

    // --- arguments and server-side defaults -------------------------------

    #[test]
    fn mode_defaults_to_worktree_and_rejects_anything_else() {
        assert_eq!(
            WorkspaceSpawnMode::parse(None).expect("default"),
            WorkspaceSpawnMode::Worktree
        );
        assert_eq!(
            WorkspaceSpawnMode::parse(Some("  ")).expect("blank is a default"),
            WorkspaceSpawnMode::Worktree
        );
        assert_eq!(
            WorkspaceSpawnMode::parse(Some("local")).expect("local"),
            WorkspaceSpawnMode::Local
        );
        let error = WorkspaceSpawnMode::parse(Some("sandbox"))
            .err()
            .expect("an unknown mode is refused");
        // The refusal names both real modes, since ADR §3.4 gives the agent
        // exactly two and nothing else describes them at call time.
        assert!(error.to_string().contains("worktree"));
        assert!(error.to_string().contains("local"));
    }

    #[test]
    fn a_worktree_needs_a_branch_name_and_a_usable_one() {
        assert_eq!(
            validate_branch_name(Some("  fix-webhook-retry  ")).expect("trimmed"),
            "fix-webhook-retry"
        );
        for bad in [None, Some(""), Some("   ")] {
            assert!(validate_branch_name(bad).is_err());
        }
        for bad in ["-force", "/leading", "trailing/", "a..b", "two words"] {
            assert!(
                validate_branch_name(Some(bad)).is_err(),
                "{bad:?} should not be accepted as a branch name"
            );
        }
    }

    #[test]
    fn the_base_branch_is_server_side_policy_not_an_argument() {
        // ADR §3.4: "Base branch + conflict policy (suffix) are server-side
        // defaults." The repo's own default wins; the caller's workspace is the
        // fallback, and only then `main`.
        let mut root = repo_root();
        assert_eq!(
            base_branch_for(&root, &workspace(WorkspaceKind::Local)),
            "main"
        );

        root.default_branch = Some("develop".to_string());
        assert_eq!(
            base_branch_for(&root, &workspace(WorkspaceKind::Local)),
            "develop"
        );

        root.default_branch = None;
        let mut caller = workspace(WorkspaceKind::Worktree);
        caller.original_branch = Some("release-1".to_string());
        assert_eq!(base_branch_for(&root, &caller), "release-1");

        caller.original_branch = None;
        caller.current_branch = None;
        assert_eq!(base_branch_for(&root, &caller), "main");
    }

    #[test]
    fn a_repo_root_is_named_the_way_the_picker_names_it() {
        let mut root = repo_root();
        assert_eq!(repo_root_name(&root), "proliferate");

        root.display_name = None;
        root.remote_repo_name = Some("proliferate-fork".to_string());
        assert_eq!(repo_root_name(&root), "proliferate-fork");

        root.remote_repo_name = None;
        assert_eq!(repo_root_name(&root), "proliferate");
    }
}
