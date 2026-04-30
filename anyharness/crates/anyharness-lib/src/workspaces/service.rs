use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use uuid::Uuid;

use super::detector;
use super::model::{ResolvedGitContext, WorkspaceRecord};
use super::resolver;
use super::store::WorkspaceStore;
use super::types::{
    CreateWorktreeResult, ProjectSetupDetectionResult, RegisterRepoWorkspaceError,
    SetWorkspaceDisplayNameError,
};
use crate::origin::OriginContext;

const MAX_WORKSPACE_DISPLAY_NAME_CHARS: usize = 160;

#[derive(Clone)]
pub struct WorkspaceService {
    store: WorkspaceStore,
    runtime_home: PathBuf,
}

impl WorkspaceService {
    pub fn new(store: WorkspaceStore, runtime_home: PathBuf) -> Self {
        Self {
            store,
            runtime_home,
        }
    }

    pub fn resolve_from_path(&self, path: &str) -> anyhow::Result<WorkspaceRecord> {
        let started = Instant::now();
        tracing::info!(path = %path, "[workspace-latency] workspace.resolve.start");

        let ctx = resolver::resolve_git_context(path)?;
        let workspace_path = &ctx.repo_root;
        tracing::info!(
            path = %path,
            repo_root = %workspace_path,
            is_worktree = ctx.is_worktree,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.resolve.git_context_resolved"
        );

        if ctx.is_worktree {
            // Worktree paths are unique — plain find_by_path is safe.
            if let Some(existing) = self.store.find_by_path(workspace_path)? {
                tracing::info!(
                    path = %path,
                    workspace_id = %existing.id,
                    workspace_kind = %existing.kind,
                    total_elapsed_ms = started.elapsed().as_millis(),
                    "[workspace-latency] workspace.resolve.existing_hit"
                );
                return self.reconcile_current_branch(existing);
            }

            let remote = ctx
                .remote_url
                .as_deref()
                .and_then(resolver::parse_remote_url);
            let now = chrono::Utc::now().to_rfc3339();

            let main_path = ctx.main_worktree_path.as_deref().unwrap_or(workspace_path);
            let ensure_started = Instant::now();
            let source_ws = self.ensure_repo_workspace(main_path)?;
            tracing::info!(
                path = %path,
                source_workspace_id = %source_ws.id,
                elapsed_ms = ensure_started.elapsed().as_millis(),
                "[workspace-latency] workspace.resolve.source_workspace_ready"
            );

            let record = WorkspaceRecord {
                id: Uuid::new_v4().to_string(),
                kind: "worktree".into(),
                repo_root_id: None,
                path: workspace_path.clone(),
                surface: "standard".into(),
                source_repo_root_path: main_path.to_string(),
                source_workspace_id: Some(source_ws.id.clone()),
                git_provider: remote.as_ref().map(|r| r.provider.clone()),
                git_owner: remote.as_ref().map(|r| r.owner.clone()),
                git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
                original_branch: ctx.current_branch.clone(),
                current_branch: ctx.current_branch.clone(),
                display_name: None,
                origin: Some(OriginContext::api_local_runtime()),
                creator_context: None,
                lifecycle_state: "active".to_string(),
                cleanup_state: "none".to_string(),
                created_at: now.clone(),
                updated_at: now,
            };
            self.store.insert(&record)?;
            tracing::info!(
                path = %path,
                workspace_id = %record.id,
                workspace_kind = %record.kind,
                total_elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] workspace.resolve.completed"
            );
            Ok(record)
        } else {
            // Non-worktree: look for an existing "local" workspace at this path.
            if let Some(existing) = self.store.find_by_path_and_kind(workspace_path, "local")? {
                tracing::info!(
                    path = %path,
                    workspace_id = %existing.id,
                    workspace_kind = %existing.kind,
                    total_elapsed_ms = started.elapsed().as_millis(),
                    "[workspace-latency] workspace.resolve.existing_hit"
                );
                return self.reconcile_current_branch(existing);
            }

            let source_ws = self.ensure_repo_workspace(workspace_path)?;
            let record = build_local_workspace_record(&ctx, &source_ws);
            self.store.insert(&record)?;
            tracing::info!(
                path = %path,
                workspace_id = %record.id,
                workspace_kind = %record.kind,
                total_elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] workspace.resolve.completed"
            );
            Ok(record)
        }
    }

    pub fn register_repo_from_path(
        &self,
        path: &str,
    ) -> Result<WorkspaceRecord, RegisterRepoWorkspaceError> {
        let ctx = resolver::resolve_git_context(path)
            .map_err(|_| RegisterRepoWorkspaceError::NotGitRepo)?;

        if ctx.is_worktree {
            return Err(RegisterRepoWorkspaceError::WorktreeNotAllowed);
        }

        if let Some(existing) = self
            .store
            .find_repo_by_source_root_path(&ctx.repo_root)
            .map_err(RegisterRepoWorkspaceError::Unexpected)?
        {
            return self
                .reconcile_current_branch(existing)
                .map_err(RegisterRepoWorkspaceError::Unexpected);
        }

        let record = build_repo_workspace_record(&ctx);
        self.store
            .insert(&record)
            .map_err(RegisterRepoWorkspaceError::Unexpected)?;
        Ok(record)
    }

    pub fn create_workspace(&self, path: &str) -> anyhow::Result<WorkspaceRecord> {
        let started = Instant::now();
        tracing::info!(path = %path, "[workspace-latency] workspace.create.start");

        let ctx = resolver::resolve_git_context(path)?;
        let workspace_path = &ctx.repo_root;
        tracing::info!(
            path = %path,
            repo_root = %workspace_path,
            is_worktree = ctx.is_worktree,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.create.git_context_resolved"
        );

        let remote = ctx
            .remote_url
            .as_deref()
            .and_then(resolver::parse_remote_url);

        let now = chrono::Utc::now().to_rfc3339();

        let record = if ctx.is_worktree {
            let main_path = ctx.main_worktree_path.as_deref().unwrap_or(workspace_path);
            let ensure_started = Instant::now();
            let source_ws = self.ensure_repo_workspace(main_path)?;
            tracing::info!(
                path = %path,
                source_workspace_id = %source_ws.id,
                elapsed_ms = ensure_started.elapsed().as_millis(),
                "[workspace-latency] workspace.create.source_workspace_ready"
            );

            WorkspaceRecord {
                id: Uuid::new_v4().to_string(),
                kind: "worktree".into(),
                repo_root_id: None,
                path: workspace_path.clone(),
                surface: "standard".into(),
                source_repo_root_path: main_path.to_string(),
                source_workspace_id: Some(source_ws.id.clone()),
                git_provider: remote.as_ref().map(|r| r.provider.clone()),
                git_owner: remote.as_ref().map(|r| r.owner.clone()),
                git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
                original_branch: ctx.current_branch.clone(),
                current_branch: ctx.current_branch.clone(),
                display_name: None,
                origin: Some(OriginContext::api_local_runtime()),
                creator_context: None,
                lifecycle_state: "active".to_string(),
                cleanup_state: "none".to_string(),
                created_at: now.clone(),
                updated_at: now,
            }
        } else {
            let source_ws = self.ensure_repo_workspace(workspace_path)?;
            build_local_workspace_record(&ctx, &source_ws)
        };
        self.store.insert(&record)?;
        tracing::info!(
            path = %path,
            workspace_id = %record.id,
            workspace_kind = %record.kind,
            total_elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.create.completed"
        );
        Ok(record)
    }

    /// Create a git worktree and register it as a workspace.
    ///
    /// Setup execution is owned by the runtime/HTTP adapter so command-run
    /// state stays with terminals instead of workspace persistence.
    pub fn create_worktree(
        &self,
        source_workspace_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        setup_script: Option<&str>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        let started = Instant::now();
        let has_setup_script = setup_script
            .map(str::trim)
            .map(|script| !script.is_empty())
            .unwrap_or(false);
        tracing::info!(
            source_workspace_id = %source_workspace_id,
            target_path = %target_path,
            new_branch_name = %new_branch_name,
            base_branch = ?base_branch,
            has_setup_script,
            "[workspace-latency] workspace.worktree.create.start"
        );

        let source_lookup_started = Instant::now();
        let source = self
            .store
            .find_by_id(source_workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("source workspace not found: {source_workspace_id}"))?;
        tracing::info!(
            source_workspace_id = %source_workspace_id,
            source_kind = %source.kind,
            elapsed_ms = source_lookup_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.source_loaded"
        );

        let effective_source = if source.kind == "local" {
            let parent_id = source
                .source_workspace_id
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("local workspace has no source_workspace_id"))?;
            self.store
                .find_by_id(parent_id)?
                .ok_or_else(|| anyhow::anyhow!("parent repo workspace not found: {parent_id}"))?
        } else if source.kind == "repo" {
            source
        } else {
            anyhow::bail!(
                "source must be a repo or local workspace, got '{}'",
                source.kind
            );
        };

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

        resolver::create_git_worktree(
            &effective_source.path,
            target_path,
            new_branch_name,
            base_branch,
        )?;

        let context_started = Instant::now();
        let ctx = resolver::resolve_git_context(target_path)?;
        let remote = ctx
            .remote_url
            .as_deref()
            .and_then(resolver::parse_remote_url);
        let current_branch = ctx.current_branch.clone();
        tracing::info!(
            source_workspace_id = %source_workspace_id,
            target_path = %target_path,
            repo_root = %ctx.repo_root,
            current_branch = ?current_branch,
            elapsed_ms = context_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.context_resolved"
        );

        let now = chrono::Utc::now().to_rfc3339();
        let record = WorkspaceRecord {
            id: Uuid::new_v4().to_string(),
            kind: "worktree".into(),
            repo_root_id: None,
            path: ctx.repo_root,
            surface: "standard".into(),
            source_repo_root_path: effective_source.source_repo_root_path.clone(),
            source_workspace_id: Some(effective_source.id.clone()),
            git_provider: remote.as_ref().map(|r| r.provider.clone()),
            git_owner: remote.as_ref().map(|r| r.owner.clone()),
            git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
            original_branch: current_branch.clone(),
            current_branch,
            display_name: None,
            origin: Some(OriginContext::api_local_runtime()),
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        let insert_started = Instant::now();
        self.store.insert(&record)?;
        tracing::info!(
            workspace_id = %record.id,
            source_workspace_id = %source_workspace_id,
            elapsed_ms = insert_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.record_inserted"
        );

        tracing::info!(
            workspace_id = %record.id,
            "[workspace-latency] workspace.worktree.setup_script.skipped"
        );

        tracing::info!(
            workspace_id = %record.id,
            source_workspace_id = %source_workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            has_setup_script,
            "[workspace-latency] workspace.worktree.create.completed"
        );

        Ok(CreateWorktreeResult {
            workspace: record,
            setup_script: None,
        })
    }

    pub fn get_workspace(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store
            .find_by_id(id)?
            .map(|record| self.reconcile_current_branch(record))
            .transpose()
    }

    /// Set or clear the user-provided workspace display name.
    ///
    /// `display_name` is trimmed; an empty string clears the override.
    pub fn set_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
    ) -> Result<WorkspaceRecord, SetWorkspaceDisplayNameError> {
        let normalized = display_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if let Some(value) = normalized.as_deref() {
            if value.chars().count() > MAX_WORKSPACE_DISPLAY_NAME_CHARS {
                return Err(SetWorkspaceDisplayNameError::TooLong(
                    MAX_WORKSPACE_DISPLAY_NAME_CHARS,
                ));
            }
        }

        let existing = self
            .store
            .find_by_id(workspace_id)
            .map_err(SetWorkspaceDisplayNameError::Unexpected)?
            .ok_or_else(|| SetWorkspaceDisplayNameError::NotFound(workspace_id.to_string()))?;

        let now = chrono::Utc::now().to_rfc3339();
        self.store
            .update_display_name(workspace_id, normalized.as_deref(), &now)
            .map_err(SetWorkspaceDisplayNameError::Unexpected)?;

        let mut updated = existing;
        updated.display_name = normalized;
        updated.updated_at = now;
        Ok(updated)
    }

    pub fn detect_setup(&self, workspace_id: &str) -> anyhow::Result<ProjectSetupDetectionResult> {
        let record = self
            .store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
        Ok(detector::detect_project_setup(Path::new(&record.path)))
    }

    pub fn list_workspaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.store
            .list_execution_surfaces()?
            .into_iter()
            .map(|record| self.reconcile_current_branch(record))
            .collect()
    }

    pub fn workspace_env(&self, workspace: &WorkspaceRecord) -> BTreeMap<String, String> {
        self.build_workspace_env(workspace, None)
            .into_iter()
            .collect()
    }

    pub fn build_workspace_env(
        &self,
        workspace: &WorkspaceRecord,
        base_ref: Option<&str>,
    ) -> Vec<(String, String)> {
        let mut env = BTreeMap::new();
        env.insert("PROLIFERATE_WORKSPACE_ID".into(), workspace.id.clone());
        env.insert("PROLIFERATE_WORKSPACE_KIND".into(), workspace.kind.clone());
        env.insert("PROLIFERATE_WORKSPACE_DIR".into(), workspace.path.clone());
        env.insert(
            "PROLIFERATE_REPO_DIR".into(),
            workspace.source_repo_root_path.clone(),
        );
        env.insert(
            "PROLIFERATE_RUNTIME_HOME".into(),
            self.runtime_home.display().to_string(),
        );
        let repo_name = workspace
            .git_repo_name
            .clone()
            .unwrap_or_else(|| path_basename(&workspace.source_repo_root_path));
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
        if let Some(source_workspace_id) = &workspace.source_workspace_id {
            env.insert(
                "PROLIFERATE_SOURCE_WORKSPACE_ID".into(),
                source_workspace_id.clone(),
            );
        }
        if let Some(provider) = &workspace.git_provider {
            env.insert("PROLIFERATE_GIT_PROVIDER".into(), provider.clone());
        }
        if let Some(owner) = &workspace.git_owner {
            env.insert("PROLIFERATE_GIT_OWNER".into(), owner.clone());
        }
        if let Some(repo) = &workspace.git_repo_name {
            env.insert("PROLIFERATE_GIT_REPO".into(), repo.clone());
        }
        if workspace.kind == "worktree" {
            env.insert("PROLIFERATE_WORKTREE_DIR".into(), workspace.path.clone());
        }
        env.into_iter().collect()
    }

    fn ensure_repo_workspace(&self, path: &str) -> anyhow::Result<WorkspaceRecord> {
        if let Some(existing) = self.store.find_repo_by_source_root_path(path)? {
            return Ok(existing);
        }
        let ctx = resolver::resolve_git_context(path)?;
        let record = build_repo_workspace_record(&ctx);
        self.store.insert(&record)?;
        Ok(record)
    }

    fn reconcile_current_branch(
        &self,
        mut record: WorkspaceRecord,
    ) -> anyhow::Result<WorkspaceRecord> {
        let next_branch = resolver::resolve_git_context(&record.path)
            .ok()
            .and_then(|ctx| ctx.current_branch)
            .or(record.current_branch.clone());

        if next_branch != record.current_branch {
            let now = chrono::Utc::now().to_rfc3339();
            self.store
                .update_current_branch(&record.id, next_branch.as_deref(), &now)?;
            record.current_branch = next_branch;
            record.updated_at = now;
            return Ok(record);
        }

        record.current_branch = next_branch;
        Ok(record)
    }
}

