use anyharness_contract::v1::{
    AgentLaunchModelOption, AgentLaunchOption, AgentLaunchOptionsResponse, AgentModelRegistryModel,
    AgentModelRegistrySnapshotResponse, ModelCatalogStatus as ContractModelCatalogStatus,
    ModelRegistrySource, ModelRegistryStatus, ProblemDetails, RefreshAgentModelRegistryRequest,
    RefreshAgentModelRegistryResponse,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::app::AppState;
use crate::domains::agents::model::ModelCatalogStatus;
use crate::domains::agents::model_registry::model::{
    DynamicModelRegistrySnapshot, DynamicModelRegistrySource, DynamicModelRegistryStatus,
    RefreshModelRegistryOptions,
};
use crate::domains::agents::registry;

type ProblemResponse = (StatusCode, Json<ProblemDetails>);

fn problem(
    status: u16,
    title: &str,
    detail: Option<String>,
    code: Option<&str>,
) -> ProblemResponse {
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        Json(ProblemDetails {
            type_url: "about:blank".into(),
            title: title.into(),
            status,
            detail,
            instance: None,
            code: code.map(String::from),
            resolution_scope: None,
            agent_kind: None,
            selection_status: None,
        }),
    )
}

fn agent_not_found(kind: &str) -> ProblemResponse {
    problem(
        404,
        "Agent not found",
        Some(format!("No built-in agent with kind: {kind}")),
        Some("AGENT_NOT_FOUND"),
    )
}

