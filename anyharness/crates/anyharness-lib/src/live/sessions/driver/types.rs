use crate::domains::sessions::live_config::{
    LegacyModeOption, LegacyModeState, SessionModelOption,
};
use agent_client_protocol as acp;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::live::sessions) enum NativeSessionStartupDisposition {
    CreatedFresh,
    LoadedExisting,
}

impl NativeSessionStartupDisposition {
    pub(in crate::live::sessions) fn as_str(self) -> &'static str {
        match self {
            Self::CreatedFresh => "created_fresh_native",
            Self::LoadedExisting => "loaded_existing_native",
        }
    }
}

#[derive(Debug, Clone)]
pub(in crate::live::sessions) struct NativeSessionStartupState {
    pub(in crate::live::sessions) current_mode_id: Option<String>,
    pub(in crate::live::sessions) legacy_mode_state: Option<LegacyModeState>,
    pub(in crate::live::sessions) config_options: Vec<acp::schema::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_models: Vec<SessionModelOption>,
}

impl NativeSessionStartupState {
    pub(in crate::live::sessions) fn from_new_session(
        response: &acp::schema::NewSessionResponse,
    ) -> Self {
        Self::from_session_parts(response.modes.as_ref(), response.config_options.as_deref())
    }

    pub(in crate::live::sessions) fn from_load_session(
        response: &acp::schema::LoadSessionResponse,
    ) -> Self {
        Self::from_session_parts(response.modes.as_ref(), response.config_options.as_deref())
    }

    pub(in crate::live::sessions) fn from_fork_session(
        response: &acp::schema::ForkSessionResponse,
    ) -> Self {
        Self::from_session_parts(response.modes.as_ref(), response.config_options.as_deref())
    }

    fn from_session_parts(
        modes: Option<&acp::schema::SessionModeState>,
        config_options: Option<&[acp::schema::SessionConfigOption]>,
    ) -> Self {
        let config_options = config_options.map(<[_]>::to_vec).unwrap_or_default();
        // ACP 0.14 dropped the dedicated `models` block from session
        // responses; model truth now rides the `model` config option
        // (category Model or id == "model"). Extract it so the startup
        // pipeline and live-config snapshot keep reporting live model state.
        let (current_model_id, available_models) = model_state_from_config_options(&config_options);
        Self {
            current_mode_id: modes.map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: modes.map(into_legacy_mode_state),
            config_options,
            current_model_id,
            available_models,
        }
    }
}

/// Extracts (current model id, available models) from a `model` config
/// option, when the harness reports models that way. Mirrors the catalog
/// probe's proven extraction.
fn model_state_from_config_options(
    config_options: &[acp::schema::SessionConfigOption],
) -> (Option<String>, Vec<SessionModelOption>) {
    let Some(option) = config_options.iter().find(|option| {
        matches!(
            option.category,
            Some(acp::schema::SessionConfigOptionCategory::Model)
        ) || option.id.to_string() == "model"
    }) else {
        return (None, Vec::new());
    };
    #[allow(unreachable_patterns)]
    let select = match &option.kind {
        acp::schema::SessionConfigKind::Select(select) => select,
        _ => return (None, Vec::new()),
    };
    let into_model = |value: &acp::schema::SessionConfigSelectOption| SessionModelOption {
        id: value.value.to_string(),
        name: value.name.clone(),
        description: value.description.clone(),
    };
    #[allow(unreachable_patterns)]
    let available_models: Vec<SessionModelOption> = match &select.options {
        acp::schema::SessionConfigSelectOptions::Ungrouped(values) => {
            values.iter().map(into_model).collect()
        }
        acp::schema::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| group.options.iter())
            .map(into_model)
            .collect(),
        _ => Vec::new(),
    };
    (Some(select.current_value.to_string()), available_models)
}

fn into_legacy_mode_state(modes: &acp::schema::SessionModeState) -> LegacyModeState {
    LegacyModeState {
        current_mode_id: modes.current_mode_id.to_string(),
        available_modes: modes
            .available_modes
            .iter()
            .map(|mode| LegacyModeOption {
                id: mode.id.to_string(),
                name: mode.name.clone(),
                description: mode.description.clone(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn select_option(
        id: &str,
        category: Option<acp::schema::SessionConfigOptionCategory>,
        values: Vec<(&str, &str)>,
        current: &str,
    ) -> acp::schema::SessionConfigOption {
        let select = acp::schema::SessionConfigSelect::new(
            current.to_string(),
            acp::schema::SessionConfigSelectOptions::Ungrouped(
                values
                    .into_iter()
                    .map(|(value, name)| {
                        acp::schema::SessionConfigSelectOption::new(
                            value.to_string(),
                            name.to_string(),
                        )
                    })
                    .collect(),
            ),
        );
        let mut option = acp::schema::SessionConfigOption::new(
            id.to_string(),
            id.to_string(),
            acp::schema::SessionConfigKind::Select(select),
        );
        option.category = category;
        option
    }

    #[test]
    fn model_state_extracted_from_model_config_option() {
        let options = vec![select_option(
            "model",
            Some(acp::schema::SessionConfigOptionCategory::Model),
            vec![("opus", "Opus"), ("sonnet", "Sonnet")],
            "opus",
        )];
        let (current, available) = model_state_from_config_options(&options);
        assert_eq!(current.as_deref(), Some("opus"));
        assert_eq!(
            available
                .iter()
                .map(|model| (model.id.as_str(), model.name.as_str()))
                .collect::<Vec<_>>(),
            vec![("opus", "Opus"), ("sonnet", "Sonnet")],
        );
    }

    #[test]
    fn model_state_matches_by_id_without_category() {
        let options = vec![select_option("model", None, vec![("a", "A")], "a")];
        let (current, available) = model_state_from_config_options(&options);
        assert_eq!(current.as_deref(), Some("a"));
        assert_eq!(available.len(), 1);
    }

    #[test]
    fn model_state_absent_without_model_option() {
        let options = vec![select_option("reasoning", None, vec![("hi", "High")], "hi")];
        let (current, available) = model_state_from_config_options(&options);
        assert!(current.is_none());
        assert!(available.is_empty());
    }
}
