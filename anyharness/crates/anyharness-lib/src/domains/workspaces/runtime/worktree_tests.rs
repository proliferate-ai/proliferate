use std::fs;
use std::path::Path;

use crate::adapters::git::{GitService, WorktreeBaseFetch};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::{
    WorktreeNameConflictError, WorktreeNameConflictPolicy,
};
use crate::origin::OriginContext;
use crate::persistence::Db;

use super::test_support::{
    assert_git_command_fails, git_stdout, init_repo, make_runtime, run_git, TempDirGuard,
};

#[test]
fn strict_post_create_races_are_classified_from_owner_state_without_parsing_stderr() {
    let source = TempDirGuard::new("runtime-worktree-strict-race-source");
    let branch_target = TempDirGuard::new("runtime-worktree-strict-race-branch-target");
    let path_target = TempDirGuard::new("runtime-worktree-strict-race-path-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-strict-race-home");
    let _ = fs::remove_dir_all(branch_target.path());
    init_repo(source.path());

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    runtime
        .create_workspace(&source.path().display().to_string())
        .expect("register source workspace");

    let raced_branch = "feature/exact-race";
    assert!(!GitService::ref_exists(
        source.path(),
        &format!("refs/heads/{raced_branch}")
    ));
    // Simulate another creator winning after the strict preflight check but
    // before Git's failed create returns. The diagnostic deliberately has no
    // conflict words, proving classification does not parse stderr.
    run_git(source.path(), ["branch", raced_branch]);
    let branch_error = runtime.classify_strict_worktree_create_failure(
        WorktreeCheckoutMode::NewBranch,
        &source.path().display().to_string(),
        branch_target.path(),
        raced_branch,
        anyhow::anyhow!("opaque git failure at /private/runtime/branch-target"),
    );
    assert!(matches!(
        branch_error.downcast_ref::<WorktreeNameConflictError>(),
        Some(WorktreeNameConflictError::Branch { .. })
    ));

    let path_error = runtime.classify_strict_worktree_create_failure(
        WorktreeCheckoutMode::NewBranch,
        &source.path().display().to_string(),
        path_target.path(),
        "feature/no-branch-conflict",
        anyhow::anyhow!("opaque git failure at /private/runtime/path-target"),
    );
    assert!(matches!(
        path_error.downcast_ref::<WorktreeNameConflictError>(),
        Some(WorktreeNameConflictError::Path { .. })
    ));
}

#[test]
fn create_worktree_fetches_and_bases_on_advanced_remote_branch() {
    let remote = TempDirGuard::new("runtime-worktree-fresh-remote");
    let source = TempDirGuard::new("runtime-worktree-fresh-source");
    let upstream = TempDirGuard::new("runtime-worktree-fresh-upstream");
    let target = TempDirGuard::new("runtime-worktree-fresh-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-fresh-home");
    let _ = fs::remove_dir_all(upstream.path());
    let _ = fs::remove_dir_all(target.path());

    run_git(remote.path(), ["init", "--bare", "-b", "main"]);
    init_repo(source.path());
    let remote_path = remote.path().display().to_string();
    run_git(source.path(), ["remote", "add", "origin", &remote_path]);
    run_git(source.path(), ["push", "-u", "origin", "main"]);
    let stale_source_head = git_stdout(source.path(), ["rev-parse", "main"]);

    let upstream_path = upstream.path().display().to_string();
    run_git(source.path(), ["clone", &remote_path, &upstream_path]);
    run_git(
        upstream.path(),
        ["config", "user.email", "codex@example.com"],
    );
    run_git(upstream.path(), ["config", "user.name", "Codex"]);
    fs::write(upstream.path().join("README.md"), "advanced\n").expect("advance remote branch");
    run_git(upstream.path(), ["add", "README.md"]);
    run_git(upstream.path(), ["commit", "-m", "Advance main"]);
    run_git(upstream.path(), ["push", "origin", "main"]);
    let advanced_remote_head = git_stdout(upstream.path(), ["rev-parse", "HEAD"]);
    assert_ne!(advanced_remote_head, stale_source_head);

    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");

    let result = runtime
        .create_worktree(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "feature/fresh-base",
            Some("main"),
            None,
        )
        .expect("create worktree");

    assert_eq!(result.base_fetch, Some(WorktreeBaseFetch::Fetched));
    assert_eq!(
        git_stdout(Path::new(&result.workspace.path), ["rev-parse", "HEAD"]),
        advanced_remote_head
    );
    assert_eq!(
        git_stdout(source.path(), ["rev-parse", "main"]),
        stale_source_head
    );
}

#[test]
fn create_worktree_without_remote_uses_local_base() {
    let source = TempDirGuard::new("runtime-worktree-no-remote-source");
    let target = TempDirGuard::new("runtime-worktree-no-remote-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-no-remote-home");
    let _ = fs::remove_dir_all(target.path());

    init_repo(source.path());
    let local_head = git_stdout(source.path(), ["rev-parse", "main"]);
    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");

    let result = runtime
        .create_worktree(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "feature/offline",
            Some("main"),
            None,
        )
        .expect("create worktree");

    assert_eq!(result.base_fetch, Some(WorktreeBaseFetch::NoRemote));
    assert_eq!(
        git_stdout(Path::new(&result.workspace.path), ["rev-parse", "HEAD"]),
        local_head
    );
}

#[test]
fn create_worktree_after_fetch_failure_uses_local_base() {
    let source = TempDirGuard::new("runtime-worktree-fetch-failure-source");
    let missing_remote = TempDirGuard::new("runtime-worktree-missing-remote");
    let target = TempDirGuard::new("runtime-worktree-fetch-failure-target");
    let runtime_home = TempDirGuard::new("runtime-worktree-fetch-failure-home");
    let missing_remote_path = missing_remote.path().display().to_string();
    let _ = fs::remove_dir_all(missing_remote.path());
    let _ = fs::remove_dir_all(target.path());

    init_repo(source.path());
    let local_head = git_stdout(source.path(), ["rev-parse", "main"]);
    run_git(
        source.path(),
        ["remote", "add", "origin", &missing_remote_path],
    );
    let db = Db::open_in_memory().expect("open db");
    let runtime = make_runtime(&db, runtime_home.path());
    let source_workspace = runtime
        .create_workspace(&source.path().display().to_string())
        .expect("create source workspace");

    let result = runtime
        .create_worktree(
            &source_workspace.repo_root.id,
            &target.path().display().to_string(),
            "feature/fetch-fallback",
            Some("main"),
            None,
        )
        .expect("create worktree");

    match result.base_fetch.as_ref() {
        Some(WorktreeBaseFetch::Failed { message }) => assert!(!message.is_empty()),
        outcome => panic!("expected failed fetch outcome, got {outcome:?}"),
    }
    assert_eq!(
        git_stdout(Path::new(&result.workspace.path), ["rev-parse", "HEAD"]),
        local_head
    );
}

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
