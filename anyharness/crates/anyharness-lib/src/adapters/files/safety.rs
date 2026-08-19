use std::io;
use std::path::{Component, Path, PathBuf};

const MAX_TEXT_FILE_SIZE: u64 = 1_048_576; // 1 MiB

pub fn max_text_file_size() -> u64 {
    MAX_TEXT_FILE_SIZE
}

/// Validate that a workspace-relative path is safe, then resolve it to an
/// absolute path whose canonical target is inside `workspace_root` at the
/// time it is checked.
pub fn resolve_safe_path(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, SafetyError> {
    let rel = validate_relative_path(relative_path)?;

    let candidate = workspace_root.join(rel);
    let canonical_root = workspace_root.canonicalize().map_err(map_safety_io_error)?;

    match candidate.symlink_metadata() {
        Ok(_) => {
            // An occupied final entry is resolved through its target. A
            // dangling final symlink is therefore distinct from an ordinary
            // absent entry and maps to NotFound rather than write/create
            // compatibility behavior.
            let canonical = candidate.canonicalize().map_err(map_safety_io_error)?;
            validate_canonical_target(&canonical, &canonical_root)?;
            Ok(canonical)
        }
        Err(error) if classify_io_error(&error) == ClassifiedIoError::NotFound => {
            // For compatibility writes to new files, verify the nearest
            // existing ancestor. Descriptor-relative traversal is a separate
            // hardening concern, so this check intentionally describes the
            // filesystem state only at validation time.
            validate_nearest_existing_ancestor(candidate.parent(), &canonical_root)?;
            Ok(candidate)
        }
        Err(error) => Err(map_safety_io_error(error)),
    }
}

/// Resolve a workspace-relative entry path without following the final path
/// component. Use this for mutations that operate on the entry itself, such as
/// renaming or deleting a symlink.
pub fn resolve_safe_entry_path(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, SafetyError> {
    let rel = validate_relative_path(relative_path)?;
    if rel.as_os_str().is_empty() {
        return Ok(workspace_root.to_path_buf());
    }

    let candidate = workspace_root.join(rel);
    let canonical_root = workspace_root.canonicalize().map_err(map_safety_io_error)?;
    let file_name = candidate
        .file_name()
        .ok_or(SafetyError::InvalidPath)?
        .to_owned();

    if let Some(parent) = candidate.parent() {
        match parent.symlink_metadata() {
            Ok(_) => {
                let canonical_parent = parent.canonicalize().map_err(map_safety_io_error)?;
                validate_canonical_target(&canonical_parent, &canonical_root)?;
                return Ok(canonical_parent.join(file_name));
            }
            Err(error) if classify_io_error(&error) == ClassifiedIoError::NotFound => {}
            Err(error) => return Err(map_safety_io_error(error)),
        }
    }

    validate_nearest_existing_ancestor(candidate.parent(), &canonical_root)?;

    Ok(candidate)
}

fn validate_nearest_existing_ancestor(
    mut current: Option<&Path>,
    canonical_root: &Path,
) -> Result<(), SafetyError> {
    while let Some(parent) = current {
        match parent.symlink_metadata() {
            Ok(_) => {
                let canonical_parent = parent.canonicalize().map_err(map_safety_io_error)?;
                return validate_canonical_target(&canonical_parent, canonical_root);
            }
            Err(error) if classify_io_error(&error) == ClassifiedIoError::NotFound => {
                current = parent.parent();
            }
            Err(error) => return Err(map_safety_io_error(error)),
        }
    }
    Ok(())
}

fn validate_canonical_target(
    canonical_path: &Path,
    canonical_root: &Path,
) -> Result<(), SafetyError> {
    reject_git_path(canonical_path)?;
    if !canonical_path.starts_with(canonical_root) {
        return Err(SafetyError::OutsideWorkspace);
    }
    Ok(())
}

fn validate_relative_path(relative_path: &str) -> Result<&Path, SafetyError> {
    if relative_path.is_empty() {
        return Ok(Path::new(relative_path));
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

    Ok(rel)
}

fn reject_git_path(canonical_path: &Path) -> Result<(), SafetyError> {
    for component in canonical_path.components() {
        if let Component::Normal(segment) = component {
            if segment == ".git" {
                return Err(SafetyError::GitDirectory);
            }
        }
    }
    Ok(())
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassifiedIoError {
    NotFound,
    PermissionDenied,
    Unexpected,
}

pub fn classify_io_error(error: &io::Error) -> ClassifiedIoError {
    match error.kind() {
        io::ErrorKind::NotFound => ClassifiedIoError::NotFound,
        io::ErrorKind::PermissionDenied => ClassifiedIoError::PermissionDenied,
        _ => ClassifiedIoError::Unexpected,
    }
}

fn map_safety_io_error(error: io::Error) -> SafetyError {
    match classify_io_error(&error) {
        ClassifiedIoError::NotFound => SafetyError::NotFound,
        ClassifiedIoError::PermissionDenied => SafetyError::PermissionDenied,
        ClassifiedIoError::Unexpected => SafetyError::IoError,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetyError {
    AbsolutePath,
    TraversalAttempt,
    InvalidPath,
    GitDirectory,
    OutsideWorkspace,
    NotFound,
    PermissionDenied,
    IoError,
}

impl std::fmt::Display for SafetyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AbsolutePath => write!(f, "absolute paths are not allowed"),
            Self::TraversalAttempt => write!(f, "path traversal (..) is not allowed"),
            Self::InvalidPath => write!(f, "invalid path component"),
            Self::GitDirectory => write!(f, ".git directory access is not allowed"),
            Self::OutsideWorkspace => write!(f, "resolved path is outside the workspace"),
            Self::NotFound => write!(f, "path target was not found"),
            Self::PermissionDenied => write!(f, "permission denied during path resolution"),
            Self::IoError => write!(f, "path resolution failed"),
        }
    }
}
