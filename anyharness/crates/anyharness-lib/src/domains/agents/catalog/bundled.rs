use super::schema::AgentCatalogDocument;
use super::validation::validate_agent_catalog_document;

const BUNDLED_AGENT_CATALOG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/v1/catalog.json"
));

pub fn bundled_agent_catalog_document() -> anyhow::Result<AgentCatalogDocument> {
    let catalog: AgentCatalogDocument = serde_json::from_str(BUNDLED_AGENT_CATALOG)?;
    validate_agent_catalog_document(&catalog)?;
    Ok(catalog)
}
