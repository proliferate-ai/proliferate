//! Tier 1, in-crate, real git + real sqlite. Every test builds a genuine
//! `AppState` over an in-memory database plus a real git repository under a temp
//! directory, and asserts against `git for-each-ref`, `git rev-parse`, and the
//! stored row — the checkpoint service's guarantees are all about what is in the
//! refs and in the row after a step, so a harness that faked either would prove
//! nothing.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::flags::checkpoint_capture_enabled;
use super::{refs, CheckpointOrigin, CheckpointRecord, WorkspaceCheckpointService};
use crate::adapters::git::operations::snapshot::WorkspaceSnapshot;
use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::persistence::Db;

/// `ANYHARNESS_CHECKPOINT_CAPTURE` is process-global; serialize every test that
/// sets it so a concurrent test never observes the wrong flag state.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard<'a> {
    _lock: std::sync::MutexGuard<'a, ()>,
}

impl EnvGuard<'_> {
    fn on() -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        std::env::set_var("ANYHARNESS_CHECKPOINT_CAPTURE", "on");
        EnvGuard { _lock: lock }
    }

    fn off() -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        std::env::remove_var("ANYHARNESS_CHECKPOINT_CAPTURE");
        EnvGuard { _lock: lock }
    }
}

impl Drop for EnvGuard<'_> {
    fn drop(&mut self) {
        std::env::remove_var("ANYHARNESS_CHECKPOINT_CAPTURE");
    }
}

struct Harness {
    base: PathBuf,
    state: AppState,
    repo_root: PathBuf,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

impl Harness {
    fn new(label: &str) -> Self {
        let base =
            std::env::temp_dir().join(format!("anyharness-checkpoints-{label}-{}", Uuid::new_v4()));
        let runtime_home = base.join("runtime");
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

    fn service(&self) -> Arc<WorkspaceCheckpointService> {
        self.state.workspace_checkpoint_service.clone()
    }

    fn worktree_workspace(&self, id: &str) -> PathBuf {
        let path = self.base.join("worktrees").join(id);
        git(
            &self.repo_root,
            &["worktree", "add", "-b", id, &path.display().to_string(), "HEAD"],
        );
        self.seed_row(id, &path);
        path
    }

    fn seed_row(&self, id: &str, path: &Path) {
        let repo_root_id = format!("repo-root-{}", self.repo_root.display());
        let repo_root_path = self.repo_root.display().to_string();
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
                     ) VALUES (?1, 'worktree', ?2, ?3, 'standard', 'active', ?1, ?1, ?1, ?4, ?4)",
                    rusqlite::params![id, repo_root_id, path, now],
                )?;
                Ok(())
            })
            .expect("seed workspace and repo root");
    }

    /// Manufacture a checkpoint directly: a real tree object, three real refs,
    /// and a matching row with a caller-controlled `created_at`/`expired`/
    /// `origin`. The retention and deletion-order tests need staggered ages and
    /// specific states that a live capture cannot produce on demand.
    fn make_checkpoint(
        &self,
        workspace_id: &str,
        checkpoint_id: &str,
        origin: CheckpointOrigin,
        created_at: &str,
        expired: bool,
    ) {
        let tree = make_tree(&self.repo_root, &format!("{checkpoint_id}.txt"), checkpoint_id);
        let head = head_sha(&self.repo_root);
        let snap = bare_snapshot(head.clone(), tree.clone(), tree.clone());
        refs::write_checkpoint_refs(&self.repo_root, workspace_id, checkpoint_id, &snap)
            .expect("write checkpoint refs");
        let record = CheckpointRecord {
            id: checkpoint_id.to_string(),
            workspace_id: workspace_id.to_string(),
            origin,
            session_id: Some("sess".to_string()),
            turn_id: Some(format!("turn-{checkpoint_id}")),
            prompt_id: None,
            fork_operation_id: None,
            revert_operation_id: None,
            head_sha: head,
            work_tree_oid: tree.clone(),
            index_tree_oid: tree,
            work_tree_anchored: false,
            index_tree_anchored: false,
            notices_json: None,
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
            expired_at: expired.then(|| created_at.to_string()),
        };
        self.service()
            .store_for_tests()
            .insert_checkpoint(&record)
            .expect("insert checkpoint row");
    }

    fn checkpoint_ref_ids(&self, workspace_id: &str) -> std::collections::BTreeSet<String> {
        refs::list_for_workspace(&self.repo_root, workspace_id)
            .expect("list checkpoint refs")
            .into_iter()
            .map(|entry| entry.checkpoint_id)
            .collect()
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

fn git_stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn head_sha(cwd: &Path) -> String {
    git_stdout(cwd, &["rev-parse", "HEAD"])
}

fn make_dirty(path: &Path) {
    std::fs::write(path.join("staged.txt"), "staged\n").expect("write staged file");
    git(path, &["add", "staged.txt"]);
    std::fs::write(path.join("README.md"), "seed\nunstaged\n").expect("modify tracked file");
    std::fs::write(path.join("untracked.txt"), "untracked\n").expect("write untracked file");
}

/// A one-file tree via plumbing only, touching neither index nor worktree.
fn make_tree(repo: &Path, filename: &str, content: &str) -> String {
    use std::io::Write;
    use std::process::Stdio;
    let mut hash = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn hash-object");
    hash.stdin
        .take()
        .unwrap()
        .write_all(content.as_bytes())
        .expect("write blob");
    let blob = String::from_utf8_lossy(&hash.wait_with_output().expect("hash-object").stdout)
        .trim()
        .to_string();
    let mut mktree = Command::new("git")
        .args(["mktree"])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn mktree");
    mktree
        .stdin
        .take()
        .unwrap()
        .write_all(format!("100644 blob {blob}\t{filename}\n").as_bytes())
        .expect("write mktree entry");
    String::from_utf8_lossy(&mktree.wait_with_output().expect("mktree").stdout)
        .trim()
        .to_string()
}

fn bare_snapshot(head_sha: String, work_tree: String, index_tree: String) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        head_sha,
        branch: Some("main".to_string()),
        work_tree,
        index_tree,
        notices: Vec::new(),
        work_tree_anchor: None,
        index_tree_anchor: None,
    }
}

