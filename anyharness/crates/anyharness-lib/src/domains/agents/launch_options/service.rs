use std::path::{Path, PathBuf};

use super::basis::compute_harness_basis_revision;
use super::store::HarnessLaunchOptionsStore;
use super::types::{
    HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchDefaults, HarnessLaunchModel,
    HarnessLaunchOptionStateRow, HarnessLaunchOptions, HarnessLaunchOptionsResponse,
    HarnessLaunchOptionsState, LaunchSelection, ProbeState,
};
use crate::persistence::Db;

#[derive(Clone)]
pub struct HarnessLaunchOptionsService {
    store: HarnessLaunchOptionsStore,
    runtime_home: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum LaunchSelectionUnsupported {
    #[error("launch-option state could not be read")]
    Internal(#[source] anyhow::Error),
    #[error("launch options are not available for the current harness basis")]
    ObservationUnavailable {
        state: Option<HarnessLaunchOptionsState>,
    },
    #[error("model '{model_id}' is absent from current launch options")]
    Model {
        model_id: String,
        state: HarnessLaunchOptionsState,
    },
    #[error("control '{control_id}' is absent from current launch options")]
    Control {
        control_id: String,
        state: HarnessLaunchOptionsState,
    },
    #[error("value '{value}' is absent from control '{control_id}'")]
    ControlValue {
        control_id: String,
        value: String,
        state: HarnessLaunchOptionsState,
    },
}

impl HarnessLaunchOptionsService {
    pub fn new(db: Db, runtime_home: PathBuf) -> Self {
        Self {
            store: HarnessLaunchOptionsStore::new(db),
            runtime_home,
        }
    }

    pub fn basis_revision(&self, harness_kind: &str) -> String {
        compute_harness_basis_revision(&self.runtime_home, harness_kind)
    }

    pub fn read(&self, harness_kind: &str) -> anyhow::Result<Option<HarnessLaunchOptionsResponse>> {
        let current_basis = self.basis_revision(harness_kind);
        self.store.read(harness_kind).map(|row| {
            row.map(|row| {
                if row.basis_revision != current_basis {
                    return HarnessLaunchOptionsResponse {
                        harness_kind: row.harness_kind,
                        basis_revision: current_basis,
                        revision: row.revision.saturating_add(1),
                        state: HarnessLaunchOptionsState::Detecting,
                        options: None,
                        observed_at: None,
                        probe_attempted_at: row.probe_attempted_at,
                        probe_failure_code: None,
                    };
                }
                project_response(row)
            })
        })
    }

    pub fn begin_probe(
        &self,
        harness_kind: &str,
        attempted_at: &str,
    ) -> anyhow::Result<HarnessLaunchOptionStateRow> {
        let basis = self.basis_revision(harness_kind);
        self.store.begin_probe(harness_kind, &basis, attempted_at)
    }

    pub fn record_success(
        &self,
        started: &HarnessLaunchOptionStateRow,
        options: &HarnessLaunchOptions,
        observed_at: &str,
    ) -> anyhow::Result<bool> {
        self.store.finish_success(
            &started.harness_kind,
            &started.basis_revision,
            started.revision,
            options,
            observed_at,
        )
    }

    /// Lossless executable projection of the override-free ACP probe. Unknown
    /// ids and missing prose are data, not validation failures.
    pub fn options_from_probe(
        snapshot: &crate::live::sessions::probe::ProbeSnapshot,
    ) -> HarnessLaunchOptions {
        let models = snapshot
            .models
            .iter()
            .map(|model| HarnessLaunchModel {
                id: model.model_id.clone(),
                observed_name: nonempty(&model.name),
                observed_description: model.description.clone(),
            })
            .collect::<Vec<_>>();

        let mut controls = controls_from_config_json(&snapshot.baseline_config_options);
        let mut control_values = controls
            .iter()
            .filter_map(|control| {
                current_value(&snapshot.baseline_config_options, &control.id)
                    .map(|value| (control.id.clone(), value))
            })
            .collect::<std::collections::BTreeMap<_, _>>();

        if !controls.iter().any(|control| control.id == "mode") {
            if let Some(values) = snapshot
                .modes
                .get("availableModes")
                .and_then(serde_json::Value::as_array)
            {
                let values = values
                    .iter()
                    .filter_map(|value| {
                        let id = value.get("id")?.as_str()?.to_string();
                        Some(HarnessLaunchControlValue {
                            observed_label: value
                                .get("name")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_string),
                            observed_description: value
                                .get("description")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_string),
                            value: id,
                        })
                    })
                    .collect::<Vec<_>>();
                if !values.is_empty() {
                    controls.push(HarnessLaunchControl {
                        id: "mode".to_string(),
                        observed_label: Some("Mode".to_string()),
                        observed_description: None,
                        values,
                    });
                    if let Some(value) = snapshot.current_mode_id.clone() {
                        control_values.insert("mode".to_string(), value);
                    }
                }
            }
        }

        HarnessLaunchOptions {
            models,
            controls,
            defaults: HarnessLaunchDefaults {
                model_id: snapshot.current_model_id.clone(),
                control_values,
            },
        }
    }

