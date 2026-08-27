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

    /// Some harnesses (Grok) advertise their model menu only on the
    /// initialize response's vendor `_meta.modelState`, never as a `model`
    /// config option. When the session response carried no model control,
    /// adopt that enumeration so the start path can admit the requested
    /// model and the live-config snapshot can present the menu. A model
    /// control the session response DID carry stays authoritative.
    pub(in crate::live::sessions) fn absorb_init_meta_model_state(
        &mut self,
        init_meta: Option<&acp::schema::Meta>,
    ) {
        if self.current_model_id.is_some() || !self.available_models.is_empty() {
            return;
        }
        let Some(model_state) = init_meta.and_then(|meta| meta.get("modelState")) else {
            return;
        };
        let (current_model_id, available_models) = model_state_from_init_meta(model_state);
        if available_models.is_empty() {
            return;
        }
        self.current_model_id = current_model_id;
        self.available_models = available_models;
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

/// Parses a vendor `initialize._meta.modelState` block
/// (`{ currentModelId, availableModels: [{ modelId, name, description }] }`)
/// into (current model id, available models). Entries without a `modelId`
/// are skipped; `name` falls back to the id. Shared by the live start path
/// and the catalog probe so both read the same enumeration.
pub(in crate::live::sessions) fn model_state_from_init_meta(
    model_state: &serde_json::Value,
) -> (Option<String>, Vec<SessionModelOption>) {
    let current_model_id = model_state
        .get("currentModelId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let available_models = model_state
        .get("availableModels")
        .and_then(|value| value.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|model| {
                    let id = model.get("modelId").and_then(|value| value.as_str())?;
                    Some(SessionModelOption {
                        id: id.to_string(),
                        name: model
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or(id)
                            .to_string(),
                        description: model
                            .get("description")
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    (current_model_id, available_models)
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

    fn grok_init_meta() -> acp::schema::Meta {
        serde_json::json!({
            "modelState": {
                "currentModelId": "grok-4.6",
                "availableModels": [
                    { "modelId": "grok-4.6", "name": "Grok 4.6", "description": "latest" },
                    { "modelId": "grok-4.5" },
                    { "name": "no id" }
                ]
            }
        })
        .as_object()
        .expect("meta object")
        .clone()
    }

    #[test]
    fn init_meta_model_state_maps_id_name_and_description() {
        let meta = grok_init_meta();
        let (current, available) = model_state_from_init_meta(&meta["modelState"]);
        assert_eq!(current.as_deref(), Some("grok-4.6"));
        assert_eq!(
            available,
            vec![
                SessionModelOption {
                    id: "grok-4.6".to_string(),
                    name: "Grok 4.6".to_string(),
                    description: Some("latest".to_string()),
                },
                SessionModelOption {
                    id: "grok-4.5".to_string(),
                    name: "grok-4.5".to_string(),
                    description: None,
                },
            ]
        );
    }

    #[test]
    fn init_meta_model_state_without_usable_models_is_empty() {
        for state in [
            serde_json::json!({}),
            serde_json::json!({ "availableModels": [] }),
            serde_json::json!({ "availableModels": [{ "name": "x" }] }),
        ] {
            let (_, available) = model_state_from_init_meta(&state);
            assert!(available.is_empty());
        }
    }

    #[test]
    fn startup_state_adopts_init_meta_models_only_without_session_model_control() {
        // Grok: session/new carries no config options; the init meta menu is
        // the only live model statement.
        let mut grok = NativeSessionStartupState::from_session_parts(None, None);
        grok.absorb_init_meta_model_state(Some(&grok_init_meta()));
        assert_eq!(grok.current_model_id.as_deref(), Some("grok-4.6"));
        assert_eq!(
            grok.available_models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["grok-4.6", "grok-4.5"]
        );

        // A session-carried model control stays authoritative over init meta.
        let options = vec![select_option(
            "model",
            Some(acp::schema::SessionConfigOptionCategory::Model),
            vec![("opus", "Opus")],
            "opus",
        )];
        let mut with_control = NativeSessionStartupState::from_session_parts(None, Some(&options));
        with_control.absorb_init_meta_model_state(Some(&grok_init_meta()));
        assert_eq!(with_control.current_model_id.as_deref(), Some("opus"));
        assert_eq!(with_control.available_models.len(), 1);

        // No meta, or meta without a usable menu, leaves the state untouched.
        let mut none = NativeSessionStartupState::from_session_parts(None, None);
        none.absorb_init_meta_model_state(None);
        let empty_meta = serde_json::json!({ "modelState": { "currentModelId": "x" } })
            .as_object()
            .expect("meta object")
            .clone();
        none.absorb_init_meta_model_state(Some(&empty_meta));
        assert!(none.current_model_id.is_none());
        assert!(none.available_models.is_empty());
    }
}
