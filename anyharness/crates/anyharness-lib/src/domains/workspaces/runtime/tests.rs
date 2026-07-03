use std::fs;
use std::path::Path;

use super::test_support::{
    git_stdout, init_repo, make_runtime, run_git, session_record, TempDirGuard,
};
use crate::adapters::git::GitService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::managed_root::managed_worktrees_root;
use crate::domains::workspaces::model::WorkspaceKind;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

#[test]
fn create_mobility_destination_publishes_created_branch_to_origin() {
    let remote = TempDirGuard::new("runtime-mobility-remote");
    let source = TempDirGuard::new("runtime-mobility-source");
    let runtime_home = TempDirGuard::new("runtime-mobility-home");

    run_git(remote.path(), ["init", "--bare", "-b", "main"]);
    init_repo(source.path());
    let remote_path = remote.path().display().to_string();
    run_git(source.path(), ["remote", "add", "origin", &remote_path]);
    run_git(source.path(), ["push", "-u", "origin", "main"]);

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");
    let duplicate_source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create duplicate source workspace");
    assert_ne!(
        source_workspace.workspace.id,
        duplicate_source_workspace.workspace.id
    );
    let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);

    let prepared = runtime
        .create_mobility_destination(
            &source_workspace.repo_root.id,
            "feature/mobility-pushed",
            &base_sha,
            Some("destination-1"),
            None,
        )
        .expect("create mobility destination");

    assert!(prepared.created);
    let worktree_path = Path::new(&prepared.workspace.path);
    let local_head = git_stdout(worktree_path, ["rev-parse", "HEAD"]);
    let remote_head = git_stdout(
        remote.path(),
        ["rev-parse", "refs/heads/feature/mobility-pushed"],
    );
    let upstream = git_stdout(
        worktree_path,
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    );

    assert_eq!(local_head.trim(), remote_head.trim());
    assert_eq!(upstream.trim(), "origin/feature/mobility-pushed");
}

#[test]
fn create_mobility_destination_adopts_clean_existing_destination_path() {
    let source = TempDirGuard::new("runtime-mobility-adopt-source");
    let runtime_home = TempDirGuard::new("runtime-mobility-adopt-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");
    let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);
    let destination_path = managed_worktrees_root(runtime_home.path())
        .join("mobility-destinations")
        .join(&source_workspace.repo_root.id)
        .join("destination-1");
    fs::create_dir_all(destination_path.parent().expect("destination parent"))
        .expect("create destination parent");
    GitService::create_worktree_at_ref(
        &source.path().display().to_string(),
        &destination_path.display().to_string(),
        "feature/adopt",
        &base_sha,
    )
    .expect("create orphan destination worktree");

    let prepared = runtime
        .create_mobility_destination(
            &source_workspace.repo_root.id,
            "feature/adopt",
            &base_sha,
            Some("destination-1"),
            None,
        )
        .expect("adopt destination");

    assert!(prepared.created);
    let workspace = prepared.workspace;
    assert_eq!(
        Path::new(&workspace.path),
        fs::canonicalize(&destination_path)
            .expect("canonicalize destination")
            .as_path()
    );
    assert_eq!(workspace.current_branch.as_deref(), Some("feature/adopt"));
    let stored = WorkspaceStore::new(db.clone())
        .find_active_by_path(&workspace.path)
        .expect("find by path")
        .expect("stored workspace");
    assert_eq!(stored.id, workspace.id);
}

#[test]
fn create_mobility_destination_reuses_clean_existing_branch_worktree() {
    let source = TempDirGuard::new("runtime-mobility-reuse-source");
    let runtime_home = TempDirGuard::new("runtime-mobility-reuse-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");
    let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);

    let first = runtime
        .create_mobility_destination(
            &source_workspace.repo_root.id,
            "feature/reuse-existing",
            &base_sha,
            None,
            Some("feature reuse existing"),
        )
        .expect("create first destination");
    let second = runtime
        .create_mobility_destination(
            &source_workspace.repo_root.id,
            "feature/reuse-existing",
            &base_sha,
            None,
            Some("feature reuse existing"),
        )
        .expect("reuse existing destination");

    assert!(first.created);
    assert!(!second.created);
    assert_eq!(second.workspace.id, first.workspace.id);
    let active_branch_workspaces = WorkspaceStore::new(db.clone())
        .list_active_by_repo_root_id(&source_workspace.repo_root.id)
        .expect("list workspaces")
        .into_iter()
        .filter(|workspace| workspace.current_branch.as_deref() == Some("feature/reuse-existing"))
        .collect::<Vec<_>>();
    assert_eq!(active_branch_workspaces.len(), 1);
}

