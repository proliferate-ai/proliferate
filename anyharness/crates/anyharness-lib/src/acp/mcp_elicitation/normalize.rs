use std::collections::{BTreeMap, HashSet};

use anyharness_contract::v1::{
    McpElicitationBooleanField, McpElicitationField, McpElicitationFieldBase,
    McpElicitationFormPayload, McpElicitationInteractionPayload, McpElicitationMode,
    McpElicitationMultiSelectField, McpElicitationNumberField, McpElicitationOption,
    McpElicitationSelectField, McpElicitationTextField, McpElicitationTextFormat,
    McpElicitationUrlPayload,
};
use serde_json::{Map, Value};

use super::{
    first_non_empty, safe_url_display, McpElicitationValidationError, NormalizedMcpElicitation,
    StoredMcpElicitation, StoredMcpElicitationMode, StoredMcpField, StoredMcpFieldKind,
    StoredMcpOption,
};

pub(super) fn normalize_form(
    server_name: String,
    message: String,
    requested_schema: Value,
) -> Result<NormalizedMcpElicitation, McpElicitationValidationError> {
    let schema = requested_schema
        .as_object()
        .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
    reject_combinators(schema)?;
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err(McpElicitationValidationError::UnsupportedSchema);
    }
    if schema
        .get("additionalProperties")
        .is_some_and(|value| value != &Value::Bool(false))
    {
        return Err(McpElicitationValidationError::UnsupportedSchema);
    }

    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    let sorted_properties = properties.iter().collect::<BTreeMap<_, _>>();
    let mut public_fields = Vec::with_capacity(sorted_properties.len());
    let mut stored_fields = Vec::with_capacity(sorted_properties.len());

    for (index, (raw_name, raw_schema)) in sorted_properties.into_iter().enumerate() {
        let field_id = format!("field_{}", index + 1);
        let required = required.contains(raw_name.as_str());
        let (public_field, stored_field) =
            normalize_field(field_id, index, raw_name, raw_schema, required)?;
        public_fields.push(public_field);
        stored_fields.push(stored_field);
    }

    let title = first_non_empty(&message)
        .unwrap_or("MCP input requested")
        .to_string();
    let payload = McpElicitationInteractionPayload {
        server_name,
        mode: McpElicitationMode::Form(McpElicitationFormPayload {
            message,
            fields: public_fields,
        }),
    };

    Ok(NormalizedMcpElicitation {
        title,
        description: None,
        payload,
        pending: StoredMcpElicitation {
            mode: StoredMcpElicitationMode::Form {
                fields: stored_fields,
            },
        },
    })
}

pub(super) fn normalize_url(
    server_name: String,
    message: String,
    url: String,
) -> NormalizedMcpElicitation {
    let url_display = safe_url_display(&url);
    let title = first_non_empty(&message)
        .unwrap_or("MCP action requested")
        .to_string();
    let payload = McpElicitationInteractionPayload {
        server_name,
        mode: McpElicitationMode::Url(McpElicitationUrlPayload {
            message,
            url_display,
            requires_reveal: true,
        }),
    };

    NormalizedMcpElicitation {
        title,
        description: None,
        payload,
        pending: StoredMcpElicitation {
            mode: StoredMcpElicitationMode::Url { url },
        },
    }
}

fn normalize_field(
    field_id: String,
    field_index: usize,
    raw_name: &str,
    schema: &Value,
    required: bool,
) -> Result<(McpElicitationField, StoredMcpField), McpElicitationValidationError> {
    let schema = schema
        .as_object()
        .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
    reject_disallowed_field_shape(schema)?;

    let base = field_base(&field_id, field_index, schema, required);

    if let Some((public_options, stored_options)) = select_options(&field_id, schema)? {
        return Ok((
            McpElicitationField::SingleSelect(McpElicitationSelectField {
                base,
                options: public_options,
            }),
            StoredMcpField {
                field_id,
                raw_name: raw_name.to_string(),
                required,
                kind: StoredMcpFieldKind::SingleSelect {
                    options: stored_options,
                },
            },
        ));
    }

    if schema.get("type").and_then(Value::as_str) == Some("array") {
        let items = schema
            .get("items")
            .and_then(Value::as_object)
            .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
        let (public_options, stored_options) = select_options(&field_id, items)?
            .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
        let min_items = schema.get("minItems").and_then(Value::as_u64);
        let max_items = schema.get("maxItems").and_then(Value::as_u64);
        return Ok((
            McpElicitationField::MultiSelect(McpElicitationMultiSelectField {
                base,
                options: public_options,
                min_items,
                max_items,
            }),
            StoredMcpField {
                field_id,
                raw_name: raw_name.to_string(),
                required,
                kind: StoredMcpFieldKind::MultiSelect {
                    options: stored_options,
                    min_items,
                    max_items,
                },
            },
        ));
    }

    match schema.get("type").and_then(Value::as_str) {
        Some("string") => {
            let min_length = schema
                .get("minLength")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            let max_length = schema
                .get("maxLength")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            let format = schema
                .get("format")
                .and_then(Value::as_str)
                .and_then(text_format);
            Ok((
                McpElicitationField::Text(McpElicitationTextField {
                    base,
                    format,
                    min_length,
                    max_length,
                }),
                StoredMcpField {
                    field_id,
                    raw_name: raw_name.to_string(),
                    required,
                    kind: StoredMcpFieldKind::String {
                        min_length,
                        max_length,
                    },
                },
            ))
        }
        Some("integer") => {
            let minimum = schema.get("minimum").and_then(Value::as_i64);
            let maximum = schema.get("maximum").and_then(Value::as_i64);
            Ok((
                McpElicitationField::Number(McpElicitationNumberField {
                    base,
                    integer: true,
                    minimum: minimum.map(|value| value.to_string()),
                    maximum: maximum.map(|value| value.to_string()),
                }),
                StoredMcpField {
                    field_id,
                    raw_name: raw_name.to_string(),
                    required,
                    kind: StoredMcpFieldKind::Integer { minimum, maximum },
                },
            ))
        }
        Some("number") => {
            let minimum = schema.get("minimum").and_then(Value::as_f64);
            let maximum = schema.get("maximum").and_then(Value::as_f64);
            if minimum.is_some_and(|value| !value.is_finite())
                || maximum.is_some_and(|value| !value.is_finite())
            {
                return Err(McpElicitationValidationError::UnsupportedSchema);
            }
            Ok((
                McpElicitationField::Number(McpElicitationNumberField {
                    base,
                    integer: false,
                    minimum: minimum.map(|value| value.to_string()),
                    maximum: maximum.map(|value| value.to_string()),
                }),
                StoredMcpField {
                    field_id,
                    raw_name: raw_name.to_string(),
                    required,
                    kind: StoredMcpFieldKind::Number { minimum, maximum },
                },
            ))
        }
        Some("boolean") => Ok((
            McpElicitationField::Boolean(McpElicitationBooleanField { base }),
            StoredMcpField {
                field_id,
                raw_name: raw_name.to_string(),
                required,
                kind: StoredMcpFieldKind::Boolean,
            },
        )),
        _ => Err(McpElicitationValidationError::UnsupportedSchema),
    }
}

