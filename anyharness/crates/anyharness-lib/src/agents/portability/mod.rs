use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::Context;

use crate::mobility::model::MobilityFileData;
use crate::sessions::model::SessionRecord;

const CLAUDE_SANITIZED_PATH_LIMIT: usize = 200;
#[cfg(unix)]
const SAFE_ARTIFACT_FILE_MODE: u32 = 0o600;
#[cfg(not(unix))]
const SAFE_ARTIFACT_FILE_MODE: u32 = 0;

pub fn collect_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
) -> anyhow::Result<Vec<MobilityFileData>> {
    let Some(home_dir) = dirs::home_dir() else {
        anyhow::bail!("unable to resolve the current user's home directory");
    };

    match session.agent_kind.as_str() {
        "claude" => collect_claude_artifacts(&home_dir, session, workspace_path),
        "codex" => collect_codex_artifacts(&home_dir, session),
        _ => Ok(Vec::new()),
    }
}

pub fn install_session_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
    files: &[MobilityFileData],
) -> anyhow::Result<()> {
    let Some(home_dir) = dirs::home_dir() else {
        anyhow::bail!("unable to resolve the current user's home directory");
    };

    match session.agent_kind.as_str() {
        "claude" => install_claude_artifacts(&home_dir, workspace_path, files),
        "codex" => install_codex_artifacts(&home_dir, files),
        _ => install_agent_artifacts(&home_dir, files, Path::new("")),
    }
}

pub fn validate_session_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
    files: &[MobilityFileData],
) -> anyhow::Result<()> {
    match session.agent_kind.as_str() {
        "claude" => {
            let target_slug = sanitize_claude_path(&workspace_path.to_string_lossy());
            let allowed_prefix = Path::new(".claude").join("projects").join(&target_slug);
            for file in files {
                let rewritten_relative_path =
                    rewrite_claude_relative_path(&file.relative_path, &target_slug);
                let _ = resolve_home_relative_artifact_path(
                    Path::new("/tmp"),
                    &rewritten_relative_path.to_string_lossy(),
                    &allowed_prefix,
                )?;
            }
            Ok(())
        }
        "codex" => {
            let allowed_prefix = Path::new(".codex").join("sessions");
            for file in files {
                let _ = resolve_home_relative_artifact_path(
                    Path::new("/tmp"),
                    &file.relative_path,
                    &allowed_prefix,
                )?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

pub fn delete_session_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
) -> anyhow::Result<()> {
    let files = collect_agent_artifacts(session, workspace_path)?;
    if files.is_empty() {
        return Ok(());
    }

    let Some(home_dir) = dirs::home_dir() else {
        anyhow::bail!("unable to resolve the current user's home directory");
    };

    for file in files {
        let target = match session.agent_kind.as_str() {
            "claude" => {
                let target_slug = sanitize_claude_path(&workspace_path.to_string_lossy());
                let rewritten_relative_path =
                    rewrite_claude_relative_path(&file.relative_path, &target_slug);
                resolve_home_relative_artifact_path(
                    &home_dir,
                    &rewritten_relative_path.to_string_lossy(),
                    &Path::new(".claude").join("projects").join(target_slug),
                )?
            }
            "codex" => resolve_home_relative_artifact_path(
                &home_dir,
                &file.relative_path,
                &Path::new(".codex").join("sessions"),
            )?,
            _ => continue,
        };
        if target.exists() {
            fs::remove_file(&target)
                .with_context(|| format!("removing agent artifact {}", target.display()))?;
        }
    }

    Ok(())
}

fn collect_claude_artifacts(
    home_dir: &Path,
    session: &SessionRecord,
    workspace_path: &Path,
) -> anyhow::Result<Vec<MobilityFileData>> {
    let Some(native_session_id) = session.native_session_id.as_deref() else {
        return Ok(Vec::new());
    };

    let project_dir = home_dir
        .join(".claude")
        .join("projects")
        .join(sanitize_claude_path(&workspace_path.to_string_lossy()));
    let main_transcript = project_dir.join(format!("{native_session_id}.jsonl"));
    if !main_transcript.exists() {
        return Ok(Vec::new());
    }

    let mut files = vec![read_file_relative_to_home(home_dir, &main_transcript)?];
    let session_dir = project_dir.join(native_session_id);
    if session_dir.exists() {
        files.extend(read_tree_relative_to_home(home_dir, &session_dir)?);
    }

    Ok(files)
}

fn install_claude_artifacts(
    home_dir: &Path,
    workspace_path: &Path,
    files: &[MobilityFileData],
) -> anyhow::Result<()> {
    let target_slug = sanitize_claude_path(&workspace_path.to_string_lossy());
    let allowed_prefix = Path::new(".claude").join("projects").join(&target_slug);
    for file in files {
        let rewritten_relative_path =
            rewrite_claude_relative_path(&file.relative_path, &target_slug);
        let target = resolve_home_relative_artifact_path(
            home_dir,
            &rewritten_relative_path.to_string_lossy(),
            &allowed_prefix,
        )?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("creating parent directory {}", parent.display()))?;
        }
        fs::write(&target, &file.content)
            .with_context(|| format!("writing agent artifact {}", target.display()))?;
        set_file_mode(&target, safe_artifact_file_mode(file.mode))?;
    }

    Ok(())
}

fn install_codex_artifacts(home_dir: &Path, files: &[MobilityFileData]) -> anyhow::Result<()> {
    install_agent_artifacts(home_dir, files, &Path::new(".codex").join("sessions"))
}

fn install_agent_artifacts(
    home_dir: &Path,
    files: &[MobilityFileData],
    allowed_prefix: &Path,
) -> anyhow::Result<()> {
    for file in files {
        let target =
            resolve_home_relative_artifact_path(home_dir, &file.relative_path, allowed_prefix)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("creating parent directory {}", parent.display()))?;
        }
        fs::write(&target, &file.content)
            .with_context(|| format!("writing agent artifact {}", target.display()))?;
        set_file_mode(&target, safe_artifact_file_mode(file.mode))?;
    }

    Ok(())
}

