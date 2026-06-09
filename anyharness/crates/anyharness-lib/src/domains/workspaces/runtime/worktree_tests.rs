use std::fs;
use std::path::Path;

use crate::domains::workspaces::store::WorkspaceStore;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::origin::OriginContext;
use crate::persistence::Db;

use super::test_support::{
    assert_git_command_fails, git_stdout, init_repo, make_runtime, run_git, TempDirGuard,
};

#[test]
fn create_worktree_keeps_created_branch_local() {
    let remote = TempDirGuard::new("runtime-worktree-remote");
    let source = TempDirGuard::new("runtime-worktree-source");
    let target = TempDirGuard::new("runtime-worktree-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-home");
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

    let result = runtime
        .create_worktree(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "feature/local-only",
            Some("main"),
            None,
        )
        .expect("create worktree");

    let worktree_path = Path::new(&result.workspace.path);
    let local_head = git_stdout(worktree_path, ["rev-parse", "HEAD"]);
    let main_head = git_stdout(source.path(), ["rev-parse", "main"]);

    assert_eq!(local_head.trim(), main_head.trim());
    assert_git_command_fails(
        remote.path(),
        ["rev-parse", "--verify", "refs/heads/feature/local-only"],
    );
    assert_git_command_fails(
        worktree_path,
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    );
}

#[test]
fn create_worktree_suffixes_generated_path_and_branch_on_conflict() {
    let remote = TempDirGuard::new("runtime-worktree-suffix-generated-remote");
    let source = TempDirGuard::new("runtime-worktree-suffix-generated-source");
    let target = TempDirGuard::new("runtime-worktree-suffix-generated-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-suffix-generated-home");
    let _ = fs::remove_dir_all(target.path());

    run_git(remote.path(), ["init", "--bare", "-b", "main"]);
    init_repo(source.path());
    let remote_path = remote.path().display().to_string();
    run_git(source.path(), ["remote", "add", "origin", &remote_path]);
    run_git(source.path(), ["push", "-u", "origin", "main"]);
    run_git(source.path(), ["branch", "codex/otter"]);

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");

    let result = runtime
        .create_worktree_with_surface(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "codex/otter",
            Some("main"),
            None,
            "standard",
            WorktreeNameConflictPolicy::SuffixPathAndBranch,
            OriginContext::api_local_runtime(),
            None,
        )
        .expect("create suffixed worktree");

    let worktree_path = Path::new(&result.workspace.path);
    let expected_basename = format!("{}-2", target.path().file_name().unwrap().to_string_lossy());
    assert_eq!(
        worktree_path.file_name().unwrap().to_string_lossy(),
        expected_basename
    );
    assert_eq!(
        git_stdout(worktree_path, ["branch", "--show-current"]).trim(),
        "codex/otter-2"
    );
    assert_eq!(
        result.workspace.current_branch.as_deref(),
        Some("codex/otter-2")
    );
}

#[test]
fn create_worktree_suffix_path_policy_keeps_reserved_branch() {
    let remote = TempDirGuard::new("runtime-worktree-suffix-path-remote");
    let source = TempDirGuard::new("runtime-worktree-suffix-path-source");
    let target = TempDirGuard::new("runtime-worktree-suffix-path-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-suffix-path-home");

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

    let result = runtime
        .create_worktree_with_surface(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "codex/cloud-reserved",
            Some("main"),
            None,
            "standard",
            WorktreeNameConflictPolicy::SuffixPath,
            OriginContext::api_local_runtime(),
            None,
        )
        .expect("create path-suffixed worktree");

    let worktree_path = Path::new(&result.workspace.path);
    let expected_basename = format!("{}-2", target.path().file_name().unwrap().to_string_lossy());
    assert_eq!(
        worktree_path.file_name().unwrap().to_string_lossy(),
        expected_basename
    );
    assert_eq!(
        git_stdout(worktree_path, ["branch", "--show-current"]).trim(),
        "codex/cloud-reserved"
    );
    assert_eq!(
        result.workspace.current_branch.as_deref(),
        Some("codex/cloud-reserved")
    );
}

#[test]
fn create_worktree_detached_ref_ignores_generated_branch_conflict() {
    let remote = TempDirGuard::new("runtime-worktree-detached-remote");
    let source = TempDirGuard::new("runtime-worktree-detached-source");
    let target = TempDirGuard::new("runtime-worktree-detached-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-detached-home");
    let _ = fs::remove_dir_all(target.path());

    run_git(remote.path(), ["init", "--bare", "-b", "main"]);
    init_repo(source.path());
    let remote_path = remote.path().display().to_string();
    run_git(source.path(), ["remote", "add", "origin", &remote_path]);
    run_git(source.path(), ["push", "-u", "origin", "main"]);
    run_git(source.path(), ["branch", "feature/base"]);
    run_git(source.path(), ["branch", "codex/otter"]);

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");

    let result = runtime
        .create_worktree_with_surface_and_checkout_mode(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "codex/otter",
            Some("feature/base"),
            None,
            "standard",
            WorktreeCheckoutMode::DetachedRef,
            WorktreeNameConflictPolicy::SuffixPath,
            OriginContext::api_local_runtime(),
            None,
        )
        .expect("create detached worktree");

    let worktree_path = Path::new(&result.workspace.path);
    let detached_head = git_stdout(worktree_path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    let worktree_head = git_stdout(worktree_path, ["rev-parse", "HEAD"]);
    let base_head = git_stdout(source.path(), ["rev-parse", "feature/base"]);

    assert_eq!(detached_head.trim(), "HEAD");
    assert_eq!(worktree_head.trim(), base_head.trim());
    assert_eq!(result.workspace.current_branch, None);
    assert_eq!(
        result.workspace.original_branch.as_deref(),
        Some("feature/base")
    );
    let env = runtime
        .workspace_env(&result.workspace)
        .expect("build workspace env");
    assert!(!env.contains_key("PROLIFERATE_BRANCH"));

    let outcome = runtime
        .refresh_workspace_branches_for_test()
        .expect("refresh branches");
    assert_eq!(outcome.schedule.scheduled_count, 2);
    assert_eq!(outcome.updated_count, 0);

    let refreshed = WorkspaceStore::new(db.clone())
        .find_by_id(&result.workspace.id)
        .expect("load refreshed workspace")
        .expect("workspace exists");
    assert_eq!(refreshed.current_branch, None);
}
