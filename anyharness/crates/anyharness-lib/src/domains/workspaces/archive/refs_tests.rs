//! Spec §7.5: write/verify by OID identity, the per-family peel, the
//! anchored shape, `list_for_repo`, `copy_to_rescue`, and `delete_for`.
//! Every test drives a real temp repository through plumbing commands only
//! (`hash-object`, `mktree`, `commit-tree`) so a `WorkspaceSnapshot` can be
//! constructed directly with whatever OIDs a test needs, without paying for
//! a full `snapshot_workspace` capture.

use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use uuid::Uuid;

use super::refs::{
    copy_to_rescue, delete_all_for, delete_for, list_for_repo, resolve_archive_refs,
    verify_archive_refs, write_archive_refs, ArchiveRefShape,
};
use crate::adapters::git::operations::snapshot::WorkspaceSnapshot;

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

fn run(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
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

fn stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo(path: &Path) -> String {
    run(path, &["init", "-b", "main"]);
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed");
    run(path, &["add", "README.md"]);
    run(path, &["commit", "-m", "initial"]);
    stdout(path, &["rev-parse", "HEAD"])
}

/// Writes a one-file tree via plumbing only (`hash-object` + `mktree`),
/// touching neither the real index nor the worktree.
fn make_tree(repo: &Path, filename: &str, content: &str) -> String {
    let mut hash = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn git hash-object");
    hash.stdin
        .take()
        .unwrap()
        .write_all(content.as_bytes())
        .expect("write blob content");
    let output = hash.wait_with_output().expect("git hash-object");
    assert!(output.status.success(), "hash-object failed");
    let blob = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let mut mktree = Command::new("git")
        .args(["mktree"])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn git mktree");
    let entry = format!("100644 blob {blob}\t{filename}\n");
    mktree
        .stdin
        .take()
        .unwrap()
        .write_all(entry.as_bytes())
        .expect("write mktree entry");
    let output = mktree.wait_with_output().expect("git mktree");
    assert!(output.status.success(), "mktree failed");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn commit_tree(repo: &Path, tree_oid: &str, message: &str) -> String {
    stdout(repo, &["commit-tree", tree_oid, "-m", message])
}

fn delete_loose_object(repo: &Path, oid: &str) {
    let common_dir = stdout(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    );
    let path = Path::new(&common_dir)
        .join("objects")
        .join(&oid[0..2])
        .join(&oid[2..]);
    fs::remove_file(&path).expect("remove loose object for test");
}

fn snapshot(
    head_sha: String,
    work_tree: String,
    index_tree: String,
    work_tree_anchor: Option<String>,
    index_tree_anchor: Option<String>,
) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        head_sha,
        branch: Some("main".to_string()),
        work_tree,
        index_tree,
        notices: Vec::new(),
        work_tree_anchor,
        index_tree_anchor,
    }
}

#[test]
fn write_then_verify_succeeds_by_oid_identity_across_all_three_families() {
    let repo = TempDirGuard::new("refs-write-verify");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "work.txt", "work content\n");
    let index_tree = make_tree(repo.path(), "index.txt", "index content\n");
    let snap = snapshot(head, work_tree, index_tree, None, None);

    write_archive_refs(repo.path(), "ws-write-verify", &snap).expect("write_archive_refs");
    verify_archive_refs(repo.path(), "ws-write-verify", &snap).expect("verify must pass");
}

#[test]
fn verify_fails_on_a_stale_ref_from_a_prior_generation() {
    let repo = TempDirGuard::new("refs-stale-generation");
    let head = init_repo(repo.path());
    let work_tree_1 = make_tree(repo.path(), "a.txt", "generation one\n");
    let index_tree_1 = make_tree(repo.path(), "b.txt", "generation one index\n");
    let snap_1 = snapshot(head.clone(), work_tree_1, index_tree_1, None, None);
    write_archive_refs(repo.path(), "ws-stale", &snap_1).expect("write generation one");

    // A second generation's OIDs, never written — simulates a re-archive
    // whose refs were never updated (or a caller that forgot to re-write).
    let work_tree_2 = make_tree(repo.path(), "a.txt", "generation two\n");
    let index_tree_2 = make_tree(repo.path(), "b.txt", "generation two index\n");
    let snap_2 = snapshot(head, work_tree_2, index_tree_2, None, None);

    let error = verify_archive_refs(repo.path(), "ws-stale", &snap_2)
        .expect_err("a stale ref from a prior generation must fail identity");
    assert!(
        error.to_string().contains("stale generation"),
        "expected a stale-generation error, got: {error}"
    );
}

