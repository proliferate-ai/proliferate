use std::collections::HashMap;

use crate::domains::agents::catalog::projection::models::bundled_model_registries;
use crate::domains::agents::model::{
    ModelRegistryMetadata, ModelRegistryModelMetadata, SessionDefaultControlsState,
};

use super::model::{
    DynamicModelRegistryModel, DynamicModelRegistrySnapshot, DynamicModelRegistryStatus,
};

pub fn bundled_registry_for_kind(kind: &str) -> Option<ModelRegistryMetadata> {
    bundled_model_registries()
        .into_iter()
        .find(|registry| registry.kind == kind)
}

pub fn effective_registry_for_kind(
    kind: &str,
    snapshot: Option<&DynamicModelRegistrySnapshot>,
) -> Option<ModelRegistryMetadata> {
    let bundled = bundled_registry_for_kind(kind)?;
    let snapshot = snapshot.filter(|snapshot| {
        snapshot.status == DynamicModelRegistryStatus::Available && !snapshot.models.is_empty()
    });
    match snapshot {
        Some(snapshot) => Some(dynamic_snapshot_to_registry(&bundled, snapshot)),
        None => Some(bundled),
    }
}

fn dynamic_snapshot_to_registry(
    bundled: &ModelRegistryMetadata,
    snapshot: &DynamicModelRegistrySnapshot,
) -> ModelRegistryMetadata {
    let bundled_by_id = bundled
        .models
        .iter()
        .map(|model| (model.id.as_str(), model))
        .collect::<HashMap<_, _>>();
    let default_model_id = resolve_default_model_id(bundled, snapshot);

    ModelRegistryMetadata {
        kind: bundled.kind.clone(),
        display_name: bundled.display_name.clone(),
        default_model_id: default_model_id.clone(),
        models: snapshot
            .models
            .iter()
            .map(|model| {
                dynamic_model_to_registry_model(
                    model,
                    bundled_by_id.get(model.id.as_str()).copied(),
                    default_model_id.as_deref(),
                )
            })
            .collect(),
    }
}

fn dynamic_model_to_registry_model(
    model: &DynamicModelRegistryModel,
    bundled: Option<&ModelRegistryModelMetadata>,
    default_model_id: Option<&str>,
) -> ModelRegistryModelMetadata {
    ModelRegistryModelMetadata {
        id: model.id.clone(),
        display_name: model.display_name.clone(),
        description: model.description.clone().or_else(|| {
            bundled
                .and_then(|bundled| bundled.description.as_ref())
                .cloned()
        }),
        is_default: default_model_id == Some(model.id.as_str()),
        default_opt_in: model
            .default_opt_in
            .or_else(|| bundled.and_then(|bundled| bundled.default_opt_in)),
        status: model.status,
        aliases: if model.aliases.is_empty() {
            bundled
                .map(|bundled| bundled.aliases.clone())
                .unwrap_or_default()
        } else {
            model.aliases.clone()
        },
        min_runtime_version: bundled.and_then(|bundled| bundled.min_runtime_version.clone()),
        launch_remediation: bundled.and_then(|bundled| bundled.launch_remediation.clone()),
        session_default_controls: bundled
            .map(|bundled| bundled.session_default_controls.clone())
            .unwrap_or_default(),
        session_default_controls_state: bundled
            .map(|bundled| bundled.session_default_controls_state)
            .unwrap_or(SessionDefaultControlsState::Omitted),
    }
}

fn resolve_default_model_id(
    bundled: &ModelRegistryMetadata,
    snapshot: &DynamicModelRegistrySnapshot,
) -> Option<String> {
    snapshot
        .models
        .iter()
        .find(|model| {
            bundled
                .default_model_id
                .as_deref()
                .is_some_and(|default_id| default_id == model.id)
        })
        .map(|model| model.id.clone())
        .or_else(|| {
            snapshot
                .models
                .iter()
                .find(|model| model.is_default)
                .map(|model| model.id.clone())
        })
        .or_else(|| snapshot.models.first().map(|model| model.id.clone()))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::domains::agents::model::ModelCatalogStatus;

    use super::*;
    use crate::domains::agents::model::ModelRegistryMetadata;
    use crate::domains::agents::model::ModelRegistryModelMetadata;

    #[test]
    fn dynamic_snapshot_keeps_bundled_visibility_intent_by_model_id() {
        let bundled = ModelRegistryMetadata {
            kind: "cursor".to_string(),
            display_name: "Cursor".to_string(),
            default_model_id: Some("auto".to_string()),
            models: vec![ModelRegistryModelMetadata {
                id: "auto".to_string(),
                display_name: "Auto".to_string(),
                description: Some("Curated default".to_string()),
                is_default: true,
                default_opt_in: Some(true),
                status: ModelCatalogStatus::Active,
                aliases: vec![],
                min_runtime_version: None,
                launch_remediation: None,
                session_default_controls: vec![],
                session_default_controls_state: SessionDefaultControlsState::Empty,
            }],
        };
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "cursor".to_string(),
            workspace_id: None,
            source: super::super::model::DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: Utc::now(),
            expires_at: None,
            models: vec![DynamicModelRegistryModel {
                id: "auto".to_string(),
                display_name: "Auto".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: false,
                default_opt_in: None,
                provider: None,
            }],
            warnings: vec![],
            error_message: None,
        };

        let projected = dynamic_snapshot_to_registry(&bundled, &snapshot);

        assert_eq!(projected.default_model_id.as_deref(), Some("auto"));
        assert_eq!(projected.models[0].default_opt_in, Some(true));
        assert_eq!(
            projected.models[0].description.as_deref(),
            Some("Curated default")
        );
    }
}
