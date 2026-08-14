use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Session, SessionEventEnvelope, SessionRawNotificationEnvelope};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnyHarnessBoundedWindowSelectionV1 {
    NewestMatching,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnyHarnessBoundedWindowPresentationOrderV1 {
    UpdatedDescIdAsc,
    SeqAsc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnyHarnessBoundedWindowCompletenessV1 {
    Complete,
    LimitUncertain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnyHarnessBoundedWindowMetaV1 {
    pub schema_version: u8,
    pub selection: AnyHarnessBoundedWindowSelectionV1,
    pub presentation_order: AnyHarnessBoundedWindowPresentationOrderV1,
    pub item_limit: usize,
    pub response_byte_limit: usize,
    pub returned_items: usize,
    pub omitted_oversized_items: usize,
    pub completeness: AnyHarnessBoundedWindowCompletenessV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnyHarnessSessionSupportWindowV1 {
    pub window: AnyHarnessBoundedWindowMetaV1,
    pub items: Vec<Session>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnyHarnessEventSupportWindowV1 {
    pub window: AnyHarnessBoundedWindowMetaV1,
    pub items: Vec<SessionEventEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnyHarnessRawNotificationSupportWindowV1 {
    pub window: AnyHarnessBoundedWindowMetaV1,
    pub items: Vec<SessionRawNotificationEnvelope>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_window_meta_uses_the_frozen_wire_vocabulary() {
        let meta = AnyHarnessBoundedWindowMetaV1 {
            schema_version: 1,
            selection: AnyHarnessBoundedWindowSelectionV1::NewestMatching,
            presentation_order: AnyHarnessBoundedWindowPresentationOrderV1::SeqAsc,
            item_limit: 200,
            response_byte_limit: 4_194_304,
            returned_items: 1,
            omitted_oversized_items: 2,
            completeness: AnyHarnessBoundedWindowCompletenessV1::LimitUncertain,
        };
        assert_eq!(
            serde_json::to_value(meta).expect("serialize support-window metadata"),
            serde_json::json!({
                "schemaVersion": 1,
                "selection": "newest_matching",
                "presentationOrder": "seq_asc",
                "itemLimit": 200,
                "responseByteLimit": 4_194_304,
                "returnedItems": 1,
                "omittedOversizedItems": 2,
                "completeness": "limit_uncertain"
            })
        );
    }

    #[test]
    fn bounded_window_metadata_rejects_unknown_wire_fields() {
        let value = serde_json::json!({
            "schemaVersion": 1,
            "selection": "newest_matching",
            "presentationOrder": "seq_asc",
            "itemLimit": 1,
            "responseByteLimit": 16_384,
            "returnedItems": 0,
            "omittedOversizedItems": 0,
            "completeness": "complete",
            "unexpected": true
        });
        assert!(serde_json::from_value::<AnyHarnessBoundedWindowMetaV1>(value).is_err());
    }
}
