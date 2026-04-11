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

    pub fn list_repo_root_workspaces(
        &self,
        repo_root_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        Ok(self
            .store
            .list_by_repo_root_id(repo_root_id)?
            .into_iter()
            .filter(|record| matches!(record.kind.as_str(), "local" | "worktree"))
            .collect())
    }

    pub fn create_mobility_destination(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
        preferred_workspace_name: Option<&str>,
    ) -> anyhow::Result<WorkspaceRecord> {
        let requested_branch = requested_branch.trim();
        let requested_base_sha = requested_base_sha.trim();
        if requested_branch.is_empty() {
            anyhow::bail!("requested branch is required");
        }
        if requested_base_sha.is_empty() {
            anyhow::bail!("requested base sha is required");
        }

        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let base_dir = self
            .runtime_home
            .join("mobility")
            .join("destinations")
            .join(&repo_root.id);
        fs::create_dir_all(&base_dir)?;

        let mut slug = sanitize_mobility_destination_name(
            preferred_workspace_name.unwrap_or(requested_branch),
        );
        if slug.is_empty() {
            slug = "workspace".to_string();
        }
        let short_sha = requested_base_sha.chars().take(8).collect::<String>();

        let target_path = (0..100)
            .map(|attempt| {
                let suffix = if attempt == 0 {
                    String::new()
                } else {
                    format!("-{}", attempt + 1)
                };
                base_dir.join(format!("{slug}-{short_sha}{suffix}"))
            })
            .find(|candidate| {
                let candidate_string = candidate.to_string_lossy();
                !candidate.exists()
                    && self
                        .store
                        .find_by_path(&candidate_string)
                        .ok()
                        .flatten()
                        .is_none()
            })
            .ok_or_else(|| anyhow::anyhow!("unable to allocate a mobility destination path"))?;

        let target_path_string = target_path.display().to_string();
        resolver::create_mobility_git_worktree(
            &repo_root.path,
            &target_path_string,
            requested_branch,
            requested_base_sha,
        )?;

        let ctx = resolver::resolve_git_context(&target_path_string)?;
        let record = build_workspace_record(
            &repo_root,
            &ctx.repo_root,
            "worktree",
            "standard",
            ctx.current_branch.clone(),
        );
        self.store.insert(&record)?;

        Ok(record)
    }

    pub fn resolve_repo_root_default_branch(&self, repo_root_id: &str) -> anyhow::Result<String> {
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;
        let default_branch = detect_repo_default_branch(Path::new(&repo_root.path))
            .ok_or_else(|| anyhow::anyhow!("canonical repo default branch could not be resolved"))?;

        if repo_root.default_branch.as_deref() != Some(default_branch.as_str()) {
            let _ = self
                .repo_root_service
                .update_default_branch(&repo_root.id, Some(&default_branch))?;
        }

        Ok(default_branch)
    }

    pub fn get_workspace(&self, workspace_id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store
            .find_by_id(workspace_id)?
            .filter(|record| record.kind != "repo")
            .map(reconcile_current_branch)
            .transpose()
    }

    pub fn delete_workspace_record(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.store.delete_by_id(workspace_id)
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
        self.remove_worktree_workspace(repo_root_path, workspace_id, worktree_path)
    }

    pub fn destroy_source_workspace_materialization(
        &self,
        workspace: &WorkspaceRecord,
        default_branch: Option<&str>,
    ) -> anyhow::Result<()> {
        match workspace.kind.as_str() {
            "worktree" => self.remove_worktree_workspace(
                &workspace.source_repo_root_path,
                &workspace.id,
                &workspace.path,
            ),
            "local" => {
                let branch = default_branch
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| anyhow::anyhow!("default branch is required to park a local workspace"))?;
                self.park_local_workspace(workspace, branch)
            }
            kind => anyhow::bail!("unsupported workspace kind for mobility source destroy: {kind}"),
        }
    }

    fn remove_worktree_workspace(
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

    fn park_local_workspace(
        &self,
        workspace: &WorkspaceRecord,
        default_branch: &str,
    ) -> anyhow::Result<()> {
        let workspace_path = Path::new(&workspace.path);
        let local_branch_exists = git_ref_exists(workspace_path, &format!("refs/heads/{default_branch}"));
        let remote_branch_exists = git_ref_exists(
            workspace_path,
            &format!("refs/remotes/origin/{default_branch}"),
        );

        let switch_args: Vec<String> = if local_branch_exists {
            vec!["switch".into(), default_branch.to_string()]
        } else if remote_branch_exists {
            vec![
                "switch".into(),
                "--track".into(),
                "-c".into(),
                default_branch.to_string(),
                format!("origin/{default_branch}"),
            ]
        } else {
            anyhow::bail!("default branch '{default_branch}' is not available locally or on origin");
        };

        let output = Command::new("git")
            .args(["-C", &workspace.path])
            .args(&switch_args)
            .output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            anyhow::bail!(
                "failed to park local workspace on default branch '{default_branch}': {stderr}"
            );
        }

        self.store.delete_by_id(&workspace.id)?;
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
        let detected_default_branch = detect_repo_default_branch(Path::new(&repo_root_path));
        let repo_root = self
            .repo_root_service
            .ensure_repo_root(CreateRepoRootInput {
                kind: "external".into(),
                path: repo_root_path,
                display_name: None,
                default_branch: detected_default_branch,
                remote_provider: remote.as_ref().map(|value| value.provider.clone()),
                remote_owner: remote.as_ref().map(|value| value.owner.clone()),
                remote_repo_name: remote.as_ref().map(|value| value.repo.clone()),
                remote_url: ctx.remote_url.clone(),
            })?;
        let repo_root = if let Some(default_branch) = detect_repo_default_branch(Path::new(&repo_root.path)) {
            if repo_root.default_branch.as_deref() != Some(default_branch.as_str()) {
                self.repo_root_service
                    .update_default_branch(&repo_root.id, Some(&default_branch))?
                    .unwrap_or(repo_root)
            } else {
                repo_root
            }
        } else {
            repo_root
        };

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

fn sanitize_mobility_destination_name(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' => ch.to_ascii_lowercase(),
            '-' | '_' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn detect_repo_default_branch(repo_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", &repo_root.display().to_string(), "symbolic-ref", "refs/remotes/origin/HEAD"])
        .output()
        .ok()?;
    if output.status.success() {
        let refname = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Some(default_branch) = refname.strip_prefix("refs/remotes/origin/") {
            return Some(default_branch.to_string());
        }
    }

    for candidate in ["main", "master", "develop"] {
        if git_ref_exists(repo_root, &format!("refs/remotes/origin/{candidate}"))
            || git_ref_exists(repo_root, &format!("refs/heads/{candidate}"))
        {
            return Some(candidate.to_string());
        }
    }

    None
}

fn git_ref_exists(repo_root: &Path, ref_name: &str) -> bool {
    Command::new("git")
        .args(["-C", &repo_root.display().to_string(), "rev-parse", "--verify", ref_name])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
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
