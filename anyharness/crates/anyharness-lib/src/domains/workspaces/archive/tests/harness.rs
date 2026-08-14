//! One real runtime, one real repository, real worktrees.
//!
//! The orchestrator's guarantees are all about what is on disk and in the row
//! after a step fails, so a harness that faked either would prove nothing. Every
//! test here therefore builds a genuine `AppState` over an in-memory database
//! plus a genuine git repository under a temp directory, and asserts against
//! `git status`, `git rev-parse`, and the stored row.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use uuid::Uuid;

use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::workspaces::archive::WorkspaceArchiveService;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::persistence::Db;

pub(super) struct Harness {
    /// Deleted on Drop. Everything the test touches lives under it, so a failed
    /// test cannot leave worktrees or refs behind on the machine.
    base: PathBuf,
    pub(super) state: AppState,
    pub(super) repo_root: PathBuf,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

impl Harness {
    pub(super) fn new(label: &str) -> Self {
        let base =
            std::env::temp_dir().join(format!("anyharness-archive-{label}-{}", Uuid::new_v4()));
        let runtime_home = base.join("runtime");
        // The managed worktrees root is `runtime_home.parent()/worktrees`, which
        // is what makes the sweep's containment guard meaningful here instead of
        // vacuously true.
        std::fs::create_dir_all(base.join("worktrees")).expect("create managed worktrees root");
        std::fs::create_dir_all(&runtime_home).expect("create runtime home");
        let repo_root = base.join("repo");
        std::fs::create_dir_all(&repo_root).expect("create repo root");
        init_repo(&repo_root);

        let state = AppState::new(
            runtime_home,
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("open in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("create app state");

        Self {
            base,
            state,
            repo_root,
        }
    }

    pub(super) fn service(&self) -> Arc<WorkspaceArchiveService> {
        self.state.workspace_archive_service.clone()
    }

    /// A worktree workspace: a real `git worktree add` inside the managed root
    /// plus the two rows the orchestrator reads.
    pub(super) fn worktree_workspace(&self, id: &str) -> PathBuf {
        let path = self.base.join("worktrees").join(id);
        git(
            &self.repo_root,
            &[
                "worktree",
                "add",
                "-b",
                id,
                &path.display().to_string(),
                "HEAD",
            ],
        );
        self.seed_row(id, "worktree", &path);
        path
    }

    /// A worktree workspace checked out on an EXISTING branch, `--force` when
    /// that branch is held elsewhere. The branch-delete guards need both shapes:
    /// a workspace sitting on the repo default branch, and one sharing a branch
    /// with a sibling worktree.
    pub(super) fn worktree_workspace_on(&self, id: &str, branch: &str, force: bool) -> PathBuf {
        let path = self.base.join("worktrees").join(id);
        let path_string = path.display().to_string();
        let mut args = vec!["worktree", "add"];
        if force {
            args.push("--force");
        }
        args.push(&path_string);
        args.push(branch);
        git(&self.repo_root, &args);
        self.seed_row(id, "worktree", &path);
        path
    }

    /// A row recorded at `path` with NO worktree created for it. The shape every
    /// path-claim and adoption test needs: a row whose recorded directory is
    /// something other than its own live checkout.
    pub(super) fn row_at(&self, id: &str, path: &Path) {
        self.seed_row(id, "worktree", path);
    }

    /// A `kind=local` workspace: the user's own checkout, which archive must
    /// never touch.
    pub(super) fn local_workspace(&self, id: &str) -> PathBuf {
        let path = self.base.join("local").join(id);
        std::fs::create_dir_all(&path).expect("create local checkout");
        init_repo(&path);
        std::fs::write(path.join("hand-written.txt"), "mine\n").expect("write local file");
        self.seed_row(id, "local", &path);
        path
    }

    pub(super) fn managed_root(&self) -> PathBuf {
        self.base.join("worktrees")
    }

    fn seed_row(&self, id: &str, kind: &str, path: &Path) {
        let repo_root_id = format!("repo-root-{}", self.repo_root.display());
        let repo_root_path = self.repo_root.display().to_string();
        let path = path.display().to_string();
        let now = "2026-08-13T00:00:00Z";
        // `kind=local` rows point at their own directory as the repo root: a
        // local workspace IS its repository, and the orchestrator resolves the
        // root through the same foreign key either way.
        let (repo_root_id, repo_root_path) = if kind == "local" {
            (format!("repo-root-{id}"), path.clone())
        } else {
            (repo_root_id, repo_root_path)
        };
        self.state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT OR IGNORE INTO repo_roots (
                        id, kind, path, display_name, default_branch, remote_provider,
                        remote_owner, remote_repo_name, remote_url, created_at, updated_at
                     ) VALUES (?1, 'external', ?2, NULL, 'main', NULL, NULL, NULL, NULL, ?3, ?3)",
                    rusqlite::params![repo_root_id, repo_root_path, now],
                )?;
                // `current_branch`/`original_branch` are seeded because real rows
                // carry them and the missing-directory branch reads them to
                // backfill `archived_branch` — a row with them NULL would make
                // that backfill silently untestable.
                conn.execute(
                    "INSERT INTO workspaces (
                        id, kind, repo_root_id, path, surface, lifecycle_state, cleanup_state,
                        display_name, original_branch, current_branch, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, 'standard', 'active', 'none', ?1, ?1, ?1, ?5, ?5)",
                    rusqlite::params![id, kind, repo_root_id, path, now],
                )?;
                Ok(())
            })
            .expect("seed workspace and repo root");
    }

    /// A minimal session row. `assert_can_start_live_session` is keyed by SESSION
    /// id, so the admission suite needs one to reach the archived predicate at
    /// all.
    pub(super) fn seed_session(&self, session_id: &str, workspace_id: &str) {
        self.state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO sessions (id, workspace_id, agent_kind, status, created_at, updated_at)
                     VALUES (?1, ?2, 'claude', 'idle', ?3, ?3)",
                    rusqlite::params![session_id, workspace_id, "2026-08-13T00:00:00Z"],
                )?;
                Ok(())
            })
            .expect("seed session");
    }

    pub(super) fn row(&self, id: &str) -> WorkspaceRecord {
        self.state
            .workspace_archive_service
            .store_for_tests()
            .require_workspace(id)
            .expect("load workspace row")
    }

    /// Force a row into the archived shape without running the flow: the setup
    /// for every tier that has to be reached from a row a previous archive (or a
    /// pre-archiving migration) produced.
    pub(super) fn force_archived(&self, id: &str, head_sha: Option<&str>, branch: Option<&str>) {
        self.state
            .workspace_archive_service
            .store_for_tests()
            .mark_archived(id, head_sha, branch, "2026-08-13T00:00:00Z", None)
            .expect("force archived");
    }
}