#[derive(Debug, Deserialize)]
pub struct AgentModelRegistryQuery {
    pub workspace_id: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/agents/launch-options",
    params(("workspace_id" = Option<String>, Query, description = "Optional workspace scope for target-discovered model registries")),
    responses(
        (status = 200, description = "List launchable agents and model options", body = AgentLaunchOptionsResponse),
    ),
    tag = "agents"
)]
pub async fn get_agent_launch_options(
    State(state): State<AppState>,
    Query(query): Query<AgentModelRegistryQuery>,
) -> Result<Json<AgentLaunchOptionsResponse>, ProblemResponse> {
    let options = state
        .dynamic_model_registry_service
        .workspace_launch_options(query.workspace_id.as_deref())
        .map_err(|error| {
            problem(
                500,
                "Launch options failed",
                Some(error.to_string()),
                Some("LAUNCH_OPTIONS_FAILED"),
            )
        })?;

    Ok(Json(AgentLaunchOptionsResponse {
        workspace_id: query.workspace_id,
        agents: options
            .agents
            .into_iter()
            .map(|agent| AgentLaunchOption {
                kind: agent.kind,
                display_name: agent.display_name,
                default_model_id: agent.default_model_id,
                models: agent
                    .models
                    .into_iter()
                    .map(|model| AgentLaunchModelOption {
                        id: model.id,
                        display_name: model.display_name,
                        aliases: model.aliases,
                        is_default: model.is_default,
                        default_opt_in: model.default_opt_in,
                    })
                    .collect(),
            })
            .collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/model-registry",
    params(
        ("kind" = String, Path, description = "Agent kind identifier"),
        ("workspace_id" = Option<String>, Query, description = "Optional workspace scope for target-discovered model registries"),
    ),
    responses(
        (status = 200, description = "Last known model registry snapshot for one agent", body = AgentModelRegistrySnapshotResponse),
        (status = 404, description = "Agent or model registry snapshot not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn get_agent_model_registry(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Query(query): Query<AgentModelRegistryQuery>,
) -> Result<Json<AgentModelRegistrySnapshotResponse>, ProblemResponse> {
    ensure_agent_exists(&kind)?;
    let snapshot = state
        .dynamic_model_registry_service
        .snapshot(&kind, query.workspace_id.as_deref())
        .map_err(|error| {
            problem(
                500,
                "Model registry failed",
                Some(error.to_string()),
                Some("MODEL_REGISTRY_FAILED"),
            )
        })?;
    let Some(snapshot) = snapshot else {
        return Err(problem(
            404,
            "Model registry snapshot not found",
            Some("Refresh this agent's model registry before reading its target snapshot.".into()),
            Some("MODEL_REGISTRY_SNAPSHOT_NOT_FOUND"),
        ));
    };
    Ok(Json(to_model_registry_snapshot_response(snapshot)))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/model-registry/refresh",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    request_body = RefreshAgentModelRegistryRequest,
    responses(
        (status = 200, description = "Refreshed or attempted model registry snapshot", body = RefreshAgentModelRegistryResponse),
        (status = 404, description = "Agent not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn refresh_agent_model_registry(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Json(req): Json<RefreshAgentModelRegistryRequest>,
) -> Result<Json<RefreshAgentModelRegistryResponse>, ProblemResponse> {
    ensure_agent_exists(&kind)?;
    let refresh_service = state.dynamic_model_registry_service.clone();
    let refresh_kind = kind.clone();
    let snapshot = tokio::task::spawn_blocking(move || {
        refresh_service.refresh(
            &refresh_kind,
            RefreshModelRegistryOptions {
                workspace_id: req.workspace_id,
                force_provider_refresh: req.force_provider_refresh,
            },
        )
    })
    .await
    .map_err(|error| {
        problem(
            500,
            "Model registry refresh failed",
            Some(format!("Model registry refresh task failed: {error}")),
            Some("MODEL_REGISTRY_REFRESH_FAILED"),
        )
    })?
    .map_err(|error| {
        problem(
            500,
            "Model registry refresh failed",
            Some(error.to_string()),
            Some("MODEL_REGISTRY_REFRESH_FAILED"),
        )
    })?;

    Ok(Json(RefreshAgentModelRegistryResponse {
        snapshot: to_model_registry_snapshot_response(snapshot),
    }))
}

fn ensure_agent_exists(kind: &str) -> Result<(), ProblemResponse> {
    if registry::descriptor(kind).is_some() {
        Ok(())
    } else {
        Err(agent_not_found(kind))
    }
}

fn to_model_registry_snapshot_response(
    snapshot: DynamicModelRegistrySnapshot,
) -> AgentModelRegistrySnapshotResponse {
    AgentModelRegistrySnapshotResponse {
        kind: snapshot.kind,
        workspace_id: snapshot.workspace_id,
        source: match snapshot.source {
            DynamicModelRegistrySource::BundledCatalog => ModelRegistrySource::BundledCatalog,
            DynamicModelRegistrySource::ProviderCli => ModelRegistrySource::ProviderCli,
        },
        status: match snapshot.status {
            DynamicModelRegistryStatus::Available => ModelRegistryStatus::Available,
            DynamicModelRegistryStatus::RefreshFailed => ModelRegistryStatus::RefreshFailed,
            DynamicModelRegistryStatus::AgentNotReady => ModelRegistryStatus::AgentNotReady,
            DynamicModelRegistryStatus::Unsupported => ModelRegistryStatus::Unsupported,
        },
        refreshed_at: snapshot.refreshed_at.to_rfc3339(),
        expires_at: snapshot.expires_at.map(|time| time.to_rfc3339()),
        models: snapshot
            .models
            .into_iter()
            .map(|model| AgentModelRegistryModel {
                id: model.id,
                display_name: model.display_name,
                description: model.description,
                aliases: model.aliases,
                status: match model.status {
                    ModelCatalogStatus::Candidate => ContractModelCatalogStatus::Candidate,
                    ModelCatalogStatus::Active => ContractModelCatalogStatus::Active,
                    ModelCatalogStatus::Deprecated => ContractModelCatalogStatus::Deprecated,
                    ModelCatalogStatus::Hidden => ContractModelCatalogStatus::Hidden,
                },
                is_default: model.is_default,
                default_opt_in: model.default_opt_in,
                provider: model.provider,
            })
            .collect(),
        warnings: snapshot.warnings,
        error_message: snapshot.error_message,
    }
}