    pub fn record_failure(
        &self,
        started: &HarnessLaunchOptionStateRow,
        attempted_at: &str,
        failure_code: &str,
    ) -> anyhow::Result<bool> {
        self.store.finish_failure(
            &started.harness_kind,
            &started.basis_revision,
            started.revision,
            attempted_at,
            failure_code,
        )
    }

    pub fn validate_selection(
        &self,
        harness_kind: &str,
        selection: &LaunchSelection,
    ) -> Result<HarnessLaunchOptionStateRow, LaunchSelectionUnsupported> {
        let row = self
            .store
            .read(harness_kind)
            .map_err(LaunchSelectionUnsupported::Internal)?;
        let current_basis = self.basis_revision(harness_kind);
        super::validation::validate_selection_row(row, &current_basis, selection)
    }

    pub fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }
}

fn nonempty(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_string())
}

fn controls_from_config_json(value: &serde_json::Value) -> Vec<HarnessLaunchControl> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|option| {
            let id = option.get("id")?.as_str()?.to_string();
            let category = option.get("category").and_then(serde_json::Value::as_str);
            if id == "model" || category == Some("model") {
                return None;
            }
            let mut values = Vec::new();
            collect_values(option.get("options"), &mut values);
            if values.is_empty() {
                return None;
            }
            Some(HarnessLaunchControl {
                id,
                observed_label: option
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                observed_description: option
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                values,
            })
        })
        .collect()
}

fn collect_values(value: Option<&serde_json::Value>, output: &mut Vec<HarnessLaunchControlValue>) {
    match value {
        Some(serde_json::Value::Array(values)) => {
            for value in values {
                if let Some(raw) = value.get("value").and_then(serde_json::Value::as_str) {
                    output.push(HarnessLaunchControlValue {
                        value: raw.to_string(),
                        observed_label: value
                            .get("name")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                        observed_description: value
                            .get("description")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                    });
                } else {
                    collect_values(value.get("options"), output);
                }
            }
        }
        Some(serde_json::Value::Object(object)) => {
            for nested in object.values() {
                collect_values(Some(nested), output);
            }
        }
        _ => {}
    }
}

fn current_value(value: &serde_json::Value, id: &str) -> Option<String> {
    value.as_array()?.iter().find_map(|option| {
        (option.get("id").and_then(serde_json::Value::as_str) == Some(id))
            .then(|| {
                option
                    .get("currentValue")
                    .or_else(|| option.get("current_value"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .flatten()
    })
}

fn project_response(row: HarnessLaunchOptionStateRow) -> HarnessLaunchOptionsResponse {
    let state = state_for(&row);
    HarnessLaunchOptionsResponse {
        harness_kind: row.harness_kind,
        basis_revision: row.basis_revision,
        revision: row.revision,
        state,
        options: row.options,
        observed_at: row.observed_at,
        probe_attempted_at: row.probe_attempted_at,
        probe_failure_code: row.probe_failure_code,
    }
}

pub(super) fn state_for(row: &HarnessLaunchOptionStateRow) -> HarnessLaunchOptionsState {
    match (row.options.as_ref(), row.probe_state) {
        (None, ProbeState::Probing) => HarnessLaunchOptionsState::Detecting,
        (Some(_), ProbeState::Probing) => HarnessLaunchOptionsState::Refreshing,
        (Some(options), ProbeState::Succeeded)
            if options.models.is_empty() && options.controls.is_empty() =>
        {
            HarnessLaunchOptionsState::ObservedEmpty
        }
        (Some(_), ProbeState::Succeeded) => HarnessLaunchOptionsState::Observed,
        (Some(_), ProbeState::Failed) => HarnessLaunchOptionsState::LastGoodAfterFailure,
        (None, ProbeState::Failed) => HarnessLaunchOptionsState::FailedWithoutObservation,
        // The SQL invariant forbids this state. Treat a corrupt/legacy row as
        // unavailable rather than manufacturing executable choices.
        (None, ProbeState::Succeeded) => HarnessLaunchOptionsState::FailedWithoutObservation,
    }
}