fn field_base(
    field_id: &str,
    field_index: usize,
    schema: &Map<String, Value>,
    required: bool,
) -> McpElicitationFieldBase {
    McpElicitationFieldBase {
        field_id: field_id.to_string(),
        label: schema
            .get("title")
            .and_then(Value::as_str)
            .and_then(first_non_empty)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Field {}", field_index + 1)),
        description: schema
            .get("description")
            .and_then(Value::as_str)
            .and_then(first_non_empty)
            .map(str::to_string),
        required,
    }
}

fn select_options(
    field_id: &str,
    schema: &Map<String, Value>,
) -> Result<Option<(Vec<McpElicitationOption>, Vec<StoredMcpOption>)>, McpElicitationValidationError>
{
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        let labels = schema.get("enumNames").and_then(Value::as_array);
        return Ok(Some(options_from_values(field_id, values, labels)?));
    }

    if let Some(values) = schema
        .get("oneOf")
        .or_else(|| schema.get("anyOf"))
        .and_then(Value::as_array)
    {
        let mut public_options = Vec::with_capacity(values.len());
        let mut stored_options = Vec::with_capacity(values.len());
        for (index, value) in values.iter().enumerate() {
            let Some(option) = value.as_object() else {
                return Err(McpElicitationValidationError::UnsupportedSchema);
            };
            let raw_value = option
                .get("const")
                .and_then(Value::as_str)
                .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
            let option_id = format!("{field_id}_option_{}", index + 1);
            let label = option
                .get("title")
                .and_then(Value::as_str)
                .and_then(first_non_empty)
                .map(str::to_string)
                .unwrap_or_else(|| format!("Option {}", index + 1));
            public_options.push(McpElicitationOption {
                option_id: option_id.clone(),
                label,
            });
            stored_options.push(StoredMcpOption {
                option_id,
                raw_value: raw_value.to_string(),
            });
        }
        return Ok(Some((public_options, stored_options)));
    }

    Ok(None)
}

fn options_from_values(
    field_id: &str,
    values: &[Value],
    labels: Option<&Vec<Value>>,
) -> Result<(Vec<McpElicitationOption>, Vec<StoredMcpOption>), McpElicitationValidationError> {
    let mut public_options = Vec::with_capacity(values.len());
    let mut stored_options = Vec::with_capacity(values.len());

    for (index, value) in values.iter().enumerate() {
        let raw_value = value
            .as_str()
            .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
        let option_id = format!("{field_id}_option_{}", index + 1);
        let label = labels
            .and_then(|labels| labels.get(index))
            .and_then(Value::as_str)
            .and_then(first_non_empty)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Option {}", index + 1));
        public_options.push(McpElicitationOption {
            option_id: option_id.clone(),
            label,
        });
        stored_options.push(StoredMcpOption {
            option_id,
            raw_value: raw_value.to_string(),
        });
    }

    Ok((public_options, stored_options))
}

fn reject_combinators(schema: &Map<String, Value>) -> Result<(), McpElicitationValidationError> {
    if schema.contains_key("oneOf") || schema.contains_key("anyOf") || schema.contains_key("allOf")
    {
        return Err(McpElicitationValidationError::UnsupportedSchema);
    }
    Ok(())
}

fn reject_disallowed_field_shape(
    schema: &Map<String, Value>,
) -> Result<(), McpElicitationValidationError> {
    if schema.contains_key("allOf") {
        return Err(McpElicitationValidationError::UnsupportedSchema);
    }
    if schema
        .get("additionalProperties")
        .is_some_and(|value| value != &Value::Bool(false))
    {
        return Err(McpElicitationValidationError::UnsupportedSchema);
    }
    Ok(())
}

fn text_format(value: &str) -> Option<McpElicitationTextFormat> {
    match value {
        "email" => Some(McpElicitationTextFormat::Email),
        "uri" => Some(McpElicitationTextFormat::Uri),
        "date" => Some(McpElicitationTextFormat::Date),
        "date-time" => Some(McpElicitationTextFormat::DateTime),
        _ => None,
    }
}