#[test]
fn a_bare_rev_parse_verify_echoes_a_missing_oid_back_which_is_why_every_check_must_peel() {
    // The pinning test for the gotcha section 5.3/6.3 name: a bare
    // `rev-parse --verify <oid>` on a syntactically valid OID echoes it
    // back with exit 0 even after the object is deleted. It detects
    // nothing without an actual peel (`^{commit}` / `^{tree}`).
    let repo = TempDirGuard::new("refs-bare-verify-blind-spot");
    init_repo(repo.path());
    let tree = make_tree(repo.path(), "w.txt", "w\n");
    delete_loose_object(repo.path(), &tree);

    let bare = stdout(repo.path(), &["rev-parse", "--verify", &tree]);
    assert_eq!(bare, tree, "bare verify must echo the missing OID back");

    let peel = Command::new("git")
        .args(["rev-parse", "--verify", &format!("{tree}^{{tree}}")])
        .current_dir(repo.path())
        .output()
        .expect("spawn git");
    assert!(
        !peel.status.success(),
        "an actual peel must fail on the deleted object where the bare verify did not"
    );
}

#[test]
fn deleted_archive_head_object_fails_verify_instead_of_a_silent_stale_pass() {
    let repo = TempDirGuard::new("refs-peel-head-deletion");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "w.txt", "w\n");
    let index_tree = make_tree(repo.path(), "i.txt", "i\n");
    let snap = snapshot(head.clone(), work_tree, index_tree, None, None);
    write_archive_refs(repo.path(), "ws-peel-head", &snap).expect("write");
    verify_archive_refs(repo.path(), "ws-peel-head", &snap).expect("initial verify passes");

    delete_loose_object(repo.path(), &head);

    // `show_ref_verify`'s use of `show-ref --verify <ref>` (rather than a
    // bare `rev-parse --verify <oid>`) already refuses to resolve a ref
    // whose target object is gone, so the failure surfaces before the
    // family-specific peel is even reached. Either way the object-existence
    // check that the peel exists for is never bypassed.
    let error = verify_archive_refs(repo.path(), "ws-peel-head", &snap)
        .expect_err("a deleted head object must never verify");
    assert!(
        error.to_string().contains("does not exist") || error.to_string().contains("peel failed"),
        "expected an existence or peel failure, got: {error}"
    );
}

#[test]
fn deleted_archive_worktree_tree_object_fails_verify_instead_of_a_silent_stale_pass() {
    let repo = TempDirGuard::new("refs-peel-worktree-deletion");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "w.txt", "w\n");
    let index_tree = make_tree(repo.path(), "i.txt", "i\n");
    let snap = snapshot(head, work_tree.clone(), index_tree, None, None);
    write_archive_refs(repo.path(), "ws-peel-worktree", &snap).expect("write");
    verify_archive_refs(repo.path(), "ws-peel-worktree", &snap).expect("initial verify passes");

    delete_loose_object(repo.path(), &work_tree);

    let error = verify_archive_refs(repo.path(), "ws-peel-worktree", &snap)
        .expect_err("a deleted worktree tree object must never verify");
    assert!(
        error.to_string().contains("does not exist") || error.to_string().contains("peel failed"),
        "expected an existence or peel failure, got: {error}"
    );
}

