use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use super::test_support::{init_repo, make_runtime, TempDirGuard};
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::store::SessionStore;
use crate::domains::terminals::store::TerminalStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{
    WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord, WorkspaceSurface,
};
use crate::domains::workspaces::options::{
    CreateWorkspaceFromOptionsInput, WorkspaceCreationMode, WorkspaceOptionRuntime,
    WorkspaceOptionsError, WorkspaceRepositoryAvailability, WorkspaceWorktreeCreates,
};
use crate::domains::workspaces::store::{WorkspaceAccessStore, WorkspaceStore};
use crate::domains::workspaces::types::CreateWorktreeResult;
use crate::domains::workspaces::worktree_names::{
    WorktreeNameConflictError, WorktreeNameConflictPolicy,
};
use crate::domains::workspaces::worktree_runtime::{
    CreateWorktreeWorkflowError, CreateWorktreeWorkflowInput, CreateWorktreeWorkflowResult,
};
use crate::live::terminals::TerminalService;
use crate::origin::OriginContext;
use crate::persistence::Db;

#[derive(Default)]
struct RecordingWorktrees {
    inputs: Mutex<Vec<CreateWorktreeWorkflowInput>>,
}

#[derive(Default)]
struct RejectingWorktrees {
    inputs: Mutex<Vec<CreateWorktreeWorkflowInput>>,
}

#[async_trait]
impl WorkspaceWorktreeCreates for RecordingWorktrees {
    async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> Result<CreateWorktreeWorkflowResult, CreateWorktreeWorkflowError> {
        self.inputs.lock().expect("inputs lock").push(input.clone());
        let now = "2026-08-11T00:00:00Z".to_string();
        Ok(CreateWorktreeWorkflowResult {
            worktree: CreateWorktreeResult {
                workspace: WorkspaceRecord {
                    id: "workspace-worktree".to_string(),
                    kind: WorkspaceKind::Worktree,
                    repo_root_id: input.repo_root_id,
                    path: input.target_path,
                    surface: WorkspaceSurface::Standard,
                    original_branch: input.base_branch,
                    current_branch: Some(input.new_branch_name),
                    display_name: None,
                    origin: Some(input.origin),
                    creator_context: input.creator_context,
                    lifecycle_state: WorkspaceLifecycleState::Active,
                    archived_head_sha: None,
                    archived_branch: None,
                    archived_at: None,
                    partial_capture_json: None,
                    created_at: now.clone(),
                    updated_at: now,
                },
                setup_script: None,
                base_fetch: None,
            },
            setup_started: false,
        })
    }
}

#[async_trait]
impl WorkspaceWorktreeCreates for RejectingWorktrees {
    async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> Result<CreateWorktreeWorkflowResult, CreateWorktreeWorkflowError> {
        self.inputs.lock().expect("inputs lock").push(input);
        Err(CreateWorktreeWorkflowError::NameConflict(
            WorktreeNameConflictError::Branch {
                source: anyhow::anyhow!(
                    "git race stderr: branch collision at /private/runtime/worktrees/feature-exact"
                ),
            },
        ))
    }
}

