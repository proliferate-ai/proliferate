//! Revalidation of accepted diagnostics-protocol values at the support
//! artifact boundary. Values are embedded unchanged, never trusted merely
//! because they have already been deserialized.

use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ExportManifestV1, ExportStreamFrameV1, FallbackHealthV1, GapV1,
    HealthResponseV1, ProducerRecordV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_frame, validate_export_manifest, validate_health, validate_producer_record,
};
use serde::Serialize;

use super::{validate_protocol_timestamp, validate_safe_u64, SupportSchemaError};

pub(super) fn accepted_record(
    record: &CollectorAcceptedRecordV1,
    context: &'static str,
) -> Result<(), SupportSchemaError> {
    reject_negative_integers(record, context)?;
    validate_export_frame(&ExportStreamFrameV1::Record {
        record: record.clone(),
    })
    .map_err(|_| SupportSchemaError::InvalidProtocolValue(context))?;
    validate_protocol_timestamp(&record.record.source_timestamp)?;
    validate_protocol_timestamp(&record.accepted_timestamp)
}

pub(super) fn producer_record(
    record: &ProducerRecordV1,
    context: &'static str,
) -> Result<(), SupportSchemaError> {
    reject_negative_integers(record, context)?;
    validate_producer_record(record)
        .map_err(|_| SupportSchemaError::InvalidProtocolValue(context))?;
    validate_protocol_timestamp(&record.source_timestamp)
}

pub(super) fn gap(gap: &GapV1, context: &'static str) -> Result<(), SupportSchemaError> {
    reject_negative_integers(gap, context)?;
    validate_export_frame(&ExportStreamFrameV1::Gap { gap: gap.clone() })
        .map_err(|_| SupportSchemaError::InvalidProtocolValue(context))
}

pub(super) fn export_manifest(
    manifest: &ExportManifestV1,
    context: &'static str,
) -> Result<(), SupportSchemaError> {
    reject_negative_integers(manifest, context)?;
    validate_export_manifest(manifest)
        .map_err(|_| SupportSchemaError::InvalidProtocolValue(context))?;
    validate_protocol_timestamp(&manifest.generated_at)?;
    for timestamp in [
        manifest.filters.source_time_from.as_deref(),
        manifest.filters.source_time_to.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_protocol_timestamp(timestamp)?;
    }
    Ok(())
}

pub(super) fn health(
    health: &HealthResponseV1,
    context: &'static str,
) -> Result<(), SupportSchemaError> {
    reject_negative_integers(health, context)?;
    validate_health(health).map_err(|_| SupportSchemaError::InvalidProtocolValue(context))
}

pub(super) fn fallback_health(health: &FallbackHealthV1) -> Result<(), SupportSchemaError> {
    validate_safe_u64(health.bytes)?;
    validate_safe_u64(health.dropped_records)
}

fn reject_negative_integers<T: Serialize>(
    value: &T,
    context: &'static str,
) -> Result<(), SupportSchemaError> {
    let value = serde_json::to_value(value)
        .map_err(|_| SupportSchemaError::InvalidProtocolValue(context))?;
    reject_negative_json_integers(&value)
        .map_err(|_| SupportSchemaError::InvalidProtocolValue(context))
}

fn reject_negative_json_integers(value: &serde_json::Value) -> Result<(), ()> {
    match value {
        serde_json::Value::Number(number) if number.as_i64().is_some_and(|value| value < 0) => {
            Err(())
        }
        serde_json::Value::Array(values) => {
            for value in values {
                reject_negative_json_integers(value)?;
            }
            Ok(())
        }
        serde_json::Value::Object(values) => {
            for value in values.values() {
                reject_negative_json_integers(value)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