fn collect_codex_artifacts(
    home_dir: &Path,
    session: &SessionRecord,
) -> anyhow::Result<Vec<MobilityFileData>> {
    let Some(native_session_id) = session.native_session_id.as_deref() else {
        return Ok(Vec::new());
    };

    let sessions_root = home_dir.join(".codex").join("sessions");
    let rollout_path =
        find_codex_rollout_path(&sessions_root, native_session_id)?.ok_or_else(|| {
            anyhow::anyhow!(
                "expected Codex rollout file for session {} ({native_session_id}) under {}",
                session.id,
                sessions_root.display()
            )
        })?;

    Ok(vec![read_file_relative_to_home(home_dir, &rollout_path)?])
}

fn read_tree_relative_to_home(
    home_dir: &Path,
    root: &Path,
) -> anyhow::Result<Vec<MobilityFileData>> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("reading metadata for {}", path.display()))?;
        if metadata.is_dir() {
            for entry in fs::read_dir(&path)
                .with_context(|| format!("reading directory {}", path.display()))?
            {
                stack.push(entry?.path());
            }
            continue;
        }
        if metadata.is_file() {
            files.push(read_file_relative_to_home(home_dir, &path)?);
        }
    }
    Ok(files)
}

fn read_file_relative_to_home(home_dir: &Path, path: &Path) -> anyhow::Result<MobilityFileData> {
    let content = fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let relative_path = path
        .strip_prefix(home_dir)
        .with_context(|| format!("stripping home prefix from {}", path.display()))?
        .to_string_lossy()
        .to_string();

    Ok(MobilityFileData {
        relative_path,
        mode: file_mode(path)?,
        content,
    })
}

fn find_codex_rollout_path(root: &Path, session_id: &str) -> anyhow::Result<Option<PathBuf>> {
    if !root.exists() {
        return Ok(None);
    }

    let expected_suffix = format!("-{session_id}.jsonl");
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("reading metadata for {}", path.display()))?;
        if metadata.is_dir() {
            for entry in fs::read_dir(&path)
                .with_context(|| format!("reading directory {}", path.display()))?
            {
                stack.push(entry?.path());
            }
            continue;
        }
        if metadata.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&expected_suffix))
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn sanitize_claude_path(path: &str) -> String {
    let sanitized: String = path
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect();
    if sanitized.len() <= CLAUDE_SANITIZED_PATH_LIMIT {
        return sanitized;
    }

    let hash = djb2_hash(path).unsigned_abs();
    format!(
        "{}-{}",
        &sanitized[..CLAUDE_SANITIZED_PATH_LIMIT],
        to_base36(hash),
    )
}

fn rewrite_claude_relative_path(relative_path: &str, target_slug: &str) -> PathBuf {
    let path = Path::new(relative_path);
    let mut components = path.components();
    let Some(Component::Normal(first)) = components.next() else {
        return path.to_path_buf();
    };
    let Some(Component::Normal(second)) = components.next() else {
        return path.to_path_buf();
    };
    let Some(Component::Normal(_source_slug)) = components.next() else {
        return path.to_path_buf();
    };

    if first != ".claude" || second != "projects" {
        return path.to_path_buf();
    }

    let mut rewritten = PathBuf::from(".claude");
    rewritten.push("projects");
    rewritten.push(target_slug);
    for component in components {
        rewritten.push(component.as_os_str());
    }
    rewritten
}

fn resolve_home_relative_artifact_path(
    home_dir: &Path,
    relative_path: &str,
    allowed_prefix: &Path,
) -> anyhow::Result<PathBuf> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        anyhow::bail!("absolute artifact paths are not allowed: {relative_path}");
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                anyhow::bail!("unsafe artifact path component in {relative_path}");
            }
        }
    }

    if !allowed_prefix.as_os_str().is_empty() && !normalized.starts_with(allowed_prefix) {
        anyhow::bail!(
            "artifact path {} did not stay under {}",
            normalized.display(),
            allowed_prefix.display()
        );
    }

    Ok(home_dir.join(normalized))
}

fn safe_artifact_file_mode(_mode: u32) -> u32 {
    SAFE_ARTIFACT_FILE_MODE
}

fn file_mode(path: &Path) -> anyhow::Result<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(path)?;
        Ok(metadata.permissions().mode())
    }

    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(0)
    }
}

fn set_file_mode(path: &Path, mode: u32) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }

    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }

    Ok(())
}

fn djb2_hash(input: &str) -> i64 {
    let mut hash: i64 = 5381;
    for byte in input.as_bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(*byte as i64);
    }
    hash
}

fn to_base36(mut value: u64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let mut chars = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        chars.push(match digit {
            0..=9 => (b'0' + digit) as char,
            _ => (b'a' + digit - 10) as char,
        });
        value /= 36;
    }
    chars.iter().rev().collect()
}
