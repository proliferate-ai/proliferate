use std::path::{Path, PathBuf};

use crate::domains::agents::model::{AgentKind, ArtifactRole, ResolvedArtifact, SpawnSpec};
use crate::integrations::agent_cli::executable::{find_in_path, is_valid_executable};

pub(super) fn resolve_agent_process_override(
    kind: &AgentKind,
) -> Option<(SpawnSpec, ResolvedArtifact)> {
    let prefix = agent_override_prefix(kind);
    let program = std::env::var(format!("{prefix}_AGENT_PROGRAM")).ok()?;
    let program = program.trim();
    if program.is_empty() {
        return None;
    }

    let requested_program = PathBuf::from(program);
    let resolved_program =
        resolve_override_program(&requested_program).unwrap_or_else(|| requested_program.clone());
    let message = if resolved_program == requested_program
        && !is_override_program_valid(&requested_program)
    {
        Some(format!(
            "Override executable `{}` was not found or is not executable.",
            requested_program.display()
        ))
    } else {
        None
    };

    Some((
        SpawnSpec {
            program: resolved_program.clone(),
            args: load_json_env_vec(&format!("{prefix}_AGENT_ARGS_JSON")),
            env: load_json_env_map(&format!("{prefix}_AGENT_ENV_JSON")),
            cwd: std::env::var(format!("{prefix}_AGENT_CWD"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
        },
        ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: message.is_none(),
            source: Some("override".into()),
            version: None,
            path: Some(resolved_program),
            message,
        },
    ))
}

fn resolve_override_program(program: &Path) -> Option<PathBuf> {
    if looks_like_path(program) {
        return is_valid_executable(program).then(|| program.to_path_buf());
    }

    let binary_name = program.to_str()?;
    find_in_path(binary_name)
}

fn looks_like_path(program: &Path) -> bool {
    program.is_absolute() || program.components().count() > 1
}

pub(super) fn is_override_program_valid(program: &Path) -> bool {
    if looks_like_path(program) {
        return is_valid_executable(program);
    }

    program.to_str().and_then(find_in_path).is_some()
}

fn agent_override_prefix(kind: &AgentKind) -> String {
    format!("ANYHARNESS_{}", kind.as_str().to_ascii_uppercase())
}

fn load_json_env_vec(name: &str) -> Vec<String> {
    let Some(raw) = std::env::var(name).ok() else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_else(|error| {
        tracing::warn!(env_var = name, %error, "invalid JSON array override");
        Vec::new()
    })
}

fn load_json_env_map(name: &str) -> std::collections::HashMap<String, String> {
    let Some(raw) = std::env::var(name).ok() else {
        return std::collections::HashMap::new();
    };
    serde_json::from_str::<std::collections::HashMap<String, String>>(&raw).unwrap_or_else(
        |error| {
            tracing::warn!(env_var = name, %error, "invalid JSON object override");
            std::collections::HashMap::new()
        },
    )
}
