//! Parse + validate entry for agent catalog documents whose bytes arrive at
//! runtime (sync fetches, build-pipeline drafts). One doorstep: bytes in,
//! validated document out.

use super::schema::AgentCatalogDocument;
use super::validation::validate_agent_catalog_document;

pub fn parse_agent_catalog_json(json: &str) -> anyhow::Result<AgentCatalogDocument> {
    let catalog: AgentCatalogDocument = serde_json::from_str(json)?;
    validate_agent_catalog_document(&catalog)?;
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::draft_catalog_json;

    #[test]
    fn parses_and_validates_the_draft_catalog() {
        let document = parse_agent_catalog_json(draft_catalog_json()).expect("draft must load");

        assert_eq!(document.schema_version, 2);
        assert_eq!(document.catalog_version, draft_catalog_version());
    }

    #[test]
    fn rejects_a_document_that_fails_validation() {
        let mut raw: serde_json::Value =
            serde_json::from_str(draft_catalog_json()).expect("draft must parse");
        raw["catalogVersion"] = serde_json::Value::String(" ".to_string());
        let json = serde_json::to_string(&raw).expect("serialize");

        let error = parse_agent_catalog_json(&json).expect_err("blank catalogVersion must fail");

        assert!(
            error.to_string().contains("catalog version is empty"),
            "unexpected error: {error}"
        );
    }

    fn draft_catalog_version() -> String {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../scripts/agent-catalog/catalog.draft.json"
        ))
        .expect("read draft catalog");
        serde_json::from_str::<serde_json::Value>(&text).expect("parse draft")["catalogVersion"]
            .as_str()
            .expect("catalogVersion")
            .to_string()
    }
}