#[test]
fn the_anchored_shape_verifies_with_the_heads_family_peel_and_resolves_to_twork() {
    let repo = TempDirGuard::new("refs-anchored-shape");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "asset.txt", "payload\n");
    let index_tree = make_tree(repo.path(), "asset.txt", "payload\n");
    let anchor = commit_tree(repo.path(), &work_tree, "archive snapshot ws-anchored");
    let snap = snapshot(
        head,
        work_tree.clone(),
        index_tree.clone(),
        Some(anchor.clone()),
        None,
    );

    write_archive_refs(repo.path(), "ws-anchored", &snap).expect("write");
    verify_archive_refs(repo.path(), "ws-anchored", &snap)
        .expect("the anchored shape must verify via the heads-family (^{commit}) peel");

    // The exact silent-success a uniform peel would produce: `^{tree}`
    // against the anchor commit resolves to Twork, not the anchor itself.
    let peeled = stdout(repo.path(), &["rev-parse", &format!("{anchor}^{{tree}}")]);
    assert_eq!(
        peeled, work_tree,
        "^{{tree}} against the anchor commit must yield Twork, not the anchor"
    );
    assert_ne!(peeled, anchor);

    let resolved = resolve_archive_refs(repo.path(), "ws-anchored")
        .expect("resolve_archive_refs")
        .expect("refs must resolve");
    assert_eq!(resolved.work_tree_shape, ArchiveRefShape::AnchorCommit);
    assert_eq!(resolved.work_tree, work_tree);
    assert_eq!(resolved.work_tree_ref_oid, anchor);
}

#[test]
fn list_for_repo_enumerates_all_three_families_and_ignores_a_dangling_ref_elsewhere() {
    let repo = TempDirGuard::new("refs-list-for-repo");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "w.txt", "w\n");
    let index_tree = make_tree(repo.path(), "i.txt", "i\n");
    let snap = snapshot(head, work_tree, index_tree, None, None);
    write_archive_refs(repo.path(), "ws-list", &snap).expect("write");

    // A dangling ref far outside the archive namespace must not break, nor
    // be included in, the enumeration. `list_for_repo` uses `for-each-ref`
    // scoped to the archive prefix rather than a bare `show-ref`, which
    // would hard-fail the whole enumeration if ANY ref anywhere in the repo
    // dangles.
    let dangling_tree = make_tree(repo.path(), "dangling.txt", "dangling\n");
    run(
        repo.path(),
        &["update-ref", "refs/elsewhere/dangling", &dangling_tree],
    );
    delete_loose_object(repo.path(), &dangling_tree);

    let entries = list_for_repo(repo.path()).expect("list_for_repo must not hard-fail");
    let families: Vec<_> = entries
        .iter()
        .filter(|entry| entry.workspace_id == "ws-list")
        .map(|entry| entry.family.as_str())
        .collect();
    assert_eq!(entries.len(), 3, "exactly the three families for ws-list");
    assert!(families.contains(&"archive-heads"));
    assert!(families.contains(&"archive-worktrees"));
    assert!(families.contains(&"archive-indexes"));
}

#[test]
fn list_for_repo_returns_nothing_for_a_repo_with_no_archive_refs() {
    let repo = TempDirGuard::new("refs-list-empty");
    init_repo(repo.path());

    let entries = list_for_repo(repo.path()).expect("list_for_repo");
    assert!(entries.is_empty());
}

#[test]
fn copy_to_rescue_writes_three_refs_even_when_twork_and_tindex_collapse_to_one_oid() {
    let repo = TempDirGuard::new("refs-rescue-collapse");
    let head = init_repo(repo.path());
    let shared_tree = make_tree(repo.path(), "same.txt", "same content\n");
    // The flat-name collapse case: a clean worktree makes Twork and Tindex
    // the same OID.
    let snap = snapshot(head.clone(), shared_tree.clone(), shared_tree, None, None);
    write_archive_refs(repo.path(), "ws-rescue", &snap).expect("write");

    copy_to_rescue(repo.path(), "ws-rescue", &head).expect("copy_to_rescue");

    let prefix = format!("refs/proliferate/rescue/ws-rescue-{head}");
    for family in ["archive-heads", "archive-worktrees", "archive-indexes"] {
        let full = format!("{prefix}/{family}");
        let resolved = stdout(repo.path(), &["show-ref", "--verify", "--hash", &full]);
        assert!(!resolved.is_empty(), "expected {full} to exist");
    }

    // Idempotent at the same sha: a second call must not fail or duplicate.
    copy_to_rescue(repo.path(), "ws-rescue", &head).expect("copy_to_rescue is idempotent");
}

