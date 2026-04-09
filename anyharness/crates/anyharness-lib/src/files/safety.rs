use std::path::{Component, Path, PathBuf};

const MAX_TEXT_FILE_SIZE: u64 = 1_048_576; // 1 MiB

pub fn max_text_file_size() -> u64 {
    MAX_TEXT_FILE_SIZE
}

/// Validate that a workspace-relative path is safe, then resolve it to an
/// absolute path guaranteed to stay inside `workspace_root`.
pub fn resolve_safe_path(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, SafetyError> {
    if relative_path.is_empty() {
        return Ok(workspace_root.to_path_buf());
    }

    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return Err(SafetyError::AbsolutePath);
    }

    for component in rel.components() {
        match component {
            Component::ParentDir => return Err(SafetyError::TraversalAttempt),
            Component::Prefix(_) => return Err(SafetyError::InvalidPath),
            _ => {}
        }
    }

    // Reject paths that touch .git
    for component in rel.components() {
        if let Component::Normal(s) = component {
            if s == ".git" {
                return Err(SafetyError::GitDirectory);
            }
        }
    }

    let candidate = workspace_root.join(rel);
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| SafetyError::IoError(e.to_string()))?;

    // If the target exists, canonicalize and verify containment
    if candidate.exists() {
        let canonical = candidate
            .canonicalize()
            .map_err(|e| SafetyError::IoError(e.to_string()))?;

        if !canonical.starts_with(&canonical_root) {
            return Err(SafetyError::OutsideWorkspace);
        }
        Ok(canonical)
    } else {
        // For writes to new files, verify the nearest existing ancestor stays
        // inside the workspace. This blocks symlink escapes even when multiple
        // parent segments do not exist yet.
        let mut current = candidate.parent();
        while let Some(parent) = current {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| SafetyError::IoError(e.to_string()))?;
                if !canonical_parent.starts_with(&canonical_root) {
                    return Err(SafetyError::OutsideWorkspace);
                }
                break;
            }
            current = parent.parent();
        }
        Ok(candidate)
    }
}

/// Sniff whether `data` is valid UTF-8 text (not binary).
pub fn is_likely_text(data: &[u8]) -> bool {
    // Fast reject: if it contains NUL bytes, treat as binary
    if data.contains(&0) {
        return false;
    }
    std::str::from_utf8(data).is_ok()
}

/// Compute a simple content-hash version token.
pub fn content_version_token(data: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.len().hash(&mut hasher);
    data.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[derive(Debug)]
pub enum SafetyError {
    AbsolutePath,
    TraversalAttempt,
    InvalidPath,
    GitDirectory,
    OutsideWorkspace,
    IoError(String),
}

impl std::fmt::Display for SafetyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AbsolutePath => write!(f, "absolute paths are not allowed"),
            Self::TraversalAttempt => write!(f, "path traversal (..) is not allowed"),
            Self::InvalidPath => write!(f, "invalid path component"),
            Self::GitDirectory => write!(f, ".git directory access is not allowed"),
            Self::OutsideWorkspace => write!(f, "resolved path is outside the workspace"),
            Self::IoError(e) => write!(f, "IO error during path resolution: {e}"),
        }
    }
}

impl SafetyError {
    pub fn problem_code(&self) -> &'static str {
        match self {
            Self::AbsolutePath | Self::TraversalAttempt | Self::InvalidPath => "INVALID_FILE_PATH",
            Self::GitDirectory => "INVALID_FILE_PATH",
            Self::OutsideWorkspace => "PATH_OUTSIDE_WORKSPACE",
            Self::IoError(_) => "INVALID_FILE_PATH",
        }
    }
}
