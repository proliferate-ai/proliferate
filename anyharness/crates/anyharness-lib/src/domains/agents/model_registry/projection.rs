use std::collections::HashMap;

use chrono::{DateTime, Utc};

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
    let snapshot = snapshot.filter(|snapshot| !snapshot.models.is_empty());
    match snapshot {
        Some(snapshot) => Some(dynamic_snapshot_to_registry(&bundled, snapshot)),
        None => Some(bundled),
    }
}

pub fn launch_registry_for_kind(
    kind: &str,
    snapshot: Option<&DynamicModelRegistrySnapshot>,
) -> Option<ModelRegistryMetadata> {
    let bundled = bundled_registry_for_kind(kind)?;
    let now = Utc::now();
    let snapshot = snapshot.filter(|snapshot| is_snapshot_launch_usable(snapshot, now));
    match snapshot {
        Some(snapshot) => Some(dynamic_snapshot_to_registry(&bundled, snapshot)),
        None => Some(bundled),
    }
}

pub fn is_snapshot_launch_usable(
    snapshot: &DynamicModelRegistrySnapshot,
    now: DateTime<Utc>,
) -> bool {
    snapshot.status == DynamicModelRegistryStatus::Available
        && !snapshot.models.is_empty()
        && snapshot
            .expires_at
            .is_none_or(|expires_at| expires_at > now)
}

fn dynamic_snapshot_to_registry(
    bundled: &ModelRegistryMetadata,
    snapshot: &DynamicModelRegistrySnapshot,
) -> ModelRegistryMetadata {
    let bundled_by_lookup = bundled_model_lookup(bundled);
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
                    bundled_by_lookup.get(model.id.as_str()).copied(),
                    default_model_id.as_deref(),
                )
            })
            .collect(),
    }
}

