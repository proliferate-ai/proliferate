use agent_client_protocol as acp;

use crate::domains::sessions::live_config::controls::option_matches_key;
use crate::domains::sessions::live_config::{
    normalized_key_rank, NormalizedControlKind, ACP_MODEL_COMPAT_CONFIG_ID,
    LEGACY_MODE_COMPAT_CONFIG_ID,
};
use crate::live::sessions::actor::config::types::ConfigPurpose;
use crate::live::sessions::actor::state::SessionStartupState;
pub(in crate::live::sessions::actor) fn pending_config_rank(
    startup_state: &SessionStartupState,
    config_id: &str,
) -> usize {
    let kind = startup_state
        .config_options
        .iter()
        .find(|option| {
            option.id.to_string() == config_id
                || (config_id == "model" && option_matches_purpose(option, ConfigPurpose::Model))
                || (config_id == LEGACY_MODE_COMPAT_CONFIG_ID
                    && option_matches_purpose(option, ConfigPurpose::Mode))
        })
        .map(|option| {
            let raw = into_raw_pending_option(option);
            if option_matches_key(&raw, NormalizedControlKind::Model) {
                NormalizedControlKind::Model
            } else if option_matches_key(&raw, NormalizedControlKind::CollaborationMode) {
                NormalizedControlKind::CollaborationMode
            } else if option_matches_key(&raw, NormalizedControlKind::Mode) {
                NormalizedControlKind::Mode
            } else if option_matches_key(&raw, NormalizedControlKind::Reasoning) {
                NormalizedControlKind::Reasoning
            } else if option_matches_key(&raw, NormalizedControlKind::Effort) {
                NormalizedControlKind::Effort
            } else if option_matches_key(&raw, NormalizedControlKind::FastMode) {
                NormalizedControlKind::FastMode
            } else {
                NormalizedControlKind::Extra
            }
        })
        .unwrap_or_else(|| {
            if config_id == ACP_MODEL_COMPAT_CONFIG_ID && startup_state.has_direct_model_control() {
                NormalizedControlKind::Model
            } else if config_id == LEGACY_MODE_COMPAT_CONFIG_ID
                && startup_state.has_raw_or_legacy_mode_control()
            {
                NormalizedControlKind::Mode
            } else {
                NormalizedControlKind::Extra
            }
        });

    normalized_key_rank(kind)
}

pub(in crate::live::sessions::actor) fn into_raw_pending_option(
    option: &acp::schema::SessionConfigOption,
) -> anyharness_contract::v1::RawSessionConfigOption {
    let acp::schema::SessionConfigKind::Select(select) = &option.kind else {
        return anyharness_contract::v1::RawSessionConfigOption {
            id: option.id.to_string(),
            name: option.name.clone(),
            description: option.description.clone(),
            category: option.category.as_ref().map(|category| {
                serde_json::to_string(category)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string()
            }),
            option_type: anyharness_contract::v1::SessionConfigOptionType::Select,
            current_value: String::new(),
            options: Vec::new(),
        };
    };

    let options = match &select.options {
        acp::schema::SessionConfigSelectOptions::Ungrouped(values) => values
            .iter()
            .map(|value| anyharness_contract::v1::RawSessionConfigValue {
                value: value.value.to_string(),
                name: value.name.clone(),
                description: value.description.clone(),
            })
            .collect(),
        acp::schema::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| {
                group
                    .options
                    .iter()
                    .map(|value| anyharness_contract::v1::RawSessionConfigValue {
                        value: value.value.to_string(),
                        name: value.name.clone(),
                        description: value.description.clone(),
                    })
            })
            .collect(),
        _ => Vec::new(),
    };

    anyharness_contract::v1::RawSessionConfigOption {
        id: option.id.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: option.category.as_ref().map(|category| {
            serde_json::to_string(category)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string()
        }),
        option_type: anyharness_contract::v1::SessionConfigOptionType::Select,
        current_value: select.current_value.to_string(),
        options,
    }
}

