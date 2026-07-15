use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use super::super::default_branch::detect_default_branch;
use super::super::executor::{run_git, run_git_ok};
use super::super::parse_status::parse_porcelain_v2;
use super::super::types::{
    GitActionAvailability, GitChangedFile, GitFileStatus, GitIncludedState, GitStatusSnapshot,
    GitStatusSummary,
};
use super::diff_support::{parse_numstat_z_map, DiffStats};
use super::status_operation::detect_operation;

/// Untracked files bypass `git diff`, so their line counts are read directly
/// off disk. Cap the read so a huge untracked file (e.g. an accidentally
/// committed binary blob or dataset) can't stall a status call.
const MAX_UNTRACKED_READ_BYTES: u64 = 5 * 1024 * 1024;

pub fn status(workspace_id: &str, workspace_path: &Path) -> anyhow::Result<GitStatusSnapshot> {
    let started = Instant::now();
    let repo_root_started = Instant::now();
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    tracing::info!(
        workspace_id = %workspace_id,
        elapsed_ms = repo_root_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.repo_root_resolved"
    );

    let porcelain_started = Instant::now();
    let raw = run_git_ok(
        &repo_root_path,
        &["status", "--porcelain=v2", "--branch", "-z"],
    )?;
    tracing::info!(
        workspace_id = %workspace_id,
        output_bytes = raw.len(),
        elapsed_ms = porcelain_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.porcelain_loaded"
    );

    let parse_started = Instant::now();
    let mut parsed = parse_porcelain_v2(&raw);
    tracing::info!(
        workspace_id = %workspace_id,
        changed_files = parsed.files.len(),
        elapsed_ms = parse_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.porcelain_parsed"
    );

    let operation_started = Instant::now();
    parsed.operation = detect_operation(&repo_root_path);
    tracing::info!(
        workspace_id = %workspace_id,
        operation = ?parsed.operation,
        elapsed_ms = operation_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.operation_detected"
    );

    let enrich_started = Instant::now();
    enrich_file_stats(workspace_id, &repo_root_path, &mut parsed.files);
    tracing::info!(
        workspace_id = %workspace_id,
        changed_files = parsed.files.len(),
        elapsed_ms = enrich_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.file_stats_enriched"
    );

    let detached = parsed.branch_head.is_none();

    let included_files = parsed
        .files
        .iter()
        .filter(|f| f.included_state != GitIncludedState::Excluded)
        .count() as u32;

    let conflicted_files = parsed
        .files
        .iter()
        .filter(|f| f.status == GitFileStatus::Conflicted)
        .count() as u32;

    let total_additions: u32 = parsed.files.iter().map(|f| f.additions).sum();
    let total_deletions: u32 = parsed.files.iter().map(|f| f.deletions).sum();
    let changed_files = parsed.files.len() as u32;
    let clean = changed_files == 0;

    let can_commit = changed_files > 0 && conflicted_files == 0;
    let has_upstream = parsed.upstream.is_some();
    let can_push = !detached && (parsed.ahead > 0 || !has_upstream) && clean;
    let push_label = if has_upstream {
        "Push"
    } else {
        "Publish branch"
    }
    .to_string();
    let can_create_pr = !detached && has_upstream && parsed.ahead == 0 && clean;

    let default_branch_started = Instant::now();
    let suggested_base = detect_default_branch(&repo_root_path);
    tracing::info!(
        workspace_id = %workspace_id,
        has_suggested_base = suggested_base.is_some(),
        elapsed_ms = default_branch_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.default_branch_detected"
    );

    let snapshot = GitStatusSnapshot {
        workspace_id: workspace_id.to_string(),
        workspace_path: workspace_path.display().to_string(),
        repo_root_path: repo_root,
        current_branch: parsed.branch_head,
        head_oid: parsed.branch_oid,
        detached,
        upstream_branch: parsed.upstream,
        suggested_base_branch: suggested_base,
        ahead: parsed.ahead,
        behind: parsed.behind,
        operation: parsed.operation,
        conflicted: conflicted_files > 0,
        clean,
        summary: GitStatusSummary {
            changed_files,
            additions: total_additions,
            deletions: total_deletions,
            included_files,
            conflicted_files,
        },
        actions: GitActionAvailability {
            can_commit,
            can_push,
            push_label,
            can_create_pull_request: can_create_pr,
            can_create_draft_pull_request: can_create_pr,
            can_create_branch_workspace: true,
            reason_if_blocked: if conflicted_files > 0 {
                Some("Conflicts must be resolved first".into())
            } else {
                None
            },
        },
        files: parsed.files,
    };
    tracing::info!(
        workspace_id = %workspace_id,
        changed_files = snapshot.summary.changed_files,
        additions = snapshot.summary.additions,
        deletions = snapshot.summary.deletions,
        elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.completed"
    );
    Ok(snapshot)
}

