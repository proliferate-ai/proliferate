use std::collections::BTreeMap;

use anyharness_contract::v1::{
    AgentAuthExternalScope, AgentAuthSelectionConfig, ApplyAgentAuthConfigRequest,
};
use serde_json::json;

use crate::persistence::Db;
use crate::sessions::mcp_bindings::crypto::SessionDataCipher;

use super::{AgentAuthConfigService, AgentAuthConfigStore};

fn cipher() -> SessionDataCipher {
    SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
        .expect("cipher")
}

#[test]
fn applies_status_without_secret_values() {
    let root = std::env::temp_dir().join(format!(
        "anyharness-agent-auth-config-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        root,
    );

    service
        .apply_config(ApplyAgentAuthConfigRequest {
            external_auth_scope: Some(AgentAuthExternalScope {
                provider: "proliferate-cloud".to_string(),
                id: "profile-1".to_string(),
                target_id: Some("target-1".to_string()),
            }),
            revision: 3,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 2,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "ANTHROPIC_CUSTOM_HEADERS".to_string(),
                    "Authorization: Bearer secret".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect("apply");

    let status = service.status().expect("status");
    assert_eq!(status.revision, Some(3));
    assert_eq!(
        status.selections[0].protected_env_keys,
        vec!["ANTHROPIC_CUSTOM_HEADERS".to_string()]
    );
    let serialized = serde_json::to_string(&status).expect("serialize");
    assert!(!serialized.contains("Bearer secret"));
}

#[test]
fn codex_launch_overlay_sets_managed_codex_home() {
    let root = std::env::temp_dir().join(format!(
        "anyharness-agent-auth-codex-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        root.clone(),
    );
    service
        .apply_config(ApplyAgentAuthConfigRequest {
            external_auth_scope: None,
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "codex".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "CODEX_API_KEY".to_string(),
                    "runtime-token".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::from([(
                    "codex".to_string(),
                    json!({
                        "model_provider_id": "proliferate",
                        "model_providers": {
                            "proliferate": {
                                "name": "Proliferate Gateway",
                                "base_url": "https://gateway.example/openai/v1",
                                "env_key": "CODEX_API_KEY",
                                "wire_api": "responses",
                                "requires_openai_auth": false
                            }
                        }
                    }),
                )]),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect("apply");

    let overlay = service
        .launch_overlay("codex", None, None)
        .expect("overlay");
    assert_eq!(
        overlay
            .protected_env
            .get("CODEX_API_KEY")
            .map(String::as_str),
        Some("runtime-token")
    );
    assert_eq!(
        overlay.protected_env.get("CODEX_HOME").map(String::as_str),
        Some(
            root.join("agent-auth")
                .join("codex")
                .to_string_lossy()
                .as_ref()
        )
    );
    assert!(root
        .join("agent-auth")
        .join("codex")
        .join("config.toml")
        .exists());
}

#[test]
fn launch_overlay_uses_requested_scope() {
    let root = std::env::temp_dir().join(format!(
        "anyharness-agent-auth-scope-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        root,
    );
    let scope_1 = AgentAuthExternalScope {
        provider: "proliferate-cloud".to_string(),
        id: "profile-1".to_string(),
        target_id: Some("target-1".to_string()),
    };
    let scope_2 = AgentAuthExternalScope {
        provider: "proliferate-cloud".to_string(),
        id: "profile-2".to_string(),
        target_id: Some("target-2".to_string()),
    };
    for (scope, revision, base_url) in [
        (scope_1.clone(), 1, "https://profile-1.example"),
        (scope_2.clone(), 2, "https://profile-2.example"),
    ] {
        service
            .apply_config(ApplyAgentAuthConfigRequest {
                external_auth_scope: Some(scope),
                revision,
                selections: vec![AgentAuthSelectionConfig {
                    agent_kind: "claude".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-1".to_string(),
                    credential_revision: revision,
                    credential_share_id: None,
                    expires_at: None,
                    protected_env: BTreeMap::from([(
                        "ANTHROPIC_BASE_URL".to_string(),
                        base_url.to_string(),
                    )]),
                    support_env: BTreeMap::new(),
                    protected_config: BTreeMap::new(),
                    support_config: BTreeMap::new(),
                    synced_file_paths: Vec::new(),
                }],
            })
            .expect("apply");
    }

    let scoped = service
        .launch_overlay("claude", Some(&scope_1), Some(1))
        .expect("scoped overlay");
    assert_eq!(
        scoped
            .protected_env
            .get("ANTHROPIC_BASE_URL")
            .map(String::as_str),
        Some("https://profile-1.example")
    );
    let unscoped = service
        .launch_overlay("claude", None, None)
        .expect("unscoped overlay");
    assert!(unscoped.protected_env.is_empty());
}

#[test]
fn launch_overlay_fails_when_required_revision_is_not_applied() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    let scope = AgentAuthExternalScope {
        provider: "proliferate-cloud".to_string(),
        id: "profile-1".to_string(),
        target_id: Some("target-1".to_string()),
    };
    service
        .apply_config(ApplyAgentAuthConfigRequest {
            external_auth_scope: Some(scope.clone()),
            revision: 3,
            selections: Vec::new(),
        })
        .expect("apply");

    let error = service
        .launch_overlay("claude", Some(&scope), Some(4))
        .expect_err("stale revision should fail");
    assert!(error.to_string().contains("older than required revision"));
}

#[test]
fn launch_overlay_rejects_expired_selection() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    service
        .apply_config(ApplyAgentAuthConfigRequest {
            external_auth_scope: None,
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                credential_share_id: None,
                expires_at: Some("2020-01-01T00:00:00Z".to_string()),
                protected_env: BTreeMap::from([(
                    "ANTHROPIC_BASE_URL".to_string(),
                    "https://gateway.example".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect("apply");

    let error = service
        .launch_overlay("claude", None, None)
        .expect_err("expired grant should fail");
    assert!(error.to_string().contains("expired"));
}
