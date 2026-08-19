use std::collections::{BTreeMap, BTreeSet};

use crate::domains::agents::model::AgentDescriptor;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;

/// Product-owned environment inputs whose value can change which executable,
/// provider, configuration home, models, or controls a harness observes.
///
/// This is deliberately shared by create admission and the common real-start
/// seam. The override-free probe has neither a workspace nor a session layer,
/// so accepting one of these keys on only the real launch would invalidate the
/// target observation used to admit its immutable intent.
fn capability_affecting_env_keys(descriptor: &AgentDescriptor) -> BTreeSet<String> {
    let mut keys = BTreeSet::from(["HOME".to_string(), "PATH".to_string()]);

    for slot in &descriptor.auth.slots {
        keys.extend(slot.env_vars.iter().cloned());
        if let Some(gateway_env) = &slot.materialization.gateway_env {
            keys.extend(gateway_env.protected_env_keys.iter().cloned());
            keys.extend(gateway_env.support_env_keys.iter().cloned());
        }
        if let Some(synced_files) = &slot.materialization.synced_files {
            keys.extend(synced_files.protected_env_keys.iter().cloned());
        }
    }

    // Provider-config declarations contain route inputs that intentionally do
    // not repeat in auth slots (for example Claude's Bedrock mode switch).
    if let Some(agent) = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == descriptor.kind.as_str())
    {
        for provider in &agent.provider_config {
            keys.extend(
                provider
                    .env_vars
                    .iter()
                    .map(|env_var| env_var.name().to_string()),
            );
        }
    }

    // The route renderer owns these harness configuration selectors directly.
    // Keep the list beside launch-option admission, where parity is enforced,
    // rather than relying on whichever route happens to overwrite a key today:
    // native routes are valid and often render no delta at all.
    let renderer_owned: &[&str] = match descriptor.kind.as_str() {
        "claude" => &[
            "ANTHROPIC_MODEL",
            "CLAUDE_CODE_EXECUTABLE",
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_FOUNDRY",
            "CLAUDE_CODE_USE_VERTEX",
        ],
        "codex" => &["CODEX_HOME"],
        "opencode" => &["OPENCODE_CONFIG", "XDG_CONFIG_HOME", "XDG_DATA_HOME"],
        "grok" => &["GROK_MODELS_BASE_URL"],
        "cursor" => &[],
        _ => &[],
    };
    keys.extend(renderer_owned.iter().map(|key| (*key).to_string()));
    keys
}

pub(crate) fn find_capability_affecting_env_override(
    descriptor: &AgentDescriptor,
    composed_user_env: &BTreeMap<String, String>,
) -> Option<String> {
    capability_affecting_env_keys(descriptor)
        .into_iter()
        .find(|key| composed_user_env.contains_key(key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::registry;

    #[test]
    fn registry_route_and_config_keys_are_rejected_from_both_launch_layers() {
        let claude = registry::descriptor("claude").expect("claude descriptor");
        let codex = registry::descriptor("codex").expect("codex descriptor");

        for (descriptor, key) in [
            (&claude, "ANTHROPIC_API_KEY"),
            (&claude, "ANTHROPIC_BASE_URL"),
            (&claude, "CLAUDE_CODE_USE_FOUNDRY"),
            (&claude, "CLAUDE_CODE_EXECUTABLE"),
            (&codex, "CODEX_HOME"),
            (&codex, "PATH"),
        ] {
            let workspace = BTreeMap::from([(key.to_string(), "workspace".to_string())]);
            assert_eq!(
                find_capability_affecting_env_override(descriptor, &workspace),
                Some(key.to_string()),
                "workspace layer must not change the probe universe"
            );

            let session = BTreeMap::from([(key.to_string(), "session".to_string())]);
            assert_eq!(
                find_capability_affecting_env_override(descriptor, &session),
                Some(key.to_string()),
                "session layer must not change the probe universe"
            );

            let global = BTreeMap::from([(key.to_string(), "global".to_string())]);
            assert_eq!(
                find_capability_affecting_env_override(descriptor, &global),
                Some(key.to_string()),
                "global secret layer must not change the probe universe"
            );
        }
    }

    #[test]
    fn ordinary_workspace_environment_remains_allowed() {
        let claude = registry::descriptor("claude").expect("claude descriptor");
        let workspace = BTreeMap::from([("PROJECT_FEATURE_FLAG".to_string(), "1".to_string())]);
        assert_eq!(
            find_capability_affecting_env_override(&claude, &workspace),
            None
        );
    }
}