#[test]
fn create_mobility_destination_rejects_dirty_existing_destination_path() {
    let source = TempDirGuard::new("runtime-mobility-dirty-adopt-source");
    let runtime_home = TempDirGuard::new("runtime-mobility-dirty-adopt-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");
    let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);
    let destination_path = managed_worktrees_root(runtime_home.path())
        .join("mobility-destinations")
        .join(&source_workspace.repo_root.id)
        .join("destination-1");
    fs::create_dir_all(destination_path.parent().expect("destination parent"))
        .expect("create destination parent");
    GitService::create_worktree_at_ref(
        &source.path().display().to_string(),
        &destination_path.display().to_string(),
        "feature/dirty-adopt",
        &base_sha,
    )
    .expect("create orphan destination worktree");
    fs::write(destination_path.join("dirty.txt"), "dirty\n").expect("dirty destination");

    let error = runtime
        .create_mobility_destination(
            &source_workspace.repo_root.id,
            "feature/dirty-adopt",
            &base_sha,
            Some("destination-1"),
            None,
        )
        .expect_err("dirty destination must not be adopted");

    assert!(error
        .to_string()
        .contains("destination path already exists with uncommitted changes"));
}

#[test]
fn create_workspace_creates_distinct_local_records_for_existing_path() {
    let source = TempDirGuard::new("runtime-create-duplicate-local-source");
    let runtime_home = TempDirGuard::new("runtime-create-duplicate-local-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let path = source.path().display().to_string();

    let first = runtime
        .create_workspace(&path)
        .expect("create first workspace");
    let second = runtime
        .create_workspace(&path)
        .expect("create duplicate local workspace");

    assert_ne!(first.workspace.id, second.workspace.id);
    assert_eq!(first.workspace.kind, WorkspaceKind::Local);
    assert_eq!(second.workspace.kind, WorkspaceKind::Local);
    assert_eq!(first.workspace.path, second.workspace.path);
    assert_eq!(first.repo_root.id, second.repo_root.id);

    let repo_roots = RepoRootStore::new(db.clone())
        .list_all()
        .expect("list repo roots");
    assert_eq!(repo_roots.len(), 1);
    assert_eq!(repo_roots[0].id, first.repo_root.id);

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE workspaces SET created_at = ?1 WHERE id = ?2",
            ["2026-01-01T00:00:00Z", first.workspace.id.as_str()],
        )?;
        conn.execute(
            "UPDATE workspaces SET created_at = ?1 WHERE id = ?2",
            ["2026-01-01T00:00:01Z", second.workspace.id.as_str()],
        )?;
        Ok(())
    })
    .expect("pin canonical ordering");

    let resolved = runtime.resolve_from_path(&path).expect("resolve existing");
    assert_eq!(resolved.workspace.id, first.workspace.id);
}