#[test]
fn delete_for_removes_exactly_its_own_id_and_leaves_siblings_and_rescue_intact() {
    let repo = TempDirGuard::new("refs-delete-for");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "w.txt", "w\n");
    let index_tree = make_tree(repo.path(), "i.txt", "i\n");
    let snap_a = snapshot(head.clone(), work_tree.clone(), index_tree.clone(), None, None);
    let snap_b = snapshot(head.clone(), work_tree, index_tree, None, None);
    write_archive_refs(repo.path(), "ws-a", &snap_a).expect("write a");
    write_archive_refs(repo.path(), "ws-b", &snap_b).expect("write b");
    copy_to_rescue(repo.path(), "ws-a", &head).expect("copy_to_rescue a");

    delete_for(repo.path(), "ws-a").expect("delete_for a");

    assert!(resolve_archive_refs(repo.path(), "ws-a")
        .expect("resolve_archive_refs")
        .is_none());
    assert!(resolve_archive_refs(repo.path(), "ws-b")
        .expect("resolve_archive_refs")
        .is_some());

    let rescue_head = format!("refs/proliferate/rescue/ws-a-{head}/archive-heads");
    let resolved = stdout(repo.path(), &["show-ref", "--verify", "--hash", &rescue_head]);
    assert!(
        !resolved.is_empty(),
        "delete_for must leave the rescue family untouched"
    );
}

/// Every `refs/proliferate/rescue/**` ref name currently in the repo.
fn rescue_ref_names(repo: &Path) -> Vec<String> {
    stdout(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/proliferate/rescue/",
        ],
    )
    .lines()
    .filter(|line| !line.is_empty())
    .map(str::to_string)
    .collect()
}

#[test]
fn delete_all_for_clears_its_own_ids_rescue_names_across_every_generation() {
    // Done-when #5's rescue half: "a purge of an archived workspace leaves no
    // refs/proliferate/archive-* AND no refs/proliferate/rescue/* ref for that
    // workspace id". `rescue_ref_names_for` splits the `<id>-<sha>` directory
    // component on its LAST hyphen because workspace ids contain hyphens
    // themselves; a prefix or parsing slip would make the whole verb a silent
    // no-op while purge still reported Deleted, which is exactly what this
    // pins. Two generations because rescue names accumulate per head sha.
    let repo = TempDirGuard::new("refs-delete-all-for-rescue");
    let head_one = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "w.txt", "w\n");
    let index_tree = make_tree(repo.path(), "i.txt", "i\n");
    let snap_one = snapshot(
        head_one.clone(),
        work_tree.clone(),
        index_tree.clone(),
        None,
        None,
    );
    // An id that itself carries hyphens — the parser's actual hazard.
    write_archive_refs(repo.path(), "ws-with-hyphens-a", &snap_one).expect("write generation one");
    copy_to_rescue(repo.path(), "ws-with-hyphens-a", &head_one).expect("rescue generation one");

    // A second generation at a different head sha, rescued under its own
    // `<id>-<sha>` directory.
    fs::write(repo.path().join("second.txt"), "second\n").expect("write second file");
    run(repo.path(), &["add", "second.txt"]);
    run(repo.path(), &["commit", "-m", "second"]);
    let head_two = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_ne!(head_one, head_two);
    let snap_two = snapshot(
        head_two.clone(),
        work_tree.clone(),
        index_tree.clone(),
        None,
        None,
    );
    write_archive_refs(repo.path(), "ws-with-hyphens-a", &snap_two).expect("write generation two");
    copy_to_rescue(repo.path(), "ws-with-hyphens-a", &head_two).expect("rescue generation two");

    // A sibling id whose rescue family must be untouched — and whose id is a
    // PREFIX-adjacent neighbour, so a naive `starts_with` match would eat it.
    let snap_sibling = snapshot(head_one.clone(), work_tree, index_tree, None, None);
    write_archive_refs(repo.path(), "ws-with-hyphens-a-b", &snap_sibling).expect("write sibling");
    copy_to_rescue(repo.path(), "ws-with-hyphens-a-b", &head_one).expect("rescue sibling");
    assert_eq!(rescue_ref_names(repo.path()).len(), 9);

    delete_all_for(repo.path(), "ws-with-hyphens-a").expect("delete_all_for");

    // The purged id: no archive refs and no rescue names, in either generation.
    assert!(resolve_archive_refs(repo.path(), "ws-with-hyphens-a")
        .expect("resolve_archive_refs")
        .is_none());
    let remaining = rescue_ref_names(repo.path());
    assert!(
        remaining
            .iter()
            .all(|name| name.starts_with("refs/proliferate/rescue/ws-with-hyphens-a-b-")),
        "only the sibling's rescue family may survive: {remaining:?}"
    );
    assert_eq!(
        remaining.len(),
        3,
        "the sibling's three rescue refs survive intact: {remaining:?}"
    );
    // The sibling's live archive refs are untouched too.
    assert!(resolve_archive_refs(repo.path(), "ws-with-hyphens-a-b")
        .expect("resolve_archive_refs")
        .is_some());
}

