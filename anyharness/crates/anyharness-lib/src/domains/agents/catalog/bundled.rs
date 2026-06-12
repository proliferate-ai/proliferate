use std::sync::OnceLock;

use super::schema::AgentCatalogDocument;
use super::validation::validate_agent_catalog_document;
use super::validation_pairing::validate_agent_catalog_registry_pairing;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;

const BUNDLED_AGENT_CATALOG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/catalog.json"
));

static BUNDLED_AGENT_CATALOG_DOCUMENT: OnceLock<AgentCatalogDocument> = OnceLock::new();

/// The compiled-in agent catalog: the fallback truth until a synced catalog
/// is applied. Fully validated at first read — document invariants AND
/// registry pairing (every context's `authSlotId` must be a slot the bundled
/// registry declares, with signals inside the slot's vocabulary), so a
/// checked-in document that the classifier would silently skip cannot ship.
pub fn bundled_agent_catalog_document() -> &'static AgentCatalogDocument {
    BUNDLED_AGENT_CATALOG_DOCUMENT.get_or_init(|| {
        let catalog: AgentCatalogDocument =
            serde_json::from_str(BUNDLED_AGENT_CATALOG).expect("bundled agents catalog must parse");
        validate_agent_catalog_document(&catalog).expect("bundled agents catalog must validate");
        validate_agent_catalog_registry_pairing(&catalog, bundled_agent_registry_document())
            .expect("bundled agents catalog must pair with the bundled registry");
        catalog
    })
}
