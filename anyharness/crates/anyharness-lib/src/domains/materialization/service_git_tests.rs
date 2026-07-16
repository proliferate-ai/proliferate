//! Integration tests for repo-root acquisition (clone-or-adopt) using real
//! temp-dir git repositories. No network:
//!   - clone-success uses a scoped `GIT_CONFIG_GLOBAL` with `insteadOf` so a
//!     GitHub-style URL resolves to a local bare repo;
//!   - adoption tests pre-clone locally then rewrite `origin` to a GitHub-style
//!     URL so identity verification runs the production parser.

use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

use super::acquire::{acquire_blocking, ensure_empty_clone_destination, verify_remote_identity};
use super::identity::RemoteIdentity;
use super::model::{AcquireOutcome, AcquireRepoRootResult, MaterializationError};
use super::store::MaterializationOperationStore;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

/// Test-facing wrapper over `acquire_blocking` with a fresh ledger store and a
/// stable operation id. `recovered_intended_kind` mirrors what the service
/// would recover from a crashed running row (None for a first attempt).
#[allow(clippy::too_many_arguments)]
fn acquire(
    workspace_runtime: &WorkspaceRuntime,
    repo_root_service: &RepoRootService,
    db: &Db,
    expected: &RemoteIdentity,
    clone_url: &str,
    destination_path: &str,
    recovered_intended_kind: Option<&str>,
) -> Result<AcquireRepoRootResult, MaterializationError> {
    let store = MaterializationOperationStore::new(db.clone());
    acquire_blocking(
        workspace_runtime,
        repo_root_service,
        &store,
        "op-test",
        expected,
        clone_url,
        destination_path,
        recovered_intended_kind,
    )
}

/// Serializes tests that mutate the process-global `GIT_CONFIG_GLOBAL` env var.
static GLOBAL_GIT_CONFIG_LOCK: Mutex<()> = Mutex::new(());

const GITHUB_URL: &str = "https://github.com/acme/widget.git";

struct Guard {
    path: std::path::PathBuf,
}
impl Guard {
    fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("anyharness-mat-{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("mkdir");
        Self { path }
    }
    fn path(&self) -> &Path {
        &self.path
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn git(cwd: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Build a bare "origin" repo (the clone source) with one real commit.
fn make_bare_origin(prefix: &str) -> Guard {
    let seed = Guard::new(&format!("{prefix}-seed"));
    let bare = Guard::new(&format!("{prefix}-bare"));
    git(bare.path(), &["init", "--bare", "-b", "main"]);
    git(seed.path(), &["init", "-b", "main"]);
    git(seed.path(), &["config", "user.email", "t@example.com"]);
    git(seed.path(), &["config", "user.name", "T"]);
    std::fs::write(seed.path().join("README.md"), "seed\n").expect("write");
    git(seed.path(), &["add", "README.md"]);
    git(seed.path(), &["commit", "-m", "init"]);
    let bare_path = bare.path().display().to_string();
    git(seed.path(), &["remote", "add", "origin", &bare_path]);
    git(seed.path(), &["push", "-u", "origin", "main"]);
    bare
}

fn make_runtime(db: &Db, home: &Path) -> WorkspaceRuntime {
    WorkspaceRuntime::new(
        WorkspaceStore::new(db.clone()),
        WorkspaceDeleteWorkflow::new(
            db.clone(),
            crate::domains::sessions::deletion::SessionDeleteWorkflow::new(db.clone()),
        ),
        RepoRootService::new(RepoRootStore::new(db.clone())),
        home.to_path_buf(),
    )
}

/// Pre-clone `bare` into `checkout` and rewrite origin to the GitHub URL.
fn clone_and_rewrite_origin(bare: &Guard, parent: &Path, checkout: &Path) {
    git(
        parent,
        &[
            "clone",
            &bare.path().display().to_string(),
            &checkout.display().to_string(),
        ],
    );
    git(checkout, &["remote", "set-url", "origin", GITHUB_URL]);
}

#[test]
fn clone_success_registers_managed_main_root() {
    let _lock = GLOBAL_GIT_CONFIG_LOCK.lock().unwrap();
    let bare = make_bare_origin("clone-ok");
    let dest = Guard::new("clone-ok-dest");
    let dest_target = dest.path().join("widget");
    let home = Guard::new("clone-ok-home");
    let config_home = Guard::new("clone-ok-gitconfig");

    // A temp global git config that rewrites the GitHub URL to the local bare
    // repo so the clone runs entirely offline but records a GitHub origin.
    let config_path = config_home.path().join("gitconfig");
    std::fs::write(
        &config_path,
        format!(
            "[url \"{}\"]\n\tinsteadOf = {}\n",
            bare.path().display(),
            GITHUB_URL
        ),
    )
    .expect("write git config");
    let previous = std::env::var_os("GIT_CONFIG_GLOBAL");
    std::env::set_var("GIT_CONFIG_GLOBAL", &config_path);

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());
    let expected = RemoteIdentity::new("github", "acme", "widget");

    let result = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &expected,
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    );

    // Restore env before asserting so a failure doesn't leak the override.
    match previous {
        Some(value) => std::env::set_var("GIT_CONFIG_GLOBAL", value),
        None => std::env::remove_var("GIT_CONFIG_GLOBAL"),
    }

    let result = result.expect("acquire clone");
    assert_eq!(result.outcome, AcquireOutcome::Cloned);
    assert_eq!(result.repo_root.kind, "managed");
    assert!(Path::new(&result.repo_root.path).join("README.md").exists());

    // A second identical acquire reuses the registered root (idempotent).
    let reused = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &expected,
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    )
    .expect("acquire reuse");
    assert_eq!(reused.outcome, AcquireOutcome::Reused);
    assert_eq!(reused.repo_root.id, result.repo_root.id);
}

