use std::path::{Path, PathBuf};
use std::{env, fs};

use super::WorkspaceService;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::domains::workspaces::types::RegisterRepoWorkspaceError;
use crate::persistence::Db;
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
        crate::domains::workspaces::types::SetWorkspaceDisplayNameError::TooLong(160)
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
        crate::domains::workspaces::types::SetWorkspaceDisplayNameError::NotFound(_)
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
fn list_workspaces_returns_stored_branch_without_reconcile() {
    let repo_root = TempDirGuard::new("service-list-stored-branch-root");
    let runtime_home = TempDirGuard::new("service-list-stored-branch-runtime");
    init_repo(repo_root.path());

    let db = Db::open_in_memory().expect("open db");
    let service = make_service(&db, runtime_home.path());

    let workspace = service
        .resolve_from_path(&repo_root.path().display().to_string())
        .expect("resolve workspace");

    run_git(repo_root.path(), ["branch", "-m", "renamed"]);
    let listed = service.list_workspaces().expect("list workspaces");
    let listed_workspace = listed
        .iter()
        .find(|record| record.id == workspace.id)
        .expect("listed workspace");

    assert_eq!(listed_workspace.current_branch.as_deref(), Some("main"));
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
