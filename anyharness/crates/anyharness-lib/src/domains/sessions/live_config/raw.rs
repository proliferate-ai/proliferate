use agent_client_protocol as acp;
use anyharness_contract::v1::{
    RawSessionConfigOption, RawSessionConfigValue, SessionConfigOptionType,
};

pub(super) fn into_raw_option(option: &acp::SessionConfigOption) -> Option<RawSessionConfigOption> {
    let acp::SessionConfigKind::Select(select) = &option.kind else {
        return None;
    };

    Some(RawSessionConfigOption {
        id: option.id.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: option.category.as_ref().map(category_to_string),
        option_type: SessionConfigOptionType::Select,
        current_value: select.current_value.to_string(),
        options: flatten_select_options(&select.options),
    })
}

fn flatten_select_options(options: &acp::SessionConfigSelectOptions) -> Vec<RawSessionConfigValue> {
    match options {
        acp::SessionConfigSelectOptions::Ungrouped(options) => {
            options.iter().map(into_raw_value).collect()
        }
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| group.options.iter().map(into_raw_value))
            .collect(),
        _ => Vec::new(),
    }
}

fn into_raw_value(option: &acp::SessionConfigSelectOption) -> RawSessionConfigValue {
    RawSessionConfigValue {
        value: option.value.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
    }
}

fn category_to_string(category: &acp::SessionConfigOptionCategory) -> String {
    match category {
        acp::SessionConfigOptionCategory::Mode => "mode".to_string(),
        acp::SessionConfigOptionCategory::Model => "model".to_string(),
        acp::SessionConfigOptionCategory::ThoughtLevel => "thought_level".to_string(),
        acp::SessionConfigOptionCategory::Other(other) => other.clone(),
        _ => "unknown".to_string(),
    }
}
