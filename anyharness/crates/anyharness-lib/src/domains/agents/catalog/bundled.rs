use std::sync::OnceLock;

use super::schema::AgentCatalogDocument;
use super::validation::validate_agent_catalog_document;

const BUNDLED_AGENT_CATALOG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/v1/catalog.json"
));

static BUNDLED_AGENT_CATALOG_DOCUMENT: OnceLock<AgentCatalogDocument> = OnceLock::new();

pub fn bundled_agent_catalog_document() -> &'static AgentCatalogDocument {
    BUNDLED_AGENT_CATALOG_DOCUMENT.get_or_init(|| {
        let catalog: AgentCatalogDocument =
            serde_json::from_str(BUNDLED_AGENT_CATALOG).expect("bundled agents catalog must parse");
        validate_agent_catalog_document(&catalog).expect("bundled agents catalog must validate");
        catalog
    })
}
