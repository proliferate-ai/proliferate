//! Materialization tests on real filesystems and real git repos: seeding,
//! idempotence (run-local edits win), and the shared exclude entry — written
//! once, into the COMMON git dir, covering worktrees.

use std::path::Path;
use std::process::Command;

use super::definition::DocTemplate;
use super::materialize::materialize_context;
use super::model::WorkflowRunDocRecord;
use crate::adapters::git::executor::GitOutput;
use crate::domains::workspaces::exclude::{
    classify_common_dir_probe, ensure_proliferate_excluded, ExcludeOutcome,
    PROLIFERATE_EXCLUDE_ENTRY,
};

const T0: &str = "2026-08-14T00:00:00+00:00";

/// House temp-dir idiom (no tempfile dev-dependency): unique dir under the
/// system temp root, removed on drop.
struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-workflows-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn doc(slug: &str, filename: &str) -> WorkflowRunDocRecord {
    WorkflowRunDocRecord {
        id: format!("doc-{slug}"),
        run_id: "run-1".into(),
        slug: slug.into(),
        filename: filename.into(),
        producing_node_row_id: None,
        seeded_from_template: true,
        created_at: T0.into(),
        updated_at: T0.into(),
    }
}

fn template(slug: &str, body: &str) -> DocTemplate {
    DocTemplate {
        slug: slug.into(),
        producing_node_id: "plan".into(),
        body: body.into(),
    }
}

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .current_dir(cwd)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_repo(root: &Path) {
    std::fs::create_dir_all(root).expect("create repo dir");
    git(root, &["init", "--initial-branch=main"]);
    git(root, &["config", "user.email", "test@example.com"]);
    git(root, &["config", "user.name", "Test"]);
    std::fs::write(root.join("README.md"), "seed\n").expect("seed file");
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "seed"]);
}

fn read_exclude(repo_root: &Path) -> String {
    std::fs::read_to_string(repo_root.join(".git/info/exclude")).unwrap_or_default()
}

#[test]
fn materialize_seeds_docs_and_writes_the_exclude_entry_once() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);

    let docs = vec![doc("plan-doc", "00-plan-doc.md"), doc("notes", "notes.md")];
    let templates = vec![template("plan-doc", "# Plan\n"), template("notes", "")];

    let context_dir = materialize_context(&root, "run-1", &docs, &templates).expect("materialize");
    assert_eq!(context_dir, root.join(".proliferate/context/run-1"));
    assert_eq!(
        std::fs::read_to_string(context_dir.join("00-plan-doc.md")).expect("seeded"),
        "# Plan\n"
    );
    assert_eq!(
        std::fs::read_to_string(context_dir.join("notes.md")).expect("seeded empty"),
        ""
    );

    let exclude = read_exclude(&root);
    assert_eq!(
        exclude
            .lines()
            .filter(|line| line.trim() == PROLIFERATE_EXCLUDE_ENTRY)
            .count(),
        1,
        "exactly one exclude entry, got:\n{exclude}"
    );

    // Negative control for idempotence: a second materialization must not
    // duplicate the entry or clobber files.
    materialize_context(&root, "run-1", &docs, &templates).expect("re-materialize");
    let exclude = read_exclude(&root);
    assert_eq!(
        exclude
            .lines()
            .filter(|line| line.trim() == PROLIFERATE_EXCLUDE_ENTRY)
            .count(),
        1,
        "still exactly one exclude entry after re-run"
    );

    // The entry actually excludes: git must not report .proliferate as
    // untracked.
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&root)
        .output()
        .expect("git status");
    let status = String::from_utf8_lossy(&output.stdout);
    assert!(
        !status.contains(".proliferate"),
        "exclude entry must hide the context folder, status:\n{status}"
    );
}

