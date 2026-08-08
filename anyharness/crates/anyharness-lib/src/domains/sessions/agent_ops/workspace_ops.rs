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
use std::sync::Arc;

use serde_json::{json, Value};

use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::domains::workspaces::worktree_runtime::{
    CreateWorktreeWorkflowInput, CreateWorktreeWorkflowResult, WorkspaceWorktreeRuntime,
};
use crate::origin::OriginContext;

use super::peer_ops::assert_workspace_can_be_mutated;
use super::tools::SpawnWorkspaceArgs;

/// The longest label a spawned workspace will carry.
///
/// `label` is agent-authored, unbounded on the wire, and §4 renders it to a
/// person beside the workspace's provenance. Nothing downstream truncates it,
/// so it is bounded here, where the value enters the system.
const MAX_LABEL_CHARS: usize = 200;

/// The worktree half of workspace creation, as this module uses it.
///
/// A seam, not an abstraction. `WorkspaceWorktreeRuntime` is the only
/// implementation and production passes it unchanged; it exists because that
/// runtime is only constructible with the whole retention/preflight stack
/// behind it, while the two decisions this module owns — the local-only gate
/// and everything `mode=local` does — are settled before a worktree is
/// touched. Taking the dependency as a trait is what lets those be tested
/// through the real `spawn_workspace` body, and what lets a test see the
/// `CreateWorktreeWorkflowInput` this module builds.
#[async_trait::async_trait]
pub(super) trait WorktreeSpawner: Send + Sync {
    fn latest_setup_command(&self, workspace_id: &str) -> anyhow::Result<Option<String>>;

    async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> anyhow::Result<CreateWorktreeWorkflowResult>;
}

#[async_trait::async_trait]
impl WorktreeSpawner for WorkspaceWorktreeRuntime {
    fn latest_setup_command(&self, workspace_id: &str) -> anyhow::Result<Option<String>> {
        WorkspaceWorktreeRuntime::latest_setup_command(self, workspace_id)
    }

    async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> anyhow::Result<CreateWorktreeWorkflowResult> {
        WorkspaceWorktreeRuntime::create_worktree(self, input)
            .await
            .map_err(anyhow::Error::from)
    }
}

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
        "this session's own checkout ({path}) could not be read, so whether there is anything \
         here to create a workspace from is unknown ({error}). Ask a person to look at it."
    )]
    CallerCheckoutUnreadable {
        workspace_id: String,
        path: String,
        error: String,
    },
    #[error(
        "repo {repo_root_id} is not checked out on this machine ({path}), so a workspace cannot \
         be created for it here. Use get_workspace_options to see the repos that are."
    )]
    RepoRootNotOnThisMachine { repo_root_id: String, path: String },
    #[error(
        "repo {repo_root_id}'s checkout ({path}) could not be read, so whether it is on this \
         machine is unknown ({error}). Use get_workspace_options to see the repos that are."
    )]
    RepoRootCheckoutUnreadable {
        repo_root_id: String,
        path: String,
        error: String,
    },
}

/// What the filesystem says about a checkout the gate needs to be there.
///
/// Three states, not two, because the gate FAILS CLOSED: an unreadable path is
/// not a present one, and it is not an absent one either — reporting it as
/// either would put a refusal reason in front of the agent that names the wrong
/// fact. `WorkspaceRecord::checkout_directory_missing` deliberately fails OPEN
/// on the same errors, because it drives destructive "your worktree is gone"
/// UI; this gate only ever refuses a creation, so the conservative direction is
/// the opposite one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum CheckoutPresence {
    Present,
    Missing,
    /// The path could not be read at all — permissions, a dead mount, transient
    /// I/O. Carries the message so the refusal can name what actually failed.
    Unreadable(String),
}

/// Read one checkout's presence. A file where a directory should be counts as
/// `Missing`: there is no checkout there either way, and "not a directory" is
/// not a reason the agent can act on differently.
pub(super) fn checkout_presence(path: &str) -> CheckoutPresence {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => CheckoutPresence::Present,
        Ok(_) => CheckoutPresence::Missing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CheckoutPresence::Missing,
        Err(error) => CheckoutPresence::Unreadable(error.to_string()),
    }
}

