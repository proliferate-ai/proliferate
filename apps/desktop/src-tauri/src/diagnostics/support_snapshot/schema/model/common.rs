//! Shared primitive model pieces: the bounded owned JSON value and the
//! aggregated omission/truncation entries.

use serde::de::Error as DeError;
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::super::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportTruncationReasonV1,
};
use super::super::validate::{self, SupportSchemaError};

/// Owned, pre-validated JSON value: only null, boolean, JS-safe integer,
/// finite number, bounded string, bounded array, or bounded ordered own-key
/// object — never an unvalidated `serde_json::Value` or object reference.
#[derive(Debug, Clone, PartialEq)]
pub enum SupportJsonValueV1 {
    Null,
    Bool(bool),
    Integer(i64),
    Number(f64),
    String(String),
    Array(Vec<SupportJsonValueV1>),
    /// Own-key entries in strict Unicode-scalar order, which is the
    /// deterministic serialization order.
    Object(Vec<(String, SupportJsonValueV1)>),
}

impl SupportJsonValueV1 {
    /// Validate an arbitrary parsed JSON value into the bounded owned form.
    pub fn try_from_json(value: &serde_json::Value) -> Result<Self, SupportSchemaError> {
        Self::convert(value, 0)
    }

    fn convert(value: &serde_json::Value, depth: usize) -> Result<Self, SupportSchemaError> {
        validate::validate_nesting_depth(depth)?;
        match value {
            serde_json::Value::Null => Ok(Self::Null),
            serde_json::Value::Bool(flag) => Ok(Self::Bool(*flag)),
            serde_json::Value::Number(number) => {
                if let Some(integer) = number.as_i64() {
                    validate::validate_safe_i64(integer)?;
                    Ok(Self::Integer(integer))
                } else if let Some(integer) = number.as_u64() {
                    validate::validate_safe_u64(integer)?;
                    Ok(Self::Integer(integer as i64))
                } else {
                    let float = number.as_f64().ok_or(SupportSchemaError::UnsafeInteger)?;
                    validate::validate_support_number(float)?;
                    Ok(Self::Number(float))
                }
            }
            serde_json::Value::String(text) => {
                validate::validate_content_string(text)?;
                Ok(Self::String(text.clone()))
            }
            serde_json::Value::Array(items) => {
                validate::validate_container_items(items.len())?;
                let mut converted = Vec::with_capacity(items.len());
                for item in items {
                    converted.push(Self::convert(item, depth + 1)?);
                }
                Ok(Self::Array(converted))
            }
            serde_json::Value::Object(entries) => {
                validate::validate_container_items(entries.len())?;
                let mut converted = Vec::with_capacity(entries.len());
                for (key, entry) in entries {
                    validate::validate_generic_string(key)?;
                    converted.push((key.clone(), Self::convert(entry, depth + 1)?));
                }
                converted.sort_by(|left, right| left.0.chars().cmp(right.0.chars()));
                Ok(Self::Object(converted))
            }
        }
    }
}

impl Serialize for SupportJsonValueV1 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(flag) => serializer.serialize_bool(*flag),
            Self::Integer(integer) => serializer.serialize_i64(*integer),
            Self::Number(float) => serializer.serialize_f64(*float),
            Self::String(text) => serializer.serialize_str(text),
            Self::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Self::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, entry) in entries {
                    map.serialize_entry(key, entry)?;
                }
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for SupportJsonValueV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        Self::try_from_json(&raw).map_err(D::Error::custom)
    }
}

/// One aggregated omission entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportOmissionV1 {
    pub source: SupportEvidenceSourceV1,
    pub reason: SupportOmissionReasonV1,
    pub count: u64,
    pub known_bytes: Option<u64>,
}

/// One aggregated truncation entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportTruncationV1 {
    pub source: SupportEvidenceSourceV1,
    pub reason: SupportTruncationReasonV1,
    pub count: u64,
    pub omitted_bytes: Option<u64>,
}
