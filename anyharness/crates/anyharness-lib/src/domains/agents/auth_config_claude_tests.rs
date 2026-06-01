use std::collections::BTreeMap;

use anyharness_contract::v1::AgentAuthSelectionConfig;

use crate::domains::sessions::mcp_bindings::crypto::SessionDataCipher;
use crate::persistence::Db;

use super::{AgentAuthConfigInput, AgentAuthConfigService, AgentAuthConfigStore};

fn cipher() -> SessionDataCipher {
    SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
        .expect("cipher")
}

#[test]
fn claude_gateway_launch_overlay_sets_managed_config_dir() {
    let root = std::env::temp_dir().join(format!(
        "anyharness-agent-auth-claude-config-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        root.clone(),
    );
    service
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: None,
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "ANTHROPIC_AUTH_TOKEN".to_string(),
                    "runtime-token".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect("apply");

    let overlay = service
        .launch_overlay("claude", None, None)
        .expect("overlay");
    let expected = root.join("agent-auth").join("claude-gateway");
    let expected_config_dir = expected.to_string_lossy().into_owned();
    assert_eq!(
        overlay
            .support_env
            .get("CLAUDE_CONFIG_DIR")
            .map(String::as_str),
        Some(expected_config_dir.as_str())
    );
    assert!(expected.is_dir());
    assert_eq!(
        overlay
            .protected_env
            .get("ANTHROPIC_AUTH_TOKEN")
            .map(String::as_str),
        Some("runtime-token")
    );
}

#[test]
fn apply_config_rejects_support_env_claude_config_dir() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    let error = service
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: None,
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "ANTHROPIC_AUTH_TOKEN".to_string(),
                    "runtime-token".to_string(),
                )]),
                support_env: BTreeMap::from([(
                    "CLAUDE_CONFIG_DIR".to_string(),
                    "/tmp/user-controlled".to_string(),
                )]),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect_err("reserved support env key");
    assert!(error.to_string().contains("CLAUDE_CONFIG_DIR"));
}