/// The local-only gate (ADR §3.3), as a pure decision.
///
/// The filesystem facts arrive already read, so the rule itself is testable and
/// so that each path is read exactly once by the caller.
///
/// The first arm is the structural one: `has_local_checkout()` is true for both
/// workspace kinds that exist today, so it does not fire yet — it is the guard
/// that a future remote/cloud-style workspace kind trips the moment it is added,
/// which is exactly the shape ADR §2 describes ("a future remote/cloud-style
/// kind would return false here"). The remaining arms are the ones that bite
/// today: a checkout that has been deleted, a repo root this machine does not
/// have, and — for either of them — a path this process cannot read.
pub(super) fn assert_local_placement(
    caller_workspace: &WorkspaceRecord,
    caller_checkout: &CheckoutPresence,
    repo_root: &RepoRootRecord,
    repo_root_checkout: &CheckoutPresence,
) -> Result<(), WorkspacePlacementRefusal> {
    if !caller_workspace.has_local_checkout() {
        return Err(WorkspacePlacementRefusal::CallerIsNotLocal {
            workspace_id: caller_workspace.id.clone(),
        });
    }
    match caller_checkout {
        CheckoutPresence::Present => {}
        CheckoutPresence::Missing => {
            return Err(WorkspacePlacementRefusal::CallerCheckoutMissing {
                workspace_id: caller_workspace.id.clone(),
                path: caller_workspace.path.clone(),
            })
        }
        CheckoutPresence::Unreadable(error) => {
            return Err(WorkspacePlacementRefusal::CallerCheckoutUnreadable {
                workspace_id: caller_workspace.id.clone(),
                path: caller_workspace.path.clone(),
                error: error.clone(),
            })
        }
    }
    match repo_root_checkout {
        CheckoutPresence::Present => Ok(()),
        CheckoutPresence::Missing => Err(WorkspacePlacementRefusal::RepoRootNotOnThisMachine {
            repo_root_id: repo_root.id.clone(),
            path: repo_root.path.clone(),
        }),
        CheckoutPresence::Unreadable(error) => {
            Err(WorkspacePlacementRefusal::RepoRootCheckoutUnreadable {
                repo_root_id: repo_root.id.clone(),
                path: repo_root.path.clone(),
                error: error.clone(),
            })
        }
    }
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

/// `get_workspace_options` (ADR §3.4): the configured local repo roots and, per
/// root, the two creation modes.
///
/// Read-only and permit-free — it opens no lease and touches no record. Roots
/// this machine does not actually have are still listed, marked unavailable
/// with the reason, rather than hidden: an agent that cannot see why a repo is
/// missing has no way to say anything useful about it.
///
/// The whole body runs on the blocking pool, for the reason the human workspace
/// routes do it (`api/http/workspaces.rs`): `resolve_git_context` shells out to
/// git four or five times PER repo root, and this is an axum request task.
pub(super) async fn get_workspace_options(
    workspace_runtime: Arc<WorkspaceRuntime>,
    repo_roots: Arc<RepoRootService>,
    caller: &SessionRecord,
) -> anyhow::Result<Value> {
    let caller = caller.clone();
    tokio::task::spawn_blocking(move || {
        build_workspace_options(&workspace_runtime, &repo_roots, &caller)
    })
    .await
    .map_err(|error| anyhow::anyhow!("workspace options task failed: {error}"))?
}

fn build_workspace_options(
    workspace_runtime: &WorkspaceRuntime,
    repo_roots: &RepoRootService,
    caller: &SessionRecord,
) -> anyhow::Result<Value> {
    let caller_workspace = workspace_runtime
        .get_workspace(&caller.workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found: {}", caller.workspace_id))?;
    let caller_checkout = checkout_presence(&caller_workspace.path);
    let roots = repo_roots.list_repo_roots()?;

    let mut options = Vec::with_capacity(roots.len());
    for root in &roots {
        let root_checkout = checkout_presence(&root.path);
        let present = root_checkout == CheckoutPresence::Present;
        let refusal =
            assert_local_placement(&caller_workspace, &caller_checkout, root, &root_checkout).err();
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
            "The setup script for a worktree is whatever this machine last ran for a workspace of \
             THAT repo; a repo with no such run gets none. You never pass one, and none runs for \
             mode=local.",
            "mode=local is idempotent: a repo that already has a local workspace gives you that \
             one back rather than a second one over the same checkout.",
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
    workspace_runtime: &Arc<WorkspaceRuntime>,
    worktree_runtime: &impl WorktreeSpawner,
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
        // ADR §3.4: defaults to the caller's own root. Any OTHER configured
        // root on this machine is allowed too — §3.4's `get_workspace_options`
        // contract lists them all and marks the caller's as the default, which
        // is the detailed spec; §1 requirement 7's "the same git repo" is the
        // summary it supersedes (amended there).
        .unwrap_or_else(|| caller_workspace.repo_root_id.clone());
    let repo_root = repo_roots
        .get_repo_root(&repo_root_id)?
        .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

    // The local-only gate, before any access check: "you cannot make one of
    // these here" is a clearer refusal than "that repo is read-only".
    assert_local_placement(
        &caller_workspace,
        &checkout_presence(&caller_workspace.path),
        &repo_root,
        &checkout_presence(&repo_root.path),
    )?;

    // The caller has to be somewhere it may still act, and the repo root has to
    // be mutable — the same access assertion the human worktree route makes.
    assert_workspace_can_be_mutated(access_gate, &caller.workspace_id)?;
    access_gate.assert_can_mutate_for_repo_root(&repo_root.id)?;

    let label = normalized_label(args.label.as_deref());

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
            spawn_local_workspace(workspace_runtime, caller, &repo_root, label).await
        }
    }
}

/// Trimmed, dropped when empty, and bounded — see [`MAX_LABEL_CHARS`]. Counted
/// in characters rather than bytes so a label of emoji is not cut mid-codepoint.
fn normalized_label(label: Option<&str>) -> Option<String> {
    label
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(MAX_LABEL_CHARS).collect())
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
/// matches what the human worktree-creation path already assumes.
fn base_branch_for(repo_root: &RepoRootRecord, caller_workspace: &WorkspaceRecord) -> String {
    repo_root
        .default_branch
        .as_deref()
        .or(caller_workspace.original_branch.as_deref())
        .or(caller_workspace.current_branch.as_deref())
        .unwrap_or("main")
        .to_string()
}

/// The setup command a worktree of `repo_root` should run, or none.
///
/// ADR §3.4 says the setup script "runs automatically for worktrees … the agent
/// never thinks about it", and the command a human already vetted for a repo IS
/// that repo's answer — which makes WHICH repo the whole question. The caller's
/// own last setup run answers it only when the new worktree is of the caller's
/// own repo; for any other root the answer has to come from that root's own
/// workspaces, because a `pnpm install && pnpm build` approved for repo A was
/// never approved to run inside a fresh checkout of repo B. A root nobody has
/// ever run setup for gets no setup command rather than somebody else's.
fn setup_command_for_new_worktree(
    workspace_runtime: &WorkspaceRuntime,
    worktree_runtime: &impl WorktreeSpawner,
    caller_workspace: &WorkspaceRecord,
    repo_root: &RepoRootRecord,
) -> Option<String> {
    if repo_root.id == caller_workspace.repo_root_id {
        return latest_setup_command_for(worktree_runtime, &caller_workspace.id);
    }
    let workspaces = workspace_runtime
        .list_repo_root_workspaces(&repo_root.id)
        .unwrap_or_else(|error| {
            tracing::warn!(
                repo_root_id = %repo_root.id,
                error = ?error,
                "could not list the target repo's workspaces; spawning the worktree without setup"
            );
            Vec::new()
        });
    // Most recently updated first (the store's ordering), so "the latest setup
    // command for this repo" means the same thing it does for the caller.
    workspaces
        .iter()
        .filter(|workspace| workspace.lifecycle_state == WorkspaceLifecycleState::Active)
        .find_map(|workspace| latest_setup_command_for(worktree_runtime, &workspace.id))
}

fn latest_setup_command_for(
    worktree_runtime: &impl WorktreeSpawner,
    workspace_id: &str,
) -> Option<String> {
    worktree_runtime
        .latest_setup_command(workspace_id)
        .unwrap_or_else(|error| {
            tracing::warn!(
                workspace_id,
                error = ?error,
                "could not read the last setup command; spawning the worktree without setup"
            );
            None
        })
}

async fn spawn_worktree_workspace(
    workspace_runtime: &WorkspaceRuntime,
    worktree_runtime: &impl WorktreeSpawner,
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
    let setup_script = setup_command_for_new_worktree(
        workspace_runtime,
        worktree_runtime,
        caller_workspace,
        repo_root,
    );

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
            "source": "the setup this machine last ran for a workspace of this repo",
        }),
        false,
    ))
}

