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