fn bundled_model_lookup(
    bundled: &ModelRegistryMetadata,
) -> HashMap<&str, &ModelRegistryModelMetadata> {
    let mut lookup = HashMap::new();
    for model in &bundled.models {
        lookup.insert(model.id.as_str(), model);
    }
    for model in &bundled.models {
        for alias in &model.aliases {
            lookup.entry(alias.as_str()).or_insert(model);
        }
    }
    lookup
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
            .or_else(|| bundled.and_then(|bundled| bundled.default_opt_in))
            .or_else(|| bundled.is_none().then_some(false)),
        status: model.status,
        aliases: merged_dynamic_aliases(model, bundled),
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

fn merged_dynamic_aliases(
    model: &DynamicModelRegistryModel,
    bundled: Option<&ModelRegistryModelMetadata>,
) -> Vec<String> {
    let mut aliases = Vec::new();
    if let Some(bundled) = bundled {
        push_alias(&mut aliases, &bundled.id, &model.id);
        for alias in &bundled.aliases {
            push_alias(&mut aliases, alias, &model.id);
        }
    }
    for alias in &model.aliases {
        push_alias(&mut aliases, alias, &model.id);
    }
    aliases
}

fn push_alias(aliases: &mut Vec<String>, alias: &str, model_id: &str) {
    if alias != model_id && !aliases.iter().any(|candidate| candidate == alias) {
        aliases.push(alias.to_string());
    }
}

fn resolve_default_model_id(
    bundled: &ModelRegistryMetadata,
    snapshot: &DynamicModelRegistrySnapshot,
) -> Option<String> {
    let bundled_default = bundled
        .default_model_id
        .as_deref()
        .and_then(|default_id| bundled.models.iter().find(|model| model.id == default_id));

    snapshot
        .models
        .iter()
        .find(|model| {
            bundled_default
                .map(|bundled| bundled_model_matches_dynamic_id(bundled, model.id.as_str()))
                .unwrap_or_else(|| {
                    bundled
                        .default_model_id
                        .as_deref()
                        .is_some_and(|default_id| default_id == model.id)
                })
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

fn bundled_model_matches_dynamic_id(
    bundled: &ModelRegistryModelMetadata,
    dynamic_id: &str,
) -> bool {
    bundled.id == dynamic_id || bundled.aliases.iter().any(|alias| alias == dynamic_id)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::domains::agents::model::ModelCatalogStatus;
    use crate::domains::agents::model_registry::model::{
        DynamicModelRegistrySource, DynamicModelRegistryStatus,
    };

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
            source: DynamicModelRegistrySource::ProviderCli,
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

    #[test]
    fn dynamic_snapshot_keeps_bundled_metadata_by_alias() {
        let bundled = ModelRegistryMetadata {
            kind: "cursor".to_string(),
            display_name: "Cursor".to_string(),
            default_model_id: Some("claude-sonnet-4-6".to_string()),
            models: vec![ModelRegistryModelMetadata {
                id: "claude-sonnet-4-6".to_string(),
                display_name: "Sonnet 4.6".to_string(),
                description: Some("Curated Claude default".to_string()),
                is_default: true,
                default_opt_in: Some(true),
                status: ModelCatalogStatus::Active,
                aliases: vec!["us.anthropic.claude-sonnet-4-6".to_string()],
                min_runtime_version: None,
                launch_remediation: None,
                session_default_controls: vec![],
                session_default_controls_state: SessionDefaultControlsState::Empty,
            }],
        };
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "cursor".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: Utc::now(),
            expires_at: None,
            models: vec![DynamicModelRegistryModel {
                id: "us.anthropic.claude-sonnet-4-6".to_string(),
                display_name: "Sonnet".to_string(),
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

        assert_eq!(
            projected.default_model_id.as_deref(),
            Some("us.anthropic.claude-sonnet-4-6")
        );
        assert_eq!(projected.models[0].default_opt_in, Some(true));
        assert_eq!(
            projected.models[0].description.as_deref(),
            Some("Curated Claude default")
        );
        assert_eq!(
            projected.models[0].aliases,
            vec!["claude-sonnet-4-6".to_string()]
        );
    }

    #[test]
    fn effective_registry_uses_previous_models_from_failed_snapshot() {
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "cursor".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::RefreshFailed,
            refreshed_at: Utc::now(),
            expires_at: None,
            models: vec![DynamicModelRegistryModel {
                id: "cursor/recovered".to_string(),
                display_name: "Recovered Cursor Model".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: Some(true),
                provider: None,
            }],
            warnings: vec![],
            error_message: Some("model discovery command failed".to_string()),
        };

        let projected = effective_registry_for_kind("cursor", Some(&snapshot))
            .expect("cursor bundled registry should exist");

        assert_eq!(
            projected.default_model_id.as_deref(),
            Some("cursor/recovered")
        );
        assert_eq!(projected.models[0].id, "cursor/recovered");
    }

    #[test]
    fn live_only_snapshot_models_default_to_hidden() {
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "cursor".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: Utc::now(),
            expires_at: None,
            models: vec![DynamicModelRegistryModel {
                id: "cursor/live-only".to_string(),
                display_name: "Live Only".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: None,
                provider: None,
            }],
            warnings: vec![],
            error_message: None,
        };

        let projected = effective_registry_for_kind("cursor", Some(&snapshot))
            .expect("cursor bundled registry should exist");

        assert_eq!(projected.models[0].default_opt_in, Some(false));
    }

    #[test]
    fn launch_registry_ignores_failed_snapshot_models() {
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "cursor".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::RefreshFailed,
            refreshed_at: Utc::now(),
            expires_at: None,
            models: vec![DynamicModelRegistryModel {
                id: "cursor/recovered".to_string(),
                display_name: "Recovered Cursor Model".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: Some(true),
                provider: None,
            }],
            warnings: vec![],
            error_message: Some("model discovery command failed".to_string()),
        };

        let projected = launch_registry_for_kind("cursor", Some(&snapshot))
            .expect("cursor bundled registry should exist");

        assert_ne!(
            projected.default_model_id.as_deref(),
            Some("cursor/recovered")
        );
        assert!(!projected
            .models
            .iter()
            .any(|model| model.id == "cursor/recovered"));
    }

    #[test]
    fn expired_snapshot_is_not_launch_usable() {
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "cursor".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: Utc::now(),
            expires_at: Some(Utc::now() - chrono::Duration::minutes(1)),
            models: vec![DynamicModelRegistryModel {
                id: "cursor/expired".to_string(),
                display_name: "Expired Cursor Model".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: Some(true),
                provider: None,
            }],
            warnings: vec![],
            error_message: None,
        };

        assert!(!is_snapshot_launch_usable(&snapshot, Utc::now()));
    }
}
