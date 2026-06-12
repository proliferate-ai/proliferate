use std::collections::BTreeMap;

use anyharness_contract::v1::{AgentAuthExternalScope, AgentAuthSelectionConfig};

use crate::domains::sessions::mcp_bindings::crypto::SessionDataCipher;
use crate::persistence::Db;

use super::{
    AgentAuthConfigInput, AgentAuthConfigStore, AgentAuthLaunchOverlayError, AgentAuthService,
};

fn cipher() -> SessionDataCipher {
    SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
        .expect("cipher")
}

#[test]
fn launch_overlay_separates_same_profile_by_target_scope() {
    let service = AgentAuthService::new(
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
    let service = AgentAuthService::new(
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
    let service = AgentAuthService::new(
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
    let service = AgentAuthService::new(
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

    let outcome = service
        .apply_config(AgentAuthConfigInput {
            external_auth_scope: Some(scope.clone()),
            revision: 1,
            selections: Vec::new(),
        })
        .expect("apply empty provider-managed config");
    assert!(outcome.no_selection_kinds.contains(&"opencode".to_string()));

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
    let service = AgentAuthService::new(
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
fn launch_overlay_merges_multiple_active_provider_slots_for_scoped_agent() {
    let service = AgentAuthService::new(
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
            selections: vec![
                AgentAuthSelectionConfig {
                    agent_kind: "opencode".to_string(),
                    auth_slot_id: "openai".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-openai".to_string(),
                    credential_revision: 1,
                    status: Some("active".to_string()),
                    credential_share_id: None,
                    expires_at: None,
                    protected_env: BTreeMap::from([(
                        "OPENAI_API_KEY".to_string(),
                        "openai-runtime-token".to_string(),
                    )]),
                    support_env: BTreeMap::new(),
                    protected_config: BTreeMap::new(),
                    support_config: BTreeMap::new(),
                    synced_file_paths: Vec::new(),
                },
                AgentAuthSelectionConfig {
                    agent_kind: "opencode".to_string(),
                    auth_slot_id: "anthropic".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-anthropic".to_string(),
                    credential_revision: 1,
                    status: Some("active".to_string()),
                    credential_share_id: None,
                    expires_at: None,
                    protected_env: BTreeMap::from([(
                        "ANTHROPIC_API_KEY".to_string(),
                        "anthropic-runtime-token".to_string(),
                    )]),
                    support_env: BTreeMap::new(),
                    protected_config: BTreeMap::new(),
                    support_config: BTreeMap::new(),
                    synced_file_paths: Vec::new(),
                },
            ],
        })
        .expect("apply multi-slot opencode config");

    let overlay = service
        .launch_overlay("opencode", Some(&scope), Some(1))
        .expect("multi-slot overlay");

    assert_eq!(
        overlay
            .protected_env
            .get("OPENAI_API_KEY")
            .map(String::as_str),
        Some("openai-runtime-token")
    );
    assert_eq!(
        overlay
            .protected_env
            .get("ANTHROPIC_API_KEY")
            .map(String::as_str),
        Some("anthropic-runtime-token")
    );
}

#[test]
fn launch_overlay_fails_closed_for_invalid_scoped_selection() {
    let service = AgentAuthService::new(
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