pub(super) fn init_repo(path: &Path) {
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.email", "test@example.com"]);
    git(path, &["config", "user.name", "Test"]);
    git(path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    git(path, &["add", "README.md"]);
    git(path, &["commit", "-m", "initial"]);
}

pub(super) fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} in {} failed: {}",
        args,
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

pub(super) fn git_stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn head_sha(cwd: &Path) -> String {
    git_stdout(cwd, &["rev-parse", "HEAD"])
}

/// Leave the worktree dirty in all three ways the snapshot has to survive:
/// staged, unstaged, and untracked.
pub(super) fn make_dirty(path: &Path) {
    std::fs::write(path.join("staged.txt"), "staged\n").expect("write staged file");
    git(path, &["add", "staged.txt"]);
    std::fs::write(path.join("README.md"), "seed\nunstaged\n").expect("modify tracked file");
    std::fs::write(path.join("untracked.txt"), "untracked\n").expect("write untracked file");
}

pub(super) fn status_porcelain(path: &Path) -> String {
    git_stdout(path, &["status", "--porcelain"])
}

/// Commit a new file so the branch tip moves past the archived SHA. The
/// divergence an archive script can create, and the divergence the diverged
/// scenario has to notice.
pub(super) fn commit_on_top(path: &Path, filename: &str) {
    std::fs::write(path.join(filename), "later\n").expect("write later file");
    git(path, &["add", filename]);
    git(path, &["commit", "-m", "later"]);
}
