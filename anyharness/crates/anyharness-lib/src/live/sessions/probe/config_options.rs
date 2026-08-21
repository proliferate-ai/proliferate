use std::time::Duration;

use agent_client_protocol as acp;

pub(super) type ModelEntry = (String, String, Option<String>);

fn model_option(
    config_options: &[acp::schema::SessionConfigOption],
) -> Option<&acp::schema::SessionConfigOption> {
    config_options.iter().find(|option| {
        matches!(
            option.category,
            Some(acp::schema::SessionConfigOptionCategory::Model)
        ) || option.id.to_string() == "model"
    })
}

pub(super) fn current_model_from_config_options(
    config_options: &[acp::schema::SessionConfigOption],
) -> Option<String> {
    match &model_option(config_options)?.kind {
        acp::schema::SessionConfigKind::Select(select) => Some(select.current_value.to_string()),
        _ => None,
    }
}

pub(super) fn model_switch_confirmed(
    config_options: &[acp::schema::SessionConfigOption],
    requested_model_id: &str,
) -> bool {
    current_model_from_config_options(config_options).as_deref() == Some(requested_model_id)
}

pub(super) async fn switch_model_and_capture_options(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    config_id: &str,
    model_id: &str,
    timeout: Duration,
    warnings: &mut Vec<String>,
) -> anyhow::Result<Option<serde_json::Value>> {
    let switched = tokio::time::timeout(
        timeout,
        conn.send_request(acp::schema::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            config_id.to_string(),
            acp::schema::SessionConfigValueId::new(model_id.to_string()),
        ))
        .block_task(),
    )
    .await;
    match switched {
        Ok(Ok(response)) if model_switch_confirmed(&response.config_options, model_id) => Ok(Some(
            elide_model_values(serde_json::to_value(&response.config_options)?),
        )),
        Ok(Ok(_)) => {
            warnings.push(format!(
                "set_session_config_option({config_id}={model_id}) returned no matching model readback"
            ));
            Ok(None)
        }
        Ok(Err(error)) => {
            warnings.push(format!(
                "set_session_config_option({config_id}={model_id}) failed: {error}"
            ));
            Ok(None)
        }
        Err(_) => {
            warnings.push(format!(
                "set_session_config_option({config_id}={model_id}) timed out"
            ));
            Ok(None)
        }
    }
}

/// Per-model captures repeat the self-referential `model` select with the full
/// model list. Elide those values while retaining the current-value read-back.
fn elide_model_values(mut config_options: serde_json::Value) -> serde_json::Value {
    if let Some(options) = config_options.as_array_mut() {
        for option in options {
            let is_model = option.get("id").and_then(|value| value.as_str()) == Some("model")
                || option.get("category").and_then(|value| value.as_str()) == Some("model");
            if is_model {
                if let Some(object) = option.as_object_mut() {
                    object.insert("options".to_string(), serde_json::Value::Array(Vec::new()));
                    object.insert("valuesElided".to_string(), serde_json::Value::Bool(true));
                }
            }
        }
    }
    config_options
}

/// Extract (config_id, [(model_id, name, description)]) from a `model`
/// config option, when the harness reports models that way.
pub(super) fn model_entries_from_config_options(
    config_options: &[acp::schema::SessionConfigOption],
) -> Option<(String, Vec<ModelEntry>)> {
    let option = model_option(config_options)?;
    #[allow(unreachable_patterns)]
    let select = match &option.kind {
        acp::schema::SessionConfigKind::Select(select) => select,
        _ => return None,
    };
    let entries = match &select.options {
        acp::schema::SessionConfigSelectOptions::Ungrouped(values) => values
            .iter()
            .map(|value| {
                (
                    value.value.to_string(),
                    value.name.clone(),
                    value.description.clone(),
                )
            })
            .collect(),
        acp::schema::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| group.options.iter())
            .map(|value| {
                (
                    value.value.to_string(),
                    value.name.clone(),
                    value.description.clone(),
                )
            })
            .collect(),
        _ => return None,
    };
    Some((option.id.to_string(), entries))
}

#[cfg(test)]
mod tests {
    use agent_client_protocol as acp;

    use super::model_switch_confirmed;

    #[test]
    fn model_switch_requires_exact_returned_current_value() {
        let mut option = acp::schema::SessionConfigOption::select(
            "model",
            "Model",
            "opus",
            vec![
                acp::schema::SessionConfigSelectOption::new("opus", "Opus"),
                acp::schema::SessionConfigSelectOption::new("fable", "Fable"),
            ],
        );
        option.category = Some(acp::schema::SessionConfigOptionCategory::Model);

        assert!(model_switch_confirmed(
            std::slice::from_ref(&option),
            "opus"
        ));
        assert!(!model_switch_confirmed(&[option], "fable"));
    }
}
