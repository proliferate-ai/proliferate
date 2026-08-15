use super::*;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use crate::domains::agents::registry::schema::AgentRegistryAuthSlotEnvVar;

#[test]
fn registry_rejects_duplicate_env_var_names() {
    let mut registry = bundled_agent_registry_document().clone();
    let slot = &mut registry.agents[0].auth.slots[0];
    slot.env_vars.push(AgentRegistryAuthSlotEnvVar::Name(
        "ANTHROPIC_API_KEY".to_string(),
    ));

    let error =
        validate_agent_registry_document(&registry).expect_err("duplicate env var must fail");

    assert!(
        error
            .to_string()
            .contains("env var 'ANTHROPIC_API_KEY' is duplicated"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_empty_discovery_kind() {
    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0].auth.slots[0]
        .discovery_kinds
        .push("  ".to_string());

    let error = validate_agent_registry_document(&registry)
        .expect_err("empty discovery kind must fail");

    assert!(
        error.to_string().contains("has empty discovery kind"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_unsupported_self_update_mechanism() {
    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0].self_update_neutralization.mechanism = "auto_magic".to_string();

    let error = validate_agent_registry_document(&registry)
        .expect_err("unsupported self-update mechanism must fail");
    assert!(
        error
            .to_string()
            .contains("selfUpdateNeutralization mechanism 'auto_magic' is not supported"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_env_mechanism_without_vars() {
    use crate::domains::agents::registry::schema::AgentRegistrySelfUpdateNeutralization;
    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0].self_update_neutralization = AgentRegistrySelfUpdateNeutralization {
        mechanism: "env".to_string(),
        detail: "claims env but declares nothing".to_string(),
        env: vec![],
    };

    let error = validate_agent_registry_document(&registry)
        .expect_err("env mechanism with no vars must fail");
    assert!(
        error.to_string().contains("declares no env vars"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_non_env_mechanism_carrying_env_vars() {
    use crate::domains::agents::registry::schema::{
        AgentRegistrySelfUpdateEnvVar, AgentRegistrySelfUpdateNeutralization,
    };
    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0].self_update_neutralization = AgentRegistrySelfUpdateNeutralization {
        mechanism: "none_found".to_string(),
        detail: "no updater found".to_string(),
        env: vec![AgentRegistrySelfUpdateEnvVar {
            name: "X".to_string(),
            value: "1".to_string(),
        }],
    };

    let error = validate_agent_registry_document(&registry)
        .expect_err("non-env mechanism carrying env vars must fail");
    assert!(
        error.to_string().contains("must not declare env vars"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_accepts_valid_direct_archive_and_rejects_bad_sha() {
    use crate::domains::agents::registry::schema::{
        AgentRegistryAgentProcessArchiveTarget, AgentRegistryAgentProcessInstall,
    };
    use std::collections::HashMap;

    let mut registry = bundled_agent_registry_document().clone();
    let mut platforms = HashMap::new();
    platforms.insert(
        "macos_arm64".to_string(),
        AgentRegistryAgentProcessArchiveTarget {
            url: "https://downloads.test/agent.tar.gz".to_string(),
            sha256: "a".repeat(64),
            expected_binary: "pkg/agent".to_string(),
            size: None,
        },
    );
    registry.agents[0].agent_process.install =
        AgentRegistryAgentProcessInstall::DirectArchive {
            platforms,
            args: vec!["acp".to_string()],
        };
    validate_agent_registry_document(&registry)
        .expect("a well-formed direct_archive install must validate");

    let mut bad = HashMap::new();
    bad.insert(
        "macos_arm64".to_string(),
        AgentRegistryAgentProcessArchiveTarget {
            url: "https://downloads.test/agent.tar.gz".to_string(),
            sha256: "not-a-sha".to_string(),
            expected_binary: "pkg/agent".to_string(),
            size: None,
        },
    );
    registry.agents[0].agent_process.install =
        AgentRegistryAgentProcessInstall::DirectArchive {
            platforms: bad,
            args: vec![],
        };
    let error = validate_agent_registry_document(&registry)
        .expect_err("a bad direct_archive sha256 must fail");
    assert!(
        error.to_string().contains("sha256 must be 64 hex"),
        "unexpected error: {error}"
    );

    for escape in ["../outside/agent", "/usr/bin/agent", "pkg/../../agent"] {
        let mut traversal = HashMap::new();
        traversal.insert(
            "macos_arm64".to_string(),
            AgentRegistryAgentProcessArchiveTarget {
                url: "https://downloads.test/agent.tar.gz".to_string(),
                sha256: "a".repeat(64),
                expected_binary: escape.to_string(),
                size: None,
            },
        );
        registry.agents[0].agent_process.install =
            AgentRegistryAgentProcessInstall::DirectArchive {
                platforms: traversal,
                args: vec![],
            };
        let error = validate_agent_registry_document(&registry)
            .expect_err("an escaping expectedBinary must fail");
        assert!(
            error.to_string().contains("relative path without '..'"),
            "unexpected error for {escape}: {error}"
        );
    }
}

#[test]
fn bundled_registry_self_update_neutralization_validates() {
    // The bundled document's per-harness selfUpdateNeutralization records
    // (claude=env DISABLE_AUTOUPDATER, others=none_found) must already pass.
    validate_agent_registry_document(bundled_agent_registry_document())
        .expect("bundled registry self-update neutralization must validate");
}

#[test]
fn bundled_registry_provider_config_validates() {
    // The bundled document's claude/codex/opencode providerConfig blocks
    // must already pass — this pins that Track D's declarations are
    // valid, not just parseable.
    validate_agent_registry_document(bundled_agent_registry_document())
        .expect("bundled registry with providerConfig must validate");
}

#[test]
fn registry_rejects_unsupported_provider_config_kind() {
    use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0]
        .provider_config
        .push(AgentRegistryProviderConfig {
            kind: "google_vertex".to_string(),
            label: "Google Vertex".to_string(),
            env_vars: vec![AgentRegistryAuthSlotEnvVar::Name(
                "ANTHROPIC_VERTEX_PROJECT_ID".to_string(),
            )],
            pending: false,
            pending_reason: None,
        });

    let error = validate_agent_registry_document(&registry)
        .expect_err("unsupported providerConfig kind must fail");

    assert!(
        error
            .to_string()
            .contains("providerConfig kind 'google_vertex' is not supported"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_duplicate_provider_config_kind() {
    use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

    let mut registry = bundled_agent_registry_document().clone();
    let duplicate = registry.agents[0].provider_config[0].clone();
    registry.agents[0]
        .provider_config
        .push(AgentRegistryProviderConfig {
            kind: duplicate.kind.clone(),
            label: duplicate.label.clone(),
            env_vars: duplicate.env_vars.clone(),
            pending: duplicate.pending,
            pending_reason: duplicate.pending_reason.clone(),
        });

    let error = validate_agent_registry_document(&registry)
        .expect_err("duplicate providerConfig kind must fail");

    assert!(
        error.to_string().contains("is duplicated"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_provider_config_with_no_env_vars() {
    use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0].provider_config = vec![AgentRegistryProviderConfig {
        kind: "aws_bedrock".to_string(),
        label: "AWS Bedrock".to_string(),
        env_vars: vec![],
        pending: false,
        pending_reason: None,
    }];

    let error = validate_agent_registry_document(&registry)
        .expect_err("providerConfig with no env vars must fail");

    assert!(
        error.to_string().contains("has no env vars"),
        "unexpected error: {error}"
    );
}

#[test]
fn registry_rejects_provider_config_duplicate_env_var() {
    use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

    let mut registry = bundled_agent_registry_document().clone();
    registry.agents[0].provider_config = vec![AgentRegistryProviderConfig {
        kind: "aws_bedrock".to_string(),
        label: "AWS Bedrock".to_string(),
        env_vars: vec![
            AgentRegistryAuthSlotEnvVar::Name("AWS_REGION".to_string()),
            AgentRegistryAuthSlotEnvVar::Name("AWS_REGION".to_string()),
        ],
        pending: false,
        pending_reason: None,
    }];

    let error = validate_agent_registry_document(&registry)
        .expect_err("duplicate providerConfig env var must fail");

    assert!(
        error
            .to_string()
            .contains("env var 'AWS_REGION' is duplicated"),
        "unexpected error: {error}"
    );
}