#[tokio::test]
async fn listed_local_and_worktree_modes_delegate_to_the_existing_workspace_owners() {
    let repo = TempDirGuard::new("workspace-options-repo");
    let runtime_home = TempDirGuard::new("workspace-options-runtime-home");
    init_repo(repo.path());
    let db = Db::open_in_memory().expect("open db");
    let repo_roots = Arc::new(RepoRootService::new(RepoRootStore::new(db.clone())));
    let workspace_runtime = Arc::new(make_runtime(&db, runtime_home.path()));
    let caller = workspace_runtime
        .create_workspace(&repo.path().to_string_lossy())
        .expect("create caller workspace");
    let access_gate = Arc::new(WorkspaceAccessGate::new(
        WorkspaceStore::new(db.clone()),
        SessionStore::new(db.clone()),
        WorkspaceAccessStore::new(db.clone()),
        Arc::new(TerminalService::new(
            TerminalStore::new(db),
            runtime_home.path().to_path_buf(),
        )),
    ));
    let worktrees = Arc::new(RecordingWorktrees::default());
    let owner = WorkspaceOptionRuntime::new(
        repo_roots,
        workspace_runtime,
        worktrees.clone(),
        access_gate,
    );
    let options = owner.list_options().await.expect("list options");
    let repository = options
        .repositories
        .iter()
        .find(|option| option.repository_id == caller.repo_root.id)
        .expect("created repository option");
    assert_eq!(
        repository.availability,
        WorkspaceRepositoryAvailability::Present
    );
    assert_eq!(
        options
            .creation_modes
            .iter()
            .map(|option| option.mode)
            .collect::<Vec<_>>(),
        vec![
            WorkspaceCreationMode::Worktree,
            WorkspaceCreationMode::Local
        ]
    );

    let creator_context = WorkspaceCreatorContext::Agent {
        source_session_id: "session-agent".to_string(),
        source_session_workspace_id: Some(caller.workspace.id.clone()),
        session_link_id: None,
        source_workspace_id: Some(caller.workspace.id.clone()),
        label: None,
    };
    // The caller already owns an active local workspace at this repo checkout,
    // so an agent-facing local creation at the identical path must conflict
    // instead of silently inserting a duplicate record that would share one
    // working directory across two sessions.
    let local_conflict = owner
        .create_workspace(
            &caller.workspace.id,
            CreateWorkspaceFromOptionsInput {
                repository_id: caller.repo_root.id.clone(),
                creation_mode: "local".to_string(),
                branch: None,
                display_name: Some("Agent local".to_string()),
                origin: OriginContext::system_local_runtime(),
                creator_context: creator_context.clone(),
            },
        )
        .await
        .expect_err("duplicate local workspace at the same path must conflict");
    assert!(matches!(
        &local_conflict,
        WorkspaceOptionsError::LocalWorkspaceConflict(existing) if *existing == caller.workspace.id
    ));
    assert_eq!(local_conflict.code(), "WORKSPACE_LOCAL_CONFLICT");

    let worktree = owner
        .create_workspace(
            &caller.workspace.id,
            CreateWorkspaceFromOptionsInput {
                repository_id: caller.repo_root.id.clone(),
                creation_mode: "worktree".to_string(),
                branch: Some("feature/agent-workspace".to_string()),
                display_name: None,
                origin: OriginContext::system_local_runtime(),
                creator_context: creator_context.clone(),
            },
        )
        .await
        .expect("create worktree workspace");
    assert_eq!(worktree.workspace.kind, WorkspaceKind::Worktree);
    let inputs = worktrees.inputs.lock().expect("inputs lock");
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].new_branch_name, "feature/agent-workspace");
    assert_eq!(inputs[0].base_branch.as_deref(), Some("main"));
    assert_eq!(
        inputs[0].name_conflict_policy,
        WorktreeNameConflictPolicy::Fail
    );
    assert_eq!(inputs[0].creator_context, Some(creator_context));
    assert_eq!(inputs[0].origin, OriginContext::system_local_runtime());
}

#[tokio::test]
async fn explicit_worktree_owner_conflict_is_typed_and_never_retries_a_suffixed_branch() {
    let repo = TempDirGuard::new("workspace-options-conflict-repo");
    let runtime_home = TempDirGuard::new("workspace-options-conflict-runtime-home");
    init_repo(repo.path());
    let db = Db::open_in_memory().expect("open db");
    let repo_roots = Arc::new(RepoRootService::new(RepoRootStore::new(db.clone())));
    let workspace_runtime = Arc::new(make_runtime(&db, runtime_home.path()));
    let caller = workspace_runtime
        .create_workspace(&repo.path().to_string_lossy())
        .expect("create caller workspace");
    let access_gate = Arc::new(WorkspaceAccessGate::new(
        WorkspaceStore::new(db.clone()),
        SessionStore::new(db.clone()),
        WorkspaceAccessStore::new(db.clone()),
        Arc::new(TerminalService::new(
            TerminalStore::new(db),
            runtime_home.path().to_path_buf(),
        )),
    ));
    let worktrees = Arc::new(RejectingWorktrees::default());
    let owner = WorkspaceOptionRuntime::new(
        repo_roots,
        workspace_runtime,
        worktrees.clone(),
        access_gate,
    );
    let requested_branch = "feature/exact-request";
    let error = owner
        .create_workspace(
            &caller.workspace.id,
            CreateWorkspaceFromOptionsInput {
                repository_id: caller.repo_root.id,
                creation_mode: "worktree".to_string(),
                branch: Some(requested_branch.to_string()),
                display_name: None,
                origin: OriginContext::system_local_runtime(),
                creator_context: WorkspaceCreatorContext::Agent {
                    source_session_id: "session-agent".to_string(),
                    source_session_workspace_id: Some(caller.workspace.id.clone()),
                    session_link_id: None,
                    source_workspace_id: Some(caller.workspace.id.clone()),
                    label: None,
                },
            },
        )
        .await
        .expect_err("owner collision must fail");

    assert!(matches!(
        &error,
        WorkspaceOptionsError::WorktreeConflict(WorktreeNameConflictError::Branch { .. })
    ));
    assert_eq!(error.code(), "WORKSPACE_WORKTREE_CONFLICT");
    let public = error.public_message();
    assert_eq!(
        public,
        "The requested worktree branch or path is already in use."
    );
    assert!(!public.contains("git race stderr"));
    assert!(!public.contains("/private/runtime"));

    let inputs = worktrees.inputs.lock().expect("inputs lock");
    assert_eq!(inputs.len(), 1, "the adapter must not retry with a suffix");
    assert_eq!(inputs[0].new_branch_name, requested_branch);
    assert_eq!(
        inputs[0].name_conflict_policy,
        WorktreeNameConflictPolicy::Fail
    );
}
