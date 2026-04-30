use anyharness_contract::v1::{
    ModelCatalogStatus as ContractModelCatalogStatus, ModelRegistry, ModelRegistryModel,
    ProblemDetails,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::error::ApiError;
use crate::agents::model::{ModelCatalogStatus, ModelRegistryMetadata, ModelRegistryModelMetadata};
use crate::app::AppState;

#[utoipa::path(
    get,
    path = "/v1/model-registries",
    responses(
        (status = 200, description = "Backend-owned model registries", body = Vec<ModelRegistry>),
    ),
    tag = "model-registries"
)]
pub async fn list_model_registries(State(state): State<AppState>) -> Json<Vec<ModelRegistry>> {
    Json(
        state
            .model_catalog_service
            .registries()
            .into_iter()
            .map(into_contract_model_registry)
            .collect(),
    )
}

#[utoipa::path(
    get,
    path = "/v1/model-registries/{kind}",
    params(("kind" = String, Path, description = "Harness kind")),
    responses(
        (status = 200, description = "Model registry", body = ModelRegistry),
        (status = 404, description = "Model registry not found", body = ProblemDetails),
    ),
    tag = "model-registries"
)]
pub async fn get_model_registry(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<ModelRegistry>, ApiError> {
    let registry = state
        .model_catalog_service
        .registry(kind.as_str())
        .ok_or_else(|| {
            ApiError::not_found(
                format!("model registry not found for '{kind}'"),
                "model_registry_not_found",
            )
        })?;

    Ok(Json(into_contract_model_registry(registry)))
}

fn into_contract_model_registry(registry: ModelRegistryMetadata) -> ModelRegistry {
    ModelRegistry {
        kind: registry.kind,
        display_name: registry.display_name,
        default_model_id: registry.default_model_id,
        models: registry
            .models
            .into_iter()
            .map(into_contract_model)
            .collect(),
    }
}

fn into_contract_model(model: ModelRegistryModelMetadata) -> ModelRegistryModel {
    ModelRegistryModel {
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
