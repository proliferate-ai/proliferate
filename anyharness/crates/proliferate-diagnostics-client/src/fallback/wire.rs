use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION, types::ProducerRecordV1,
    validation::parse_producer_record_value,
};
use serde::{Deserialize, Serialize};

use crate::DiagnosticsComponent;

use super::FallbackError;

pub(super) const FALLBACK_SCHEMA: u8 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FallbackReason {
    CollectorUnavailable,
    GenerationChanged,
    TransportCooldown,
    DeliveryUnknown,
    FinalTeardown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct FallbackRecordV1 {
    pub(super) fallback_schema: u8,
    pub(super) reason: FallbackReason,
    pub(super) record: ProducerRecordV1,
}

impl FallbackRecordV1 {
    pub(super) fn encode(
        component: DiagnosticsComponent,
        reason: FallbackReason,
        record: &ProducerRecordV1,
    ) -> Result<Vec<u8>, FallbackError> {
        if record.component != component.protocol_component() {
            return Err(FallbackError::ComponentMismatch);
        }
        if record.schema_version != CURRENT_SCHEMA_VERSION {
            return Err(FallbackError::InvalidRecord);
        }
        let raw = serde_json::to_value(record).map_err(|_| FallbackError::InvalidRecord)?;
        let canonical =
            parse_producer_record_value(&raw).map_err(|_| FallbackError::InvalidRecord)?;
        if canonical.component != component.protocol_component()
            || canonical.schema_version != CURRENT_SCHEMA_VERSION
        {
            return Err(FallbackError::InvalidRecord);
        }
        let wrapper = Self {
            fallback_schema: FALLBACK_SCHEMA,
            reason,
            record: canonical,
        };
        let mut encoded = serde_json::to_vec(&wrapper).map_err(|_| FallbackError::InvalidRecord)?;
        encoded.push(b'\n');
        Ok(encoded)
    }

    #[cfg(test)]
    pub(super) fn validate_for(
        &self,
        component: DiagnosticsComponent,
    ) -> Result<(), FallbackError> {
        if self.fallback_schema != FALLBACK_SCHEMA {
            return Err(FallbackError::InvalidRecord);
        }
        if self.record.component != component.protocol_component() {
            return Err(FallbackError::ComponentMismatch);
        }
        if self.record.schema_version != CURRENT_SCHEMA_VERSION {
            return Err(FallbackError::InvalidRecord);
        }
        let raw = serde_json::to_value(&self.record).map_err(|_| FallbackError::InvalidRecord)?;
        parse_producer_record_value(&raw)
            .map(|_| ())
            .map_err(|_| FallbackError::InvalidRecord)
    }
}
