use anyharness_contract::v1::{
    ModelCatalogStatus as ContractModelCatalogStatus, ModelEntry, ProviderConfig,
};
use axum::{extract::State, Json};

use crate::agents::model::{ModelCatalogStatus, ModelRegistryMetadata, ModelRegistryModelMetadata};
use crate::app::AppState;

#[utoipa::path(
    get,
    path = "/v1/provider-configs",
    responses(
        (status = 200, description = "Provider configuration catalog", body = Vec<ProviderConfig>),
    ),
    tag = "provider-configs"
)]
pub async fn list_provider_configs(State(state): State<AppState>) -> Json<Vec<ProviderConfig>> {
    Json(
        state
            .model_catalog_service
            .registries()
            .into_iter()
            .map(into_contract_provider_config)
            .collect(),
    )
}

fn into_contract_provider_config(config: ModelRegistryMetadata) -> ProviderConfig {
    ProviderConfig {
        kind: config.kind,
        display_name: config.display_name,
        models: config.models.into_iter().map(into_contract_model).collect(),
    }
}

fn into_contract_model(model: ModelRegistryModelMetadata) -> ModelEntry {
    ModelEntry {
        id: model.id,
        display_name: model.display_name,
        description: model.description,
        is_default: model.is_default,
        status: into_contract_status(model.status),
        aliases: model.aliases,
        min_runtime_version: model.min_runtime_version,
    }
}

fn into_contract_status(status: ModelCatalogStatus) -> ContractModelCatalogStatus {
    match status {
        ModelCatalogStatus::Candidate => ContractModelCatalogStatus::Candidate,
        ModelCatalogStatus::Active => ContractModelCatalogStatus::Active,
        ModelCatalogStatus::Deprecated => ContractModelCatalogStatus::Deprecated,
        ModelCatalogStatus::Hidden => ContractModelCatalogStatus::Hidden,
    }
}
