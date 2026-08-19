//! Compatibility projection for internal agent-operation callers.
//!
//! Executable membership comes only from target-observed launch options. The
//! catalog may contribute prose for exact IDs, but cannot add a model, alias,
//! control, default, or fallback.

use super::SessionService;
use crate::domains::agents::model::{AgentKind, ModelCatalogStatus};
use crate::domains::agents::readiness::launch_options::{
    ResolvedLaunchAgentOption, ResolvedLaunchModelOption, ResolvedLiveModelEffortCandidate,
    ResolvedModelEffort, ResolvedWorkspaceLaunchOptions,
};

impl SessionService {
    pub fn active_agent_catalog(&self) -> crate::domains::agents::catalog::service::ActiveCatalog {
        self.catalog_service.active_catalog()
    }

    /// An active model mutation is authorized only by this exact session's
    /// latest live statement. Target launch options and the distribution
    /// catalog cannot authorize a running session.
    pub fn live_model_switch_authorized(
        &self,
        record: &crate::domains::sessions::model::SessionRecord,
        value: &str,
    ) -> bool {
        self.get_live_config_snapshot(&record.id)
            .ok()
            .flatten()
            .is_some_and(|snapshot| snapshot.models.iter().any(|model| model.id == value))
    }

    pub fn resolved_workspace_launch_options(
        &self,
        _workspace_id: Option<&str>,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        let catalog = self.catalog_service.active_catalog();
        let mut agents = Vec::new();

        for kind in AgentKind::all() {
            let kind_id = kind.as_str();
            let Some(observed) = self.launch_options_service.read(kind_id)? else {
                continue;
            };
            let Some(options) = observed.options else {
                continue;
            };
            let effort = options
                .controls
                .iter()
                .find(|control| control.id == "effort" || control.id == "reasoning_effort");
            let mode = options.controls.iter().find(|control| control.id == "mode");
            let fast_mode = options.controls.iter().any(|control| control.id == "fast_mode");

            let models = options
                .models
                .iter()
                .map(|model| {
                    let presentation = catalog
                        .agent(kind_id)
                        .and_then(|agent| agent.session.presentation_models.iter().find(|candidate| candidate.id == model.id));
                    ResolvedLaunchModelOption {
                        id: model.id.clone(),
                        display_name: model
                            .observed_name
                            .clone()
                            .or_else(|| presentation.map(|value| value.display_name.clone()))
                            .unwrap_or_else(|| model.id.clone()),
                        aliases: Vec::new(),
                        is_default: options.defaults.model_id.as_deref() == Some(model.id.as_str()),
                        default_opt_in: None,
                        description: model
                            .observed_description
                            .clone()
                            .or_else(|| presentation.and_then(|value| value.description.clone())),
                        provider: None,
                        status: Some(ModelCatalogStatus::Active),
                        effort: effort.map(|control| ResolvedModelEffort {
                            values: control.values.iter().map(|value| value.value.clone()).collect(),
                            default: options.defaults.control_values.get(&control.id).cloned(),
                        }),
                        live_effort_candidates: effort
                            .map(|control| vec![ResolvedLiveModelEffortCandidate {
                                control_key: control.id.clone(),
                                values: control.values.iter().map(|value| value.value.clone()).collect(),
                                live_config_id: control.id.clone(),
                            }])
                            .unwrap_or_default(),
                        fast_mode,
                        modes: mode.map(|control| {
                            control.values.iter().map(|value| value.value.clone()).collect()
                        }),
                    }
                })
                .collect();

            agents.push(ResolvedLaunchAgentOption {
                kind: kind_id.to_string(),
                display_name: catalog
                    .agent(kind_id)
                    .map(|agent| agent.display_name.clone())
                    .unwrap_or_else(|| kind.display_name().to_string()),
                default_model_id: options.defaults.model_id.clone(),
                controls: options
                    .controls
                    .iter()
                    .map(|control| anyharness_contract::v1::HarnessLaunchControl {
                        id: control.id.clone(),
                        observed_label: control.observed_label.clone(),
                        observed_description: control.observed_description.clone(),
                        values: control
                            .values
                            .iter()
                            .map(|value| anyharness_contract::v1::HarnessLaunchControlValue {
                                value: value.value.clone(),
                                observed_label: value.observed_label.clone(),
                                observed_description: value.observed_description.clone(),
                            })
                            .collect(),
                    })
                    .collect(),
                default_control_values: options.defaults.control_values.clone(),
                models,
            });
        }

        Ok(ResolvedWorkspaceLaunchOptions { agents })
    }
}
