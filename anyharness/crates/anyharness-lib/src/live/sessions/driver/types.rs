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
        Self::from_session_parts(
            response.modes.as_ref(),
            response.config_options.as_deref(),
            response.meta.as_ref(),
        )
    }

    pub(in crate::live::sessions) fn from_load_session(
        response: &acp::schema::LoadSessionResponse,
    ) -> Self {
        Self::from_session_parts(
            response.modes.as_ref(),
            response.config_options.as_deref(),
            response.meta.as_ref(),
        )
    }

    pub(in crate::live::sessions) fn from_fork_session(
        response: &acp::schema::ForkSessionResponse,
    ) -> Self {
        Self::from_session_parts(
            response.modes.as_ref(),
            response.config_options.as_deref(),
            response.meta.as_ref(),
        )
    }

    /// Enumeration-only fallback for a harness whose session response carried
    /// no model statement at all. `initialize._meta.modelState` is observed
    /// BEFORE `authenticate` and before any session exists, so it can name
    /// the menu but never the session's effective model: `current_model_id`
    /// stays `None`, and a requested model is established only by a setter
    /// whose readback confirms it.
    pub(in crate::live::sessions) fn absorb_init_meta_model_menu(
        &mut self,
        init_meta: Option<&acp::schema::Meta>,
    ) {
        if self.current_model_id.is_some() || !self.available_models.is_empty() {
            return;
        }
        let Some(model_state) = init_meta.and_then(|meta| meta.get("modelState")) else {
            return;
        };
        let (_, available_models) = model_state_from_init_meta(model_state);
        self.available_models = available_models;
    }

    fn from_session_parts(
        modes: Option<&acp::schema::SessionModeState>,
        config_options: Option<&[acp::schema::SessionConfigOption]>,
        meta: Option<&acp::schema::Meta>,
    ) -> Self {
        let config_options = config_options.map(<[_]>::to_vec).unwrap_or_default();
        // ACP 0.14 dropped the dedicated `models` block from session
        // responses; model truth now rides the `model` config option
        // (category Model or id == "model"). Extract it so the startup
        // pipeline and live-config snapshot keep reporting live model state.
        let (mut current_model_id, mut available_models) =
            model_state_from_config_options(&config_options);
        if current_model_id.is_none() && available_models.is_empty() {
            // Grok carries no config options; its session-scoped model
            // statement rides the response's vendor `_meta`.
            (current_model_id, available_models) = model_state_from_session_meta(meta);
        }
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

/// Vendor key under which Grok reports the session's own model and mode
/// options on `session/new` / `session/load` responses.
const GROK_SESSION_CONFIG_META_KEY: &str = "x.ai/sessionConfig";

/// Parses the session-scoped model statement a session response carries in
/// its vendor `_meta` (`"x.ai/sessionConfig": { options: [{ id, category:
/// "model", label, description, selected }] }`). This is observed AFTER
/// `authenticate` and for the exact native session, so it is authoritative
/// for both the menu and the effective model; it also tracks a later
/// `session/set_model` on `session/load`.
pub(in crate::live::sessions) fn model_state_from_session_meta(
    meta: Option<&acp::schema::Meta>,
) -> (Option<String>, Vec<SessionModelOption>) {
    let Some(options) = meta
        .and_then(|meta| meta.get(GROK_SESSION_CONFIG_META_KEY))
        .and_then(|config| config.get("options"))
        .and_then(|options| options.as_array())
    else {
        return (None, Vec::new());
    };
    let mut current_model_id = None;
    let available_models = options
        .iter()
        .filter(|option| option.get("category").and_then(|value| value.as_str()) == Some("model"))
        .filter_map(|option| {
            let id = option.get("id").and_then(|value| value.as_str())?;
            if option.get("selected").and_then(|value| value.as_bool()) == Some(true) {
                current_model_id = Some(id.to_string());
            }
            Some(SessionModelOption {
                id: id.to_string(),
                name: option
                    .get("label")
                    .and_then(|value| value.as_str())
                    .unwrap_or(id)
                    .to_string(),
                description: option
                    .get("description")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            })
        })
        .collect();
    (current_model_id, available_models)
}

/// Parses a vendor `initialize._meta.modelState` block
/// (`{ currentModelId, availableModels: [{ modelId, name, description }] }`)
/// into (current model id, available models). Entries without a `modelId`
/// are skipped; `name` falls back to the id. Shared by the catalog probe and
/// the live start path's enumeration-only fallback.
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

    fn grok_session_meta(selected: &str) -> acp::schema::Meta {
        serde_json::json!({
            "x.ai/sessionConfig": {
                "options": [
                    { "id": "grok-4.6", "category": "model", "label": "Grok 4.6",
                      "selected": selected == "grok-4.6" },
                    { "id": "grok-4.5", "category": "model", "label": "Grok 4.5",
                      "description": "prior", "selected": selected == "grok-4.5" },
                    { "id": "high", "category": "mode", "label": "High Effort", "selected": true }
                ]
            }
        })
        .as_object()
        .expect("meta object")
        .clone()
    }

    #[test]
    fn session_meta_model_state_reads_only_model_options_and_the_selected_one() {
        let (current, available) =
            model_state_from_session_meta(Some(&grok_session_meta("grok-4.5")));
        assert_eq!(current.as_deref(), Some("grok-4.5"));
        assert_eq!(
            available,
            vec![
                SessionModelOption {
                    id: "grok-4.6".to_string(),
                    name: "Grok 4.6".to_string(),
                    description: None,
                },
                SessionModelOption {
                    id: "grok-4.5".to_string(),
                    name: "Grok 4.5".to_string(),
                    description: Some("prior".to_string()),
                },
            ]
        );
        assert_eq!(model_state_from_session_meta(None), (None, Vec::new()));
        let unrelated = serde_json::json!({ "isGitRepo": false })
            .as_object()
            .expect("meta object")
            .clone();
        assert_eq!(
            model_state_from_session_meta(Some(&unrelated)),
            (None, Vec::new())
        );
    }

    #[test]
    fn startup_state_prefers_the_session_scoped_model_statement() {
        // session/load after a set_model: the session says grok-4.5 even
        // though initialize said grok-4.6. The session wins, and the init
        // meta menu is not consulted.
        let mut state = NativeSessionStartupState::from_session_parts(
            None,
            None,
            Some(&grok_session_meta("grok-4.5")),
        );
        state.absorb_init_meta_model_menu(Some(&grok_init_meta()));
        assert_eq!(state.current_model_id.as_deref(), Some("grok-4.5"));
        assert_eq!(state.available_models.len(), 2);

        // A session-carried model config option stays authoritative over both.
        let options = vec![select_option(
            "model",
            Some(acp::schema::SessionConfigOptionCategory::Model),
            vec![("opus", "Opus")],
            "opus",
        )];
        let mut with_control = NativeSessionStartupState::from_session_parts(
            None,
            Some(&options),
            Some(&grok_session_meta("grok-4.5")),
        );
        with_control.absorb_init_meta_model_menu(Some(&grok_init_meta()));
        assert_eq!(with_control.current_model_id.as_deref(), Some("opus"));
        assert_eq!(with_control.available_models.len(), 1);
    }

    #[test]
    fn init_meta_menu_is_enumeration_only_and_never_names_the_session_model() {
        let mut grok = NativeSessionStartupState::from_session_parts(None, None, None);
        grok.absorb_init_meta_model_menu(Some(&grok_init_meta()));
        assert_eq!(grok.current_model_id, None);
        assert_eq!(
            grok.available_models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["grok-4.6", "grok-4.5"]
        );

        // No meta, or meta without a usable menu, leaves the state untouched.
        let mut none = NativeSessionStartupState::from_session_parts(None, None, None);
        none.absorb_init_meta_model_menu(None);
        let empty_meta = serde_json::json!({ "modelState": { "currentModelId": "x" } })
            .as_object()
            .expect("meta object")
            .clone();
        none.absorb_init_meta_model_menu(Some(&empty_meta));
        assert!(none.current_model_id.is_none());
        assert!(none.available_models.is_empty());
    }
}
