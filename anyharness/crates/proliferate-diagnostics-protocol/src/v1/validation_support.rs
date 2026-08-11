use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use super::limits::{
    CURRENT_SCHEMA_VERSION, MAX_ARGUMENT_DEPTH, MAX_ARGUMENT_LIST_ITEMS,
    MAX_ARGUMENT_OBJECT_FIELDS, MAX_CARDINALITY_ENTRIES, MAX_FILTER_VALUES, MAX_ID_BYTES,
    MAX_NAME_BYTES, MAX_SAFE_INTEGER, MAX_STRING_BYTES, MIN_SUPPORTED_PRODUCER_MINOR,
};
use super::types::{
    ArgumentValueV1, CollectorAcceptedRecordV1, GapV1, RecordsFilterV1, RejectionReasonV1,
    SchemaVersionV1, VersionCountV1,
};
use super::validation::validate_producer_record;

const SECRET_FIELD_NAMES: &[&str] = &[
    "authorization",
    "authorization_header",
    "cookie",
    "cookies",
    "access_token",
    "refresh_token",
    "raw_token",
    "private_key",
    "secret",
    "environment_values",
    "keychain",
];

const PROHIBITED_MODEL_PLUGIN_FIELDS: &[&str] = &[
    "prompt",
    "response",
    "content",
    "tool_arguments",
    "tool_results",
    "arguments",
    "results",
    "raw_payload",
    "provider_response",
    "command",
    "path",
];

pub(super) fn validate_accepted_record(
    record: &CollectorAcceptedRecordV1,
) -> Result<(), RejectionReasonV1> {
    validate_producer_record(&record.record)?;
    validate_timestamp(&record.accepted_timestamp)
}

pub(super) fn validate_gap(gap: &GapV1) -> Result<(), RejectionReasonV1> {
    if let Some(producer_boot_id) = &gap.producer_boot_id {
        validate_id(producer_boot_id)?;
    }
    Ok(())
}

pub(super) fn validate_version_count(version: &VersionCountV1) -> Result<(), RejectionReasonV1> {
    validate_schema_version(version.version)
}

pub(super) fn validate_filters(filters: &RecordsFilterV1) -> Result<(), RejectionReasonV1> {
    if filters.components.len() > MAX_FILTER_VALUES
        || filters.record_classes.len() > MAX_FILTER_VALUES
        || filters.severities.len() > MAX_FILTER_VALUES
        || filters.names.len() > MAX_FILTER_VALUES
        || filters.outcomes.len() > MAX_FILTER_VALUES
    {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    if let Some(value) = &filters.source_time_from {
        validate_timestamp(value)?;
    }
    if let Some(value) = &filters.source_time_to {
        validate_timestamp(value)?;
    }
    for name in &filters.names {
        validate_name(name)?;
    }
    validate_optional_ids([
        filters.operation_id.as_deref(),
        filters.parent_operation_id.as_deref(),
        filters.trace_id.as_deref(),
        filters.workspace_id.as_deref(),
        filters.session_id.as_deref(),
        filters.turn_id.as_deref(),
        filters.item_id.as_deref(),
        filters.request_id.as_deref(),
        filters.target_id.as_deref(),
        filters.prompt_id.as_deref(),
        filters.workflow_id.as_deref(),
    ])?;
    if let Some(value) = &filters.error_classification {
        validate_name(value)?;
    }
    Ok(())
}

pub(super) fn validate_argument_value(
    value: &ArgumentValueV1,
    depth: usize,
) -> Result<(), RejectionReasonV1> {
    if depth > MAX_ARGUMENT_DEPTH {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    match value {
        ArgumentValueV1::String(value) => validate_bounded_string(value, MAX_STRING_BYTES),
        ArgumentValueV1::Enum(value) => validate_name(value),
        ArgumentValueV1::Float(value) if !value.is_finite() => Err(RejectionReasonV1::InvalidShape),
        ArgumentValueV1::List(values) => {
            if values.len() > MAX_ARGUMENT_LIST_ITEMS {
                return Err(RejectionReasonV1::LimitExceeded);
            }
            for value in values {
                validate_argument_value(value, depth + 1)?;
            }
            Ok(())
        }
        ArgumentValueV1::Object(values) => {
            if values.len() > MAX_ARGUMENT_OBJECT_FIELDS {
                return Err(RejectionReasonV1::LimitExceeded);
            }
            for (key, value) in values {
                validate_name(key)?;
                validate_argument_value(value, depth + 1)?;
            }
            Ok(())
        }
        ArgumentValueV1::Integer(_) | ArgumentValueV1::Float(_) | ArgumentValueV1::Boolean(_) => {
            Ok(())
        }
    }
}

pub(super) fn validate_schema_version(version: SchemaVersionV1) -> Result<(), RejectionReasonV1> {
    if version.major != CURRENT_SCHEMA_VERSION.major {
        return Err(RejectionReasonV1::UnsupportedMajor);
    }
    if version.minor < MIN_SUPPORTED_PRODUCER_MINOR || version.minor > CURRENT_SCHEMA_VERSION.minor
    {
        return Err(RejectionReasonV1::UnsupportedMinor);
    }
    Ok(())
}

pub(super) fn validate_raw_version(value: &Value) -> Result<(), RejectionReasonV1> {
    let version: SchemaVersionV1 = value
        .get("schema_version")
        .cloned()
        .ok_or(RejectionReasonV1::InvalidShape)
        .and_then(|version| from_value(&version))?;
    validate_schema_version(version)
}

pub(super) fn validate_optional_ids<'a>(
    values: impl IntoIterator<Item = Option<&'a str>>,
) -> Result<(), RejectionReasonV1> {
    for value in values.into_iter().flatten() {
        validate_id(value)?;
    }
    Ok(())
}

pub(super) fn validate_timestamp(value: &str) -> Result<(), RejectionReasonV1> {
    let bytes = value.as_bytes();
    let prefix_digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    let prefix_has_shape = bytes.len() >= 20
        && bytes.len() <= 35
        && bytes.get(4) == Some(&b'-')
        && bytes.get(7) == Some(&b'-')
        && bytes.get(10) == Some(&b'T')
        && bytes.get(13) == Some(&b':')
        && bytes.get(16) == Some(&b':')
        && prefix_digits
            .iter()
            .all(|index| bytes.get(*index).is_some_and(u8::is_ascii_digit));
    let suffix = bytes.get(19..).unwrap_or_default();
    let zone_index = suffix
        .iter()
        .position(|byte| matches!(byte, b'Z' | b'+' | b'-'));
    let suffix_has_shape = zone_index.is_some_and(|index| {
        let fraction = &suffix[..index];
        let zone = &suffix[index..];
        let fraction_is_valid = fraction.is_empty()
            || (fraction.len() >= 2
                && fraction.first() == Some(&b'.')
                && fraction[1..].iter().all(u8::is_ascii_digit));
        let zone_is_valid = zone == b"Z"
            || (zone.len() == 6
                && matches!(zone[0], b'+' | b'-')
                && zone[1..3].iter().all(u8::is_ascii_digit)
                && zone[3] == b':'
                && zone[4..6].iter().all(u8::is_ascii_digit));
        fraction_is_valid && zone_is_valid
    });
    let has_shape = prefix_has_shape && suffix_has_shape;
    if has_shape {
        Ok(())
    } else {
        Err(RejectionReasonV1::InvalidShape)
    }
}

pub(super) fn validate_name(value: &str) -> Result<(), RejectionReasonV1> {
    validate_bounded_string(value, MAX_NAME_BYTES)?;
    let mut bytes = value.bytes();
    let first = bytes.next().ok_or(RejectionReasonV1::InvalidShape)?;
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return Err(RejectionReasonV1::InvalidShape);
    }
    if bytes.all(|byte| {
        byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || matches!(byte, b'.' | b'_' | b':' | b'-')
    }) {
        Ok(())
    } else {
        Err(RejectionReasonV1::InvalidShape)
    }
}