fn enrich_file_stats(workspace_id: &str, repo_root: &Path, files: &mut [GitChangedFile]) {
    let unstaged_started = Instant::now();
    let numstat = run_git(repo_root, &["diff", "--numstat", "-z"]);
    let unstaged_elapsed_ms = unstaged_started.elapsed().as_millis();
    let unstaged_success = numstat
        .as_ref()
        .map(|output| output.success)
        .unwrap_or(false);

    let staged_started = Instant::now();
    let staged_numstat = run_git(repo_root, &["diff", "--cached", "--numstat", "-z"]);
    let staged_elapsed_ms = staged_started.elapsed().as_millis();
    let staged_success = staged_numstat
        .as_ref()
        .map(|output| output.success)
        .unwrap_or(false);

    // Keyed by the *current* (new) path only. `parse_numstat_z_map` already
    // resolves git's `-z` rename encoding (an empty-path record followed by
    // two NUL-delimited path segments) into (old_path, new_path) pairs, so
    // renamed entries land on the new path the porcelain parser also uses.
    let mut by_path: HashMap<String, DiffStats> = HashMap::new();
    if let Ok(o) = &numstat {
        if o.success {
            merge_numstat_into(&mut by_path, &o.stdout);
        }
    }
    if let Ok(o) = &staged_numstat {
        if o.success {
            merge_numstat_into(&mut by_path, &o.stdout);
        }
    }

    for file in files.iter_mut() {
        if let Some(stat) = by_path.get(&file.path) {
            file.additions = file.additions.saturating_add(stat.additions);
            file.deletions = file.deletions.saturating_add(stat.deletions);
            file.binary = file.binary || stat.binary;
        }
    }

    let untracked_started = Instant::now();
    apply_untracked_line_counts(repo_root, files);
    let untracked_elapsed_ms = untracked_started.elapsed().as_millis();

    tracing::info!(
        workspace_id = %workspace_id,
        file_count = files.len(),
        unstaged_elapsed_ms,
        unstaged_success,
        staged_elapsed_ms,
        staged_success,
        untracked_elapsed_ms,
        "[anyharness-latency] git.status.numstat_loaded"
    );
}

fn merge_numstat_into(target: &mut HashMap<String, DiffStats>, raw: &str) {
    for ((_old_path, path), stat) in parse_numstat_z_map(raw) {
        let entry = target.entry(path).or_default();
        entry.additions = entry.additions.saturating_add(stat.additions);
        entry.deletions = entry.deletions.saturating_add(stat.deletions);
        entry.binary |= stat.binary;
    }
}

/// `git diff --numstat` never covers untracked files, so their additions are
/// derived by reading the file directly: newline count, plus one for a
/// trailing partial line. Binary or unreadable files are left at 0.
fn apply_untracked_line_counts(repo_root: &Path, files: &mut [GitChangedFile]) {
    for file in files.iter_mut() {
        if file.status != GitFileStatus::Untracked {
            continue;
        }
        if let Some((additions, binary)) = count_untracked_file_lines(repo_root, &file.path) {
            file.additions = additions;
            file.binary = file.binary || binary;
        }
    }
}

