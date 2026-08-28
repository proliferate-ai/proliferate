//! Tier 1, in-crate, real git + real sqlite. Tests assert the refs and rows that
//! carry the checkpoint service's guarantees; faking either would prove nothing.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use uuid::Uuid;

use super::test_support::EnvGuard;
use super::{refs, CheckpointOrigin, CheckpointRecord, WorkspaceCheckpointService};
use crate::adapters::git::operations::snapshot::WorkspaceSnapshot;
use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::persistence::Db;

/// `pub(super)` so `retention_tests` (split out of this file to stay under
/// the repo line cap) can share the harness; `repo_root` is `pub(super)` too
/// because the orphan-reap suite writes refs directly against it.
pub(super) struct Harness {
    base: PathBuf,
    state: AppState,
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

    pub(super) fn service(&self) -> Arc<WorkspaceCheckpointService> {
        self.state.workspace_checkpoint_service.clone()
    }

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
    pub(super) fn make_checkpoint(
        &self,
        workspace_id: &str,
        checkpoint_id: &str,
        origin: CheckpointOrigin,
        created_at: &str,
        expired: bool,
    ) {
        let tree = make_tree(
            &self.repo_root,
            &format!("{checkpoint_id}.txt"),
            checkpoint_id,
        );
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

    pub(super) fn checkpoint_ref_ids(
        &self,
        workspace_id: &str,
    ) -> std::collections::BTreeSet<String> {
        refs::list_for_workspace(&self.repo_root, workspace_id)
            .expect("list checkpoint refs")
            .into_iter()
            .map(|entry| entry.checkpoint_id)
            .collect()
    }

    pub(super) fn corrupt_checkpoint_anchor_flag(&self, checkpoint_id: &str) {
        self.state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE workspace_checkpoints SET work_tree_anchored = 'not-an-integer' WHERE id = ?1",
                    [checkpoint_id],
                )?;
                Ok(())
            })
            .expect("corrupt checkpoint row for mapping-failure test");
    }
}

async fn capture_turn_start(
    service: &Arc<WorkspaceCheckpointService>,
    workspace_id: &str,
    session_id: Option<String>,
    prompt_id: Option<String>,
) -> Result<CheckpointRecord, super::capture::CheckpointCaptureError> {
    let _lease = service
        .workspace_operation_gate
        .acquire_shared(workspace_id, WorkspaceOperationKind::SessionPrompt)
        .await;
    service
        .capture_turn_start_under_workspace_lease(workspace_id, session_id, prompt_id)
        .await
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

pub(super) fn head_sha(cwd: &Path) -> String {
    git_stdout(cwd, &["rev-parse", "HEAD"])
}

fn make_dirty(path: &Path) {
    std::fs::write(path.join("staged.txt"), "staged\n").expect("write staged file");
    git(path, &["add", "staged.txt"]);
    std::fs::write(path.join("README.md"), "seed\nunstaged\n").expect("modify tracked file");
    std::fs::write(path.join("untracked.txt"), "untracked\n").expect("write untracked file");
}

/// A one-file tree via plumbing only, touching neither index nor worktree.
pub(super) fn make_tree(repo: &Path, filename: &str, content: &str) -> String {
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

pub(super) fn bare_snapshot(
    head_sha: String,
    work_tree: String,
    index_tree: String,
) -> WorkspaceSnapshot {
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

pub(super) fn timestamp_days_ago(days: i64) -> String {
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

    let record = capture_turn_start(&service, "ws-1", Some("sess-1".into()), Some("p-1".into()))
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
    let worktree_ref = format!("refs/proliferate/checkpoints/ws-1/{}/worktree", record.id);
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

#[tokio::test]
async fn turn_start_capture_waits_for_the_workspace_exclusive_lease() {
    let harness = Harness::new("capture-lease");
    harness.worktree_workspace("ws-1");
    let service = harness.service();
    let exclusive = service
        .workspace_operation_gate
        .acquire_exclusive("ws-1")
        .await;
    let capture_service = service.clone();
    let mut capture = tokio::spawn(async move {
        capture_turn_start(&capture_service, "ws-1", Some("sess-1".into()), None).await
    });

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut capture)
            .await
            .is_err(),
        "capture must not write refs while retention or purge holds exclusivity"
    );
    assert!(
        harness.checkpoint_ref_ids("ws-1").is_empty(),
        "no rowless refs may appear before the shared lease is admitted"
    );

    drop(exclusive);
    let record = tokio::time::timeout(std::time::Duration::from_secs(5), capture)
        .await
        .expect("capture resumes after exclusivity ends")
        .expect("capture task joins")
        .expect("capture succeeds");
    assert!(harness.checkpoint_ref_ids("ws-1").contains(&record.id));
}

#[tokio::test]
async fn capture_does_not_nest_the_workspace_read_lease_behind_a_queued_writer() {
    let harness = Harness::new("capture-nested-lease");
    harness.worktree_workspace("ws-1");
    let service = harness.service();
    let workspace_gate = service.workspace_operation_gate.clone();
    let outer_prompt_lease = workspace_gate
        .acquire_shared("ws-1", WorkspaceOperationKind::SessionPrompt)
        .await;
    let writer_gate = workspace_gate.clone();
    let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(async move {
        let _ = writer_started_tx.send(());
        writer_gate.acquire_exclusive("ws-1").await
    });
    writer_started_rx.await.expect("writer task starts");
    tokio::task::yield_now().await;

    let record = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        service.capture_turn_start_under_workspace_lease("ws-1", Some("sess-1".into()), None),
    )
    .await
    .expect("capture must not wait behind the workspace writer")
    .expect("capture succeeds under the outer prompt lease");
    assert!(harness.checkpoint_ref_ids("ws-1").contains(&record.id));

    drop(outer_prompt_lease);
    let writer_lease = tokio::time::timeout(std::time::Duration::from_secs(1), writer)
        .await
        .expect("writer proceeds after the outer prompt lease drops")
        .expect("writer task joins");
    drop(writer_lease);
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
        error.to_string().contains("git show-ref --verify"),
        "expected the stable ref-verification failure, got: {error}"
    );
    let _ = std::fs::remove_dir_all(&repo_base);
}

