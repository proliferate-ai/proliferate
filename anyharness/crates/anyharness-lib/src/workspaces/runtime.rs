use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use uuid::Uuid;

use super::model::WorkspaceRecord;
use super::resolver;
use super::service::WorkspaceService;
use super::store::WorkspaceStore;
use super::types::{
    CreateWorktreeResult, ProjectSetupDetectionResult, SetWorkspaceDisplayNameError,
    SetupScriptExecutionResult, SetupScriptExecutionStatus,
};
use crate::repo_roots::model::{CreateRepoRootInput, RepoRootRecord};
use crate::repo_roots::service::RepoRootService;

pub struct WorkspaceRuntime {
    service: WorkspaceService,
    store: WorkspaceStore,
    repo_root_service: RepoRootService,
    runtime_home: PathBuf,
}

#[derive(Debug, Clone)]
pub struct WorkspaceResolution {
    pub repo_root: RepoRootRecord,
    pub workspace: WorkspaceRecord,
}

impl WorkspaceRuntime {
    pub fn new(
        service: WorkspaceService,
        store: WorkspaceStore,
        repo_root_service: RepoRootService,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            service,
            store,
            repo_root_service,
            runtime_home,
        }
    }

    pub fn resolve_from_path(&self, path: &str) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_or_create_workspace(path, true)
    }

    pub fn create_workspace(&self, path: &str) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_or_create_workspace(path, false)
    }

    pub fn create_worktree(
        &self,
        repo_root_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        setup_script: Option<&str>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        self.create_worktree_with_surface(
            repo_root_id,
            target_path,
            new_branch_name,
            base_branch,
            setup_script,
            "standard",
        )
    }

    pub fn create_worktree_with_surface(
        &self,
        repo_root_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        setup_script: Option<&str>,
        surface: &str,
    ) -> anyhow::Result<CreateWorktreeResult> {
        let source = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let target = Path::new(target_path);
        let canonical_target = target
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .map(|parent| parent.join(target.file_name().unwrap_or_default()))
            .unwrap_or_else(|| target.to_path_buf());
        let canonical_str = canonical_target.to_string_lossy();

        if canonical_target.exists() {
            anyhow::bail!("worktree target path already exists: {canonical_str}");
        }

        if self.store.find_by_path(&canonical_str)?.is_some() {
            anyhow::bail!("a workspace record already exists for path: {canonical_str}");
        }

        resolver::create_git_worktree(&source.path, target_path, new_branch_name, base_branch)?;

        let ctx = resolver::resolve_git_context(target_path)?;
        let record = build_workspace_record(
            &source,
            &ctx.repo_root,
            "worktree",
            surface,
            ctx.current_branch.clone(),
        );
        self.store.insert(&record)?;

        let setup_script = setup_script
            .map(str::trim)
            .filter(|script| !script.is_empty())
            .map(|script| {
                self.run_setup_script(&record, Some(base_branch.unwrap_or("HEAD")), script)
            })
            .transpose()?;

        Ok(CreateWorktreeResult {
            workspace: record,
            setup_script,
        })
    }

    pub fn get_workspace(&self, workspace_id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store
            .find_by_id(workspace_id)?
            .filter(|record| record.kind != "repo")
            .map(reconcile_current_branch)
            .transpose()
    }

    pub fn set_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
    ) -> Result<WorkspaceRecord, SetWorkspaceDisplayNameError> {
        self.service.set_display_name(workspace_id, display_name)
    }

    pub fn detect_setup(&self, workspace_id: &str) -> anyhow::Result<ProjectSetupDetectionResult> {
        self.service.detect_setup(workspace_id)
    }

    pub fn list_workspaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.store
            .list_execution_surfaces()?
            .into_iter()
            .map(reconcile_current_branch)
            .collect()
    }

    pub fn workspace_env(
        &self,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<BTreeMap<String, String>> {
        Ok(self
            .build_workspace_env(workspace, None)?
            .into_iter()
            .collect())
    }

    pub fn build_workspace_env(
        &self,
        workspace: &WorkspaceRecord,
        base_ref: Option<&str>,
    ) -> anyhow::Result<Vec<(String, String)>> {
        let repo_root_id = workspace.effective_repo_root_id();
        let repo_root = self
            .repo_root_service
            .get_repo_root(&repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let mut env = BTreeMap::new();
        env.insert("PROLIFERATE_WORKSPACE_ID".into(), workspace.id.clone());
        env.insert("PROLIFERATE_WORKSPACE_KIND".into(), workspace.kind.clone());
        env.insert("PROLIFERATE_WORKSPACE_DIR".into(), workspace.path.clone());
        env.insert("PROLIFERATE_REPO_ROOT_ID".into(), repo_root.id.clone());
        env.insert("PROLIFERATE_REPO_DIR".into(), repo_root.path.clone());
        env.insert(
            "PROLIFERATE_RUNTIME_HOME".into(),
            self.runtime_home.display().to_string(),
        );
        let repo_name = repo_root
            .remote_repo_name
            .clone()
            .unwrap_or_else(|| path_basename(&repo_root.path));
        env.insert("PROLIFERATE_REPO_NAME".into(), repo_name);
        if let Some(branch) = workspace
            .current_branch
            .as_ref()
            .or(workspace.original_branch.as_ref())
        {
            env.insert("PROLIFERATE_BRANCH".into(), branch.clone());
        }
        if let Some(base_ref) = base_ref {
            env.insert("PROLIFERATE_BASE_REF".into(), base_ref.to_string());
        }
        if let Some(provider) = &repo_root.remote_provider {
            env.insert("PROLIFERATE_GIT_PROVIDER".into(), provider.clone());
        }
        if let Some(owner) = &repo_root.remote_owner {
            env.insert("PROLIFERATE_GIT_OWNER".into(), owner.clone());
        }
        if let Some(repo) = &repo_root.remote_repo_name {
            env.insert("PROLIFERATE_GIT_REPO".into(), repo.clone());
        }
        if workspace.kind == "worktree" {
            env.insert("PROLIFERATE_WORKTREE_DIR".into(), workspace.path.clone());
        }

        Ok(env.into_iter().collect())
    }

    pub fn cleanup_failed_worktree(
        &self,
        repo_root_path: &str,
        workspace_id: &str,
        worktree_path: &str,
    ) -> anyhow::Result<()> {
        let worktree = Path::new(worktree_path);
        if worktree.exists() {
            let output = Command::new("git")
                .args([
                    "-C",
                    repo_root_path,
                    "worktree",
                    "remove",
                    "--force",
                    worktree_path,
                ])
                .output()?;
            if !output.status.success() && worktree.exists() {
                fs::remove_dir_all(worktree)?;
            }
        }

        if self.store.find_by_id(workspace_id)?.is_some() {
            self.store.delete_by_id(workspace_id)?;
        }

        Ok(())
    }

    fn resolve_or_create_workspace(
        &self,
        path: &str,
        allow_existing: bool,
    ) -> anyhow::Result<WorkspaceResolution> {
        let started = Instant::now();
        tracing::info!(path = %path, allow_existing, "[workspace-latency] workspace.runtime.resolve.start");
        let ctx = resolver::resolve_git_context(path)?;
        let repo_root_path = ctx
            .main_worktree_path
            .clone()
            .unwrap_or_else(|| ctx.repo_root.clone());
        let remote = ctx
            .remote_url
            .as_deref()
            .and_then(resolver::parse_remote_url);
        let repo_root = self
            .repo_root_service
            .ensure_repo_root(CreateRepoRootInput {
                kind: "external".into(),
                path: repo_root_path,
                display_name: None,
                default_branch: ctx.current_branch.clone(),
                remote_provider: remote.as_ref().map(|value| value.provider.clone()),
                remote_owner: remote.as_ref().map(|value| value.owner.clone()),
                remote_repo_name: remote.as_ref().map(|value| value.repo.clone()),
                remote_url: ctx.remote_url.clone(),
            })?;

        let workspace_kind = if ctx.is_worktree { "worktree" } else { "local" };
        let workspace_path = ctx.repo_root.clone();
        if allow_existing {
            if let Some(existing) = self
                .store
                .find_by_path_and_kind(&workspace_path, workspace_kind)?
            {
                return Ok(WorkspaceResolution {
                    repo_root,
                    workspace: reconcile_current_branch(existing)?,
                });
            }
        }

        let record = build_workspace_record(
            &repo_root,
            &workspace_path,
            workspace_kind,
            "standard",
            ctx.current_branch,
        );
        self.store.insert(&record)?;
        tracing::info!(
            path = %path,
            repo_root_id = %repo_root.id,
            workspace_id = %record.id,
            workspace_kind,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.runtime.resolve.completed"
        );
        Ok(WorkspaceResolution {
            repo_root,
            workspace: record,
        })
    }

    fn run_setup_script(
        &self,
        workspace: &WorkspaceRecord,
        base_ref: Option<&str>,
        script: &str,
    ) -> anyhow::Result<SetupScriptExecutionResult> {
        const MAX_OUTPUT_BYTES: usize = 64 * 1024;

        let started = Instant::now();
        let mut command = setup_shell_command(script);
        command.current_dir(&workspace.path);
        for (key, value) in self.build_workspace_env(workspace, base_ref)? {
            command.env(key, value);
        }

        match command.output() {
            Ok(output) => Ok(SetupScriptExecutionResult {
                command: script.to_string(),
                status: if output.status.success() {
                    SetupScriptExecutionStatus::Succeeded
                } else {
                    SetupScriptExecutionStatus::Failed
                },
                exit_code: output.status.code().unwrap_or(-1),
                stdout: truncate_output(&String::from_utf8_lossy(&output.stdout), MAX_OUTPUT_BYTES),
                stderr: truncate_output(&String::from_utf8_lossy(&output.stderr), MAX_OUTPUT_BYTES),
                duration_ms: started.elapsed().as_millis() as u64,
            }),
            Err(error) => Ok(SetupScriptExecutionResult {
                command: script.to_string(),
                status: SetupScriptExecutionStatus::Failed,
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("failed to run setup script: {error}"),
                duration_ms: started.elapsed().as_millis() as u64,
            }),
        }
    }
}

fn build_workspace_record(
    repo_root: &RepoRootRecord,
    path: &str,
    kind: &str,
    surface: &str,
    current_branch: Option<String>,
) -> WorkspaceRecord {
    let now = chrono::Utc::now().to_rfc3339();
    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: kind.to_string(),
        repo_root_id: Some(repo_root.id.clone()),
        path: path.to_string(),
        surface: surface.to_string(),
        source_repo_root_path: repo_root.path.clone(),
        source_workspace_id: None,
        git_provider: repo_root.remote_provider.clone(),
        git_owner: repo_root.remote_owner.clone(),
        git_repo_name: repo_root.remote_repo_name.clone(),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn reconcile_current_branch(mut record: WorkspaceRecord) -> anyhow::Result<WorkspaceRecord> {
    let next_branch = resolver::resolve_git_context(&record.path)
        .ok()
        .and_then(|ctx| ctx.current_branch)
        .or(record.current_branch.clone());

    record.current_branch = next_branch;
    Ok(record)
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .to_string()
}

fn truncate_output(output: &str, max_bytes: usize) -> String {
    if output.len() <= max_bytes {
        return output.to_string();
    }

    let mut end = max_bytes;
    while end > 0 && !output.is_char_boundary(end) {
        end -= 1;
    }

    let mut truncated = output[..end].to_string();
    truncated.push_str("\n[output truncated]");
    truncated
}

#[cfg(windows)]
fn setup_shell_command(script: &str) -> Command {
    let mut command = Command::new("cmd");
    command.args(["/C", script]);
    command
}

#[cfg(not(windows))]
fn setup_shell_command(script: &str) -> Command {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut command = Command::new(shell);
    command.args(["-lc", script]);
    command
}
