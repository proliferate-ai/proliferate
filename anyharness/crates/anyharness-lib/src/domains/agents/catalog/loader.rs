//! Dual-read entry for agent catalog documents during the v1 -> v2
//! transition. The bundled catalog stays on the v1 path (`bundled.rs` is
//! untouched); this loader is for documents whose version is not known at
//! compile time (sync fetches, build-pipeline drafts).
//!
//! DUAL-READ RULE: a document is read as v2 iff its top-level
//! `schemaVersion` is a number >= 2, OR — for early drafts that predate the
//! field — it lacks a numeric `schemaVersion` but carries a top-level
//! `probedAgainst` key (the v2-only registry pairing). Everything else is
//! read as v1. Both arms are validated before they are returned.

use serde_json::Value;

use super::schema::AgentCatalogDocument;
use super::schema_v2::AgentCatalogV2Document;
use super::validation::validate_agent_catalog_document;
use super::validation_v2::validate_agent_catalog_v2_document;

#[derive(Debug, Clone)]
pub enum AgentCatalog {
    V1(AgentCatalogDocument),
    V2(AgentCatalogV2Document),
}

pub fn parse_agent_catalog_json(json: &str) -> anyhow::Result<AgentCatalog> {
    let raw: Value = serde_json::from_str(json)?;
    if is_v2_catalog_value(&raw) {
        let catalog: AgentCatalogV2Document = serde_json::from_value(raw)?;
        validate_agent_catalog_v2_document(&catalog)?;
        Ok(AgentCatalog::V2(catalog))
    } else {
        let catalog: AgentCatalogDocument = serde_json::from_value(raw)?;
        validate_agent_catalog_document(&catalog)?;
        Ok(AgentCatalog::V1(catalog))
    }
}

fn is_v2_catalog_value(raw: &Value) -> bool {
    match raw.get("schemaVersion").and_then(Value::as_u64) {
        Some(schema_version) => schema_version >= 2,
        None => raw.get("probedAgainst").is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema_v2::draft_catalog_v2_json;

    const BUNDLED_V1_CATALOG: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../catalogs/agents/v1/catalog.json"
    ));

    #[test]
    fn dual_read_picks_v2_for_the_draft_catalog() {
        let catalog = parse_agent_catalog_json(draft_catalog_v2_json()).expect("draft must load");

        match catalog {
            AgentCatalog::V2(document) => {
                assert_eq!(document.schema_version, 2);
                assert_eq!(document.catalog_version, "2026-06-10.6");
            }
            AgentCatalog::V1(_) => panic!("draft catalog must be read as v2"),
        }
    }

    #[test]
    fn dual_read_picks_v1_for_the_bundled_catalog() {
        let catalog = parse_agent_catalog_json(BUNDLED_V1_CATALOG).expect("bundled must load");

        match catalog {
            AgentCatalog::V1(document) => assert_eq!(document.schema_version, 1),
            AgentCatalog::V2(_) => panic!("bundled catalog must be read as v1"),
        }
    }

    #[test]
    fn dual_read_treats_probed_against_without_schema_version_as_v2() {
        let mut raw: serde_json::Value =
            serde_json::from_str(draft_catalog_v2_json()).expect("draft must parse");
        raw.as_object_mut()
            .expect("draft is an object")
            .remove("schemaVersion");
        let json = serde_json::to_string(&raw).expect("serialize");

        let catalog = parse_agent_catalog_json(&json).expect("must load via probedAgainst marker");

        match catalog {
            AgentCatalog::V2(document) => assert_eq!(document.schema_version, 2),
            AgentCatalog::V1(_) => panic!("probedAgainst document must be read as v2"),
        }
    }

    #[test]
    fn dual_read_rejects_v2_document_that_fails_validation() {
        let mut raw: serde_json::Value =
            serde_json::from_str(draft_catalog_v2_json()).expect("draft must parse");
        raw["catalogVersion"] = serde_json::Value::String(" ".to_string());
        let json = serde_json::to_string(&raw).expect("serialize");

        let error = parse_agent_catalog_json(&json).expect_err("blank catalogVersion must fail");

        assert!(
            error.to_string().contains("catalog version is empty"),
            "unexpected error: {error}"
        );
    }
}