#[test]
fn run_local_edits_survive_rematerialization() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);
    let docs = vec![doc("plan-doc", "00-plan-doc.md")];
    let templates = vec![template("plan-doc", "# Plan\n")];

    let context_dir = materialize_context(&root, "run-1", &docs, &templates).expect("materialize");
    let path = context_dir.join("00-plan-doc.md");
    std::fs::write(&path, "# Plan\n\nthe agent wrote this\n").expect("edit");

    materialize_context(&root, "run-1", &docs, &templates).expect("re-materialize");
    assert_eq!(
        std::fs::read_to_string(&path).expect("read"),
        "# Plan\n\nthe agent wrote this\n",
        "run-local edits win; seeding never overwrites"
    );
}

#[test]
fn worktree_workspaces_write_the_entry_into_the_common_git_dir() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);
    let worktree = tmp.path().join("wt");
    git(
        &root,
        &[
            "worktree",
            "add",
            worktree.to_str().expect("utf8 path"),
            "-b",
            "run-branch",
        ],
    );

    let docs = vec![doc("notes", "notes.md")];
    let templates = vec![template("notes", "")];
    materialize_context(&worktree, "run-1", &docs, &templates).expect("materialize in worktree");

    // The entry lands in the MAIN clone's info/exclude (the common dir), not
    // in the worktree's private gitdir.
    let exclude = read_exclude(&root);
    assert!(
        exclude
            .lines()
            .any(|line| line.trim() == PROLIFERATE_EXCLUDE_ENTRY),
        "common-dir exclude must carry the entry:\n{exclude}"
    );
    let private = root.join(".git/worktrees/wt/info/exclude");
    assert!(
        !private.exists(),
        "the worktree's private gitdir must stay untouched"
    );

    // And it covers the worktree: git in the worktree sees nothing untracked.
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&worktree)
        .output()
        .expect("git status");
    let status = String::from_utf8_lossy(&output.stdout);
    assert!(
        !status.contains(".proliferate"),
        "shared entry must cover the worktree, status:\n{status}"
    );
}

#[test]
fn non_git_workspaces_materialize_without_an_exclude_entry() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("plain");
    std::fs::create_dir_all(&root).expect("create dir");
    // Guard against the tempdir living inside some outer repo: resolve what
    // the exclude verb sees first, and only assert the strict outcome when
    // the dir is genuinely repo-free.
    let outcome = ensure_proliferate_excluded(&root).expect("exclude probe");
    let docs = vec![doc("notes", "notes.md")];
    let templates = vec![template("notes", "seeded\n")];
    let context_dir = materialize_context(&root, "run-1", &docs, &templates).expect("materialize");
    assert_eq!(
        std::fs::read_to_string(context_dir.join("notes.md")).expect("read"),
        "seeded\n"
    );
    if outcome == ExcludeOutcome::NotAGitRepo {
        assert!(!root.join(".git").exists());
    }
}

/// Template bodies are STATIC seeds: whatever bytes the definition carries
/// land on disk verbatim — reference-shaped text, sigils, braces and all.
/// Nothing scans or interpolates a template body.
#[test]
fn template_bodies_seed_byte_for_byte_verbatim() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);
    let body = "# Plan\n@input:ticket and @doc:plan-doc stay literal, so do {braces} and $vars\n\u{201C}smart quotes\u{201D} too\n";
    let docs = vec![doc("plan-doc", "00-plan-doc.md")];
    let templates = vec![template("plan-doc", body)];
    let context_dir = materialize_context(&root, "run-1", &docs, &templates).expect("materialize");
    assert_eq!(
        std::fs::read(context_dir.join("00-plan-doc.md")).expect("read"),
        body.as_bytes(),
        "template bodies are static seeds, written verbatim"
    );
}

/// A registry row with no matching template still materializes (empty file):
/// run-local registered docs have no template by construction.
#[test]
fn doc_rows_without_templates_seed_empty_files() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);
    let docs = vec![doc("scratch", "scratch.md")];
    let context_dir = materialize_context(&root, "run-1", &docs, &[]).expect("materialize");
    assert_eq!(
        std::fs::read_to_string(context_dir.join("scratch.md")).expect("read"),
        ""
    );
}

