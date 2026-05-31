use std::path::{Path, PathBuf};

use super::types::GitOperation;

pub(super) fn detect_operation(repo_root: &Path) -> GitOperation {
    let git_dir = repo_root.join(".git");
    let git_path = if git_dir.is_dir() {
        git_dir
    } else if git_dir.is_file() {
        if let Ok(content) = std::fs::read_to_string(&git_dir) {
            if let Some(rest) = content.strip_prefix("gitdir: ") {
                PathBuf::from(rest.trim())
            } else {
                return GitOperation::None;
            }
        } else {
            return GitOperation::None;
        }
    } else {
        return GitOperation::None;
    };

    if git_path.join("MERGE_HEAD").exists() {
        GitOperation::Merge
    } else if git_path.join("rebase-merge").exists() || git_path.join("rebase-apply").exists() {
        GitOperation::Rebase
    } else if git_path.join("CHERRY_PICK_HEAD").exists() {
        GitOperation::CherryPick
    } else if git_path.join("REVERT_HEAD").exists() {
        GitOperation::Revert
    } else {
        GitOperation::None
    }
}
