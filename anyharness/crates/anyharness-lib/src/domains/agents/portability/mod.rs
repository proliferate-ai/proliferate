use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::Context;

use crate::domains::agents::route_auth;
use crate::domains::sessions::model::SessionRecord;

const CLAUDE_SANITIZED_PATH_LIMIT: usize = 200;
#[cfg(unix)]
const SAFE_ARTIFACT_FILE_MODE: u32 = 0o600;
#[cfg(not(unix))]
const SAFE_ARTIFACT_FILE_MODE: u32 = 0;

mod codex;

#[derive(Debug, Clone)]
pub struct AgentArtifactFileData {
    pub relative_path: String,
    pub mode: u32,
    pub content: Vec<u8>,
}

pub fn collect_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
    runtime_home: Option<&Path>,
) -> anyhow::Result<Vec<AgentArtifactFileData>> {
    let Some(home_dir) = dirs::home_dir() else {
        anyhow::bail!("unable to resolve the current user's home directory");
    };

    match session.agent_kind.as_str() {
        "claude" => collect_claude_artifacts(&home_dir, session, workspace_path),
        "codex" => codex::collect_codex_artifacts(&home_dir, runtime_home, session),
        _ => Ok(Vec::new()),
    }
}

pub fn install_session_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
    files: &[AgentArtifactFileData],
    runtime_home: Option<&Path>,
) -> anyhow::Result<()> {
    let Some(home_dir) = dirs::home_dir() else {
        anyhow::bail!("unable to resolve the current user's home directory");
    };

    match session.agent_kind.as_str() {
        "claude" => install_claude_artifacts(&home_dir, workspace_path, files, runtime_home),
        "codex" => codex::install_codex_artifacts(&home_dir, runtime_home, files),
        _ => install_agent_artifacts(&home_dir, files, Path::new("")),
    }
}

pub fn validate_session_agent_artifacts(
    session: &SessionRecord,
    workspace_path: &Path,
    files: &[AgentArtifactFileData],
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
    runtime_home: Option<&Path>,
) -> anyhow::Result<()> {
    let Some(home_dir) = dirs::home_dir() else {
        anyhow::bail!("unable to resolve the current user's home directory");
    };
    if session.agent_kind.as_str() == "codex" {
        return codex::delete_codex_artifacts(&home_dir, runtime_home, session);
    }

    let files = collect_agent_artifacts(session, workspace_path, runtime_home)?;
    if files.is_empty() {
        return Ok(());
    }

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
) -> anyhow::Result<Vec<AgentArtifactFileData>> {
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
    files: &[AgentArtifactFileData],
    runtime_home: Option<&Path>,
) -> anyhow::Result<()> {
    let target_slug = sanitize_claude_path(&workspace_path.to_string_lossy());
    let home_allowed_prefix = Path::new(".claude").join("projects").join(&target_slug);
    // A route-authed Claude launch (gateway or api_key — i.e. every cloud-sandbox
    // session) reads its transcripts from an isolated CLAUDE_CONFIG_DIR
    // (<runtime_home>/agent-auth/claude-config), NOT ~/.claude
    // (route_auth::render::set_claude_config_dir + sanitize_claude_ambient).
    // Native/unrouted launches (local desktop) read ~/.claude. Write the
    // re-slugged transcript into BOTH so `--resume` finds it regardless of how
    // the destination's Claude is routed. Without the isolated-dir mirror,
    // preserve_native_sessions silently starts a fresh native session at the
    // cloud destination (the transcript is present on disk but unreachable),
    // losing the whole conversation — the exact failure this migration mode
    // exists to prevent.
    let config_dir = runtime_home.map(route_auth::claude_config_dir_path);
    let config_allowed_prefix = Path::new("projects").join(&target_slug);
    for file in files {
        let rewritten_relative_path =
            rewrite_claude_relative_path(&file.relative_path, &target_slug);
        let home_target = resolve_home_relative_artifact_path(
            home_dir,
            &rewritten_relative_path.to_string_lossy(),
            &home_allowed_prefix,
        )?;
        write_artifact_file(&home_target, file)?;

        if let Some(config_dir) = config_dir.as_deref() {
            // Re-root ".claude/projects/<slug>/…" as "projects/<slug>/…" under the
            // isolated config dir: CLAUDE_CONFIG_DIR replaces the whole ~/.claude
            // root, so the tree below it is byte-for-byte identical.
            if let Some(under_root) = strip_claude_root_component(&rewritten_relative_path) {
                let config_target = resolve_home_relative_artifact_path(
                    config_dir,
                    &under_root.to_string_lossy(),
                    &config_allowed_prefix,
                )?;
                write_artifact_file(&config_target, file)?;
            }
        }
    }

    Ok(())
}

