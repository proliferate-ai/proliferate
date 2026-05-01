use anyharness_contract::v1::{
    ModelCatalogStatus as ContractModelCatalogStatus, ModelEntry,
    ModelLaunchRemediation as ContractModelLaunchRemediation,
    ModelLaunchRemediationKind as ContractModelLaunchRemediationKind, ProviderConfig,
    SessionDefaultControl as ContractSessionDefaultControl,
    SessionDefaultControlKey as ContractSessionDefaultControlKey,
    SessionDefaultControlValue as ContractSessionDefaultControlValue,
};
use axum::{extract::State, Json};

use crate::agents::model::{
    ModelCatalogStatus, ModelLaunchRemediationKind, ModelLaunchRemediationMetadata,
    ModelRegistryMetadata, ModelRegistryModelMetadata, SessionDefaultControlKey,
    SessionDefaultControlMetadata, SessionDefaultControlValueMetadata,
};
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
        launch_remediation: model
            .launch_remediation
            .map(into_contract_launch_remediation),
        session_default_controls: model
            .session_default_controls
            .into_iter()
            .map(into_contract_session_default_control)
            .collect(),
    }
}

fn into_contract_session_default_control(
    control: SessionDefaultControlMetadata,
) -> ContractSessionDefaultControl {
    ContractSessionDefaultControl {
        key: into_contract_session_default_control_key(control.key),
        label: control.label,
        values: control
            .values
            .into_iter()
            .map(into_contract_session_default_control_value)
            .collect(),
        default_value: control.default_value,
    }
}

fn into_contract_session_default_control_value(
    value: SessionDefaultControlValueMetadata,
) -> ContractSessionDefaultControlValue {
    ContractSessionDefaultControlValue {
        value: value.value,
        label: value.label,
        description: value.description,
        is_default: value.is_default,
    }
}

fn into_contract_session_default_control_key(
    key: SessionDefaultControlKey,
) -> ContractSessionDefaultControlKey {
    match key {
        SessionDefaultControlKey::Reasoning => ContractSessionDefaultControlKey::Reasoning,
        SessionDefaultControlKey::Effort => ContractSessionDefaultControlKey::Effort,
        SessionDefaultControlKey::FastMode => ContractSessionDefaultControlKey::FastMode,
    }
}

fn into_contract_launch_remediation(
    remediation: ModelLaunchRemediationMetadata,
) -> ContractModelLaunchRemediation {
    ContractModelLaunchRemediation {
        kind: match remediation.kind {
            ModelLaunchRemediationKind::ManagedReinstall => {
                ContractModelLaunchRemediationKind::ManagedReinstall
            }
            ModelLaunchRemediationKind::ExternalUpdate => {
                ContractModelLaunchRemediationKind::ExternalUpdate
            }
            ModelLaunchRemediationKind::Restart => ContractModelLaunchRemediationKind::Restart,
        },
        message: remediation.message,
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
