use anyharness_contract::v1::{ModelRegistry, ModelRegistryModel, ProblemDetails};
use axum::{extract::Path, Json};

use super::error::ApiError;
use crate::agents::catalog::model_registries;
use crate::agents::model::{ModelRegistryMetadata, ModelRegistryModelMetadata};

#[utoipa::path(
    get,
    path = "/v1/model-registries",
    responses(
        (status = 200, description = "Backend-owned model registries", body = Vec<ModelRegistry>),
    ),
    tag = "model-registries"
)]
pub async fn list_model_registries() -> Json<Vec<ModelRegistry>> {
    Json(
        model_registries()
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
pub async fn get_model_registry(Path(kind): Path<String>) -> Result<Json<ModelRegistry>, ApiError> {
    let registry = model_registries()
        .into_iter()
        .find(|registry| registry.kind == kind)
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
    }
}
