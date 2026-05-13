use anyharness_contract::v1 as contract;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;

use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::domains::runtime_inventory::model as domain;

#[utoipa::path(
    get,
    path = "/v1/runtime/inventory",
    responses(
        (status = 200, description = "Runtime inventory snapshot", body = contract::RuntimeInventoryResponse),
    ),
    tag = "runtime"
)]
pub async fn get_runtime_inventory(
    State(state): State<AppState>,
) -> Json<contract::RuntimeInventoryResponse> {
    Json(inventory_to_contract(
        state.runtime_inventory_service.inventory().await,
    ))
}

#[utoipa::path(
    get,
    path = "/v1/runtime/activity",
    responses(
        (status = 200, description = "Runtime activity snapshot", body = contract::RuntimeActivityResponse),
    ),
    tag = "runtime"
)]
pub async fn get_runtime_activity(
    State(state): State<AppState>,
) -> Json<contract::RuntimeActivityResponse> {
    Json(activity_to_contract(
        state.runtime_inventory_service.activity(None).await,
    ))
}

#[utoipa::path(
    post,
    path = "/v1/runtime/prepare-stop",
    request_body = Option<contract::PrepareStopRequest>,
    responses(
        (status = 200, description = "Runtime stop preflight", body = contract::PrepareStopResponse),
        (status = 400, description = "Invalid request", body = contract::ProblemDetails),
    ),
    tag = "runtime"
)]
pub async fn prepare_runtime_stop(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<contract::PrepareStopResponse>, ApiError> {
    let req = parse_optional_prepare_stop_request(body)?;
    let input = domain::PrepareStopInput {
        reason: req.reason,
        workspace_ids: req.workspace_ids,
        force: req.force,
    };
    Ok(Json(prepare_stop_to_contract(
        state.runtime_inventory_service.prepare_stop(input).await,
    )))
}

fn parse_optional_prepare_stop_request(
    body: Bytes,
) -> Result<contract::PrepareStopRequest, ApiError> {
    if body.is_empty() {
        return Ok(contract::PrepareStopRequest::default());
    }
    serde_json::from_slice(&body).map_err(|error| {
        ApiError::bad_request(
            format!("invalid prepare-stop request body: {error}"),
            "INVALID_PREPARE_STOP_REQUEST",
        )
    })
}

fn inventory_to_contract(
    snapshot: domain::RuntimeInventorySnapshot,
) -> contract::RuntimeInventoryResponse {
    contract::RuntimeInventoryResponse {
        reported_at: snapshot.reported_at,
        runtime_version: snapshot.runtime_version,
        runtime_home: snapshot.runtime_home,
        os_kind: snapshot.os_kind,
        os_version: snapshot.os_version,
        arch: snapshot.arch,
        distro: snapshot.distro,
        shell: snapshot.shell,
        package_managers: snapshot.package_managers,
        workspace_roots: snapshot
            .workspace_roots
            .into_iter()
            .map(workspace_root_to_contract)
            .collect(),
        capabilities: capabilities_to_contract(snapshot.capabilities),
        versions: versions_to_contract(snapshot.versions),
        provider_readiness: snapshot
            .provider_readiness
            .into_iter()
            .map(readiness_to_contract)
            .collect(),
        mcp_readiness: snapshot
            .mcp_readiness
            .into_iter()
            .map(readiness_to_contract)
            .collect(),
        agent_catalog_revision: snapshot.agent_catalog_revision,
        collection_errors: snapshot.collection_errors,
    }
}

fn activity_to_contract(
    snapshot: domain::RuntimeActivitySnapshot,
) -> contract::RuntimeActivityResponse {
    contract::RuntimeActivityResponse {
        reported_at: snapshot.reported_at,
        workspace_count: snapshot.workspace_count,
        total_session_count: snapshot.total_session_count,
        active_session_count: snapshot.active_session_count,
        active_turn_count: snapshot.active_turn_count,
        pending_interaction_count: snapshot.pending_interaction_count,
        pending_prompt_count: snapshot.pending_prompt_count,
        active_terminal_count: snapshot.active_terminal_count,
        active_process_count: snapshot.active_process_count,
        workspace_operation_count: snapshot.workspace_operation_count,
        operation_counts: snapshot
            .operation_counts
            .into_iter()
            .map(operation_count_to_contract)
            .collect(),
        safe_stop_state: safe_stop_state_to_contract(snapshot.safe_stop_state),
        safe_stop_reasons: snapshot
            .safe_stop_reasons
            .into_iter()
            .map(safe_stop_blocker_to_contract)
            .collect(),
        collection_errors: snapshot.collection_errors,
    }
}

fn prepare_stop_to_contract(
    snapshot: domain::PrepareStopSnapshot,
) -> contract::PrepareStopResponse {
    contract::PrepareStopResponse {
        prepared_at: snapshot.prepared_at,
        safe_stop_state: safe_stop_state_to_contract(snapshot.safe_stop_state),
        blockers: snapshot
            .blockers
            .into_iter()
            .map(safe_stop_blocker_to_contract)
            .collect(),
        activity: activity_to_contract(snapshot.activity),
        message: snapshot.message,
    }
}

fn workspace_root_to_contract(
    root: domain::RuntimeWorkspaceRoot,
) -> contract::RuntimeWorkspaceRoot {
    contract::RuntimeWorkspaceRoot {
        path: root.path,
        kind: root.kind,
        workspace_count: root.workspace_count,
    }
}

fn capabilities_to_contract(
    capabilities: domain::RuntimeInventoryCapabilities,
) -> contract::RuntimeInventoryCapabilities {
    contract::RuntimeInventoryCapabilities {
        supports_process_spawn: capabilities.supports_process_spawn,
        supports_pty: capabilities.supports_pty,
        supports_filesystem: capabilities.supports_filesystem,
        supports_git: capabilities.supports_git,
        supports_network_egress: capabilities.supports_network_egress,
        supports_port_forwarding: capabilities.supports_port_forwarding,
        supports_browser: capabilities.supports_browser,
        supports_computer_use: capabilities.supports_computer_use,
        supports_docker: capabilities.supports_docker,
    }
}

fn versions_to_contract(versions: domain::RuntimeToolVersions) -> contract::RuntimeToolVersions {
    contract::RuntimeToolVersions {
        node_version: versions.node_version,
        npm_version: versions.npm_version,
        python_version: versions.python_version,
        uv_version: versions.uv_version,
        git_version: versions.git_version,
    }
}

fn readiness_to_contract(
    readiness: domain::RuntimeReadinessEntry,
) -> contract::RuntimeReadinessEntry {
    contract::RuntimeReadinessEntry {
        id: readiness.id,
        display_name: readiness.display_name,
        state: readiness_state_to_contract(readiness.state),
        message: readiness.message,
    }
}

fn readiness_state_to_contract(
    state: domain::RuntimeReadinessState,
) -> contract::RuntimeReadinessState {
    match state {
        domain::RuntimeReadinessState::Ready => contract::RuntimeReadinessState::Ready,
        domain::RuntimeReadinessState::InstallRequired => {
            contract::RuntimeReadinessState::InstallRequired
        }
        domain::RuntimeReadinessState::CredentialsRequired => {
            contract::RuntimeReadinessState::CredentialsRequired
        }
        domain::RuntimeReadinessState::LoginRequired => {
            contract::RuntimeReadinessState::LoginRequired
        }
        domain::RuntimeReadinessState::Unsupported => contract::RuntimeReadinessState::Unsupported,
        domain::RuntimeReadinessState::Error => contract::RuntimeReadinessState::Error,
        domain::RuntimeReadinessState::Unknown => contract::RuntimeReadinessState::Unknown,
    }
}

fn operation_count_to_contract(
    operation_count: domain::RuntimeOperationCount,
) -> contract::RuntimeOperationCount {
    contract::RuntimeOperationCount {
        kind: operation_count.kind,
        count: operation_count.count,
    }
}

fn safe_stop_blocker_to_contract(blocker: domain::SafeStopBlocker) -> contract::SafeStopBlocker {
    contract::SafeStopBlocker {
        code: safe_stop_blocker_code_to_contract(blocker.code),
        message: blocker.message,
        count: blocker.count,
        workspace_id: blocker.workspace_id,
        session_id: blocker.session_id,
        terminal_id: blocker.terminal_id,
        operation: blocker.operation,
    }
}

fn safe_stop_state_to_contract(state: domain::SafeStopState) -> contract::SafeStopState {
    match state {
        domain::SafeStopState::Safe => contract::SafeStopState::Safe,
        domain::SafeStopState::Blocked => contract::SafeStopState::Blocked,
        domain::SafeStopState::Unknown => contract::SafeStopState::Unknown,
    }
}

fn safe_stop_blocker_code_to_contract(
    code: domain::SafeStopBlockerCode,
) -> contract::SafeStopBlockerCode {
    match code {
        domain::SafeStopBlockerCode::ActiveSession => contract::SafeStopBlockerCode::ActiveSession,
        domain::SafeStopBlockerCode::ActiveTurn => contract::SafeStopBlockerCode::ActiveTurn,
        domain::SafeStopBlockerCode::PendingInteraction => {
            contract::SafeStopBlockerCode::PendingInteraction
        }
        domain::SafeStopBlockerCode::PendingPrompt => contract::SafeStopBlockerCode::PendingPrompt,
        domain::SafeStopBlockerCode::ActiveTerminal => {
            contract::SafeStopBlockerCode::ActiveTerminal
        }
        domain::SafeStopBlockerCode::ActiveProcess => contract::SafeStopBlockerCode::ActiveProcess,
        domain::SafeStopBlockerCode::WorkspaceOperationInProgress => {
            contract::SafeStopBlockerCode::WorkspaceOperationInProgress
        }
        domain::SafeStopBlockerCode::RuntimeStateUnavailable => {
            contract::SafeStopBlockerCode::RuntimeStateUnavailable
        }
    }
}
