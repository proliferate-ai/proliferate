use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyharness_credential_discovery::{
    export_portable_auth as export_portable_agent_auth, ProviderId,
};
use anyhow::Context;

use crate::domains::agents::model::{AgentKind, ResolvedAgent};

const CODEX_LOCAL_HOME_DIR: &str = "codex-local";
const CODEX_LOCAL_CONFIG: &str = r#"model = "gpt-5.5"
model_reasoning_effort = "medium"

[features]
plugins = false
tool_suggest = false
"#;

pub(super) fn build_session_launch_env(
    resolved_agent: &ResolvedAgent,
    runtime_home: &Path,
    requested_model_id: Option<&str>,
) -> anyhow::Result<BTreeMap<String, String>> {
    match resolved_agent.descriptor.kind {
        AgentKind::Claude => build_claude_session_launch_env(resolved_agent, requested_model_id),
        AgentKind::Codex => {
            let codex_home = prepare_local_codex_home(runtime_home)?;
            Ok(BTreeMap::from([(
                "CODEX_HOME".to_string(),
                codex_home.to_string_lossy().into_owned(),
            )]))
        }
        _ => Ok(BTreeMap::new()),
    }
}

fn build_claude_session_launch_env(
    resolved_agent: &ResolvedAgent,
    requested_model_id: Option<&str>,
) -> anyhow::Result<BTreeMap<String, String>> {
    let mut env = BTreeMap::new();

    if let Some(path) = resolved_agent
        .native
        .as_ref()
        .and_then(|artifact| artifact.path.as_ref())
    {
        env.insert(
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            path.to_string_lossy().into_owned(),
        );
    }

    if let Some(model_id) = requested_model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
    {
        env.insert("ANTHROPIC_MODEL".to_string(), model_id.to_string());
    }

    Ok(env)
}

fn prepare_local_codex_home(runtime_home: &Path) -> anyhow::Result<PathBuf> {
    let codex_home = runtime_home.join("agent-auth").join(CODEX_LOCAL_HOME_DIR);
    fs::create_dir_all(&codex_home)
        .with_context(|| format!("failed to create local Codex home {}", codex_home.display()))?;
    write_private_file(
        &codex_home.join("config.toml"),
        CODEX_LOCAL_CONFIG.as_bytes(),
    )?;
    remove_managed_codex_hooks(&codex_home)?;
    sync_local_codex_auth(&codex_home)?;
    Ok(codex_home)
}

fn sync_local_codex_auth(codex_home: &Path) -> anyhow::Result<()> {
    let auth_path = codex_home.join("auth.json");
    let Some(home_dir) = dirs::home_dir() else {
        remove_stale_file(&auth_path)?;
        tracing::warn!("could not resolve HOME while preparing local Codex auth");
        return Ok(());
    };
    let Some(export) = export_portable_agent_auth(ProviderId::Codex, &home_dir)
        .context("failed to export local Codex auth")?
    else {
        remove_stale_file(&auth_path)?;
        return Ok(());
    };

    for file in export.files {
        if file.relative_path.as_str() == ".codex/auth.json" {
            write_private_file(&auth_path, &file.content)?;
        }
    }

    Ok(())
}

fn remove_managed_codex_hooks(codex_home: &Path) -> anyhow::Result<()> {
    remove_stale_file(&codex_home.join("hooks.json"))
}

fn remove_stale_file(path: &Path) -> anyhow::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

fn write_private_file(path: &Path, contents: &[u8]) -> anyhow::Result<()> {
    let tmp_path = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&tmp_path, contents)
        .with_context(|| format!("failed to write {}", tmp_path.display()))?;
    set_private_file_permissions(&tmp_path)?;
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "failed to move {} into place at {}",
            tmp_path.display(),
            path.display()
        )
    })?;
    set_private_file_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> anyhow::Result<()> {
    Ok(())
}