/// `mode=local`, which is idempotent PER REPO ROOT.
///
/// Opening a checkout in place is not a creation an agent can take back: ruling
/// 11 gives it no way to retire anything, so a retry loop that created a second
/// row over the same directory would leave duplicates only a person can clear,
/// and the two would be indistinguishable to everyone downstream. A person
/// making the same call sees the duplicate in the picker immediately; an agent
/// does not. So an active local workspace for this root IS the answer to
/// "open this repo in place", and the result says it was reused rather than
/// made.
///
/// This is the agent surface only. `POST /v1/workspaces` and the shared
/// `resolve_or_create_workspace` are untouched: the human route's
/// non-idempotence is a deliberate "create another one", which is a request an
/// agent has no way to express here.
async fn spawn_local_workspace(
    workspace_runtime: &Arc<WorkspaceRuntime>,
    caller: &SessionRecord,
    repo_root: &RepoRootRecord,
    label: Option<String>,
) -> anyhow::Result<Value> {
    // ADR §3.4: never for local. Opening an existing checkout in place has
    // nothing to set up — the files are already there, and running a setup
    // command would act on somebody else's working tree.
    let setup = json!({ "started": false, "command": null, "source": "not run for mode=local" });

    if let Some(existing) = existing_local_workspace(workspace_runtime, repo_root)? {
        return Ok(spawn_result(
            &existing,
            repo_root,
            WorkspaceSpawnMode::Local,
            caller,
            None,
            setup,
            true,
        ));
    }

    // Creating resolves the git context, which shells out several times, so it
    // goes to the blocking pool the way the human route does
    // (`api/http/workspaces.rs` wraps the same call in `run_blocking`).
    let runtime = workspace_runtime.clone();
    let path = repo_root.path.clone();
    let creator_context = Some(agent_creator_context(caller, label));
    let created = tokio::task::spawn_blocking(move || {
        runtime.create_workspace_with_origin_and_creator_context(
            &path,
            OriginContext::system_local_runtime(),
            creator_context,
        )
    })
    .await
    .map_err(|error| anyhow::anyhow!("local workspace create task failed: {error}"))??;

    Ok(spawn_result(
        &created.workspace,
        repo_root,
        WorkspaceSpawnMode::Local,
        caller,
        None,
        setup,
        false,
    ))
}