#[test]
fn existing_empty_destination_is_cloned_not_rejected() {
    // PR3-EMPTY-02: an existing but EMPTY destination directory must be cloned
    // into (the frozen contract accepts "non-existent or empty"), not routed
    // into adoption and failed.
    let _lock = GLOBAL_GIT_CONFIG_LOCK.lock().unwrap();
    let bare = make_bare_origin("clone-empty");
    let dest = Guard::new("clone-empty-dest");
    let dest_target = dest.path().join("widget");
    std::fs::create_dir_all(&dest_target).expect("pre-create empty target");
    let home = Guard::new("clone-empty-home");
    let config_home = Guard::new("clone-empty-gitconfig");

    let config_path = config_home.path().join("gitconfig");
    std::fs::write(
        &config_path,
        format!(
            "[url \"{}\"]\n\tinsteadOf = {}\n",
            bare.path().display(),
            GITHUB_URL
        ),
    )
    .expect("write git config");
    let previous = std::env::var_os("GIT_CONFIG_GLOBAL");
    std::env::set_var("GIT_CONFIG_GLOBAL", &config_path);

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());

    let result = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &RemoteIdentity::new("github", "acme", "widget"),
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    );

    match previous {
        Some(value) => std::env::set_var("GIT_CONFIG_GLOBAL", value),
        None => std::env::remove_var("GIT_CONFIG_GLOBAL"),
    }

    let result = result.expect("empty destination clones");
    assert_eq!(result.outcome, AcquireOutcome::Cloned);
    assert_eq!(result.repo_root.kind, "managed");
    assert!(Path::new(&result.repo_root.path).join("README.md").exists());
}