pub(super) fn validate_id(value: &str) -> Result<(), RejectionReasonV1> {
    validate_bounded_string(value, MAX_ID_BYTES)
}

pub(super) fn validate_short_string(value: &str) -> Result<(), RejectionReasonV1> {
    validate_bounded_string(value, MAX_NAME_BYTES)
}

pub(super) fn validate_bounded_string(value: &str, limit: usize) -> Result<(), RejectionReasonV1> {
    if value.is_empty() {
        return Err(RejectionReasonV1::InvalidShape);
    }
    if value.len() > limit {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    Ok(())
}

pub(super) fn reject_secret_fields(value: &Value) -> Result<(), RejectionReasonV1> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if SECRET_FIELD_NAMES.contains(&key.as_str()) {
                    return Err(RejectionReasonV1::ProhibitedSecret);
                }
                reject_secret_fields(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_secret_fields(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn reject_prohibited_model_plugin_metadata(
    value: &Value,
) -> Result<(), RejectionReasonV1> {
    let lifecycle = value.get("lifecycle").and_then(Value::as_object);
    for metadata in lifecycle
        .into_iter()
        .flat_map(|payload| [payload.get("model"), payload.get("plugin")])
        .flatten()
        .filter_map(Value::as_object)
    {
        if metadata
            .keys()
            .any(|key| PROHIBITED_MODEL_PLUGIN_FIELDS.contains(&key.as_str()))
        {
            return Err(RejectionReasonV1::ProhibitedMetadata);
        }
    }
    Ok(())
}

pub(super) fn compact_json_len(value: &Value) -> Result<usize, RejectionReasonV1> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|_| RejectionReasonV1::InvalidShape)
}

pub(super) fn validate_serializable_safe_integers<T: Serialize>(
    value: &T,
) -> Result<(), RejectionReasonV1> {
    let value = serde_json::to_value(value).map_err(|_| RejectionReasonV1::InvalidShape)?;
    validate_value_safe_integers(&value)
}

pub(super) fn validate_value_safe_integers(value: &Value) -> Result<(), RejectionReasonV1> {
    match value {
        Value::Number(number) => {
            let is_unsafe = number
                .as_u64()
                .is_some_and(|value| value > MAX_SAFE_INTEGER)
                || number
                    .as_i64()
                    .is_some_and(|value| value.unsigned_abs() > MAX_SAFE_INTEGER);
            if is_unsafe {
                Err(RejectionReasonV1::LimitExceeded)
            } else {
                Ok(())
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_value_safe_integers(value)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_value_safe_integers(value)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

pub(super) fn from_value<T: DeserializeOwned>(value: &Value) -> Result<T, RejectionReasonV1> {
    serde_json::from_value(value.clone()).map_err(|_| RejectionReasonV1::InvalidShape)
}

pub(super) fn map_too_large<K: Ord>(map: &BTreeMap<K, u64>) -> bool {
    map.len() > MAX_CARDINALITY_ENTRIES
}
