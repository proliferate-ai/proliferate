//! Recursive projected-JSON validation and accounting.

use super::super::model::common::SupportJsonValueV1;
use super::{
    validate_container_items, validate_content_string, validate_generic_string,
    validate_nesting_depth, validate_safe_i64, SupportSchemaError,
};

pub(super) fn validate_support_json_value_at(
    value: &SupportJsonValueV1,
    depth: usize,
) -> Result<(), SupportSchemaError> {
    validate_nesting_depth(depth)?;
    match value {
        SupportJsonValueV1::Null | SupportJsonValueV1::Bool(_) => Ok(()),
        SupportJsonValueV1::Integer(value) => validate_safe_i64(*value),
        SupportJsonValueV1::Number(value) => super::validate_support_number(*value),
        SupportJsonValueV1::String(value) => validate_content_string(value),
        SupportJsonValueV1::Array(values) => {
            validate_container_items(values.len())?;
            for value in values {
                validate_support_json_value_at(value, depth + 1)?;
            }
            Ok(())
        }
        SupportJsonValueV1::Object(values) => {
            validate_container_items(values.len())?;
            let mut prior_key = None;
            for (key, value) in values {
                validate_generic_string(key)?;
                if prior_key.is_some_and(|prior: &str| key.chars().cmp(prior.chars()).is_le()) {
                    return Err(SupportSchemaError::InvariantViolation(
                        "projected object key order/uniqueness",
                    ));
                }
                prior_key = Some(key.as_str());
                validate_support_json_value_at(value, depth + 1)?;
            }
            Ok(())
        }
    }
}

pub(super) fn count_json_values(value: &SupportJsonValueV1) -> usize {
    match value {
        SupportJsonValueV1::Array(values) => {
            1 + values.iter().map(count_json_values).sum::<usize>()
        }
        SupportJsonValueV1::Object(values) => {
            1 + values
                .iter()
                .map(|(_, value)| count_json_values(value))
                .sum::<usize>()
        }
        _ => 1,
    }
}