/// F3: only the genuine not-a-repo answer maps to NotAGitRepo. Git FAILING —
/// dubious ownership, permissions, corruption — must surface as an error, or
/// the never-committed guarantee silently evaporates.
#[test]
fn git_failures_are_errors_not_a_missing_repo() {
    let root = Path::new("/ws");
    let ok = |stdout: &str| GitOutput {
        stdout: stdout.into(),
        stderr: String::new(),
        success: true,
    };
    let failed = |stderr: &str| GitOutput {
        stdout: String::new(),
        stderr: stderr.into(),
        success: false,
    };

    let dir = classify_common_dir_probe(root, &ok("/ws/.git\n"))
        .expect("repo probe")
        .expect("is a repo");
    assert_eq!(dir, Path::new("/ws/.git"));
    // Relative answers resolve against the workspace root.
    let dir = classify_common_dir_probe(root, &ok(".git\n"))
        .expect("repo probe")
        .expect("is a repo");
    assert_eq!(dir, Path::new("/ws/.git"));

    let outcome = classify_common_dir_probe(
        root,
        &failed("fatal: not a git repository (or any of the parent directories): .git\n"),
    )
    .expect("genuine not-a-repo is not an error");
    assert_eq!(outcome, None);

    // Negative controls: every other git failure is an error.
    classify_common_dir_probe(
        root,
        &failed("fatal: detected dubious ownership in repository\n"),
    )
    .expect_err("dubious ownership must not read as no-repo");
    classify_common_dir_probe(
        root,
        &failed("error: unable to read .git/HEAD: Permission denied\n"),
    )
    .expect_err("permission failure must not read as no-repo");
    classify_common_dir_probe(root, &ok(""))
        .expect_err("a successful probe with no path is malformed, not a repo");
}

#[test]
fn exclude_entry_appends_below_existing_content() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);
    let exclude_path = root.join(".git/info/exclude");
    std::fs::create_dir_all(exclude_path.parent().expect("parent")).expect("info dir");
    std::fs::write(&exclude_path, "*.tmp").expect("pre-existing content without newline");

    assert_eq!(
        ensure_proliferate_excluded(&root).expect("write"),
        ExcludeOutcome::Written
    );
    assert_eq!(
        ensure_proliferate_excluded(&root).expect("idempotent"),
        ExcludeOutcome::AlreadyPresent
    );
    let content = read_exclude(&root);
    assert_eq!(content, format!("*.tmp\n{PROLIFERATE_EXCLUDE_ENTRY}\n"));
}

/// R3: two runs sharing one workspace never collide on doc paths — each
/// run's docs live under its own run-scoped directory. Negative control for
/// the old flat layout: identical filenames across runs stay disjoint files.
#[test]
fn concurrent_runs_materialize_into_disjoint_run_scoped_dirs() {
    let tmp = TempDir::new("test");
    let root = tmp.path().join("repo");
    init_repo(&root);
    let docs = vec![doc("plan-doc", "00-plan-doc.md")];

    let dir_a = materialize_context(&root, "run-a", &docs, &[template("plan-doc", "a\n")])
        .expect("materialize run a");
    let dir_b = materialize_context(&root, "run-b", &docs, &[template("plan-doc", "b\n")])
        .expect("materialize run b");

    assert_ne!(dir_a, dir_b, "run-scoped dirs must be disjoint");
    assert_eq!(dir_a, root.join(".proliferate/context/run-a"));
    assert_eq!(dir_b, root.join(".proliferate/context/run-b"));
    assert_eq!(
        std::fs::read_to_string(dir_a.join("00-plan-doc.md")).expect("run a doc"),
        "a\n",
        "run b's seed must not clobber run a's identically named doc"
    );
    assert_eq!(
        std::fs::read_to_string(dir_b.join("00-plan-doc.md")).expect("run b doc"),
        "b\n"
    );
}
