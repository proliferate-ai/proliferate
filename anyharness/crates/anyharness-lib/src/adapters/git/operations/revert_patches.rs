use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use super::super::executor::{run_git_ok, GitOutput};
use super::super::parse_status::parse_porcelain_v2;
use super::super::types::{
    GitFileStatus, GitIncludedState, GitOperation, GitRevertPatchEntry, GitRevertPatchOperation,
    GitRevertPatchesError, GitRevertPatchesResult,
};
use super::status_operation::detect_operation;

pub fn revert_patches(
    workspace_path: &Path,
    entries: &[GitRevertPatchEntry],
) -> Result<GitRevertPatchesResult, GitRevertPatchesError> {
    if entries.is_empty() {
        return Err(GitRevertPatchesError::NothingToRevert);
    }

    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    let head_oid_before = run_git_ok(&repo_root_path, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();

    if detect_operation(&repo_root_path) != GitOperation::None {
        return Err(GitRevertPatchesError::ConflictedOperation);
    }

    let raw_status = run_git_ok(
        &repo_root_path,
        &["status", "--porcelain=v2", "--branch", "-z"],
    )?;
    let parsed_status = parse_porcelain_v2(&raw_status);
    if parsed_status
        .files
        .iter()
        .any(|file| file.status == GitFileStatus::Conflicted)
    {
        return Err(GitRevertPatchesError::ConflictedOperation);
    }

    let mut patch_stream = String::new();
    let mut reverted_paths = BTreeSet::new();
    for entry in entries {
        let path = normalize_revert_path(&entry.path)?;
        let old_path = entry
            .old_path
            .as_deref()
            .map(normalize_revert_path)
            .transpose()?;
        if entry.patch_truncated {
            return Err(GitRevertPatchesError::TruncatedPatch { path });
        }
        if entry.patch.trim().is_empty() {
            return Err(GitRevertPatchesError::MissingPatch { path });
        }
        if let Some(file) = parsed_status
            .files
            .iter()
            .find(|file| revert_entry_touches_status_file(file, &path, old_path.as_deref()))
        {
            match file.included_state {
                GitIncludedState::Partial => {
                    return Err(GitRevertPatchesError::PartialStaging { path });
                }
                GitIncludedState::Included => {
                    return Err(GitRevertPatchesError::StagedChanges { path });
                }
                GitIncludedState::Excluded => {}
            }
        }
        let normalized_patch = normalize_revert_patch(entry, &path, old_path.as_deref())?;
        patch_stream.push_str(&normalized_patch);
        if !patch_stream.ends_with('\n') {
            patch_stream.push('\n');
        }
        reverted_paths.insert(path);
    }

    let check = run_git_with_stdin(
        &repo_root_path,
        &[
            "apply",
            "--reverse",
            "--check",
            "--recount",
            "--whitespace=nowarn",
        ],
        &patch_stream,
    )?;
    if !check.success {
        return Err(GitRevertPatchesError::PatchRejected {
            path: reverted_paths.iter().next().cloned().unwrap_or_default(),
            message: git_command_message(&check.stderr, "patch no longer applies"),
        });
    }

    let apply = run_git_with_stdin(
        &repo_root_path,
        &["apply", "--reverse", "--recount", "--whitespace=nowarn"],
        &patch_stream,
    )?;
    if !apply.success {
        return Err(GitRevertPatchesError::GitFailed {
            message: git_command_message(&apply.stderr, "patch apply failed"),
        });
    }

    let head_oid_after = run_git_ok(&repo_root_path, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();

    Ok(GitRevertPatchesResult {
        reverted_paths: reverted_paths.into_iter().collect(),
        head_oid_before,
        head_oid_after,
    })
}

fn normalize_revert_path(path: &str) -> Result<String, GitRevertPatchesError> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\\') {
        return Err(GitRevertPatchesError::UnsafePath {
            path: path.to_string(),
        });
    }
    let path_value = Path::new(trimmed);
    if path_value.is_absolute() {
        return Err(GitRevertPatchesError::UnsafePath {
            path: trimmed.to_string(),
        });
    }
    for component in path_value.components() {
        match component {
            Component::Normal(value) if value == std::ffi::OsStr::new(".git") => {
                return Err(GitRevertPatchesError::UnsafePath {
                    path: trimmed.to_string(),
                });
            }
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(GitRevertPatchesError::UnsafePath {
                    path: trimmed.to_string(),
                });
            }
        }
    }
    Ok(trimmed.to_string())
}

