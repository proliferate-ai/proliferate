//! Shared real-state test harness for the workspace-materialization batteries:
//! real SQLite, real Git, per-test isolated managed worktrees root.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use tokio::runtime::Handle;

use super::model::MaterializationRecord;
use super::runtime::{WorkflowWorkspaceRuntime, WorkspacePutSuccess};
use super::service::WorkflowWorkspaceService;
use super::store::MaterializationStore;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::domains::workspaces::workflow_placement::WorkflowPlacementRequest;
use crate::persistence::Db;

pub(super) const RUN_ID: &str = "77777777-7777-4777-8777-777777777777";

pub(super) struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    pub(super) fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("anyharness-{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(super) struct Harness {
    _root: Option<TempDirGuard>,
    pub(super) root_path: PathBuf,
    pub(super) db: Db,
    pub(super) workspace_runtime: Arc<WorkspaceRuntime>,
    pub(super) service: Arc<WorkflowWorkspaceService>,
    pub(super) runtime: Arc<WorkflowWorkspaceRuntime>,
}

impl Harness {
    pub(super) fn new(prefix: &str) -> Self {
        Self::with_db(prefix, Db::open_in_memory().expect("in-memory db"))
    }

    pub(super) fn with_db(prefix: &str, db: Db) -> Self {
        Self::build(Some(TempDirGuard::new(prefix)), None, db)
    }

    /// A harness rooted at an externally owned directory (survives this
    /// harness's drop) — for restart tests that reopen state.
    pub(super) fn at_external_root(root: &Path, db: Db) -> Self {
        Self::build(None, Some(root.to_path_buf()), db)
    }

    fn build(owned_root: Option<TempDirGuard>, external_root: Option<PathBuf>, db: Db) -> Self {
        let root_path = external_root.unwrap_or_else(|| {
            owned_root
                .as_ref()
                .expect("owned or external root")
                .path()
                .to_path_buf()
        });
        let runtime_home = root_path.join("runtime");
        std::fs::create_dir_all(&runtime_home).expect("runtime home");
        let workspace_runtime = Arc::new(WorkspaceRuntime::new(
            WorkspaceStore::new(db.clone()),
            WorkspaceDeleteWorkflow::new(
                db.clone(),
                crate::domains::sessions::deletion::SessionDeleteWorkflow::new(db.clone()),
            ),
            RepoRootService::new(RepoRootStore::new(db.clone())),
            runtime_home,
        ));
        let service = Arc::new(WorkflowWorkspaceService::new(MaterializationStore::new(
            db.clone(),
        )));
        let runtime = Arc::new(WorkflowWorkspaceRuntime::new(
            service.clone(),
            workspace_runtime.clone(),
            Handle::current(),
        ));
        Self {
            _root: owned_root,
            root_path,
            db,
            workspace_runtime,
            service,
            runtime,
        }
    }

    /// The deterministic target path for a run under this harness's root.
    pub(super) fn workflow_path(&self, run_id: &str) -> PathBuf {
        let canonical_root = std::fs::canonicalize(&self.root_path).expect("canonical root");
        canonical_root
            .join("worktrees")
            .join("workflows")
            .join(run_id)
    }

    /// Initialize a source repository with one commit and return its
    /// (repo_root_id, path, head_oid).
    pub(super) fn source_repo(&self) -> (String, PathBuf, String) {
        let source = self.root_path.join("source");
        std::fs::create_dir_all(&source).expect("source dir");
        init_repo(&source);
        let repo_root = self
            .workspace_runtime
            .resolve_repo_root_from_path(source.to_str().expect("utf8 path"))
            .expect("resolve repo root");
        let head = git_stdout(&source, &["rev-parse", "HEAD"]);
        (repo_root.id, source, head)
    }

    /// A source repository with an ANNOTATED tag pointing at HEAD. Returns
    /// (repo_root_id, source_path, tag_name, tag_object_oid, commit_oid) where
    /// the tag object OID differs from the commit it points at — the GIT-01
    /// distinction.
    pub(super) fn source_repo_with_annotated_tag(
        &self,
    ) -> (String, PathBuf, String, String, String) {
        let (repo_root_id, source, commit_oid) = self.source_repo();
        let tag = "v1.0.0";
        run_git(&source, &["tag", "-a", tag, "-m", "annotated release tag"]);
        let tag_object_oid = git_stdout(&source, &["rev-parse", tag]);
        // Sanity: an annotated tag's own object OID differs from the commit.
        assert_ne!(
            tag_object_oid, commit_oid,
            "expected an annotated tag object distinct from its commit"
        );
        (
            repo_root_id,
            source,
            tag.to_string(),
            tag_object_oid,
            commit_oid,
        )
    }

    pub(super) fn table_count(&self, table: &str) -> i64 {
        self.db
            .with_conn(|conn| {
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
            })
            .expect("count rows")
    }
}

/// A typed scratch placement for `run_id`. Strict wire decode is proved at the
/// HTTP contract boundary (`api::workflow_workspaces_tests`); the domain tests
/// exercise the already-decoded placement.
pub(super) fn scratch_body(run_id: &str) -> WorkflowPlacementRequest {
    WorkflowPlacementRequest::Scratch {
        run_id: run_id.to_string(),
    }
}

/// A typed repository-worktree placement for `run_id`.
pub(super) fn repo_body(
    run_id: &str,
    repo_root_id: &str,
    base_ref: &str,
) -> WorkflowPlacementRequest {
    WorkflowPlacementRequest::RepositoryWorktree {
        run_id: run_id.to_string(),
        repo_root_id: repo_root_id.to_string(),
        base_ref: base_ref.to_string(),
    }
}

pub(super) fn init_repo(path: &Path) {
    run_git(path, &["init", "-b", "main"]);
    run_git(path, &["config", "user.email", "codex@example.com"]);
    run_git(path, &["config", "user.name", "Codex"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run_git(path, &["add", "README.md"]);
    run_git(path, &["commit", "-m", "Initial commit"]);
}

pub(super) fn run_git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
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

pub(super) fn git_stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
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
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn record_of(outcome: &WorkspacePutSuccess) -> &MaterializationRecord {
    match outcome {
        WorkspacePutSuccess::Created(record) | WorkspacePutSuccess::Replay(record) => record,
    }
}
