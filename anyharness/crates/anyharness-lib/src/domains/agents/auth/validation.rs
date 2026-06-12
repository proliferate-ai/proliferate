use std::collections::BTreeMap;

use anyharness_contract::v1::AgentAuthSelectionConfig;
use chrono::DateTime;

use crate::domains::agents::registry::built_in_registry;

use super::AgentAuthConfigInput;

pub(super) fn validate_config_input(request: &AgentAuthConfigInput) -> anyhow::Result<()> {
    if request.revision < 0 {
        anyhow::bail!("agent auth config revision must be non-negative");
    }
    for selection in &request.selections {
        if selection.agent_kind.trim().is_empty() {
            anyhow::bail!("agent auth selection agentKind is required");
        }
        if selection.auth_slot_id.trim().is_empty() {
            anyhow::bail!("agent auth selection authSlotId is required");
        }
        if let Some(expires_at) = selection.expires_at.as_deref() {
            DateTime::parse_from_rfc3339(expires_at).map_err(|error| {
                anyhow::anyhow!("agent auth selection expiresAt is invalid: {error}")
            })?;
        }
        validate_env_map(&selection.protected_env)?;
        validate_env_map(&selection.support_env)?;
        validate_materialization_allowlist(selection)?;
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

fn validate_materialization_allowlist(selection: &AgentAuthSelectionConfig) -> anyhow::Result<()> {
    let registry = built_in_registry();
    let descriptor = registry
        .iter()
        .find(|descriptor| descriptor.kind.as_str() == selection.agent_kind)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "agent auth selection references unsupported agentKind {}",
                selection.agent_kind
            )
        })?;
    let slot = descriptor
        .auth
        .slot(&selection.auth_slot_id)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "agent auth selection references unsupported authSlotId {}/{}",
                selection.agent_kind,
                selection.auth_slot_id
            )
        })?;
    let (allowed_env, allowed_synced_files): (&[String], Option<&[String]>) =
        match selection.materialization_mode.as_str() {
            "gateway_env" => slot
                .materialization
                .gateway_env
                .as_ref()
                .map(|policy| (policy.protected_env_keys.as_slice(), None)),
            "synced_files" => slot.materialization.synced_files.as_ref().map(|policy| {
                (
                    policy.protected_env_keys.as_slice(),
                    Some(policy.allowed_file_paths.as_slice()),
                )
            }),
            _ => {
                anyhow::bail!(
                    "agent auth materialization policy is unsupported for {}/{}/{}",
                    selection.agent_kind,
                    selection.auth_slot_id,
                    selection.materialization_mode
                );
            }
        }
        .ok_or_else(|| {
            anyhow::anyhow!(
                "agent auth materialization mode {} is unsupported for {}/{}",
                selection.materialization_mode,
                selection.agent_kind,
                selection.auth_slot_id
            )
        })?;
    for key in selection.protected_env.keys() {
        if !allowed_env.iter().any(|allowed_key| allowed_key == key) {
            anyhow::bail!(
                "agent auth protectedEnv key {} is not allowed for {}/{}/{}",
                key,
                selection.agent_kind,
                selection.auth_slot_id,
                selection.materialization_mode
            );
        }
    }
    if selection.synced_file_paths.is_empty() {
        return Ok(());
    }
    let Some(allowed_synced_files) = allowed_synced_files else {
        anyhow::bail!(
            "agent auth syncedFilePaths are not supported for {}/{}/{}",
            selection.agent_kind,
            selection.auth_slot_id,
            selection.materialization_mode
        );
    };
    for path in &selection.synced_file_paths {
        if path.trim().is_empty() {
            anyhow::bail!("agent auth syncedFilePaths cannot contain an empty path");
        }
        if !allowed_synced_files
            .iter()
            .any(|allowed_path| allowed_path == path)
        {
            anyhow::bail!(
                "agent auth syncedFilePaths path {} is not allowed for {}/{}/{}",
                path,
                selection.agent_kind,
                selection.auth_slot_id,
                selection.materialization_mode
            );
        }
    }
    Ok(())
}

fn is_protected_env_key(key: &str) -> bool {
    if key == "CLAUDE_CONFIG_DIR" || key == "CLAUDE_CODE_USE_BEDROCK" || key == "CURSOR_API_KEY" {
        return true;
    }
    built_in_registry()
        .iter()
        .flat_map(|descriptor| descriptor.auth.slots.iter())
        .flat_map(|slot| {
            slot.materialization
                .gateway_env
                .iter()
                .flat_map(|policy| policy.protected_env_keys.iter())
                .chain(
                    slot.materialization
                        .synced_files
                        .iter()
                        .flat_map(|policy| policy.protected_env_keys.iter()),
                )
        })
        .any(|protected_key| protected_key == key)
}