fn normalize_revert_patch(
    entry: &GitRevertPatchEntry,
    path: &str,
    old_path: Option<&str>,
) -> Result<String, GitRevertPatchesError> {
    let patch = entry.patch.trim_end();
    if patch.contains('\0') {
        return Err(GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "patch contains NUL bytes".to_string(),
        });
    }
    if patch.contains("GIT binary patch") || patch.contains("Binary files ") {
        return Err(GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "binary patches cannot be undone safely".to_string(),
        });
    }
    if patch.contains("diff --git ") || (patch.contains("--- ") && patch.contains("+++ ")) {
        validate_full_patch_headers(patch, path, old_path)?;
        return Ok(format!("{patch}\n"));
    }
    if !patch.lines().any(|line| line.starts_with("@@ ")) {
        return Err(GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "patch is missing diff headers".to_string(),
        });
    }
    if entry.operation != GitRevertPatchOperation::Edit || old_path.is_some() {
        return Err(GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "patch is missing file headers".to_string(),
        });
    }
    Ok(format!(
        "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n{patch}\n"
    ))
}

fn revert_entry_touches_status_file(
    file: &super::super::types::GitChangedFile,
    path: &str,
    old_path: Option<&str>,
) -> bool {
    file.path == path
        || file.old_path.as_deref() == Some(path)
        || old_path.is_some_and(|old_path| {
            file.path == old_path || file.old_path.as_deref() == Some(old_path)
        })
}

fn validate_full_patch_headers(
    patch: &str,
    path: &str,
    old_path: Option<&str>,
) -> Result<(), GitRevertPatchesError> {
    let mut saw_header_path = false;
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let (left, right) = parse_diff_git_paths(rest, path)?;
            validate_patch_header_path(left.as_deref(), path, old_path)?;
            validate_patch_header_path(right.as_deref(), path, old_path)?;
            saw_header_path = true;
            continue;
        }
        for prefix in ["--- ", "+++ "] {
            if let Some(rest) = line.strip_prefix(prefix) {
                let parsed = parse_prefixed_patch_path(rest, path)?;
                validate_patch_header_path(parsed.as_deref(), path, old_path)?;
                saw_header_path = true;
            }
        }
        for prefix in ["rename from ", "rename to ", "copy from ", "copy to "] {
            if let Some(rest) = line.strip_prefix(prefix) {
                let parsed = Some(normalize_revert_path(rest)?);
                validate_patch_header_path(parsed.as_deref(), path, old_path)?;
                saw_header_path = true;
            }
        }
    }

    if saw_header_path {
        Ok(())
    } else {
        Err(GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "patch is missing file headers".to_string(),
        })
    }
}

fn parse_diff_git_paths(
    rest: &str,
    path: &str,
) -> Result<(Option<String>, Option<String>), GitRevertPatchesError> {
    let Some((left, right)) = rest.trim().rsplit_once(" b/") else {
        return Err(GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "patch has unsupported diff header".to_string(),
        });
    };
    Ok((
        parse_prefixed_patch_path(left, path)?,
        parse_prefixed_patch_path(&format!("b/{right}"), path)?,
    ))
}

fn parse_prefixed_patch_path(
    raw_path: &str,
    path: &str,
) -> Result<Option<String>, GitRevertPatchesError> {
    let trimmed = raw_path.trim();
    if trimmed == "/dev/null" {
        return Ok(None);
    }
    let without_prefix = trimmed
        .strip_prefix("a/")
        .or_else(|| trimmed.strip_prefix("b/"))
        .ok_or_else(|| GitRevertPatchesError::PatchRejected {
            path: path.to_string(),
            message: "patch has unsupported file header".to_string(),
        })?;
    normalize_revert_path(without_prefix).map(Some)
}

fn validate_patch_header_path(
    header_path: Option<&str>,
    path: &str,
    old_path: Option<&str>,
) -> Result<(), GitRevertPatchesError> {
    let Some(header_path) = header_path else {
        return Ok(());
    };
    if header_path == path || old_path == Some(header_path) {
        return Ok(());
    }
    Err(GitRevertPatchesError::PatchRejected {
        path: path.to_string(),
        message: format!("patch header references unexpected path {header_path}"),
    })
}

fn run_git_with_stdin(cwd: &Path, args: &[&str], stdin: &str) -> anyhow::Result<GitOutput> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to run git {}: {e}", args.join(" ")))?;

    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin.write_all(stdin.as_bytes())?;
    }
    let output = child.wait_with_output()?;
    Ok(GitOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
    })
}

fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}
