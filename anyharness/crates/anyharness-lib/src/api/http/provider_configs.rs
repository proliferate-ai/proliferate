use anyharness_contract::v1::{ModelEntry, ProviderConfig};
use axum::Json;

use crate::agents::catalog::model_registries;
use crate::agents::model::{ModelRegistryMetadata, ModelRegistryModelMetadata};

#[utoipa::path(
    get,
    path = "/v1/provider-configs",
    responses(
        (status = 200, description = "Provider configuration catalog", body = Vec<ProviderConfig>),
    ),
    tag = "provider-configs"
)]
pub async fn list_provider_configs() -> Json<Vec<ProviderConfig>> {
    Json(
        model_registries()
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
        is_default: model.is_default,
    }
}