fn delete_loose_object(repo: &Path, oid: &str) {
    let common_dir = git_stdout(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    );
    let path = Path::new(&common_dir)
        .join("objects")
        .join(&oid[0..2])
        .join(&oid[2..]);
    std::fs::remove_file(&path).expect("remove loose object");
}

fn timestamp_days_ago(days: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339()
}

/// 1. Capture happy path: dirty worktree, three refs exist and verify, the row
///    carries the peeled OIDs.
#[tokio::test]
async fn capture_writes_three_verifiable_refs_and_a_row_with_the_peeled_oids() {
    let harness = Harness::new("capture-happy");
    harness.worktree_workspace("ws-1");
    let path = harness.base.join("worktrees").join("ws-1");
    make_dirty(&path);
    let service = harness.service();

    let record = service
        .capture("ws-1", CheckpointOrigin::TurnStart, Some("sess-1".into()), Some("p-1".into()))
        .await
        .expect("capture");

    let ref_ids = harness.checkpoint_ref_ids("ws-1");
    assert!(ref_ids.contains(&record.id), "the capture's refs exist");
    // Verify passes: reconstruct the snapshot shape from the row and re-run it.
    let snap = bare_snapshot(
        record.head_sha.clone(),
        record.work_tree_oid.clone(),
        record.index_tree_oid.clone(),
    );
    refs::verify_checkpoint_refs(&harness.repo_root, "ws-1", &record.id, &snap)
        .expect("verify passes against the captured OIDs");
    // The peeled worktree tree in the row is what `worktree^{tree}` resolves to.
    let worktree_ref = format!(
        "refs/proliferate/checkpoints/ws-1/{}/worktree",
        record.id
    );
    let peeled = git_stdout(
        &harness.repo_root,
        &["rev-parse", &format!("{worktree_ref}^{{tree}}")],
    );
    assert_eq!(peeled, record.work_tree_oid);
    let row = service
        .store_for_tests()
        .find_checkpoint(&record.id)
        .expect("query")
        .expect("row present");
    assert_eq!(row.origin, CheckpointOrigin::TurnStart);
    assert_eq!(row.session_id.as_deref(), Some("sess-1"));
    assert!(row.turn_id.is_none(), "turn_id is unknown at capture time");
}