/// The active local workspace over this repo root's checkout, if there is one.
///
/// Matched on the repo root rather than on the path so a path that normalises
/// differently (a symlinked or relative root row) still finds the workspace
/// that is genuinely the same one.
fn existing_local_workspace(
    workspace_runtime: &WorkspaceRuntime,
    repo_root: &RepoRootRecord,
) -> anyhow::Result<Option<WorkspaceRecord>> {
    Ok(workspace_runtime
        .list_repo_root_workspaces(&repo_root.id)?
        .into_iter()
        .find(|workspace| {
            workspace.kind == WorkspaceKind::Local
                && workspace.lifecycle_state == WorkspaceLifecycleState::Active
        }))
}

#[allow(clippy::too_many_arguments)]
fn spawn_result(
    workspace: &WorkspaceRecord,
    repo_root: &RepoRootRecord,
    mode: WorkspaceSpawnMode,
    caller: &SessionRecord,
    base_branch: Option<String>,
    setup: Value,
    reused: bool,
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
        // True when this call handed back a workspace that already existed
        // instead of making one. Only `mode=local` can reuse; a worktree spawn
        // always creates, suffixing a taken branch name rather than reusing.
        "reused": reused,
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
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::Mutex;

    use crate::domains::repo_roots::store::RepoRootStore;
    use crate::domains::sessions::deletion::SessionDeleteWorkflow;
    use crate::domains::terminals::store::TerminalStore;
    use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceSurface,
    };
    use crate::domains::workspaces::store::{WorkspaceAccessStore, WorkspaceStore};
    use crate::domains::workspaces::types::CreateWorktreeResult;
    use crate::live::terminals::TerminalService;
    use crate::persistence::Db;

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
            assert_local_placement(
                &workspace(kind),
                &CheckoutPresence::Present,
                &repo_root(),
                &CheckoutPresence::Present,
            )
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
            &CheckoutPresence::Present,
            &repo_root(),
            &CheckoutPresence::Missing,
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
            &CheckoutPresence::Missing,
            &repo_root(),
            &CheckoutPresence::Present,
        )
        .err()
        .expect("a deleted caller checkout is refused");

        assert!(matches!(
            error,
            WorkspacePlacementRefusal::CallerCheckoutMissing { .. }
        ));
        // And it is checked BEFORE the repo root, so the agent is told about
        // its own situation rather than about the repo.
        let both_broken = assert_local_placement(
            &workspace(WorkspaceKind::Local),
            &CheckoutPresence::Missing,
            &repo_root(),
            &CheckoutPresence::Missing,
        )
        .err()
        .expect("refused");
        assert!(matches!(
            both_broken,
            WorkspacePlacementRefusal::CallerCheckoutMissing { .. }
        ));
    }

    #[test]
    fn a_path_the_gate_cannot_read_refuses_and_names_the_check() {
        // The gate FAILS CLOSED, and says which of its two filesystem facts it
        // could not establish. Reading an unreadable path as "present" would
        // let a creation through on an unproven fact; reading it as "missing"
        // would tell the agent a checkout was deleted when it may be sitting
        // behind a permission error.
        let caller = assert_local_placement(
            &workspace(WorkspaceKind::Worktree),
            &CheckoutPresence::Unreadable("permission denied".to_string()),
            &repo_root(),
            &CheckoutPresence::Present,
        )
        .err()
        .expect("an unreadable caller checkout is refused, not admitted");
        assert!(matches!(
            caller,
            WorkspacePlacementRefusal::CallerCheckoutUnreadable { .. }
        ));
        assert!(caller.to_string().contains("permission denied"));
        assert!(
            !caller.to_string().contains("gone from disk"),
            "an unreadable path must not be reported as a deleted one"
        );

        let root = assert_local_placement(
            &workspace(WorkspaceKind::Worktree),
            &CheckoutPresence::Present,
            &repo_root(),
            &CheckoutPresence::Unreadable("host is down".to_string()),
        )
        .err()
        .expect("an unreadable repo root is refused, not admitted");
        assert!(matches!(
            root,
            WorkspacePlacementRefusal::RepoRootCheckoutUnreadable { .. }
        ));
        assert!(root.to_string().contains("host is down"));
    }

    #[test]
    fn presence_is_read_from_the_filesystem_the_way_the_gate_needs_it() {
        let dir = temp_dir("presence");
        assert_eq!(
            checkout_presence(&dir.path().to_string_lossy()),
            CheckoutPresence::Present
        );
        assert_eq!(
            checkout_presence(&dir.path().join("nope").to_string_lossy()),
            CheckoutPresence::Missing
        );
        // A file where a checkout should be: no checkout either way.
        let file = dir.path().join("a-file");
        std::fs::write(&file, "not a checkout").expect("write file");
        assert_eq!(
            checkout_presence(&file.to_string_lossy()),
            CheckoutPresence::Missing
        );
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
            assert!(assert_local_placement(
                &caller,
                &CheckoutPresence::Present,
                &repo_root(),
                &CheckoutPresence::Present
            )
            .is_ok());
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

    #[test]
    fn an_agent_authored_label_is_trimmed_and_bounded() {
        assert_eq!(
            normalized_label(Some("  billing hotfix  ")).as_deref(),
            Some("billing hotfix")
        );
        for empty in [None, Some(""), Some("   ")] {
            assert_eq!(normalized_label(empty), None);
        }
        // Unbounded, agent-authored and rendered to a person by §4: bounded
        // where it enters, because nothing downstream does it.
        let long = "x".repeat(MAX_LABEL_CHARS + 500);
        assert_eq!(
            normalized_label(Some(&long)).map(|label| label.chars().count()),
            Some(MAX_LABEL_CHARS)
        );
        // Counted in characters, so a multi-byte label is never cut in half.
        let emoji = "🙂".repeat(MAX_LABEL_CHARS + 10);
        let capped = normalized_label(Some(&emoji)).expect("kept");
        assert_eq!(capped.chars().count(), MAX_LABEL_CHARS);
        assert!(capped.chars().all(|character| character == '🙂'));
    }

    // --- the tool bodies, executed -----------------------------------------
    //
    // Everything above proves a rule; these run `spawn_workspace` and
    // `get_workspace_options` themselves, over a real store and real git
    // checkouts in a temp dir. The worktree runtime arrives as a spy — it is
    // the one dependency that is not constructible without the whole
    // retention/preflight stack, and taking it as [`WorktreeSpawner`] is what
    // lets a test see the `CreateWorktreeWorkflowInput` this module builds.

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn temp_dir(prefix: &str) -> TempDir {
        let path = std::env::temp_dir().join(format!(
            "anyharness-agent-ops-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        TempDir { path }
    }

    fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_repo(path: &Path) {
        std::fs::create_dir_all(path).expect("create repo dir");
        run_git(path, ["init", "-b", "main"]);
        run_git(path, ["config", "user.email", "agent@example.com"]);
        run_git(path, ["config", "user.name", "Agent"]);
        std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
        run_git(path, ["add", "README.md"]);
        run_git(path, ["commit", "-m", "Initial commit"]);
    }

    /// A `WorktreeSpawner` that creates nothing and records everything.
    ///
    /// `latest_setup_command` answers per WORKSPACE id, which is the whole
    /// point: the cross-repo question is which workspace's setup run gets
    /// reused, and a spy that answered one command for everybody could not
    /// tell a right answer from a wrong one.
    #[derive(Default)]
    struct WorktreeSpy {
        setup_commands: Mutex<HashMap<String, String>>,
        created: Mutex<Vec<CreateWorktreeWorkflowInput>>,
    }

    impl WorktreeSpy {
        fn with_setup_command(self, workspace_id: &str, command: &str) -> Self {
            self.setup_commands
                .lock()
                .expect("spy poisoned")
                .insert(workspace_id.to_string(), command.to_string());
            self
        }

        fn only_creation(&self) -> CreateWorktreeWorkflowInput {
            let created = self.created.lock().expect("spy poisoned");
            assert_eq!(created.len(), 1, "expected exactly one worktree creation");
            created[0].clone()
        }
    }

    #[async_trait::async_trait]
    impl WorktreeSpawner for WorktreeSpy {
        fn latest_setup_command(&self, workspace_id: &str) -> anyhow::Result<Option<String>> {
            Ok(self
                .setup_commands
                .lock()
                .expect("spy poisoned")
                .get(workspace_id)
                .cloned())
        }

        async fn create_worktree(
            &self,
            input: CreateWorktreeWorkflowInput,
        ) -> anyhow::Result<CreateWorktreeWorkflowResult> {
            let mut created = WorkspaceRecord {
                id: format!("workspace-worktree-{}", input.new_branch_name),
                repo_root_id: input.repo_root_id.clone(),
                path: input.target_path.clone(),
                current_branch: Some(input.new_branch_name.clone()),
                ..workspace(WorkspaceKind::Worktree)
            };
            created.original_branch = input.base_branch.clone();
            self.created.lock().expect("spy poisoned").push(input);
            Ok(CreateWorktreeWorkflowResult {
                worktree: CreateWorktreeResult {
                    workspace: created,
                    setup_script: None,
                    base_fetch: None,
                },
                setup_started: false,
            })
        }
    }

    struct Fixture {
        _home: TempDir,
        repos: TempDir,
        workspace_runtime: Arc<WorkspaceRuntime>,
        repo_roots: RepoRootService,
        access_gate: WorkspaceAccessGate,
        caller: SessionRecord,
        caller_workspace_id: String,
        caller_repo_root_id: String,
    }

    impl Fixture {
        /// A second git repo on this machine, registered as a repo root but
        /// with no workspace of its own — the cross-repo case.
        fn other_repo(&self, name: &str) -> RepoRootRecord {
            let path = self.repos.path().join(name);
            init_repo(&path);
            self.workspace_runtime
                .resolve_repo_root_from_path(&path.to_string_lossy())
                .expect("register the other repo root")
        }

        fn workspaces_for(&self, repo_root_id: &str) -> Vec<WorkspaceRecord> {
            self.workspace_runtime
                .list_repo_root_workspaces(repo_root_id)
                .expect("list workspaces")
        }
    }

    fn fixture() -> Fixture {
        let db = Db::open_in_memory().expect("open db");
        let home = temp_dir("home");
        let repos = temp_dir("repos");
        let caller_repo = repos.path().join("caller-repo");
        init_repo(&caller_repo);

        let repo_roots = RepoRootService::new(RepoRootStore::new(db.clone()));
        let workspace_runtime = Arc::new(WorkspaceRuntime::new(
            WorkspaceStore::new(db.clone()),
            WorkspaceDeleteWorkflow::new(db.clone(), SessionDeleteWorkflow::new(db.clone())),
            repo_roots.clone(),
            home.path().to_path_buf(),
        ));
        let resolved = workspace_runtime
            .create_workspace(&caller_repo.to_string_lossy())
            .expect("open the caller's own checkout");
        let access_gate = WorkspaceAccessGate::new(
            WorkspaceStore::new(db.clone()),
            crate::domains::sessions::store::SessionStore::new(db.clone()),
            WorkspaceAccessStore::new(db.clone()),
            Arc::new(TerminalService::new(
                TerminalStore::new(db.clone()),
                home.path().to_path_buf(),
            )),
        );
        let mut caller = session();
        caller.workspace_id = resolved.workspace.id.clone();

        Fixture {
            _home: home,
            repos,
            workspace_runtime,
            repo_roots,
            access_gate,
            caller,
            caller_workspace_id: resolved.workspace.id,
            caller_repo_root_id: resolved.repo_root.id,
        }
    }

    async fn spawn(
        fixture: &Fixture,
        worktrees: &WorktreeSpy,
        args: SpawnWorkspaceArgs,
    ) -> anyhow::Result<Value> {
        spawn_workspace(
            &fixture.workspace_runtime,
            worktrees,
            &fixture.repo_roots,
            &fixture.access_gate,
            &fixture.caller,
            args,
        )
        .await
    }

    #[tokio::test]
    async fn the_local_only_gate_refuses_through_the_real_tool_body() {
        let fixture = fixture();
        let other = fixture.other_repo("gone-repo");
        std::fs::remove_dir_all(fixture.repos.path().join("gone-repo")).expect("delete the repo");

        let error = spawn(
            &fixture,
            &WorktreeSpy::default(),
            SpawnWorkspaceArgs {
                repo_root_id: Some(other.id.clone()),
                mode: Some("local".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .err()
        .expect("a repo root whose checkout is gone is refused");
        assert!(
            error.to_string().contains("not checked out on this machine"),
            "unexpected refusal: {error}"
        );
        // And nothing was created on the way to the refusal.
        assert!(fixture.workspaces_for(&other.id).is_empty());

        // The caller's own side of the same gate, through the same body.
        std::fs::remove_dir_all(fixture.repos.path().join("caller-repo"))
            .expect("delete the caller's checkout");
        let error = spawn(
            &fixture,
            &WorktreeSpy::default(),
            SpawnWorkspaceArgs {
                mode: Some("local".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .err()
        .expect("a caller with no checkout left is refused");
        assert!(
            error.to_string().contains("gone from disk"),
            "unexpected refusal: {error}"
        );
    }

    #[tokio::test]
    async fn a_local_spawn_creates_one_workspace_and_a_second_call_returns_it() {
        let fixture = fixture();
        let other = fixture.other_repo("other-repo");

        let first = spawn(
            &fixture,
            &WorktreeSpy::default(),
            SpawnWorkspaceArgs {
                repo_root_id: Some(other.id.clone()),
                mode: Some("local".to_string()),
                label: Some("  billing hotfix  ".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .expect("open the other repo in place");

        assert_eq!(first["mode"], "local");
        assert_eq!(first["kind"], "local");
        assert_eq!(first["reused"], false);
        assert_eq!(first["createdBySessionId"], "ses_caller");
        assert_eq!(first["setupScript"]["started"], false);
        let created_id = first["workspaceId"].as_str().expect("workspaceId").to_string();

        // The row exists, in the right repo, stamped with the agent that asked.
        let rows = fixture.workspaces_for(&other.id);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, created_id);
        assert_eq!(rows[0].kind, WorkspaceKind::Local);
        assert_eq!(
            rows[0].creator_context,
            Some(WorkspaceCreatorContext::Agent {
                source_session_id: "ses_caller".to_string(),
                source_session_workspace_id: Some(fixture.caller_workspace_id.clone()),
                session_link_id: None,
                source_workspace_id: Some(fixture.caller_workspace_id.clone()),
                label: Some("billing hotfix".to_string()),
            })
        );

        // Ruling 11 gives an agent no way to undo a workspace, and agents
        // retry. So the second call is the same workspace, said out loud —
        // not a second indistinguishable row over the same checkout.
        let second = spawn(
            &fixture,
            &WorktreeSpy::default(),
            SpawnWorkspaceArgs {
                repo_root_id: Some(other.id.clone()),
                mode: Some("local".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .expect("the second call is answered, not refused");

        assert_eq!(second["workspaceId"].as_str(), Some(created_id.as_str()));
        assert_eq!(second["reused"], true);
        assert_eq!(
            fixture.workspaces_for(&other.id).len(),
            1,
            "two local spawns of one repo root must leave ONE workspace"
        );
    }

    #[tokio::test]
    async fn a_worktree_of_another_repo_never_runs_the_callers_setup_command() {
        // H1: the setup command is a human-vetted shell command, scoped to the
        // repo it was vetted for. Reusing the caller's for a DIFFERENT repo
        // runs it inside a checkout nobody authorised it for.
        let fixture = fixture();
        let other = fixture.other_repo("other-repo");
        let spy = WorktreeSpy::default()
            .with_setup_command(&fixture.caller_workspace_id, "pnpm install && pnpm build");

        spawn(
            &fixture,
            &spy,
            SpawnWorkspaceArgs {
                repo_root_id: Some(other.id.clone()),
                mode: Some("worktree".to_string()),
                branch_name: Some("fix-webhook-retry".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .expect("spawn a worktree of the other repo");

        let input = spy.only_creation();
        assert_eq!(
            input.setup_script, None,
            "a repo with no setup run of its own gets NO setup command — never the caller's"
        );
        // The rest of the server-side policy, on the same call.
        assert_eq!(input.repo_root_id, other.id);
        assert_eq!(input.new_branch_name, "fix-webhook-retry");
        assert_eq!(input.base_branch.as_deref(), Some("main"));
        assert_eq!(input.checkout_mode, WorktreeCheckoutMode::NewBranch);
        assert_eq!(
            input.name_conflict_policy,
            WorktreeNameConflictPolicy::SuffixPathAndBranch
        );
        assert!(matches!(
            input.creator_context,
            Some(WorkspaceCreatorContext::Agent { .. })
        ));
    }

    #[tokio::test]
    async fn a_worktree_takes_the_setup_command_of_the_repo_it_is_actually_for() {
        let fixture = fixture();
        let other = fixture.other_repo("other-repo");
        // The other repo now has a workspace of its own, with its own setup
        // run — that is the command this repo uses here.
        let opened = spawn(
            &fixture,
            &WorktreeSpy::default(),
            SpawnWorkspaceArgs {
                repo_root_id: Some(other.id.clone()),
                mode: Some("local".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .expect("open the other repo in place");
        let other_workspace_id = opened["workspaceId"].as_str().expect("workspaceId");

        let spy = WorktreeSpy::default()
            .with_setup_command(&fixture.caller_workspace_id, "pnpm install && pnpm build")
            .with_setup_command(other_workspace_id, "make deps");

        spawn(
            &fixture,
            &spy,
            SpawnWorkspaceArgs {
                repo_root_id: Some(other.id.clone()),
                mode: Some("worktree".to_string()),
                branch_name: Some("fix-webhook-retry".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .expect("spawn a worktree of the other repo");

        assert_eq!(
            spy.only_creation().setup_script.as_deref(),
            Some("make deps")
        );
    }

    #[tokio::test]
    async fn a_worktree_of_the_callers_own_repo_still_reuses_the_callers_setup_command() {
        // The negative half of H1: scoping the reuse to the caller's own repo
        // must not stop it happening there, which is the case ADR §3.4 is
        // actually about.
        let fixture = fixture();
        let spy = WorktreeSpy::default()
            .with_setup_command(&fixture.caller_workspace_id, "pnpm install && pnpm build");

        spawn(
            &fixture,
            &spy,
            SpawnWorkspaceArgs {
                mode: Some("worktree".to_string()),
                branch_name: Some("fix-webhook-retry".to_string()),
                ..SpawnWorkspaceArgs::default()
            },
        )
        .await
        .expect("spawn a worktree of the caller's own repo");

        let input = spy.only_creation();
        assert_eq!(
            input.setup_script.as_deref(),
            Some("pnpm install && pnpm build")
        );
        // And an omitted `repoRootId` still means the caller's own root.
        assert_eq!(input.repo_root_id, fixture.caller_repo_root_id);
    }

    #[tokio::test]
    async fn workspace_options_describe_every_configured_root_and_why_one_is_unusable() {
        let fixture = fixture();
        let present = fixture.other_repo("present-repo");
        let gone = fixture.other_repo("gone-repo");
        std::fs::remove_dir_all(fixture.repos.path().join("gone-repo")).expect("delete the repo");

        let options = get_workspace_options(
            fixture.workspace_runtime.clone(),
            Arc::new(fixture.repo_roots.clone()),
            &fixture.caller,
        )
        .await
        .expect("describe the options");

        assert_eq!(
            options["defaultRepoRootId"].as_str(),
            Some(fixture.caller_repo_root_id.as_str())
        );
        let roots = options["repoRoots"].as_array().expect("repoRoots");
        assert_eq!(roots.len(), 3);

        let find = |id: &str| {
            roots
                .iter()
                .find(|root| root["repoRootId"].as_str() == Some(id))
                .cloned()
                .unwrap_or_else(|| panic!("{id} is listed"))
        };

        let own = find(&fixture.caller_repo_root_id);
        assert_eq!(own["available"], true);
        assert_eq!(own["isCallersRepo"], true);
        assert_eq!(own["unavailableReason"], Value::Null);
        assert_eq!(own["currentBranch"].as_str(), Some("main"));

        let present = find(&present.id);
        assert_eq!(present["available"], true);
        assert_eq!(present["isCallersRepo"], false);

        // Listed, not hidden, WITH the reason — an agent that cannot see why a
        // repo is unusable has nothing useful to say about it.
        let gone = find(&gone.id);
        assert_eq!(gone["available"], false);
        assert!(gone["unavailableReason"]
            .as_str()
            .is_some_and(|reason| reason.contains("not checked out on this machine")));
        assert_eq!(gone["currentBranch"], Value::Null);
    }
}
