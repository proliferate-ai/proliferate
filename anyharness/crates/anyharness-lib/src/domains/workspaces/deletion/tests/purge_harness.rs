//! The shared fixture behind `purge_tests.rs`: real `AppState`, real git
//! repositories, real worktrees. The orchestrator's whole promise is "row dies
//! last", so a harness that faked the filesystem or the git state would prove
//! nothing — every test built on this asserts against the actual checkout
//! directory, the actual git worktree registration, and the actual stored row.
//!
//! It lives in its own file only because the suite outgrew the 600-line cap;
//! the tests are one file over in `purge_tests.rs`.

use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

pub(super) struct Harness {
    /// Deleted on Drop. Everything the test touches lives under it, so a
    /// failed test cannot leave worktrees or refs behind on the machine.
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
            std::env::temp_dir().join(format!("anyharness-purge-{label}-{}", Uuid::new_v4()));
        let runtime_home = base.join("runtime");
        // The managed worktrees root is `runtime_home.parent()/worktrees`,
        // which is what makes purge's containment guard meaningful here
        // instead of vacuously true.
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

    pub(super) fn runtime_home(&self) -> PathBuf {
        self.state.runtime_home.clone()
    }

    /// A worktree workspace: a real `git worktree add` inside the managed
    /// root plus the row purge reads.
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
        self.seed_row(
            id,
            "worktree",
            &path,
            "repo-root-1",
            &self.repo_root.display().to_string(),
        );
        path
    }

    /// A `kind=local` workspace: the user's own checkout, which purge must
    /// never remove even though it deletes the row.
    pub(super) fn local_workspace(&self, id: &str) -> PathBuf {
        let path = self.base.join("local").join(id);
        std::fs::create_dir_all(&path).expect("create local checkout");
        init_repo(&path);
        std::fs::write(path.join("hand-written.txt"), "mine\n").expect("write local file");
        self.seed_row(
            id,
            "local",
            &path,
            &format!("repo-root-{id}"),
            &path.display().to_string(),
        );
        path
    }

    /// A worktree workspace row whose recorded path is a real git worktree
    /// checkout that lives OUTSIDE the managed worktrees root — the shape
    /// the managed-root containment guard exists to refuse.
    pub(super) fn unmanaged_worktree_workspace(&self, id: &str) -> PathBuf {
        let path = self.base.join("outside-managed-root").join(id);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
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
        self.seed_row(
            id,
            "worktree",
            &path,
            "repo-root-1",
            &self.repo_root.display().to_string(),
        );
        path
    }

    /// The shape an ARCHIVED row is in BY CONSTRUCTION: R4's archive phase 2
    /// already removed the checkout, so the row records a path with nothing
    /// at it. This is the fixture the containment guard's missing-directory
    /// early-out exists for — without it, canonicalizing the absent path
    /// fails and reads as "outside the managed worktrees root", which refuses
    /// the purge before the ref, artifact, and row deletes.
    pub(super) fn archived_worktree_workspace(&self, id: &str) -> PathBuf {
        let path = self.worktree_workspace(id);
        self.clear_checkout(&path);
        self.set_lifecycle(id, "archived");
        path
    }

    /// Remove the checkout and its registration exactly the way archive's
    /// phase 2 does, leaving the row behind.
    pub(super) fn clear_checkout(&self, path: &Path) {
        git(
            &self.repo_root,
            &["worktree", "remove", "--force", &path.display().to_string()],
        );
        assert!(
            !path.exists(),
            "the fixture must leave nothing at {}",
            path.display()
        );
    }

    fn set_lifecycle(&self, id: &str, lifecycle_state: &str) {
        self.state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE workspaces SET lifecycle_state = ?2 WHERE id = ?1",
                    rusqlite::params![id, lifecycle_state],
                )?;
                Ok(())
            })
            .expect("set lifecycle state");
    }

    /// Write the three archive refs for `id` by hand (any resolvable OID will
    /// do — purge's ref delete is shape-agnostic), so a purge that never
    /// reaches the ref delete is visible as a surviving ref rather than as a
    /// silent pass.
    pub(super) fn seed_archive_refs(&self, id: &str) {
        let head = String::from_utf8_lossy(
            &Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&self.repo_root)
                .output()
                .expect("rev-parse HEAD")
                .stdout,
        )
        .trim()
        .to_string();
        for family in ["archive-heads", "archive-worktrees", "archive-indexes"] {
            git(
                &self.repo_root,
                &[
                    "update-ref",
                    &format!("refs/proliferate/{family}/{id}"),
                    &head,
                ],
            );
        }
    }

    pub(super) fn archive_ref_names(&self, id: &str) -> Vec<String> {
        let output = Command::new("git")
            .args(["for-each-ref", "--format=%(refname)", "refs/proliferate/"])
            .current_dir(&self.repo_root)
            .output()
            .expect("for-each-ref");
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| line.contains(id))
            .map(str::to_string)
            .collect()
    }

    fn seed_row(
        &self,
        id: &str,
        kind: &str,
        path: &Path,
        repo_root_id: &str,
        repo_root_path: &str,
    ) {
        let path = path.display().to_string();
        let now = "2026-08-13T00:00:00Z";
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
                conn.execute(
                    "INSERT INTO workspaces (
                        id, kind, repo_root_id, path, surface, lifecycle_state,
                        display_name, original_branch, current_branch, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, 'standard', 'active', ?1, ?1, ?1, ?5, ?5)",
                    rusqlite::params![id, kind, repo_root_id, path, now],
                )?;
                Ok(())
            })
            .expect("seed workspace and repo root");
    }

    pub(super) fn workspace_row_exists(&self, id: &str) -> bool {
        WorkspaceStore::new(self.state.db.clone())
            .find_workspace(id)
            .expect("find workspace")
            .is_some()
    }

    pub(super) fn session_row_exists(&self, id: &str) -> bool {
        SessionStore::new(self.state.db.clone())
            .find_by_id(id)
            .expect("find session")
            .is_some()
    }
}

