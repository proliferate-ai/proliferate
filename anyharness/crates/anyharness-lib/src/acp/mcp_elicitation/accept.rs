use std::collections::{HashMap, HashSet};

use anyharness_contract::v1::{McpElicitationSubmittedField, McpElicitationSubmittedValue};
use serde_json::{Map, Number, Value};

use super::{
    McpElicitationOutcome, McpElicitationValidationError, StoredMcpField, StoredMcpFieldKind,
};

pub(super) fn accept_form(
    fields: &[StoredMcpField],
    submitted_fields: Vec<McpElicitationSubmittedField>,
) -> Result<McpElicitationOutcome, McpElicitationValidationError> {
    let field_by_id = fields
        .iter()
        .map(|field| (field.field_id.as_str(), field))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    let mut content = Map::new();
    let mut accepted_field_ids = Vec::new();

    for submitted in submitted_fields {
        if !seen.insert(submitted.field_id.clone()) {
            return Err(McpElicitationValidationError::DuplicateField);
        }
        let stored = field_by_id
            .get(submitted.field_id.as_str())
            .ok_or(McpElicitationValidationError::InvalidFieldId)?;
        let Some(value) = value_for_field(stored, submitted.value)? else {
            continue;
        };
        accepted_field_ids.push(stored.field_id.clone());
        content.insert(stored.raw_name.clone(), value);
    }

    for field in fields {
        if field.required && !seen.contains(&field.field_id) {
            return Err(McpElicitationValidationError::MissingRequiredField);
        }
    }

    Ok(McpElicitationOutcome::Accepted {
        accepted_field_ids,
        content: Some(Value::Object(content)),
    })
}

fn value_for_field(
    field: &StoredMcpField,
    submitted: McpElicitationSubmittedValue,
) -> Result<Option<Value>, McpElicitationValidationError> {
    match (&field.kind, submitted) {
        (
            StoredMcpFieldKind::String {
                min_length,
                max_length,
            },
            McpElicitationSubmittedValue::String { value },
        ) => {
            if value.is_empty() && !field.required {
                return Ok(None);
            }
            let len = value.chars().count();
            if value.is_empty()
                || min_length.is_some_and(|min| len < min as usize)
                || max_length.is_some_and(|max| len > max as usize)
            {
                return Err(McpElicitationValidationError::InvalidValue);
            }
            Ok(Some(Value::String(value)))
        }
        (
            StoredMcpFieldKind::Integer { minimum, maximum },
            McpElicitationSubmittedValue::Integer { value },
        ) => {
            if minimum.is_some_and(|min| value < min) || maximum.is_some_and(|max| value > max) {
                return Err(McpElicitationValidationError::InvalidValue);
            }
            Ok(Some(Value::Number(Number::from(value))))
        }
        (
            StoredMcpFieldKind::Number { minimum, maximum },
            McpElicitationSubmittedValue::Number { value },
        ) => {
            if !value.is_finite()
                || minimum.is_some_and(|min| value < min)
                || maximum.is_some_and(|max| value > max)
            {
                return Err(McpElicitationValidationError::InvalidValue);
            }
            Number::from_f64(value)
                .map(Value::Number)
                .map(Some)
                .ok_or(McpElicitationValidationError::InvalidValue)
        }
        (StoredMcpFieldKind::Boolean, McpElicitationSubmittedValue::Boolean { value }) => {
            Ok(Some(Value::Bool(value)))
        }
        (
            StoredMcpFieldKind::SingleSelect { options },
            McpElicitationSubmittedValue::Option { option_id },
        ) => options
            .iter()
            .find(|option| option.option_id == option_id)
            .map(|option| Some(Value::String(option.raw_value.clone())))
            .ok_or(McpElicitationValidationError::InvalidValue),
        (
            StoredMcpFieldKind::MultiSelect {
                options,
                min_items,
                max_items,
            },
            McpElicitationSubmittedValue::OptionArray { option_ids },
        ) => {
            if min_items.is_some_and(|min| option_ids.len() < min as usize)
                || max_items.is_some_and(|max| option_ids.len() > max as usize)
            {
                return Err(McpElicitationValidationError::InvalidValue);
            }
            let mut seen_option_ids = HashSet::with_capacity(option_ids.len());
            let mut values = Vec::with_capacity(option_ids.len());
            for option_id in &option_ids {
                if !seen_option_ids.insert(option_id.as_str()) {
                    return Err(McpElicitationValidationError::InvalidValue);
                }
                let option = options
                    .iter()
                    .find(|option| option.option_id == option_id.as_str())
                    .ok_or(McpElicitationValidationError::InvalidValue)?;
                values.push(Value::String(option.raw_value.clone()));
            }
            Ok(Some(Value::Array(values)))
        }
        _ => Err(McpElicitationValidationError::InvalidValue),
    }
}