fn build_repo_workspace_record(ctx: &ResolvedGitContext) -> WorkspaceRecord {
    let remote = ctx
        .remote_url
        .as_deref()
        .and_then(resolver::parse_remote_url);
    let current_branch = ctx.current_branch.clone();
    let now = chrono::Utc::now().to_rfc3339();

    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: "repo".into(),
        repo_root_id: None,
        path: ctx.repo_root.clone(),
        surface: "standard".into(),
        source_repo_root_path: ctx.repo_root.clone(),
        source_workspace_id: None,
        git_provider: remote.as_ref().map(|r| r.provider.clone()),
        git_owner: remote.as_ref().map(|r| r.owner.clone()),
        git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        origin: Some(OriginContext::system_local_runtime()),
        creator_context: None,
        lifecycle_state: "active".to_string(),
        cleanup_state: "none".to_string(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn build_local_workspace_record(
    ctx: &ResolvedGitContext,
    source_repo: &WorkspaceRecord,
) -> WorkspaceRecord {
    let remote = ctx
        .remote_url
        .as_deref()
        .and_then(resolver::parse_remote_url);
    let current_branch = ctx.current_branch.clone();
    let now = chrono::Utc::now().to_rfc3339();

    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: "local".into(),
        repo_root_id: None,
        path: ctx.repo_root.clone(),
        surface: "standard".into(),
        source_repo_root_path: source_repo.source_repo_root_path.clone(),
        source_workspace_id: Some(source_repo.id.clone()),
        git_provider: remote.as_ref().map(|r| r.provider.clone()),
        git_owner: remote.as_ref().map(|r| r.owner.clone()),
        git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        origin: Some(OriginContext::api_local_runtime()),
        creator_context: None,
        lifecycle_state: "active".to_string(),
        cleanup_state: "none".to_string(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::{env, fs};

    use super::WorkspaceService;
    use crate::persistence::Db;
    use crate::workspaces::store::WorkspaceStore;
    use crate::workspaces::types::RegisterRepoWorkspaceError;
    use uuid::Uuid;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn register_repo_from_path_creates_repo_workspace_without_sessions() {
        let repo_root = TempDirGuard::new("repo-register-root");
        let runtime_home = TempDirGuard::new("repo-register-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = WorkspaceService::new(
            WorkspaceStore::new(db.clone()),
            runtime_home.path().to_path_buf(),
        );

        let workspace = service
            .register_repo_from_path(&repo_root.path().display().to_string())
            .expect("register repo");
        let canonical_repo_root = fs::canonicalize(repo_root.path())
            .expect("canonicalize repo root")
            .display()
            .to_string();

        assert_eq!(workspace.kind, "repo");
        assert_eq!(workspace.source_repo_root_path, canonical_repo_root);

        let session_count: i64 = db
            .with_conn(|conn| conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0)))
            .expect("count sessions");
        assert_eq!(session_count, 0);
    }

    #[test]
    fn register_repo_from_path_is_idempotent() {
        let repo_root = TempDirGuard::new("repo-register-idempotent");
        let runtime_home = TempDirGuard::new("repo-register-runtime");
        init_repo(repo_root.path());

        let service = WorkspaceService::new(
            WorkspaceStore::new(Db::open_in_memory().expect("open db")),
            runtime_home.path().to_path_buf(),
        );

        let first = service
            .register_repo_from_path(&repo_root.path().display().to_string())
            .expect("first register");
        let second = service
            .register_repo_from_path(&repo_root.path().display().to_string())
            .expect("second register");

        assert_eq!(first.id, second.id);
    }

    #[test]
    fn register_repo_from_path_rejects_worktree_paths() {
        let repo_root = TempDirGuard::new("repo-register-main");
        let worktree_root = TempDirGuard::new("repo-register-worktree");
        let runtime_home = TempDirGuard::new("repo-register-runtime");
        init_repo(repo_root.path());
        add_worktree(
            repo_root.path(),
            worktree_root.path(),
            "feature/register-repo",
        );

        let service = WorkspaceService::new(
            WorkspaceStore::new(Db::open_in_memory().expect("open db")),
            runtime_home.path().to_path_buf(),
        );

        let error = service
            .register_repo_from_path(&worktree_root.path().display().to_string())
            .expect_err("expected worktree rejection");

        assert!(matches!(
            error,
            RegisterRepoWorkspaceError::WorktreeNotAllowed
        ));
    }

    #[test]
    fn register_repo_from_path_rejects_non_git_directories() {
        let non_git_root = TempDirGuard::new("repo-register-non-git");
        let runtime_home = TempDirGuard::new("repo-register-runtime");

        let service = WorkspaceService::new(
            WorkspaceStore::new(Db::open_in_memory().expect("open db")),
            runtime_home.path().to_path_buf(),
        );

        let error = service
            .register_repo_from_path(&non_git_root.path().display().to_string())
            .expect_err("expected non-git rejection");

        assert!(matches!(error, RegisterRepoWorkspaceError::NotGitRepo));
    }

    fn init_repo(path: &Path) {
        run_git(path, ["init", "-b", "main"]);
        run_git(path, ["config", "user.email", "codex@example.com"]);
        run_git(path, ["config", "user.name", "Codex"]);
        fs::write(path.join("README.md"), "seed\n").expect("write seed file");
        run_git(path, ["add", "README.md"]);
        run_git(path, ["commit", "-m", "Initial commit"]);
    }

    fn add_worktree(repo_root: &Path, worktree_path: &Path, branch_name: &str) {
        let worktree_str = worktree_path.display().to_string();
        run_git(
            repo_root,
            ["worktree", "add", "-b", branch_name, &worktree_str, "HEAD"],
        );
    }

    fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn make_service(db: &Db, runtime_home: &Path) -> WorkspaceService {
        WorkspaceService::new(WorkspaceStore::new(db.clone()), runtime_home.to_path_buf())
    }

    #[test]
    fn resolve_from_path_creates_local_with_repo_parent() {
        let repo_root = TempDirGuard::new("resolve-local-root");
        let runtime_home = TempDirGuard::new("resolve-local-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let workspace = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve workspace");

        assert_eq!(workspace.kind, "local");
        assert!(workspace.source_workspace_id.is_some());

        // The structural repo parent should also exist.
        let store = WorkspaceStore::new(db.clone());
        let parent = store
            .find_by_id(workspace.source_workspace_id.as_deref().unwrap())
            .expect("find parent")
            .expect("parent must exist");
        assert_eq!(parent.kind, "repo");
    }

    #[test]
    fn resolve_from_path_returns_existing_local() {
        let repo_root = TempDirGuard::new("resolve-local-idempotent");
        let runtime_home = TempDirGuard::new("resolve-local-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());
        let path = repo_root.path().display().to_string();

        let first = service.resolve_from_path(&path).expect("first resolve");
        let second = service.resolve_from_path(&path).expect("second resolve");

        assert_eq!(first.id, second.id);
        assert_eq!(first.kind, "local");
    }

    #[test]
    fn create_workspace_creates_local() {
        let repo_root = TempDirGuard::new("create-local-root");
        let runtime_home = TempDirGuard::new("create-local-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let workspace = service
            .create_workspace(&repo_root.path().display().to_string())
            .expect("create workspace");

        assert_eq!(workspace.kind, "local");
        assert!(workspace.source_workspace_id.is_some());
    }

    #[test]
    fn set_display_name_persists_and_normalizes() {
        let repo_root = TempDirGuard::new("display-name-persist-root");
        let runtime_home = TempDirGuard::new("display-name-persist-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let workspace = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve workspace");
        assert!(workspace.display_name.is_none());

        // Setting a display name (with surrounding whitespace) trims and persists.
        let updated = service
            .set_display_name(&workspace.id, Some("  My Custom Name  "))
            .expect("set display name");
        assert_eq!(updated.display_name.as_deref(), Some("My Custom Name"));

        // Reading back from the store returns the persisted value.
        let reloaded = service
            .get_workspace(&workspace.id)
            .expect("get workspace")
            .expect("workspace exists");
        assert_eq!(reloaded.display_name.as_deref(), Some("My Custom Name"));
    }

    #[test]
    fn set_display_name_clears_when_empty_or_none() {
        let repo_root = TempDirGuard::new("display-name-clear-root");
        let runtime_home = TempDirGuard::new("display-name-clear-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let workspace = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve workspace");
        service
            .set_display_name(&workspace.id, Some("Pinned"))
            .expect("set display name");

        // Empty string clears the override.
        let cleared_via_empty = service
            .set_display_name(&workspace.id, Some("   "))
            .expect("clear via whitespace");
        assert!(cleared_via_empty.display_name.is_none());

        // Set again, then clear via None.
        service
            .set_display_name(&workspace.id, Some("Pinned again"))
            .expect("set display name again");
        let cleared_via_none = service
            .set_display_name(&workspace.id, None)
            .expect("clear via none");
        assert!(cleared_via_none.display_name.is_none());
    }

    #[test]
    fn set_display_name_rejects_too_long() {
        let repo_root = TempDirGuard::new("display-name-too-long-root");
        let runtime_home = TempDirGuard::new("display-name-too-long-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let workspace = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve workspace");

        let too_long = "x".repeat(161);
        let error = service
            .set_display_name(&workspace.id, Some(&too_long))
            .expect_err("expected too-long error");
        assert!(matches!(
            error,
            crate::workspaces::types::SetWorkspaceDisplayNameError::TooLong(160)
        ));
    }

    #[test]
    fn set_display_name_returns_not_found_for_unknown_workspace() {
        let runtime_home = TempDirGuard::new("display-name-not-found-runtime");
        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let error = service
            .set_display_name("does-not-exist", Some("anything"))
            .expect_err("expected not-found error");
        assert!(matches!(
            error,
            crate::workspaces::types::SetWorkspaceDisplayNameError::NotFound(_)
        ));
    }

    #[test]
    fn reconcile_current_branch_preserves_display_name() {
        let repo_root = TempDirGuard::new("display-name-reconcile-root");
        let runtime_home = TempDirGuard::new("display-name-reconcile-runtime");
        init_repo(repo_root.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        let workspace = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve workspace");
        service
            .set_display_name(&workspace.id, Some("Stable Name"))
            .expect("set display name");

        // Rename the branch on disk; resolve again to trigger reconcile.
        run_git(repo_root.path(), ["branch", "-m", "renamed"]);
        let reconciled = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve again");
        assert_eq!(reconciled.display_name.as_deref(), Some("Stable Name"));
        assert_eq!(reconciled.current_branch.as_deref(), Some("renamed"));
    }

    #[test]
    fn create_worktree_accepts_local_source() {
        let repo_root = TempDirGuard::new("worktree-local-source-main");
        let worktree_target = TempDirGuard::new("worktree-local-source-target");
        let runtime_home = TempDirGuard::new("worktree-local-source-runtime");
        init_repo(repo_root.path());
        // Remove the target dir so create_worktree can create it.
        let _ = fs::remove_dir_all(worktree_target.path());

        let db = Db::open_in_memory().expect("open db");
        let service = make_service(&db, runtime_home.path());

        // Create a local workspace first (which also creates the repo parent).
        let local_ws = service
            .resolve_from_path(&repo_root.path().display().to_string())
            .expect("resolve local workspace");
        assert_eq!(local_ws.kind, "local");

        // Create worktree from the local workspace.
        let result = service
            .create_worktree(
                &local_ws.id,
                &worktree_target.path().display().to_string(),
                "feature/from-local",
                None,
                None,
            )
            .expect("create worktree from local");

        assert_eq!(result.workspace.kind, "worktree");
        // The worktree should point to the repo parent, not the local workspace.
        assert_eq!(
            result.workspace.source_workspace_id.as_deref(),
            local_ws.source_workspace_id.as_deref()
        );
    }
}