fn count_untracked_file_lines(repo_root: &Path, rel_path: &str) -> Option<(u32, bool)> {
    let full_path = repo_root.join(rel_path);
    let metadata = std::fs::metadata(&full_path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_READ_BYTES {
        return None;
    }

    let data = std::fs::read(&full_path).ok()?;
    if data.is_empty() {
        return Some((0, false));
    }
    if !crate::adapters::files::safety::is_likely_text(&data) {
        return Some((0, true));
    }

    let newline_count = data.iter().filter(|&&byte| byte == b'\n').count() as u32;
    let ends_with_newline = data.last() == Some(&b'\n');
    let additions = if ends_with_newline {
        newline_count
    } else {
        newline_count.saturating_add(1)
    };
    Some((additions, false))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::ErrorKind;
    use std::process::Command;

    use uuid::Uuid;

    use super::*;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            loop {
                let path = std::env::temp_dir()
                    .join(format!("anyharness-git-status-{prefix}-{}", Uuid::new_v4()));
                match fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("create temp dir: {error}"),
                }
            }
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

    fn git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("utf8")
            .trim()
            .to_string()
    }

    fn run_git_cmd<const N: usize>(cwd: &Path, args: [&str; N]) {
        let _ = git_stdout(cwd, args);
    }

    fn init_repo() -> TempDirGuard {
        let repo = TempDirGuard::new("repo");
        run_git_cmd(repo.path(), ["init", "-b", "main"]);
        run_git_cmd(repo.path(), ["config", "user.email", "codex@example.com"]);
        run_git_cmd(repo.path(), ["config", "user.name", "Codex"]);
        repo
    }

    fn commit_file(repo: &Path, path: &str, content: &str, message: &str) {
        fs::write(repo.join(path), content).expect("write file");
        run_git_cmd(repo, ["add", path]);
        run_git_cmd(repo, ["commit", "-m", message]);
    }

    fn find_file<'a>(files: &'a [GitChangedFile], path: &str) -> &'a GitChangedFile {
        files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("expected changed file {path}, got {files:?}"))
    }

    #[test]
    fn unstaged_modified_file_gets_real_additions_and_deletions() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\ntwo\nthree\n", "initial");
        fs::write(repo.path().join("tracked.txt"), "one\ntwo\nchanged\nfour\n")
            .expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "tracked.txt");

        assert_eq!(file.status, GitFileStatus::Modified);
        assert_eq!(file.additions, 2);
        assert_eq!(file.deletions, 1);
        assert_eq!(snapshot.summary.additions, 2);
        assert_eq!(snapshot.summary.deletions, 1);
    }

    #[test]
    fn staged_and_unstaged_changes_to_same_file_are_summed() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        fs::write(repo.path().join("tracked.txt"), "one\ntwo\n").expect("write file");
        run_git_cmd(repo.path(), ["add", "tracked.txt"]);
        fs::write(repo.path().join("tracked.txt"), "one\ntwo\nthree\n").expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "tracked.txt");

        // "1: staged" (+two) and "1: unstaged" (+three) should both be
        // reflected, not just whichever numstat call ran last.
        assert_eq!(file.additions, 2);
        assert_eq!(file.deletions, 0);
    }

    #[test]
    fn renamed_file_numstat_attaches_to_new_path() {
        let repo = init_repo();
        commit_file(
            repo.path(),
            "old.txt",
            "one\ntwo\nthree\nfour\nfive\n",
            "initial",
        );
        run_git_cmd(repo.path(), ["mv", "old.txt", "new.txt"]);
        fs::write(
            repo.path().join("new.txt"),
            "one\ntwo\nthree\nfour\nfive\nsix\n",
        )
        .expect("write file");
        run_git_cmd(repo.path(), ["add", "new.txt"]);

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "new.txt");

        assert_eq!(file.status, GitFileStatus::Renamed);
        assert_eq!(file.old_path.as_deref(), Some("old.txt"));
        assert_eq!(file.additions, 1);
        assert_eq!(file.deletions, 0);
    }

    #[test]
    fn renamed_file_nested_in_shared_prefix_attaches_to_new_path() {
        let repo = init_repo();
        fs::create_dir_all(repo.path().join("src/old")).expect("mkdir");
        commit_file(
            repo.path(),
            "src/old/file.txt",
            "one\ntwo\nthree\n",
            "initial",
        );
        fs::create_dir_all(repo.path().join("src/new")).expect("mkdir");
        run_git_cmd(repo.path(), ["mv", "src/old/file.txt", "src/new/file.txt"]);
        fs::write(
            repo.path().join("src/new/file.txt"),
            "one\ntwo\nthree\nfour\n",
        )
        .expect("write file");
        run_git_cmd(repo.path(), ["add", "src/new/file.txt"]);

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "src/new/file.txt");

        assert_eq!(file.status, GitFileStatus::Renamed);
        assert_eq!(file.old_path.as_deref(), Some("src/old/file.txt"));
        assert_eq!(file.additions, 1);
        assert_eq!(file.deletions, 0);
    }

    #[test]
    fn binary_modified_file_leaves_counts_zero_and_marks_binary() {
        let repo = init_repo();
        fs::write(repo.path().join("binary.bin"), [0u8, 1, 2, 3]).expect("write file");
        run_git_cmd(repo.path(), ["add", "binary.bin"]);
        run_git_cmd(repo.path(), ["commit", "-m", "initial"]);
        fs::write(repo.path().join("binary.bin"), [0u8, 1, 2, 3, 4, 5]).expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "binary.bin");

        assert_eq!(file.status, GitFileStatus::Modified);
        assert!(file.binary);
        assert_eq!(file.additions, 0);
        assert_eq!(file.deletions, 0);
    }

    #[test]
    fn untracked_file_additions_count_lines_including_trailing_partial_line() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        fs::write(repo.path().join("new.txt"), "one\ntwo\nthree").expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "new.txt");

        assert_eq!(file.status, GitFileStatus::Untracked);
        // Two full lines plus a trailing line without a newline = 3.
        assert_eq!(file.additions, 3);
        assert_eq!(file.deletions, 0);
    }

    #[test]
    fn untracked_binary_file_leaves_additions_zero() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        fs::write(repo.path().join("new.bin"), [0u8, 159, 146, 150]).expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "new.bin");

        assert_eq!(file.status, GitFileStatus::Untracked);
        assert_eq!(file.additions, 0);
        assert!(file.binary);
    }

    #[test]
    fn oversized_untracked_file_is_skipped() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        // 1 byte over the cap, made of newlines so a real count would be
        // trivially non-zero if the cap weren't enforced.
        let oversized = "\n".repeat(MAX_UNTRACKED_READ_BYTES as usize + 1);
        fs::write(repo.path().join("huge.txt"), oversized).expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "huge.txt");

        assert_eq!(file.status, GitFileStatus::Untracked);
        assert_eq!(file.additions, 0);
    }

    #[test]
    fn empty_untracked_file_has_zero_additions() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        fs::write(repo.path().join("empty.txt"), "").expect("write file");

        let snapshot = status("workspace", repo.path()).expect("status");
        let file = find_file(&snapshot.files, "empty.txt");

        assert_eq!(file.status, GitFileStatus::Untracked);
        assert_eq!(file.additions, 0);
        assert_eq!(file.deletions, 0);
    }
}
