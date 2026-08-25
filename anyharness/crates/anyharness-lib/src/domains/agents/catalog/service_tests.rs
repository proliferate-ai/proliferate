use std::sync::Arc;

use super::loader::parse_agent_catalog_json;
use super::schema::canonical_catalog_json;
use super::service::{ActiveCatalog, AgentCatalogService};
use super::sync::CatalogSyncService;

fn canonical_catalog() -> ActiveCatalog {
    let document = parse_agent_catalog_json(canonical_catalog_json()).expect("catalog must load");
    ActiveCatalog::new(Arc::new(document))
}

#[test]
fn service_reads_the_bundled_catalog_at_boot() {
    let sync = Arc::new(CatalogSyncService::from_bundled());
    let service = AgentCatalogService::new(sync.clone());
    assert!(service.active_catalog().agent("claude").is_some());
}

#[test]
fn bundled_catalog_declares_goal_support_for_claude_and_codex_only() {
    let catalog = AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled()))
        .active_catalog();
    assert!(catalog.supports_goals("claude"));
    assert!(catalog.supports_goals("codex"));
    for kind in ["gemini", "cursor", "opencode", "grok", "unknown"] {
        assert!(!catalog.supports_goals(kind), "kind={kind}");
    }
}

#[test]
fn pins_surface_catalog_harness_versions() {
    let catalog = canonical_catalog();
    let claude = catalog.pins("claude").expect("claude pins");
    assert_eq!(claude.agent_process.version, "0.66.0-proliferate.2");
    assert_eq!(
        claude.native.as_ref().map(|pin| pin.version.as_str()),
        Some("2.1.234")
    );
    assert!(catalog.pins("cursor").expect("cursor pins").native.is_none());
    assert!(catalog.pins("not-an-agent").is_none());
}

#[test]
fn bundled_catalog_is_a_complete_lockfile() {
    use super::schema::{AgentCatalogArtifactPin, AgentCatalogArtifactSource};

    let catalog = AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled()))
        .active_catalog();
    let check = |kind: &str, role: &str, pin: &AgentCatalogArtifactPin| {
        let source = pin
            .source
            .as_ref()
            .unwrap_or_else(|| panic!("{kind} {role} pin must carry a resolved source"));
        if let AgentCatalogArtifactSource::Binary { targets }
        | AgentCatalogArtifactSource::Archive { targets, .. } = source
        {
            for shipped in ["macos_arm64", "macos_x64", "linux_x64"] {
                assert!(targets.contains_key(shipped));
            }
            for target in targets.values() {
                assert_eq!(target.sha256.len(), 64);
            }
        }
    };
    for agent in catalog.agents() {
        check(&agent.kind, "agentProcess", &agent.harness.agent_process);
        if let Some(native) = &agent.harness.native {
            check(&agent.kind, "native", native);
        }
    }
}
