//! Integration tests for the shared exact-ref worktree mechanics using real
//! temp-dir git repositories (offline; no network).

use std::path::Path;

use super::exact_ref::{resolve_requested_commit, ExactRefOutcome};
use super::test_support::{git_stdout, init_repo, make_runtime, run_git, TempDirGuard};
use crate::persistence::Db;

/// A repo root registered from a real on-disk main checkout, with `home` chosen
/// so `managed_worktrees_root` = `<home>/../worktrees` resolves under a temp
/// dir unique to this test.
struct Fixture {
    _home: TempDirGuard,
    _source: TempDirGuard,
    db: Db,
    runtime: super::WorkspaceRuntime,
    repo_root_id: String,
    head_sha: String,
}

fn setup(prefix: &str) -> Fixture {
    let source = TempDirGuard::new(&format!("{prefix}-source"));
    // runtime_home lives under its own temp root so the derived managed
    // worktrees root (`../worktrees`) is isolated per test.
    let home_parent = TempDirGuard::new(&format!("{prefix}-home"));
    let runtime_home = home_parent.path().join("anyharness");
    std::fs::create_dir_all(&runtime_home).expect("create runtime home");

    init_repo(source.path());
    let head_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, &runtime_home);
    let resolution = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");

    Fixture {
        _home: home_parent,
        _source: source,
        db,
        runtime,
        repo_root_id: resolution.repo_root.id,
        head_sha,
    }
}

#[test]
fn resolves_dash_prefixed_ref_without_option_injection() {
    let fx = setup("exact-ref-option-boundary");
    run_git(
        fx._source.path(),
        ["update-ref", "refs/heads/--workflow-base", &fx.head_sha],
    );

    let resolved = resolve_requested_commit(fx._source.path(), "--workflow-base")
        .expect("dash-prefixed ref must be treated as a revision, not an option");
    assert_eq!(resolved, fx.head_sha);
}

#[test]
fn creates_worktree_at_exact_branch_and_sha() {
    let fx = setup("exact-ref-create");
    let result = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/exact",
            &fx.head_sha,
            None,
            None,
        )
        .expect("materialize");
    assert_eq!(result.outcome, ExactRefOutcome::Created);
    assert_eq!(result.observed_head_sha, fx.head_sha);
    let worktree = Path::new(&result.workspace.path);
    assert_eq!(
        git_stdout(worktree, ["branch", "--show-current"]).trim(),
        "feature/exact"
    );
    assert_eq!(
        git_stdout(worktree, ["rev-parse", "HEAD"]).trim(),
        fx.head_sha
    );
}

#[test]
fn reuses_existing_clean_worktree_on_same_branch_and_sha() {
    let fx = setup("exact-ref-reuse");
    let first = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/reuse",
            &fx.head_sha,
            None,
            None,
        )
        .expect("first materialize");
    let second = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/reuse",
            &fx.head_sha,
            None,
            None,
        )
        .expect("second materialize");
    assert_eq!(second.outcome, ExactRefOutcome::Reused);
    assert_eq!(second.workspace.path, first.workspace.path);
}

#[test]
fn rejects_requested_ref_not_found() {
    let fx = setup("exact-ref-missing");
    let error = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/missing",
            "0000000000000000000000000000000000000000",
            None,
            None,
        )
        .expect_err("missing sha must fail");
    assert!(
        error.to_string().to_lowercase().contains("rev-parse")
            || error.to_string().to_lowercase().contains("not")
    );
}

#[test]
fn rejects_dirty_reuse_at_destination_id() {
    let fx = setup("exact-ref-dirty");
    let created = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/dirty",
            &fx.head_sha,
            Some("dest-dirty"),
            None,
        )
        .expect("create at destination id");
    // Dirty the worktree, drop the workspace row so the path is re-inspected,
    // then re-request the same destination id: adoption must reject the dirty
    // tree rather than reset it.
    std::fs::write(Path::new(&created.workspace.path).join("dirty.txt"), "x")
        .expect("dirty the tree");
    crate::domains::workspaces::store::WorkspaceStore::new(fx.db.clone())
        .delete_by_id(&created.workspace.id)
        .expect("delete workspace row");

    let error = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/dirty",
            &fx.head_sha,
            Some("dest-dirty"),
            None,
        )
        .expect_err("dirty adoption must fail");
    assert!(error.to_string().to_lowercase().contains("uncommitted"));
}

#[test]
fn rejects_branch_mismatch_at_destination_id() {
    let fx = setup("exact-ref-branch");
    let created = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/first",
            &fx.head_sha,
            Some("dest-branch"),
            None,
        )
        .expect("create at destination id");
    crate::domains::workspaces::store::WorkspaceStore::new(fx.db.clone())
        .delete_by_id(&created.workspace.id)
        .expect("delete workspace row");

    // Same destination id, different requested branch: adoption must reject.
    let error = fx
        .runtime
        .create_or_reuse_standard_worktree_at_ref(
            &fx.repo_root_id,
            "feature/second",
            &fx.head_sha,
            Some("dest-branch"),
            None,
        )
        .expect_err("branch mismatch must fail");
    assert!(error
        .to_string()
        .to_lowercase()
        .contains("not requested branch"));
}