#[test]
fn wrong_repo_identity_is_remote_mismatch_and_cleans_up() {
    let _lock = GLOBAL_GIT_CONFIG_LOCK.lock().unwrap();
    let bare = make_bare_origin("clone-mismatch");
    let dest = Guard::new("clone-mismatch-dest");
    let dest_target = dest.path().join("widget");
    let home = Guard::new("clone-mismatch-home");
    let config_home = Guard::new("clone-mismatch-gitconfig");

    let config_path = config_home.path().join("gitconfig");
    std::fs::write(
        &config_path,
        format!(
            "[url \"{}\"]\n\tinsteadOf = {}\n",
            bare.path().display(),
            GITHUB_URL
        ),
    )
    .expect("write git config");
    let previous = std::env::var_os("GIT_CONFIG_GLOBAL");
    std::env::set_var("GIT_CONFIG_GLOBAL", &config_path);

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());
    let wrong = RemoteIdentity::new("github", "someone-else", "different");

    let error = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &wrong,
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    );

    match previous {
        Some(value) => std::env::set_var("GIT_CONFIG_GLOBAL", value),
        None => std::env::remove_var("GIT_CONFIG_GLOBAL"),
    }

    let error = error.expect_err("mismatch must fail");
    assert_eq!(error.code(), "REPOSITORY_REMOTE_MISMATCH");
    // Cleanup removed the directory this operation cloned into.
    assert!(!dest_target.exists());
}

#[test]
fn non_empty_destination_preserves_user_data() {
    let bare = make_bare_origin("clone-nonempty");
    let dest = Guard::new("clone-nonempty-dest");
    let dest_target = dest.path().join("widget");
    std::fs::create_dir_all(&dest_target).expect("mkdir target");
    std::fs::write(dest_target.join("preexisting.txt"), "x").expect("write");
    let home = Guard::new("clone-nonempty-home");

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());
    let clone_url = bare.path().display().to_string();

    // A pre-existing non-empty non-git dir is an adoption attempt that fails
    // (not a git repo), and the user's data is never deleted.
    let error = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &RemoteIdentity::new("github", "acme", "widget"),
        &clone_url,
        &dest_target.display().to_string(),
        None,
    )
    .expect_err("non-empty destination must fail");
    assert!(dest_target.join("preexisting.txt").exists());
    assert!(error.code() == "MATERIALIZATION_FAILED" || error.code() == "DESTINATION_NOT_EMPTY");
}

#[test]
fn adopts_correct_existing_main_checkout() {
    let bare = make_bare_origin("adopt-ok");
    let dest = Guard::new("adopt-ok-dest");
    let dest_target = dest.path().join("widget");
    let home = Guard::new("adopt-ok-home");

    clone_and_rewrite_origin(&bare, dest.path(), &dest_target);

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());

    let result = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &RemoteIdentity::new("github", "acme", "widget"),
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    )
    .expect("adopt");
    assert_eq!(result.outcome, AcquireOutcome::Adopted);
    assert_eq!(result.repo_root.kind, "external");
}

#[test]
fn crash_after_clone_recovers_as_managed_not_external() {
    // Simulate a crash between clone and registration: the destination is a
    // real checkout on disk (as a clone would leave it) and the ledger row
    // recorded intent "managed". A retry must re-register as a MANAGED root with
    // a Cloned outcome, never downgrading it to external adoption (Finding 2).
    let bare = make_bare_origin("crash-managed");
    let dest = Guard::new("crash-managed-dest");
    let dest_target = dest.path().join("widget");
    let home = Guard::new("crash-managed-home");

    // Leave a completed clone on disk with a GitHub-style origin.
    clone_and_rewrite_origin(&bare, dest.path(), &dest_target);

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());

    let result = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &RemoteIdentity::new("github", "acme", "widget"),
        GITHUB_URL,
        &dest_target.display().to_string(),
        Some("managed"),
    )
    .expect("recover managed clone");
    assert_eq!(result.outcome, AcquireOutcome::Cloned);
    assert_eq!(result.repo_root.kind, "managed");

    // Without recovered intent, the same on-disk state is treated as external
    // adoption — proving the intent marker is what preserves the managed kind.
    // A fully independent runtime/db so the prior managed registration does not
    // leak into this control acquisition.
    let db2 = Db::open_in_memory().expect("db2");
    let repo_root_service2 = RepoRootService::new(RepoRootStore::new(db2.clone()));
    let home2 = Guard::new("crash-managed-home2");
    let runtime2 = make_runtime(&db2, home2.path());
    let adopted = acquire(
        &runtime2,
        &repo_root_service2,
        &db2,
        &RemoteIdentity::new("github", "acme", "widget"),
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    )
    .expect("adopt without intent");
    assert_eq!(adopted.outcome, AcquireOutcome::Adopted);
    assert_eq!(adopted.repo_root.kind, "external");
}

