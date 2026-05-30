use std::collections::BTreeMap;

use anyharness_contract::v1::AgentAuthSelectionConfig;
use chrono::DateTime;

use super::AgentAuthConfigInput;

const PROTECTED_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_USE_BEDROCK",
    "CODEX_API_KEY",
    "CODEX_HOME",
    "CURSOR_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GEMINI_BASE_URL",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
];
const CLAUDE_GATEWAY_PROTECTED_ENV: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
];
const CODEX_GATEWAY_PROTECTED_ENV: &[&str] = &["CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_HOME"];
const OPENCODE_GATEWAY_PROTECTED_ENV: &[&str] = &["OPENAI_API_KEY", "OPENAI_BASE_URL"];
const GEMINI_GATEWAY_PROTECTED_ENV: &[&str] = &["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"];
const CLAUDE_SYNCED_PROTECTED_ENV: &[&str] = &[];
const GEMINI_SYNCED_PROTECTED_ENV: &[&str] = &[
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
];

pub(super) fn validate_config_input(request: &AgentAuthConfigInput) -> anyhow::Result<()> {
    if request.revision < 0 {
        anyhow::bail!("agent auth config revision must be non-negative");
    }
    for selection in &request.selections {
        if selection.agent_kind.trim().is_empty() {
            anyhow::bail!("agent auth selection agentKind is required");
        }
        if let Some(expires_at) = selection.expires_at.as_deref() {
            DateTime::parse_from_rfc3339(expires_at).map_err(|error| {
                anyhow::anyhow!("agent auth selection expiresAt is invalid: {error}")
            })?;
        }
        validate_env_map(&selection.protected_env)?;
        validate_env_map(&selection.support_env)?;
        validate_protected_env_allowlist(selection)?;
        for key in selection.support_env.keys() {
            if is_protected_env_key(key) {
                anyhow::bail!("agent auth supportEnv cannot set protected key {key}");
            }
        }
    }
    Ok(())
}

fn validate_env_map(env: &BTreeMap<String, String>) -> anyhow::Result<()> {
    for key in env.keys() {
        validate_env_name(key)?;
    }
    Ok(())
}

fn validate_env_name(name: &str) -> anyhow::Result<()> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        anyhow::bail!("empty environment variable name");
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        anyhow::bail!("environment variable name must start with a letter or underscore");
    }
    if !chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric()) {
        anyhow::bail!("environment variable name contains unsupported characters");
    }
    Ok(())
}

fn validate_protected_env_allowlist(selection: &AgentAuthSelectionConfig) -> anyhow::Result<()> {
    let allowed = match (
        selection.agent_kind.as_str(),
        selection.materialization_mode.as_str(),
    ) {
        ("claude", "gateway_env") => CLAUDE_GATEWAY_PROTECTED_ENV,
        ("codex", "gateway_env") => CODEX_GATEWAY_PROTECTED_ENV,
        ("opencode", "gateway_env") => OPENCODE_GATEWAY_PROTECTED_ENV,
        ("gemini", "gateway_env") => GEMINI_GATEWAY_PROTECTED_ENV,
        ("claude", "synced_files") => CLAUDE_SYNCED_PROTECTED_ENV,
        ("gemini", "synced_files") => GEMINI_SYNCED_PROTECTED_ENV,
        ("codex", "synced_files") | ("opencode", "synced_files") => &[],
        _ => {
            anyhow::bail!(
                "agent auth protected env policy is unsupported for {}/{}",
                selection.agent_kind,
                selection.materialization_mode
            );
        }
    };
    for key in selection.protected_env.keys() {
        if !allowed.contains(&key.as_str()) {
            anyhow::bail!(
                "agent auth protectedEnv key {} is not allowed for {}/{}",
                key,
                selection.agent_kind,
                selection.materialization_mode
            );
        }
    }
    Ok(())
}

fn is_protected_env_key(key: &str) -> bool {
    PROTECTED_ENV_KEYS.contains(&key)
}