#[test]
fn duplicate_local_workspace_sessions_are_isolated_by_workspace_id() {
    let source = TempDirGuard::new("runtime-duplicate-local-sessions-source");
    let runtime_home = TempDirGuard::new("runtime-duplicate-local-sessions-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let path = source.path().display().to_string();
    let first = runtime
        .create_workspace(&path)
        .expect("create first workspace");
    let second = runtime
        .create_workspace(&path)
        .expect("create duplicate local workspace");
    let session_store = SessionStore::new(db.clone());

    session_store
        .insert(&session_record("session-first", &first.workspace.id))
        .expect("insert first session");
    session_store
        .insert(&session_record("session-second", &second.workspace.id))
        .expect("insert second session");

    let first_sessions = session_store
        .list_visible_by_workspace(&first.workspace.id)
        .expect("list first workspace sessions");
    let second_sessions = session_store
        .list_visible_by_workspace(&second.workspace.id)
        .expect("list second workspace sessions");

    assert_eq!(
        first_sessions
            .iter()
            .map(|session| session.id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-first"]
    );
    assert_eq!(
        second_sessions
            .iter()
            .map(|session| session.id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-second"]
    );
}

#[test]
fn list_workspaces_returns_stored_branch_without_inline_git_refresh() {
    let source = TempDirGuard::new("runtime-list-stored-branch-source");
    let runtime_home = TempDirGuard::new("runtime-list-stored-branch-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create workspace")
        .workspace;

    run_git(source.path(), ["branch", "-m", "renamed"]);
    let listed = runtime.list_workspaces().expect("list workspaces");
    let listed_workspace = listed
        .iter()
        .find(|record| record.id == workspace.id)
        .expect("listed workspace");

    assert_eq!(listed_workspace.current_branch.as_deref(), Some("main"));
}

#[test]
fn get_workspace_returns_stored_branch_without_inline_git_refresh() {
    let source = TempDirGuard::new("runtime-get-stored-branch-source");
    let runtime_home = TempDirGuard::new("runtime-get-stored-branch-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create workspace")
        .workspace;

    run_git(source.path(), ["branch", "-m", "renamed"]);
    let fetched = runtime
        .get_workspace(&workspace.id)
        .expect("get workspace")
        .expect("workspace exists");

    assert_eq!(fetched.current_branch.as_deref(), Some("main"));
}

#[test]
fn background_branch_refresh_persists_changed_branch_and_throttles() {
    let source = TempDirGuard::new("runtime-branch-refresh-source");
    let runtime_home = TempDirGuard::new("runtime-branch-refresh-home");
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create workspace")
        .workspace;

    run_git(source.path(), ["branch", "-m", "renamed"]);
    let outcome = runtime
        .refresh_workspace_branches_for_test()
        .expect("refresh branches");
    assert_eq!(outcome.schedule.scheduled_count, 1);
    assert_eq!(outcome.updated_count, 1);
    assert_eq!(runtime.scheduled_branch_refresh_batches_for_test(), 1);

    let refreshed = WorkspaceStore::new(db.clone())
        .find_by_id(&workspace.id)
        .expect("load stored workspace")
        .expect("workspace exists");
    assert_eq!(refreshed.current_branch.as_deref(), Some("renamed"));

    let throttled = runtime
        .refresh_workspace_branches_for_test()
        .expect("refresh branches again");
    assert_eq!(throttled.schedule.scheduled_count, 0);
    assert_eq!(throttled.schedule.skipped_throttled_count, 1);
    assert_eq!(runtime.scheduled_branch_refresh_batches_for_test(), 1);
}

#[test]
fn create_workspace_rejects_existing_active_worktree_path() {
    let remote = TempDirGuard::new("runtime-create-existing-worktree-remote");
    let source = TempDirGuard::new("runtime-create-existing-worktree-source");
    let target = TempDirGuard::new("runtime-create-existing-worktree-target");
    let runtime_home = TempDirGuard::new("runtime-create-existing-worktree-home");
    let _ = fs::remove_dir_all(target.path());

    run_git(remote.path(), ["init", "--bare", "-b", "main"]);
    init_repo(source.path());
    let remote_path = remote.path().display().to_string();
    run_git(source.path(), ["remote", "add", "origin", &remote_path]);
    run_git(source.path(), ["push", "-u", "origin", "main"]);

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");
    let worktree = runtime
        .create_worktree(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "feature/existing-worktree",
            Some("main"),
            None,
        )
        .expect("create worktree");

    let error = match runtime.create_workspace(&worktree.workspace.path) {
        Ok(_) => panic!("create should reject existing worktree path"),
        Err(error) => error,
    };

    assert!(error
        .to_string()
        .contains("a workspace record already exists for path"));
}
