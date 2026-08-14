//! Deterministic order checks for structured and opaque fallback evidence.

use super::super::model::evidence::{SupportFallbackRecordV1, SupportOpaqueFallbackLineV1};
use super::SupportSchemaError;

pub(super) fn fallback_records(
    records: &[SupportFallbackRecordV1],
) -> Result<(), SupportSchemaError> {
    let mut prior = None;
    for record in records {
        let key = (
            record.component,
            record.record.producer_boot_id.as_str(),
            record.record.producer_sequence,
            u8::MAX - record.segment,
            record.line,
        );
        if prior.is_some_and(|prior| key <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "fallback record order",
            ));
        }
        prior = Some(key);
    }
    Ok(())
}

pub(super) fn opaque_lines(
    lines: &[SupportOpaqueFallbackLineV1],
) -> Result<(), SupportSchemaError> {
    let mut prior = None;
    for line in lines {
        let key = (u8::MAX - line.segment, line.line);
        if prior.is_some_and(|prior| key <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "opaque fallback line order",
            ));
        }
        prior = Some(key);
    }
    Ok(())
}