#[test]
fn adopt_wrong_repo_is_remote_mismatch() {
    let bare = make_bare_origin("adopt-wrong");
    let dest = Guard::new("adopt-wrong-dest");
    let dest_target = dest.path().join("widget");
    let home = Guard::new("adopt-wrong-home");

    clone_and_rewrite_origin(&bare, dest.path(), &dest_target);

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());

    let error = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &RemoteIdentity::new("github", "acme", "other-repo"),
        GITHUB_URL,
        &dest_target.display().to_string(),
        None,
    )
    .expect_err("adopt mismatch must fail");
    assert_eq!(error.code(), "REPOSITORY_REMOTE_MISMATCH");
    // Adoption never deletes the user's existing checkout.
    assert!(dest_target.join("README.md").exists());
}

#[test]
fn rejects_worktree_as_repo_root() {
    let bare = make_bare_origin("adopt-worktree");
    let dest = Guard::new("adopt-worktree-dest");
    let main_checkout = dest.path().join("widget");
    let linked = dest.path().join("widget-wt");
    let home = Guard::new("adopt-worktree-home");

    clone_and_rewrite_origin(&bare, dest.path(), &main_checkout);
    git(
        &main_checkout,
        &["worktree", "add", "-b", "wt", &linked.display().to_string()],
    );

    let db = Db::open_in_memory().expect("db");
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    let runtime = make_runtime(&db, home.path());

    let error = acquire(
        &runtime,
        &repo_root_service,
        &db,
        &RemoteIdentity::new("github", "acme", "widget"),
        GITHUB_URL,
        &linked.display().to_string(),
        None,
    )
    .expect_err("worktree must be rejected");
    assert_eq!(error.code(), "REPO_ROOT_WORKTREE_UNSUPPORTED");
}

#[test]
fn symlink_escape_in_destination_ancestor_is_collapsed() {
    // A destination whose parent is a symlink canonicalizes to the real target;
    // this asserts we never operate on the symlink path itself.
    let real_parent = Guard::new("symlink-real");
    let link_home = Guard::new("symlink-link");
    let link = link_home.path().join("link");
    #[cfg(unix)]
    std::os::unix::fs::symlink(real_parent.path(), &link).expect("symlink");
    let destination = link.join("child");
    let canonical = super::identity::canonicalize_destination(&destination).expect("canonicalize");
    assert!(canonical.starts_with(std::fs::canonicalize(real_parent.path()).unwrap()));
}

#[test]
fn empty_destination_ownership_created_flag() {
    let dest = Guard::new("empty-dest");
    let missing = dest.path().join("child/target");
    assert!(ensure_empty_clone_destination(&missing).expect("create"));
    assert!(!ensure_empty_clone_destination(&missing).expect("empty ok"));
    std::fs::write(missing.join("f.txt"), "x").expect("write");
    let error = ensure_empty_clone_destination(&missing).expect_err("non-empty");
    assert_eq!(error.code(), "DESTINATION_NOT_EMPTY");
}

#[test]
fn verify_remote_identity_matches_rewritten_origin() {
    let bare = make_bare_origin("verify");
    let dest = Guard::new("verify-dest");
    let checkout = dest.path().join("widget");
    clone_and_rewrite_origin(&bare, dest.path(), &checkout);
    verify_remote_identity(
        &checkout.display().to_string(),
        &RemoteIdentity::new("github", "acme", "widget"),
    )
    .expect("identity matches");
}
