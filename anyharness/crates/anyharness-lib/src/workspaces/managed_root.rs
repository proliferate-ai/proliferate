use std::path::{Path, PathBuf};

pub const ANYHARNESS_WORKTREES_ROOT_ENV: &str = "ANYHARNESS_WORKTREES_ROOT";

pub fn managed_worktrees_root(runtime_home: &Path) -> PathBuf {
    if let Some(root) = std::env::var_os(ANYHARNESS_WORKTREES_ROOT_ENV) {
        return PathBuf::from(root);
    }
    runtime_home
        .parent()
        .map(|root| root.join("worktrees"))
        .unwrap_or_else(|| runtime_home.join("worktrees"))
}

pub fn canonical_managed_worktrees_root(runtime_home: &Path) -> anyhow::Result<PathBuf> {
    let root = managed_worktrees_root(runtime_home);
    let env_override = std::env::var_os(ANYHARNESS_WORKTREES_ROOT_ENV).is_some();
    if !root.is_absolute() {
        if env_override {
            anyhow::bail!("{ANYHARNESS_WORKTREES_ROOT_ENV} must be an absolute path");
        }
        return Ok(root);
    }
    if root.exists() {
        return std::fs::canonicalize(&root)
            .map_err(|error| anyhow::anyhow!("canonicalizing managed worktrees root: {error}"));
    }
    let parent = root
        .parent()
        .ok_or_else(|| anyhow::anyhow!("managed worktrees root has no parent"))?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|error| {
        anyhow::anyhow!("canonicalizing managed worktrees root parent: {error}")
    })?;
    let file_name = root
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("managed worktrees root has no final path component"))?;
    Ok(canonical_parent.join(file_name))
}