#[test]
fn checkpoint_ref_deletion_reports_an_unreadable_repository() {
    let not_a_repo = std::env::temp_dir().join(format!(
        "anyharness-checkpoints-not-repo-{}",
        Uuid::new_v4()
    ));
    std::fs::create_dir_all(&not_a_repo).expect("create non-repository directory");

    refs::delete_for(&not_a_repo, "ws-1", "cp-1")
        .expect_err("git inspection failures must not masquerade as absent refs");

    let _ = std::fs::remove_dir_all(not_a_repo);
}

/// 3. GC survival: after an aggressive prune the captured objects still peel,
///    because the refs keep them reachable.
#[tokio::test]
async fn captured_objects_survive_an_aggressive_gc() {
    let harness = Harness::new("capture-gc");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let service = harness.service();
    let record = capture_turn_start(&service, "ws-1", None, None)
        .await
        .expect("capture");

    git(&harness.repo_root, &["gc", "--prune=now", "--aggressive"]);

    let snap = bare_snapshot(
        record.head_sha.clone(),
        record.work_tree_oid.clone(),
        record.index_tree_oid.clone(),
    );
    refs::verify_checkpoint_refs(&harness.repo_root, "ws-1", &record.id, &snap)
        .expect("objects still peel after gc --prune=now --aggressive");
}

/// Archive ref sweeping must ignore checkpoint refs.
#[tokio::test]
async fn the_archive_sweep_leaves_checkpoint_refs_untouched() {
    let _env = EnvGuard::off().await;
    let harness = Harness::new("isolation");
    harness.worktree_workspace("ws-1");
    harness.make_checkpoint(
        "ws-1",
        "cp-1",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
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

/// Purge's checkpoint step removes rows and refs.
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

    store
        .mark_checkpoints_expired_for_workspace("ws-1", "2026-08-19T00:00:00Z")
        .expect("expire rows");
    refs::delete_all_for(&harness.repo_root, "ws-1").expect("delete refs");
    store
        .delete_checkpoints_for_workspace("ws-1")
        .expect("delete rows");

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

/// Fork linkage is exact on `(session, turn)`.
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
    // Exact-equality discipline: a boundary with no checkpoint answers None —
    // never a nearest-turn match. A non-turn-opening boundary has no checkpoint
    // by construction, and the lookup must not degrade to the closest turn.
    assert_eq!(
        service.find_checkpoint_id_for_boundary("sess", "turn-missing"),
        None,
        "a boundary with no checkpoint answers None — never a nearest-turn match"
    );
    // Session scoping: turn ids are not unique across a fork lineage, so the SAME
    // turn key under a DIFFERENT session_id must NOT resolve the checkpoint —
    // `session_id` is the disambiguator, not `turn_id` alone.
    assert_eq!(
        service.find_checkpoint_id_for_boundary("other-sess", "turn-cp-boundary"),
        None,
        "the same turn key under a different session_id resolves to nothing"
    );
}