pub(in crate::live::sessions::actor) fn find_select_option_for_value<'a>(
    config_options: &'a [acp::schema::SessionConfigOption],
    purpose: ConfigPurpose,
    desired_value: &str,
) -> Option<&'a acp::schema::SessionConfigOption> {
    config_options.iter().find(|option| {
        matches!(&option.kind, acp::schema::SessionConfigKind::Select(_))
            && option_matches_purpose(option, purpose)
            && select_option_contains_value(option, desired_value)
    })
}

pub(in crate::live::sessions::actor) fn option_matches_purpose(
    option: &acp::schema::SessionConfigOption,
    purpose: ConfigPurpose,
) -> bool {
    let raw = into_raw_pending_option(option);
    match purpose {
        ConfigPurpose::Model => option_matches_key(&raw, NormalizedControlKind::Model),
        ConfigPurpose::Mode => option_matches_key(&raw, NormalizedControlKind::Mode),
    }
}

pub(in crate::live::sessions) fn find_select_option_by_purpose<'a>(
    config_options: &'a [acp::schema::SessionConfigOption],
    purpose: ConfigPurpose,
) -> Option<&'a acp::schema::SessionConfigOption> {
    config_options.iter().find(|option| {
        matches!(&option.kind, acp::schema::SessionConfigKind::Select(_))
            && option_matches_purpose(option, purpose)
    })
}

pub(in crate::live::sessions::actor) fn find_select_option_for_request<'a>(
    config_options: &'a [acp::schema::SessionConfigOption],
    config_id: &str,
) -> Option<&'a acp::schema::SessionConfigOption> {
    config_options
        .iter()
        .find(|option| option.id.to_string() == config_id)
        .or_else(|| {
            if config_id == "model" {
                find_select_option_by_purpose(config_options, ConfigPurpose::Model)
            } else if config_id == LEGACY_MODE_COMPAT_CONFIG_ID {
                find_select_option_by_purpose(config_options, ConfigPurpose::Mode)
            } else {
                None
            }
        })
}

pub(in crate::live::sessions::actor) fn is_model_config_request(
    config_id: &str,
    option: Option<&acp::schema::SessionConfigOption>,
) -> bool {
    config_id == "model"
        || option
            .map(|option| option_matches_purpose(option, ConfigPurpose::Model))
            .unwrap_or(false)
}

pub(in crate::live::sessions::actor) fn is_mode_config_request(
    config_id: &str,
    option: Option<&acp::schema::SessionConfigOption>,
) -> bool {
    config_id == LEGACY_MODE_COMPAT_CONFIG_ID
        || option
            .map(|option| option_matches_purpose(option, ConfigPurpose::Mode))
            .unwrap_or(false)
}

pub(in crate::live::sessions::actor) fn current_select_value(
    option: &acp::schema::SessionConfigOption,
) -> Option<String> {
    match &option.kind {
        acp::schema::SessionConfigKind::Select(select) => Some(select.current_value.to_string()),
        _ => None,
    }
}

pub(in crate::live::sessions::actor) fn select_option_contains_value(
    option: &acp::schema::SessionConfigOption,
    desired_value: &str,
) -> bool {
    match &option.kind {
        acp::schema::SessionConfigKind::Select(select) => match &select.options {
            acp::schema::SessionConfigSelectOptions::Ungrouped(options) => options
                .iter()
                .any(|candidate| candidate.value.to_string() == desired_value),
            acp::schema::SessionConfigSelectOptions::Grouped(groups) => groups.iter().any(|group| {
                group
                    .options
                    .iter()
                    .any(|candidate| candidate.value.to_string() == desired_value)
            }),
            _ => false,
        },
        _ => false,
    }
}

pub(in crate::live::sessions::actor) fn select_option_values(
    option: &acp::schema::SessionConfigOption,
) -> Vec<String> {
    match &option.kind {
        acp::schema::SessionConfigKind::Select(select) => match &select.options {
            acp::schema::SessionConfigSelectOptions::Ungrouped(options) => options
                .iter()
                .map(|candidate| candidate.value.to_string())
                .collect(),
            acp::schema::SessionConfigSelectOptions::Grouped(groups) => groups
                .iter()
                .flat_map(|group| group.options.iter())
                .map(|candidate| candidate.value.to_string())
                .collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}
