use std::collections::BTreeMap;

use anyharness_contract::v1::{AgentAuthExternalScope, AgentAuthSelectionConfig};
use serde_json::json;

use crate::domains::sessions::mcp_bindings::crypto::SessionDataCipher;
use crate::persistence::Db;

use super::{
    AgentAuthConfigInput, AgentAuthConfigService, AgentAuthConfigStore, AgentAuthLaunchOverlayError,
};

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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(AgentAuthExternalScope {
                provider: "proliferate-cloud".to_string(),
                id: "profile-1".to_string(),
                target_id: Some("target-1".to_string()),
            }),
            revision: 3,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                auth_slot_id: "anthropic".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 2,
                status: None,
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
fn apply_config_infers_legacy_single_slot_auth_selection() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    let input: AgentAuthConfigInput = serde_json::from_value(json!({
        "externalAuthScope": null,
        "revision": 1,
        "selections": [{
            "agentKind": "claude",
            "materializationMode": "gateway_env",
            "credentialId": "credential-1",
            "credentialRevision": 1,
            "protectedEnv": {
                "ANTHROPIC_BASE_URL": "https://gateway.example"
            }
        }]
    }))
    .expect("legacy payload");

    service.apply_config(input).expect("apply");

    let status = service.status().expect("status");
    assert_eq!(status.selections[0].agent_kind, "claude");
    assert_eq!(status.selections[0].auth_slot_id, "anthropic");
}

#[test]
fn apply_config_requires_auth_slot_for_multi_slot_agent() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    let input: AgentAuthConfigInput = serde_json::from_value(json!({
        "externalAuthScope": null,
        "revision": 1,
        "selections": [{
            "agentKind": "opencode",
            "materializationMode": "gateway_env",
            "credentialId": "credential-1",
            "credentialRevision": 1,
            "protectedEnv": {
                "OPENAI_API_KEY": "secret"
            }
        }]
    }))
    .expect("legacy payload");

    let error = service
        .apply_config(input)
        .expect_err("authSlotId required");
    assert!(error.to_string().contains("authSlotId"));
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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: None,
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "codex".to_string(),
                auth_slot_id: "openai".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
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
                        "model_provider": "proliferate",
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
    assert_eq!(overlay.protected_env.get("OPENAI_API_KEY"), None);
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
    let codex_home = root.join("agent-auth").join("codex");
    let config_toml =
        std::fs::read_to_string(codex_home.join("config.toml")).expect("codex config");
    assert!(config_toml.contains("openai_base_url = \"https://gateway.example/openai/v1\""));
    assert!(config_toml.contains("env_key = \"CODEX_API_KEY\""));
    assert!(config_toml.contains("model_provider = \"proliferate\""));
    assert!(!config_toml.contains("model_provider_id"));
    assert!(config_toml.contains("[model_providers.proliferate]"));
    assert!(config_toml.contains("env_key = \"CODEX_API_KEY\""));

    let auth_json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(codex_home.join("auth.json")).expect("codex auth"))
            .expect("parse codex auth");
    assert_eq!(auth_json["auth_mode"], "apikey");
    assert_eq!(auth_json["OPENAI_API_KEY"], "runtime-token");
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
            .apply_config(AgentAuthConfigInput {
                external_auth_scope: Some(scope),
                revision,
                selections: vec![AgentAuthSelectionConfig {
                    agent_kind: "claude".to_string(),
                    auth_slot_id: "anthropic".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-1".to_string(),
                    credential_revision: revision,
                    status: None,
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
fn apply_config_stale_response_reports_current_revision() {
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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 2,
            selections: Vec::new(),
        })
        .expect("apply current");

    let stale = service
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope),
            revision: 1,
            selections: Vec::new(),
        })
        .expect("apply stale");

    assert!(!stale.applied);
    assert_eq!(stale.revision, 2);
    assert_eq!(stale.status, "stale");
}

#[test]
fn launch_overlay_separates_same_profile_by_target_scope() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    let target_1 = AgentAuthExternalScope {
        provider: "proliferate-cloud".to_string(),
        id: "profile-1".to_string(),
        target_id: Some("target-1".to_string()),
    };
    let target_2 = AgentAuthExternalScope {
        provider: "proliferate-cloud".to_string(),
        id: "profile-1".to_string(),
        target_id: Some("target-2".to_string()),
    };
    for (scope, base_url) in [
        (target_1.clone(), "https://target-1.example"),
        (target_2.clone(), "https://target-2.example"),
    ] {
        service
            .apply_config(AgentAuthConfigInput {
                external_auth_scope: Some(scope),
                revision: 1,
                selections: vec![AgentAuthSelectionConfig {
                    agent_kind: "claude".to_string(),
                    auth_slot_id: "anthropic".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-1".to_string(),
                    credential_revision: 1,
                    status: Some("active".to_string()),
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
        .launch_overlay("claude", Some(&target_1), Some(1))
        .expect("target-1 overlay");
    assert_eq!(
        scoped
            .protected_env
            .get("ANTHROPIC_BASE_URL")
            .map(String::as_str),
        Some("https://target-1.example")
    );
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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 3,
            selections: Vec::new(),
        })
        .expect("apply");

    let error = service
        .launch_overlay("claude", Some(&scope), Some(4))
        .expect_err("stale revision should fail");
    assert!(error.to_string().contains("needs_resync"));
}

#[test]
fn launch_overlay_fails_closed_for_missing_scoped_selection() {
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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 1,
            selections: Vec::new(),
        })
        .expect("apply");

    let error = service
        .launch_overlay("claude", Some(&scope), Some(1))
        .expect_err("missing selection should fail closed");
    let AgentAuthLaunchOverlayError::SelectionRequired(required) = error else {
        panic!("expected selection required");
    };
    assert_eq!(required.agent_kind, "claude");
    assert_eq!(required.selection_status, "missing");
    assert_eq!(required.resolution_scope, Some(scope));
}

