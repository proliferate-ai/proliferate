use std::path::Path;

use super::super::executor::run_git;
use super::super::parse_status::parse_porcelain_v2;
use super::super::types::{GitFileStatus, GitStatusSummarySnapshot, GitStatusSummaryState};
use super::status_operation::detect_operation;

pub fn status_summary(workspace_path: &Path) -> GitStatusSummarySnapshot {
    let raw = match run_git(
        workspace_path,
        &["status", "--porcelain=v2", "--branch", "-z"],
    ) {
        Ok(output) if output.success => output.stdout,
        Ok(output) => {
            return unknown(output.stderr.trim().to_string());
        }
        Err(error) => {
            return unknown(error.to_string());
        }
    };

    let parsed = parse_porcelain_v2(&raw);
    let operation = detect_operation(workspace_path);
    let changed_file_count = parsed
        .files
        .iter()
        .filter(|file| file.status != GitFileStatus::Untracked)
        .count() as u32;
    let untracked_file_count = parsed
        .files
        .iter()
        .filter(|file| file.status == GitFileStatus::Untracked)
        .count() as u32;
    let conflicted = parsed
        .files
        .iter()
        .any(|file| file.status == GitFileStatus::Conflicted)
        || !matches!(operation, super::super::types::GitOperation::None);
    let clean = changed_file_count == 0 && untracked_file_count == 0 && !conflicted;
    let state = if conflicted {
        GitStatusSummaryState::Conflicted
    } else if clean {
        GitStatusSummaryState::Clean
    } else {
        GitStatusSummaryState::Dirty
    };

    GitStatusSummarySnapshot {
        state,
        clean,
        conflicted,
        changed_file_count,
        untracked_file_count,
        ahead: parsed.ahead,
        behind: parsed.behind,
        branch: parsed.branch_head,
        upstream_branch: parsed.upstream,
        error_message: None,
    }
}

fn unknown(message: String) -> GitStatusSummarySnapshot {
    GitStatusSummarySnapshot {
        state: GitStatusSummaryState::Unknown,
        clean: false,
        conflicted: false,
        changed_file_count: 0,
        untracked_file_count: 0,
        ahead: 0,
        behind: 0,
        branch: None,
        upstream_branch: None,
        error_message: Some(message),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "anyharness-{prefix}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn untracked_files_mark_summary_dirty_without_changed_count() {
        let repo = TempDirGuard::new("git-status-summary-untracked");
        let init = std::process::Command::new("git")
            .arg("-c")
            .arg("init.defaultBranch=main")
            .arg("init")
            .arg(repo.path())
            .output()
            .expect("run git init");
        assert!(init.status.success(), "git init failed: {init:?}");

        std::fs::write(repo.path().join("scratch.txt"), "untracked\n")
            .expect("write untracked file");

        let summary = status_summary(repo.path());

        assert_eq!(summary.state, GitStatusSummaryState::Dirty);
        assert!(!summary.clean);
        assert_eq!(summary.changed_file_count, 0);
        assert_eq!(summary.untracked_file_count, 1);
    }
}
