use std::fs;

use serde_json::json;

use super::{
    build_anyharness_agent_auth_request, parse_refresh_agent_auth_config_payload,
    AgentAuthMaterializationPlan,
};

#[test]
fn parses_refresh_payload_strictly() {
    let payload = parse_refresh_agent_auth_config_payload(&json!({
        "sandboxProfileId": "profile-1",
        "revision": 4,
        "reason": "selection_changed",
        "forceRestart": false
    }))
    .expect("payload");

    assert_eq!(payload.sandbox_profile_id, "profile-1");
    assert_eq!(payload.revision, 4);
}

#[test]
fn builds_secret_bearing_anyharness_request() {
    let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
        "applied": true,
        "targetId": "target-1",
        "sandboxProfileId": "profile-1",
        "revision": 7,
        "selections": [{
            "agentKind": "claude",
            "materializationMode": "gateway_env",
            "credentialId": "credential-1",
            "credentialRevision": 3,
            "credentialShareId": null,
            "gateway": {
                "protocolFacade": "anthropic",
                "baseUrls": { "anthropic": "https://gateway.example/anthropic" },
                "runtimeGrantToken": "grant-token",
                "expiresAt": "2026-05-18T00:00:00Z",
                "protectedEnv": {
                    "ANTHROPIC_BASE_URL": "https://gateway.example/anthropic",
                    "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer grant-token"
                },
                "supportEnv": {},
                "protectedConfig": {},
                "supportConfig": {}
            }
        }]
    }))
    .expect("plan");

    let (request, outcome) =
        build_anyharness_agent_auth_request(None, "profile-1", "target-1", 7, &plan)
            .expect("request");

    assert!(outcome.applied);
    assert_eq!(outcome.selection_count, 1);
    assert_eq!(request["revision"], 7);
    assert_eq!(
        request["selections"][0]["protectedEnv"]["ANTHROPIC_BASE_URL"],
        "https://gateway.example/anthropic"
    );
    assert_eq!(
        request["selections"][0]["expiresAt"],
        "2026-05-18T00:00:00Z"
    );
}

#[test]
fn allows_codex_gateway_env_aliases() {
    let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
        "applied": true,
        "targetId": "target-1",
        "sandboxProfileId": "profile-1",
        "revision": 7,
        "selections": [{
            "agentKind": "codex",
            "materializationMode": "gateway_env",
            "credentialId": "credential-1",
            "credentialRevision": 3,
            "credentialShareId": null,
            "gateway": {
                "protocolFacade": "openai",
                "baseUrls": { "openai": "https://gateway.example/openai/v1" },
                "runtimeGrantToken": "grant-token",
                "expiresAt": "2026-05-18T00:00:00Z",
                "protectedEnv": {
                    "CODEX_API_KEY": "sk-codex",
                    "OPENAI_API_KEY": "sk-codex",
                    "CODEX_HOME": "/home/user/.proliferate/anyharness/agent-auth/codex"
                },
                "supportEnv": {},
                "protectedConfig": {},
                "supportConfig": {}
            }
        }]
    }))
    .expect("plan");

    let (request, outcome) =
        build_anyharness_agent_auth_request(None, "profile-1", "target-1", 7, &plan)
            .expect("request");

    assert!(outcome.applied);
    assert_eq!(
        request["selections"][0]["protectedEnv"]["OPENAI_API_KEY"],
        "sk-codex"
    );
}

#[test]
fn rejects_plan_for_different_profile_or_target() {
    let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
        "applied": true,
        "targetId": "target-1",
        "sandboxProfileId": "profile-1",
        "revision": 7,
        "selections": []
    }))
    .expect("plan");

    let profile_error =
        build_anyharness_agent_auth_request(None, "profile-2", "target-1", 7, &plan)
            .expect_err("profile mismatch");
    assert!(profile_error
        .to_string()
        .contains("agent auth sandbox profile mismatch"));

    let target_error = build_anyharness_agent_auth_request(None, "profile-1", "target-2", 7, &plan)
        .expect_err("target mismatch");
    assert!(target_error
        .to_string()
        .contains("agent auth target mismatch"));
}

#[test]
fn applies_synced_auth_cleanup_and_reports_paths() {
    let root = std::env::current_dir()
        .expect("cwd")
        .join("target")
        .join(format!(
            "proliferate-worker-agent-auth-cleanup-{}",
            std::process::id()
        ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join(".codex")).expect("mkdir");
    fs::write(root.join(".codex/auth.json"), "{}").expect("write auth");
    let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
        "applied": true,
        "targetId": "target-1",
        "sandboxProfileId": "profile-1",
        "revision": 7,
        "selections": [{
            "agentKind": "codex",
            "materializationMode": "synced_files",
            "credentialId": "credential-1",
            "credentialRevision": 3,
            "status": "invalid",
            "credentialShareId": null,
            "syncedFiles": {
                "credentialShareId": null,
                "envVars": {},
                "files": [],
                "cleanup": [{
                    "relativePath": ".codex/auth.json",
                    "reason": "credential_revoked"
                }]
            }
        }]
    }))
    .expect("plan");

    let (request, outcome) =
        build_anyharness_agent_auth_request(Some(&root), "profile-1", "target-1", 7, &plan)
            .expect("request");
    assert_eq!(outcome.applied_cleanup_paths, vec![".codex/auth.json"]);
    assert_eq!(outcome.selection_count, 1);
    assert_eq!(request["selections"][0]["status"], "invalid");
    assert!(!root.join(".codex/auth.json").exists());
}

#[test]
fn rejects_claude_synced_protected_env() {
    let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
        "applied": true,
        "targetId": "target-1",
        "sandboxProfileId": "profile-1",
        "revision": 7,
        "selections": [{
            "agentKind": "claude",
            "materializationMode": "synced_files",
            "credentialId": "credential-1",
            "credentialRevision": 3,
            "credentialShareId": null,
            "syncedFiles": {
                "credentialShareId": null,
                "envVars": { "ANTHROPIC_API_KEY": "secret" },
                "files": [],
                "cleanup": []
            }
        }]
    }))
    .expect("plan");

    let error = build_anyharness_agent_auth_request(None, "profile-1", "target-1", 7, &plan)
        .expect_err("disallowed synced env");
    assert!(error.to_string().contains("ANTHROPIC_API_KEY"));
}