#[test]
fn delete_all_for_leaves_delete_fors_contract_intact_for_a_sibling_id() {
    // R5-10's whole reason for existing: the rescue clearing lives in a NEW
    // verb so R2's frozen `delete_for` keeps its pinned "leaves a sibling id's
    // set and any rescue/ names intact" contract. This asserts the two verbs
    // do not interfere — `delete_all_for` on one id must leave the OTHER id in
    // exactly the state `delete_for` promises, rescue names included.
    let repo = TempDirGuard::new("refs-delete-all-for-noninterference");
    let head = init_repo(repo.path());
    let work_tree = make_tree(repo.path(), "w.txt", "w\n");
    let index_tree = make_tree(repo.path(), "i.txt", "i\n");
    let snap_a = snapshot(head.clone(), work_tree.clone(), index_tree.clone(), None, None);
    let snap_b = snapshot(head.clone(), work_tree, index_tree, None, None);
    write_archive_refs(repo.path(), "ws-a", &snap_a).expect("write a");
    write_archive_refs(repo.path(), "ws-b", &snap_b).expect("write b");
    copy_to_rescue(repo.path(), "ws-a", &head).expect("rescue a");
    copy_to_rescue(repo.path(), "ws-b", &head).expect("rescue b");

    delete_all_for(repo.path(), "ws-a").expect("delete_all_for a");

    assert!(resolve_archive_refs(repo.path(), "ws-b")
        .expect("resolve_archive_refs")
        .is_some());
    let sibling_rescue = format!("refs/proliferate/rescue/ws-b-{head}/archive-heads");
    assert!(
        !stdout(repo.path(), &["show-ref", "--verify", "--hash", &sibling_rescue]).is_empty(),
        "delete_all_for must not touch a sibling id's rescue family"
    );

    // And `delete_for` on the sibling still behaves as R2 pinned it: its own
    // three archive refs go, its rescue names stay.
    delete_for(repo.path(), "ws-b").expect("delete_for b");
    assert!(resolve_archive_refs(repo.path(), "ws-b")
        .expect("resolve_archive_refs")
        .is_none());
    assert!(
        !stdout(repo.path(), &["show-ref", "--verify", "--hash", &sibling_rescue]).is_empty(),
        "delete_for still leaves rescue names alone; only delete_all_for clears them"
    );

    // Idempotent: a re-issued purge re-walks the same verb and converges.
    delete_all_for(repo.path(), "ws-a").expect("delete_all_for is idempotent");
}
