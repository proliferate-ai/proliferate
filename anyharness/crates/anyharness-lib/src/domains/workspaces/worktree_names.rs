use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeNameConflictPolicy {
    Fail,
    SuffixPath,
    SuffixPathAndBranch,
}

impl Default for WorktreeNameConflictPolicy {
    fn default() -> Self {
        Self::Fail
    }
}

#[derive(Debug, Clone)]
pub struct WorktreeNameCandidate {
    pub target_path: PathBuf,
    pub branch_name: String,
}

impl WorktreeNameConflictPolicy {
    pub fn candidate(
        self,
        target_path: &str,
        branch_name: &str,
        suffix: Option<usize>,
    ) -> WorktreeNameCandidate {
        match (self, suffix) {
            (_, None) | (Self::Fail, _) => WorktreeNameCandidate {
                target_path: PathBuf::from(target_path),
                branch_name: branch_name.to_string(),
            },
            (Self::SuffixPath, Some(value)) => WorktreeNameCandidate {
                target_path: suffix_path_leaf(target_path, value),
                branch_name: branch_name.to_string(),
            },
            (Self::SuffixPathAndBranch, Some(value)) => WorktreeNameCandidate {
                target_path: suffix_path_leaf(target_path, value),
                branch_name: suffix_branch_leaf(branch_name, value),
            },
        }
    }

    pub fn can_retry(self) -> bool {
        !matches!(self, Self::Fail)
    }

    pub fn can_retry_branch(self) -> bool {
        matches!(self, Self::SuffixPathAndBranch)
    }
}

pub fn suffix_branch_leaf(branch_name: &str, suffix: usize) -> String {
    let trimmed = branch_name.trim();
    if let Some((prefix, leaf)) = trimmed.rsplit_once('/') {
        return format!("{prefix}/{}-{suffix}", fallback_leaf(leaf));
    }
    format!("{}-{suffix}", fallback_leaf(trimmed))
}

fn suffix_path_leaf(target_path: &str, suffix: usize) -> PathBuf {
    let path = Path::new(target_path);
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "workspace".to_string());
    let suffixed = format!("{}-{suffix}", fallback_leaf(&file_name));
    path.parent()
        .map(|parent| parent.join(&suffixed))
        .unwrap_or_else(|| PathBuf::from(suffixed))
}

fn fallback_leaf(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{suffix_branch_leaf, WorktreeNameConflictPolicy};

    #[test]
    fn suffix_branch_leaf_preserves_prefix() {
        assert_eq!(suffix_branch_leaf("codex/otter", 2), "codex/otter-2");
        assert_eq!(suffix_branch_leaf("otter", 2), "otter-2");
    }

    #[test]
    fn suffix_path_and_branch_candidates_share_suffix() {
        let candidate = WorktreeNameConflictPolicy::SuffixPathAndBranch.candidate(
            "/tmp/worktrees/otter",
            "codex/otter",
            Some(3),
        );
        assert_eq!(
            candidate.target_path.to_string_lossy(),
            "/tmp/worktrees/otter-3"
        );
        assert_eq!(candidate.branch_name, "codex/otter-3");
    }
}