fn init_repo(path: &Path) {
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.email", "test@example.com"]);
    git(path, &["config", "user.name", "Test"]);
    git(path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    git(path, &["add", "README.md"]);
    git(path, &["commit", "-m", "initial"]);
}

fn git(cwd: &Path, args: &[&str]) {
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

pub(super) fn pack_file_count(repo_root: &Path) -> usize {
    let pack_dir = repo_root.join(".git").join("objects").join("pack");
    let Ok(entries) = std::fs::read_dir(&pack_dir) else {
        return 0;
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("pack"))
        .count()
}

/// Delete just a worktree's admin registration under `.git/worktrees/`,
/// leaving the checkout directory (and its content) on disk. Reproduces the
/// exact case `git worktree remove` answers with exit 128 for, and that exit
/// code alone cannot distinguish from "nothing left at all" — the scenario
/// `GitService::remove_worktree_force`'s rm-rf fallback exists to converge.
pub(super) fn delete_admin_registration_only(repo_root: &Path, worktree: &Path) {
    let output = Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(repo_root)
        .output()
        .expect("spawn git rev-parse");
    let common_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let admin_root = Path::new(&common_dir).join("worktrees");
    for entry in std::fs::read_dir(&admin_root).expect("read worktrees admin dir") {
        let entry = entry.expect("read admin entry");
        let gitdir_file = entry.path().join("gitdir");
        let Ok(recorded) = std::fs::read_to_string(&gitdir_file) else {
            continue;
        };
        let recorded_path = PathBuf::from(recorded.trim());
        let recorded_parent = recorded_path
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok());
        let target_canonical = std::fs::canonicalize(worktree).ok();
        if recorded_parent.is_some() && recorded_parent == target_canonical {
            std::fs::remove_dir_all(entry.path()).expect("remove admin registration");
            return;
        }
    }
    panic!("no admin registration found for {}", worktree.display());
}

pub(super) fn session_record(
    id: &str,
    workspace_id: &str,
    native_session_id: Option<&str>,
) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "codex".to_string(),
        native_session_id: native_session_id.map(str::to_string),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-08-13T00:00:00Z".to_string(),
        updated_at: "2026-08-13T00:00:00Z".to_string(),
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
