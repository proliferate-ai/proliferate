use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION, types::ProducerRecordV1,
    validation::parse_producer_record_value,
};
use serde::{Deserialize, Serialize};

use crate::DiagnosticsComponent;

use super::{FallbackError, FALLBACK_SEGMENT_BYTES};

/// Current component-fallback wrapper schema.
pub const FALLBACK_SCHEMA: u8 = 1;

/// Closed reason assigned when a producer persists a record to component fallback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FallbackReason {
    CollectorUnavailable,
    GenerationChanged,
    TransportCooldown,
    DeliveryUnknown,
    FinalTeardown,
}

/// Strict component-fallback wrapper around one accepted producer record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FallbackRecordV1 {
    pub fallback_schema: u8,
    pub reason: FallbackReason,
    pub record: ProducerRecordV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFallbackRecordV1 {
    fallback_schema: u8,
    reason: FallbackReason,
    record: serde_json::Value,
}

impl FallbackRecordV1 {
    pub(super) fn encode(
        component: DiagnosticsComponent,
        reason: FallbackReason,
        record: &ProducerRecordV1,
    ) -> Result<Vec<u8>, FallbackError> {
        let wrapper = Self {
            fallback_schema: FALLBACK_SCHEMA,
            reason,
            record: record.clone(),
        }
        .canonical_for(component)?;
        let mut encoded = serde_json::to_vec(&wrapper).map_err(|_| FallbackError::InvalidRecord)?;
        encoded.push(b'\n');
        Ok(encoded)
    }

    #[cfg(test)]
    pub(super) fn validate_for(
        &self,
        component: DiagnosticsComponent,
    ) -> Result<(), FallbackError> {
        self.clone().canonical_for(component).map(|_| ())
    }

    fn canonical_for(mut self, component: DiagnosticsComponent) -> Result<Self, FallbackError> {
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
        let canonical =
            parse_producer_record_value(&raw).map_err(|_| FallbackError::InvalidRecord)?;
        if canonical.component != component.protocol_component()
            || canonical.schema_version != CURRENT_SCHEMA_VERSION
        {
            return Err(FallbackError::InvalidRecord);
        }
        self.record = canonical;
        Ok(self)
    }
}

/// Parses one bounded JSON-lines fallback value and binds it to its expected component family.
///
/// The input may omit its line terminator or end in exactly one LF. Any other
/// embedded LF, unknown wrapper field or reason, schema mismatch, component
/// mismatch, or producer-record validation failure returns `None`.
pub fn parse_fallback_record_line(
    expected_component: DiagnosticsComponent,
    line: &[u8],
) -> Option<FallbackRecordV1> {
    if line.is_empty()
        || line.len() > FALLBACK_SEGMENT_BYTES as usize
        || line.last().is_some_and(u8::is_ascii_whitespace) && !line.ends_with(b"\n")
    {
        return None;
    }
    let value = line.strip_suffix(b"\n").unwrap_or(line);
    if value.is_empty()
        || value.contains(&b'\n')
        || value.first().is_some_and(u8::is_ascii_whitespace)
        || value.last().is_some_and(u8::is_ascii_whitespace)
    {
        return None;
    }
    let raw = serde_json::from_slice::<RawFallbackRecordV1>(value).ok()?;
    if raw.fallback_schema != FALLBACK_SCHEMA {
        return None;
    }
    let record = parse_producer_record_value(&raw.record).ok()?;
    if record.component != expected_component.protocol_component()
        || record.schema_version != CURRENT_SCHEMA_VERSION
    {
        return None;
    }
    Some(FallbackRecordV1 {
        fallback_schema: raw.fallback_schema,
        reason: raw.reason,
        record,
    })
}
