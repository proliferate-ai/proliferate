use std::sync::OnceLock;

use super::schema::AgentRegistryDocument;
use super::validation::validate_agent_registry_document;

const BUNDLED_AGENT_REGISTRY: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/v1/registry.json"
));

static BUNDLED_AGENT_REGISTRY_DOCUMENT: OnceLock<AgentRegistryDocument> = OnceLock::new();

pub fn bundled_agent_registry_document() -> &'static AgentRegistryDocument {
    BUNDLED_AGENT_REGISTRY_DOCUMENT.get_or_init(|| {
        let registry: AgentRegistryDocument = serde_json::from_str(BUNDLED_AGENT_REGISTRY)
            .expect("bundled agents registry must parse");
        validate_agent_registry_document(&registry).expect("bundled agents registry must validate");
        registry
    })
}