/// 2. Verify-failure negative control: an object deleted between write and verify
///    fails verification (the check capture relies on to refuse a dangling
///    checkpoint). Exercised at the refs level because capture writes and verifies
///    back-to-back with no external seam between them.
#[test]
fn a_deleted_object_fails_checkpoint_verification() {
    let repo_base =
        std::env::temp_dir().join(format!("anyharness-checkpoints-verify-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&repo_base).expect("mkdir");
    init_repo(&repo_base);
    let head = head_sha(&repo_base);
    let tree = make_tree(&repo_base, "w.txt", "w\n");
    let snap = bare_snapshot(head, tree.clone(), tree.clone());
    refs::write_checkpoint_refs(&repo_base, "ws-1", "cp-1", &snap).expect("write");
    refs::verify_checkpoint_refs(&repo_base, "ws-1", "cp-1", &snap).expect("initial verify passes");

    delete_loose_object(&repo_base, &tree);
    let error = refs::verify_checkpoint_refs(&repo_base, "ws-1", "cp-1", &snap)
        .expect_err("a deleted object must never verify");
    assert!(
        error.to_string().contains("does not exist") || error.to_string().contains("peel failed"),
        "expected an existence/peel failure, got: {error}"
    );
    let _ = std::fs::remove_dir_all(&repo_base);
}

/// 3. GC survival: after an aggressive prune the captured objects still peel,
///    because the refs keep them reachable.
#[tokio::test]
async fn captured_objects_survive_an_aggressive_gc() {
    let harness = Harness::new("capture-gc");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let record = harness
        .service()
        .capture("ws-1", CheckpointOrigin::TurnStart, None, None)
        .await
        .expect("capture");

    git(
        &harness.repo_root,
        &["gc", "--prune=now", "--aggressive"],
    );

    let snap = bare_snapshot(
        record.head_sha.clone(),
        record.work_tree_oid.clone(),
        record.index_tree_oid.clone(),
    );
    refs::verify_checkpoint_refs(&harness.repo_root, "ws-1", &record.id, &snap)
        .expect("objects still peel after gc --prune=now --aggressive");
}

/// 4. Flag-off = zero capture: retention leaves existing checkpoints untouched
///    while the flag is off, and the flag reads false.
#[tokio::test]
async fn retention_is_a_noop_while_the_flag_is_off() {
    let _env = EnvGuard::off();
    assert!(!checkpoint_capture_enabled());
    let harness = Harness::new("flag-off");
    harness.worktree_workspace("ws-1");
    // Way past the age cap and way past N — retention WOULD cull these if it ran.
    for index in 0..(super::retention::RETENTION_KEEP_N + 5) {
        harness.make_checkpoint(
            "ws-1",
            &format!("cp-{index}"),
            CheckpointOrigin::TurnStart,
            &timestamp_days_ago(100),
            false,
        );
    }
    let before = harness.checkpoint_ref_ids("ws-1");

    harness.service().sweep_retention().await;

    assert_eq!(
        harness.checkpoint_ref_ids("ws-1"),
        before,
        "flag-off retention must leave every checkpoint untouched"
    );
}

/// 5. Retention: cull to N, keep the newest N, honor the age cap, and honor the
///    three exemptions (in-flight claim, newest safety row beyond N, safety past
///    the age cap).
#[tokio::test]
async fn retention_culls_to_n_with_the_age_cap_and_exemptions() {
    let _env = EnvGuard::on();
    let harness = Harness::new("retention");
    harness.worktree_workspace("ws-1");
    let service = harness.service();
    let n = super::retention::RETENTION_KEEP_N;

    // N+3 fresh turn-start rows, newest first by created_at (index 0 = newest).
    for index in 0..(n + 3) {
        harness.make_checkpoint(
            "ws-1",
            &format!("fresh-{index:03}"),
            CheckpointOrigin::TurnStart,
            &timestamp_days_ago(index as i64),
            false,
        );
    }
    // One fresh row inside the newest N but older than the age cap.
    harness.make_checkpoint(
        "ws-1",
        "aged-in-n",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(20),
        false,
    );
    // The newest safety row, ranked WAY beyond N by age, but exempt from N-cull.
    harness.make_checkpoint(
        "ws-1",
        "safety-old",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(9),
        false,
    );
    // A safety row past the age cap: exempt from N, NOT from age → culled.
    harness.make_checkpoint(
        "ws-1",
        "safety-expired",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(30),
        false,
    );
    // A row that would be culled by BOTH the age cap AND the N-cut, but a revert
    // claims it → survives. Dated past the 14-day cap so ONLY the in-flight claim
    // can explain its survival (remove the `is_claimed` check in `should_retain`
    // and this test fails).
    harness.make_checkpoint(
        "ws-1",
        "claimed",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(40),
        false,
    );
    let _claim = service.inflight_reverts().claim("claimed");

    service.sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        surviving.contains("claimed"),
        "an in-flight-claimed checkpoint survives even past both the N-cut and the age cap"
    );
    assert!(
        surviving.contains("safety-old"),
        "the newest safety row is exempt from the N-cull"
    );
    assert!(
        !surviving.contains("safety-expired"),
        "a safety row past the age cap is still culled"
    );
    assert!(
        !surviving.contains("aged-in-n"),
        "the age cap culls even inside the newest N"
    );
    // A culled row keeps its expired_at set; its refs are gone.
    let expired = service
        .store_for_tests()
        .find_checkpoint("safety-expired")
        .expect("query")
        .expect("row");
    assert!(expired.expired_at.is_some(), "culled rows are expired, not deleted");
    // The very newest fresh row is intact.
    assert!(surviving.contains("fresh-000"), "the newest fresh row survives");
}

/// 6. Deletion-order crash states: a row-expired-but-refs-present state and a
///    refs-present-but-row-absent state are both reaped, and an unexpired row
///    never loses its refs.
#[tokio::test]
async fn the_orphan_reap_converges_both_crash_states_and_spares_live_rows() {
    let _env = EnvGuard::on();
    let harness = Harness::new("deletion-order");
    harness.worktree_workspace("ws-1");
    let service = harness.service();

    // A live unexpired row (keeps the workspace a retention candidate and is the
    // spare-me control).
    harness.make_checkpoint(
        "ws-1",
        "live",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    // Crash state A: the row was expired but its refs never got deleted.
    harness.make_checkpoint(
        "ws-1",
        "expired-refs",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        true,
    );
    // Crash state B: refs exist with no row at all (capture crashed before the
    // insert). Write refs directly, insert no row.
    {
        let tree = make_tree(&harness.repo_root, "orphan.txt", "orphan");
        let snap = bare_snapshot(head_sha(&harness.repo_root), tree.clone(), tree);
        refs::write_checkpoint_refs(&harness.repo_root, "ws-1", "rowless", &snap)
            .expect("write orphan refs");
    }
    assert!(harness.checkpoint_ref_ids("ws-1").contains("rowless"));

    service.sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        surviving.contains("live"),
        "an unexpired row never has its refs deleted"
    );
    assert!(
        !surviving.contains("expired-refs"),
        "an expired row's leftover refs are reaped"
    );
    assert!(
        !surviving.contains("rowless"),
        "refs with no row (crash before insert) are reaped"
    );
}

/// 7. Sweep isolation regression: the archive sweep's `list_for_repo` ignores
///    checkpoint refs, so archive's orphaned-refs duty leaves them untouched.
///    Fails if the `checkpoints/` filter is removed from `archive/refs.rs`.
#[tokio::test]
async fn the_archive_sweep_leaves_checkpoint_refs_untouched() {
    let _env = EnvGuard::off();
    let harness = Harness::new("isolation");
    harness.worktree_workspace("ws-1");
    // Only checkpoint refs in the repo (no archive refs at all).
    harness.make_checkpoint(
        "ws-1",
        "cp-1",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    // The archive enumerator must return nothing for a checkpoint-only repo.
    let archive_entries =
        crate::domains::workspaces::archive::refs::list_for_repo(&harness.repo_root)
            .expect("archive list_for_repo must not hard-fail on checkpoint refs");
    assert!(
        archive_entries.is_empty(),
        "archive list_for_repo must not surface checkpoint refs, got: {:?}",
        archive_entries
            .iter()
            .map(|entry| (&entry.family, &entry.workspace_id))
            .collect::<Vec<_>>()
    );
    // And the archive sweep's full pass leaves the checkpoint refs in place.
    harness
        .state
        .workspace_archive_service
        .sweep_leftovers()
        .await;
    assert!(
        harness.checkpoint_ref_ids("ws-1").contains("cp-1"),
        "the archive sweep must never reap a checkpoint ref"
    );
}

/// 8. Purge: a workspace's checkpoint rows and refs are both gone after purge's
///    checkpoint step.
#[tokio::test]
async fn purge_clears_checkpoint_rows_and_refs() {
    let harness = Harness::new("purge");
    harness.worktree_workspace("ws-1");
    harness.make_checkpoint(
        "ws-1",
        "cp-1",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    let store = harness.service().store_for_tests().clone();

    // Drive the two purge steps directly (the full purge flow is exercised by the
    // deletion suite; here the checkpoint carve-out is under test).
    store
        .delete_checkpoints_for_workspace("ws-1")
        .expect("delete rows");
    refs::delete_all_for(&harness.repo_root, "ws-1").expect("delete refs");

    assert!(
        store
            .list_unexpired_checkpoints_for_workspace("ws-1")
            .expect("query")
            .is_empty(),
        "checkpoint rows are gone"
    );
    assert!(
        harness.checkpoint_ref_ids("ws-1").is_empty(),
        "checkpoint refs are gone"
    );
}

/// 9. Fork linkage: the boundary lookup finds an unexpired checkpoint at
///    `(session, turn)`, and returns nothing when none exists.
#[tokio::test]
async fn the_boundary_lookup_finds_the_checkpoint_or_nothing() {
    let harness = Harness::new("fork-linkage");
    harness.worktree_workspace("ws-1");
    let service = harness.service();
    // Seed a turn-start checkpoint whose (session, turn) keys are known.
    harness.make_checkpoint(
        "ws-1",
        "cp-boundary",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    // `make_checkpoint` stamps session="sess", turn="turn-<id>".
    assert_eq!(
        service.find_checkpoint_id_for_boundary("sess", "turn-cp-boundary"),
        Some("cp-boundary".to_string()),
        "the boundary lookup finds the checkpoint"
    );
    assert_eq!(
        service.find_checkpoint_id_for_boundary("sess", "turn-missing"),
        None,
        "no checkpoint at the boundary returns None"
    );
}