/// Re-root a rewritten `.claude/projects/<slug>/…` artifact path as
/// `projects/<slug>/…` for placement under an isolated CLAUDE_CONFIG_DIR (which
/// stands in for the `~/.claude` root). Returns `None` for any path not under
/// `.claude/` — there is nothing to mirror.
fn strip_claude_root_component(relative_path: &Path) -> Option<PathBuf> {
    let mut components = relative_path.components();
    match components.next() {
        Some(Component::Normal(first)) if first == ".claude" => {
            Some(components.as_path().to_path_buf())
        }
        _ => None,
    }
}

fn write_artifact_file(target: &Path, file: &AgentArtifactFileData) -> anyhow::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating parent directory {}", parent.display()))?;
    }
    fs::write(target, &file.content)
        .with_context(|| format!("writing agent artifact {}", target.display()))?;
    set_file_mode(target, safe_artifact_file_mode(file.mode))?;
    Ok(())
}

fn install_agent_artifacts(
    home_dir: &Path,
    files: &[AgentArtifactFileData],
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

fn read_tree_relative_to_home(
    home_dir: &Path,
    root: &Path,
) -> anyhow::Result<Vec<AgentArtifactFileData>> {
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

fn read_file_relative_to_home(
    home_dir: &Path,
    path: &Path,
) -> anyhow::Result<AgentArtifactFileData> {
    let content = fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let relative_path = path
        .strip_prefix(home_dir)
        .with_context(|| format!("stripping home prefix from {}", path.display()))?
        .to_string_lossy()
        .to_string();

    Ok(AgentArtifactFileData {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "anyharness-portability-{prefix}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
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

    fn codex_session(native_session_id: &str) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: Some(native_session_id.to_string()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "ended".to_string(),
            created_at: "2026-05-30T00:00:00Z".to_string(),
            updated_at: "2026-05-30T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn claude_session(native_session_id: &str) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some(native_session_id.to_string()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "ended".to_string(),
            created_at: "2026-05-30T00:00:00Z".to_string(),
            updated_at: "2026-05-30T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: None,
        }
    }

    #[test]
    fn claude_artifacts_round_trip_across_workspace_slug_rewrite() {
        // Only Codex's collect path is covered above; Claude re-slugs every
        // artifact path onto the destination workspace (collect :135-160,
        // install :162-187 / rewrite_claude_relative_path :309-333) and had
        // no round-trip test.
        let home = TempDirGuard::new("claude-slug-roundtrip");
        let native_session_id = "native-claude-abc";
        let source_workspace_path = Path::new("/tmp/mobility-source-workspace-one");
        let source_slug = sanitize_claude_path(&source_workspace_path.to_string_lossy());

        let source_project_dir = home
            .path()
            .join(".claude")
            .join("projects")
            .join(&source_slug);
        fs::create_dir_all(&source_project_dir).expect("create source project dir");
        let transcript_path = source_project_dir.join(format!("{native_session_id}.jsonl"));
        fs::write(&transcript_path, b"{\"line\":1}\n").expect("write transcript");
        let session_subdir = source_project_dir.join(native_session_id);
        fs::create_dir_all(&session_subdir).expect("create session subdir");
        fs::write(session_subdir.join("extra.json"), b"{\"nested\":true}\n")
            .expect("write nested artifact");

        let session = claude_session(native_session_id);

        let collected = collect_claude_artifacts(home.path(), &session, source_workspace_path)
            .expect("collect claude artifacts from the source slug");
        assert_eq!(collected.len(), 2);
        let expected_prefix = format!(".claude/projects/{source_slug}/");
        assert!(
            collected
                .iter()
                .all(|file| file.relative_path.starts_with(&expected_prefix)),
            "collected artifacts must be rooted under the source slug: {collected:?}"
        );

        let destination_workspace_path = Path::new("/tmp/mobility-destination-workspace-two");
        let destination_slug = sanitize_claude_path(&destination_workspace_path.to_string_lossy());
        assert_ne!(
            source_slug, destination_slug,
            "the test must exercise an actual slug rewrite"
        );

        let runtime_home = TempDirGuard::new("claude-slug-roundtrip-runtime");
        install_claude_artifacts(
            home.path(),
            destination_workspace_path,
            &collected,
            Some(runtime_home.path()),
        )
        .expect("install claude artifacts under the destination slug");

        let destination_project_dir = home
            .path()
            .join(".claude")
            .join("projects")
            .join(&destination_slug);
        let destination_transcript =
            destination_project_dir.join(format!("{native_session_id}.jsonl"));
        assert!(
            destination_transcript.exists(),
            "main transcript must land under the destination slug"
        );
        assert_eq!(
            fs::read(&destination_transcript).expect("read destination transcript"),
            b"{\"line\":1}\n"
        );
        let destination_nested = destination_project_dir
            .join(native_session_id)
            .join("extra.json");
        assert!(
            destination_nested.exists(),
            "nested session artifacts must land under the destination slug"
        );

        // The isolated CLAUDE_CONFIG_DIR mirror must carry the same re-slugged
        // tree (a route-authed launch resumes from here, not ~/.claude).
        let config_project_dir = runtime_home
            .path()
            .join("agent-auth")
            .join("claude-config")
            .join("projects")
            .join(&destination_slug);
        let config_transcript = config_project_dir.join(format!("{native_session_id}.jsonl"));
        assert!(
            config_transcript.exists(),
            "main transcript must also mirror into the isolated CLAUDE_CONFIG_DIR"
        );
        assert_eq!(
            fs::read(&config_transcript).expect("read config-dir transcript"),
            b"{\"line\":1}\n"
        );
        assert!(
            config_project_dir
                .join(native_session_id)
                .join("extra.json")
                .exists(),
            "nested session artifacts must also mirror into the isolated CLAUDE_CONFIG_DIR"
        );
        assert_eq!(
            fs::read(&destination_nested).expect("read nested destination artifact"),
            b"{\"nested\":true}\n"
        );

        // Install only copies into the new slug; it must not touch the
        // source slug's own files.
        assert!(transcript_path.exists());
    }

    #[test]
    fn collect_codex_artifacts_skips_missing_rollout_file() {
        let home = TempDirGuard::new("missing-codex-rollout");
        let session = codex_session("native-123");

        let artifacts = codex::collect_codex_artifacts(home.path(), None, &session)
            .expect("missing rollout should not fail");

        assert!(artifacts.is_empty());
    }

    #[test]
    fn collect_codex_artifacts_reads_matching_rollout_file() {
        let home = TempDirGuard::new("codex-rollout");
        let session = codex_session("native-123");
        let rollout_dir = home.path().join(".codex").join("sessions").join("2026");
        fs::create_dir_all(&rollout_dir).expect("create rollout dir");
        let rollout_path = rollout_dir.join("rollout-native-123.jsonl");
        fs::write(&rollout_path, b"{\"event\":\"ok\"}\n").expect("write rollout");

        let artifacts = codex::collect_codex_artifacts(home.path(), None, &session)
            .expect("collect rollout artifact");

        assert_eq!(artifacts.len(), 1);
        assert_eq!(
            artifacts[0].relative_path,
            ".codex/sessions/2026/rollout-native-123.jsonl"
        );
        assert_eq!(artifacts[0].content, b"{\"event\":\"ok\"}\n");
    }

    #[test]
    fn collect_codex_artifacts_reads_runtime_local_codex_home() {
        let home = TempDirGuard::new("codex-empty-home");
        let runtime_home = TempDirGuard::new("codex-runtime-home");
        let session = codex_session("native-123");
        let rollout_dir = runtime_home
            .path()
            .join("agent-auth")
            .join("codex-local")
            .join("sessions")
            .join("2026");
        fs::create_dir_all(&rollout_dir).expect("create runtime rollout dir");
        fs::write(rollout_dir.join("rollout-native-123.jsonl"), b"runtime\n")
            .expect("write runtime rollout");

        let artifacts =
            codex::collect_codex_artifacts(home.path(), Some(runtime_home.path()), &session)
                .expect("collect runtime rollout artifact");

        assert_eq!(artifacts.len(), 1);
        assert_eq!(
            artifacts[0].relative_path,
            ".codex/sessions/2026/rollout-native-123.jsonl"
        );
        assert_eq!(artifacts[0].content, b"runtime\n");
    }

    #[test]
    fn collect_codex_artifacts_canonicalizes_runtime_home_under_home_dir() {
        // Regression: in a cloud sandbox the runtime home lives UNDER the user
        // home (~/.proliferate/anyharness), so a route-authed codex rollout at
        // <home>/.proliferate/anyharness/agent-auth/codex-local/sessions/... is
        // itself under home_dir. The collected relative_path must still be the
        // canonical .codex/sessions/... (not the on-disk path stripped of home),
        // or install rejects it as escaping .codex/sessions. The prior
        // read_file_relative_to_home shortcut produced the wrong path here.
        let home = TempDirGuard::new("codex-home-with-nested-runtime");
        let runtime_home = home.path().join(".proliferate").join("anyharness");
        let session = codex_session("native-123");
        let rollout_dir = runtime_home
            .join("agent-auth")
            .join("codex-local")
            .join("sessions")
            .join("2026");
        fs::create_dir_all(&rollout_dir).expect("create nested runtime rollout dir");
        fs::write(rollout_dir.join("rollout-native-123.jsonl"), b"nested\n")
            .expect("write nested rollout");

        let artifacts =
            codex::collect_codex_artifacts(home.path(), Some(&runtime_home), &session)
                .expect("collect nested runtime rollout artifact");

        assert_eq!(artifacts.len(), 1);
        assert_eq!(
            artifacts[0].relative_path,
            ".codex/sessions/2026/rollout-native-123.jsonl"
        );
        assert_eq!(artifacts[0].content, b"nested\n");
    }

    #[test]
    fn collect_codex_artifacts_reroots_codex_local_home_nested_under_home_dir() {
        // Regression guard for the cloud round-trip: in a real sandbox the
        // runtime home (and thus the codex-local CODEX_HOME) lives UNDER $HOME
        // (`/home/user/.proliferate/anyharness/agent-auth/codex-local`), unlike
        // the local test which spawns the runtime in a scratch dir outside
        // $HOME. A collect that shortcut through read_file_relative_to_home
        // whenever the rollout path lived under home_dir mis-rooted it as
        // `.proliferate/anyharness/agent-auth/codex-local/sessions/…` instead of
        // the canonical `.codex/sessions/…`, and the cloud->local install then
        // rejected it as escaping `.codex/sessions`. The path must always be
        // re-rooted from the CODEX_HOME it was found under.
        let home = TempDirGuard::new("codex-nested-home");
        let runtime_home = home.path().join(".proliferate").join("anyharness");
        let session = codex_session("native-123");
        let rollout_dir = runtime_home
            .join("agent-auth")
            .join("codex-local")
            .join("sessions")
            .join("2026");
        fs::create_dir_all(&rollout_dir).expect("create nested runtime rollout dir");
        fs::write(rollout_dir.join("rollout-native-123.jsonl"), b"nested\n")
            .expect("write nested rollout");

        let artifacts =
            codex::collect_codex_artifacts(home.path(), Some(runtime_home.as_path()), &session)
                .expect("collect nested runtime rollout artifact");

        assert_eq!(artifacts.len(), 1);
        assert_eq!(
            artifacts[0].relative_path,
            ".codex/sessions/2026/rollout-native-123.jsonl",
            "a codex-local rollout nested under $HOME must re-root as .codex/…, \
             not a $HOME-relative .proliferate/… path"
        );
        assert_eq!(artifacts[0].content, b"nested\n");
    }

    #[test]
    fn install_codex_artifacts_writes_to_runtime_local_and_ambient_roots() {
        // Install must be symmetric with collect's codex_artifact_roots: a
        // migrated rollout lands in BOTH the runtime-local codex-local home
        // (the CODEX_HOME a native/api_key route-authed launch scans) and the
        // ambient ~/.codex (native/unrouted destinations). Before this fix
        // install wrote only ~/.codex, so a route-authed sandbox resume found
        // nothing and fell back to a fresh native session.
        let home = TempDirGuard::new("codex-install-home");
        let runtime_home = TempDirGuard::new("codex-install-runtime");
        let file = AgentArtifactFileData {
            relative_path: ".codex/sessions/2026/07/rollout-native-abc.jsonl".to_string(),
            mode: 0o600,
            content: b"{\"event\":\"ok\"}\n".to_vec(),
        };

        codex::install_codex_artifacts(
            home.path(),
            Some(runtime_home.path()),
            std::slice::from_ref(&file),
        )
        .expect("install codex rollout into both roots");

        let ambient = home
            .path()
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("07")
            .join("rollout-native-abc.jsonl");
        assert!(
            ambient.exists(),
            "rollout must land under the ambient ~/.codex root"
        );
        assert_eq!(
            fs::read(&ambient).expect("read ambient rollout"),
            b"{\"event\":\"ok\"}\n"
        );

        let runtime_local = runtime_home
            .path()
            .join("agent-auth")
            .join("codex-local")
            .join("sessions")
            .join("2026")
            .join("07")
            .join("rollout-native-abc.jsonl");
        assert!(
            runtime_local.exists(),
            "rollout must also mirror into the runtime-local codex-local root"
        );
        assert_eq!(
            fs::read(&runtime_local).expect("read runtime-local rollout"),
            b"{\"event\":\"ok\"}\n"
        );
    }

    #[test]
    fn install_codex_artifacts_without_runtime_home_writes_only_ambient_root() {
        // Native-auth destinations with no runtime-local codex home get the
        // unchanged v1 behavior: the ambient ~/.codex write, and only that.
        let home = TempDirGuard::new("codex-install-ambient-only");
        let file = AgentArtifactFileData {
            relative_path: ".codex/sessions/2026/rollout-native-xyz.jsonl".to_string(),
            mode: 0o600,
            content: b"solo\n".to_vec(),
        };

        codex::install_codex_artifacts(home.path(), None, std::slice::from_ref(&file))
            .expect("install codex rollout into the ambient root");

        assert!(home
            .path()
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("rollout-native-xyz.jsonl")
            .exists());
    }

    #[test]
    fn install_codex_artifacts_rejects_path_traversal() {
        // The `sessions` allowed-prefix guard must reject a `..` escape for the
        // new runtime-local destination too — nothing may be written outside
        // either codex home.
        let home = TempDirGuard::new("codex-install-traversal-home");
        let runtime_home = TempDirGuard::new("codex-install-traversal-runtime");
        let malicious = AgentArtifactFileData {
            relative_path: ".codex/sessions/../../evil.jsonl".to_string(),
            mode: 0o600,
            content: b"pwned\n".to_vec(),
        };

        let result = codex::install_codex_artifacts(
            home.path(),
            Some(runtime_home.path()),
            std::slice::from_ref(&malicious),
        );
        assert!(
            result.is_err(),
            "a traversal path must be rejected, not written outside sessions/"
        );
        assert!(!runtime_home
            .path()
            .join("agent-auth")
            .join("evil.jsonl")
            .exists());
        assert!(!home.path().join("evil.jsonl").exists());
    }

    #[test]
    fn validate_session_agent_artifacts_rejects_codex_path_traversal() {
        // The pre-install validation gate still rejects a codex traversal path
        // and still accepts a well-formed rollout path unchanged.
        let session = codex_session("native-123");
        let workspace = Path::new("/tmp/mobility-dest");

        let malicious = AgentArtifactFileData {
            relative_path: ".codex/sessions/../../etc/passwd".to_string(),
            mode: 0o600,
            content: Vec::new(),
        };
        assert!(
            validate_session_agent_artifacts(&session, workspace, std::slice::from_ref(&malicious))
                .is_err(),
            "validation must reject a codex traversal path"
        );

        let ok = AgentArtifactFileData {
            relative_path: ".codex/sessions/2026/rollout-native-123.jsonl".to_string(),
            mode: 0o600,
            content: Vec::new(),
        };
        validate_session_agent_artifacts(&session, workspace, std::slice::from_ref(&ok))
            .expect("a well-formed codex rollout path must validate");
    }
}