#[test]
fn launch_overlay_fails_closed_for_missing_scoped_provider_managed_selection() {
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

    let missing_record = service
        .launch_overlay("opencode", Some(&scope), Some(1))
        .expect_err("scoped provider-managed agent needs applied auth config");
    let AgentAuthLaunchOverlayError::SelectionRequired(required) = missing_record else {
        panic!("expected selection required");
    };
    assert_eq!(required.agent_kind, "opencode");
    assert_eq!(required.selection_status, "missing");

    service
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 1,
            selections: Vec::new(),
        })
        .expect("apply empty provider-managed config");

    let empty_record = service
        .launch_overlay("opencode", Some(&scope), Some(1))
        .expect_err("scoped provider-managed agent needs selected auth slot");
    let AgentAuthLaunchOverlayError::SelectionRequired(required) = empty_record else {
        panic!("expected selection required");
    };
    assert_eq!(required.agent_kind, "opencode");
    assert_eq!(required.selection_status, "missing");
}

#[test]
fn launch_overlay_fails_stale_provider_managed_agent_when_optional_selection_exists() {
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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "opencode".to_string(),
                auth_slot_id: "openai".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: Some("active".to_string()),
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "OPENAI_API_KEY".to_string(),
                    "runtime-token".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect("apply optional opencode selection");

    let error = service
        .launch_overlay("opencode", Some(&scope), Some(2))
        .expect_err("stale optional selection should not be used");
    assert!(error.to_string().contains("needs_resync"));
}

#[test]
fn launch_overlay_fails_closed_for_invalid_scoped_selection() {
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
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                auth_slot_id: "anthropic".to_string(),
                materialization_mode: "synced_files".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: Some("invalid".to_string()),
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::new(),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect("apply");

    let error = service
        .launch_overlay("claude", Some(&scope), Some(1))
        .expect_err("invalid selection should fail closed");
    let AgentAuthLaunchOverlayError::SelectionRequired(required) = error else {
        panic!("expected selection required");
    };
    assert_eq!(required.selection_status, "invalid");
}

#[test]
fn apply_config_rejects_disallowed_protected_env_key() {
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
                auth_slot_id: "anthropic".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "OPENAI_API_KEY".to_string(),
                    "wrong-agent".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect_err("disallowed key");
    assert!(error.to_string().contains("OPENAI_API_KEY"));
}

#[test]
fn apply_config_rejects_cursor_api_key_in_support_env() {
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
                auth_slot_id: "anthropic".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "ANTHROPIC_BASE_URL".to_string(),
                    "https://gateway.example".to_string(),
                )]),
                support_env: BTreeMap::from([(
                    "CURSOR_API_KEY".to_string(),
                    "wrong-surface".to_string(),
                )]),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect_err("protected key in support env");
    assert!(error.to_string().contains("CURSOR_API_KEY"));
}

#[test]
fn apply_config_rejects_claude_synced_protected_env() {
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
                auth_slot_id: "anthropic".to_string(),
                materialization_mode: "synced_files".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::from([(
                    "ANTHROPIC_API_KEY".to_string(),
                    "secret".to_string(),
                )]),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: Vec::new(),
            }],
        })
        .expect_err("disallowed synced key");
    assert!(error.to_string().contains("ANTHROPIC_API_KEY"));
}

#[test]
fn apply_config_rejects_disallowed_synced_file_path() {
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
                agent_kind: "codex".to_string(),
                auth_slot_id: "openai".to_string(),
                materialization_mode: "synced_files".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
                credential_share_id: None,
                expires_at: None,
                protected_env: BTreeMap::new(),
                support_env: BTreeMap::new(),
                protected_config: BTreeMap::new(),
                support_config: BTreeMap::new(),
                synced_file_paths: vec![".ssh/id_rsa".to_string()],
            }],
        })
        .expect_err("disallowed synced file path");
    assert!(error.to_string().contains(".ssh/id_rsa"));
}

#[test]
fn launch_overlay_rejects_expired_selection() {
    let service = AgentAuthConfigService::new(
        AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
        Some(cipher()),
        std::env::temp_dir(),
    );
    service
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: None,
            revision: 1,
            selections: vec![AgentAuthSelectionConfig {
                agent_kind: "claude".to_string(),
                auth_slot_id: "anthropic".to_string(),
                materialization_mode: "gateway_env".to_string(),
                credential_id: "credential-1".to_string(),
                credential_revision: 1,
                status: None,
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
