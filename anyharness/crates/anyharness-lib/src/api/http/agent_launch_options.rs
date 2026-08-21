use anyharness_contract::v1::{
    AgentAuthProbePhase, AgentReadinessState, HarnessLaunchControl, HarnessLaunchControlValue,
    HarnessLaunchDefaults, HarnessLaunchModel, HarnessLaunchModelControls, HarnessLaunchOptions,
    HarnessLaunchOptionsResponse, HarnessLaunchOptionsState, ProblemDetails,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use super::agents_contract::probe_phase_to_contract;
use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::launch_options as domain;
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::registry::descriptor;

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/launch-options",
    params(("kind" = String, Path, description = "Harness kind identifier")),
    responses(
        (status = 200, description = "Target-observed harness launch options", body = HarnessLaunchOptionsResponse),
        (status = 404, description = "Unknown harness kind", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn get_launch_options(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<HarnessLaunchOptionsResponse>, ApiError> {
    validate_kind(&kind)?;
    let response = response_for(&state, &kind).await?;
    tracing::info!(
        harness = %kind,
        harness_basis_revision = %response.basis_revision,
        source_revision = response.revision,
        state = ?response.state,
        model_count = response.options.as_ref().map(|options| options.models.len()).unwrap_or(0),
        control_count = response.options.as_ref().map(|options| options.controls.len()).unwrap_or(0),
        event = "agent.launch_options.served",
        "served harness launch options"
    );
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/launch-options/refresh",
    params(("kind" = String, Path, description = "Harness kind identifier")),
    responses(
        (status = 202, description = "Refresh completed", body = HarnessLaunchOptionsResponse),
        (status = 404, description = "Unknown or uninstalled harness", body = ProblemDetails),
        (status = 409, description = "Refresh cannot run on this target", body = ProblemDetails),
        (status = 502, description = "Harness probe failed", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn refresh_launch_options(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<(StatusCode, Json<HarnessLaunchOptionsResponse>), ApiError> {
    validate_kind(&kind)?;
    state
        .launch_probe_service
        .refresh_now(&kind)
        .await
        .map_err(refresh_error)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(response_for(&state, &kind).await?),
    ))
}

async fn response_for(
    state: &AppState,
    kind: &str,
) -> Result<HarnessLaunchOptionsResponse, ApiError> {
    let readiness = state.agent_runtime.get_agent(kind).await?.agent.status;
    let readiness = readiness_to_contract(readiness);
    match state
        .launch_options_service
        .read(kind)
        .map_err(|error| ApiError::internal(format!("launch-options read failed: {error}")))?
    {
        Some(response) => {
            // Read AFTER the row, so the phase is never older than the state it
            // qualifies, and derived FROM it, so the two cannot contradict.
            let probe_phase = probe_phase_for(state, kind, durable_probe_in_flight(response.state));
            Ok(to_contract(response, readiness, probe_phase))
        }
        // No row at all: nothing is durably in flight, whatever a slot might say.
        None => Ok(HarnessLaunchOptionsResponse {
            harness_kind: kind.to_string(),
            basis_revision: state.launch_options_service.basis_revision(kind),
            revision: 0,
            state: HarnessLaunchOptionsState::Detecting,
            options: None,
            observed_at: None,
            probe_attempted_at: chrono::Utc::now().to_rfc3339(),
            probe_failure_code: None,
            readiness,
            probe_phase: probe_phase_for(state, kind, false),
        }),
    }
}

/// Does the DURABLE row say a probe is in flight? The projected state is that
/// row's own reading of `probe_state`: `detecting` and `refreshing` are exactly
/// `ProbeState::Probing` over an absent or a present last-good observation
/// (`launch_options::service::state_for`). Deriving the phase from the same
/// projection the response carries is what keeps the two consistent by
/// construction instead of by two racing sources of truth.
fn durable_probe_in_flight(state: domain::HarnessLaunchOptionsState) -> bool {
    matches!(
        state,
        domain::HarnessLaunchOptionsState::Detecting
            | domain::HarnessLaunchOptionsState::Refreshing
    )
}

fn validate_kind(kind: &str) -> Result<(), ApiError> {
    ensure_path_safe_identifier(kind, "kind")?;
    descriptor(kind).map(|_| ()).ok_or_else(|| {
        ApiError::not_found(
            format!("unknown agent kind '{kind}'"),
            "HARNESS_LAUNCH_OPTIONS_UNKNOWN_AGENT",
        )
    })
}

fn ensure_path_safe_identifier(value: &str, field: &str) -> Result<(), ApiError> {
    let well_formed = !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        });
    if well_formed {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            format!("{field} must be 1-64 characters of [a-z0-9_-]"),
            "HARNESS_LAUNCH_OPTIONS_INVALID_IDENTIFIER",
        ))
    }
}

fn refresh_error(error: crate::domains::agents::launch_probe::RefreshError) -> ApiError {
    use crate::domains::agents::launch_probe::RefreshError;

    let code = error.code();
    match error {
        RefreshError::NotOwner => ApiError::new(
            StatusCode::CONFLICT,
            "another runtime owns the probe engine for this runtime home",
            None,
            Some(code),
        ),
        RefreshError::NotInstalled(_) => {
            ApiError::new(StatusCode::NOT_FOUND, error.to_string(), None, Some(code))
        }
        RefreshError::Material(material_error) => ApiError::new(
            StatusCode::CONFLICT,
            "this machine's agent-auth configuration cannot be probed",
            Some(material_error.code().to_string()),
            Some(code),
        ),
        RefreshError::Probe(probe_error) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "launch-options probe failed",
            Some(probe_error.code().to_string()),
            Some(code),
        ),
        RefreshError::Persistence(detail) => ApiError::internal(detail),
    }
}

/// This harness's probe phase: the durable row's in-flight answer, refined by the
/// scheduler's live slot. `None` when nothing is in flight durably AND this runtime
/// does not own the probe engine, so the phase is genuinely unknowable here; the
/// field is then omitted from the wire rather than reported as a settled `idle`.
fn probe_phase_for(
    state: &AppState,
    kind: &str,
    durable_in_flight: bool,
) -> Option<AgentAuthProbePhase> {
    state
        .launch_probe_service
        .probe_phase(kind, chrono::Utc::now(), durable_in_flight)
        .map(probe_phase_to_contract)
}

fn readiness_to_contract(status: ResolvedAgentStatus) -> AgentReadinessState {
    match status {
        ResolvedAgentStatus::Ready => AgentReadinessState::Ready,
        ResolvedAgentStatus::InstallRequired => AgentReadinessState::InstallRequired,
        ResolvedAgentStatus::CredentialsRequired => AgentReadinessState::CredentialsRequired,
        ResolvedAgentStatus::LoginRequired => AgentReadinessState::LoginRequired,
        ResolvedAgentStatus::Unsupported => AgentReadinessState::Unsupported,
        ResolvedAgentStatus::Error => AgentReadinessState::Error,
    }
}

fn to_contract(
    response: domain::HarnessLaunchOptionsResponse,
    readiness: AgentReadinessState,
    probe_phase: Option<AgentAuthProbePhase>,
) -> HarnessLaunchOptionsResponse {
    HarnessLaunchOptionsResponse {
        harness_kind: response.harness_kind,
        basis_revision: response.basis_revision,
        revision: response.revision,
        state: match response.state {
            domain::HarnessLaunchOptionsState::Detecting => HarnessLaunchOptionsState::Detecting,
            domain::HarnessLaunchOptionsState::Refreshing => HarnessLaunchOptionsState::Refreshing,
            domain::HarnessLaunchOptionsState::Observed => HarnessLaunchOptionsState::Observed,
            domain::HarnessLaunchOptionsState::ObservedEmpty => {
                HarnessLaunchOptionsState::ObservedEmpty
            }
            domain::HarnessLaunchOptionsState::LastGoodAfterFailure => {
                HarnessLaunchOptionsState::LastGoodAfterFailure
            }
            domain::HarnessLaunchOptionsState::FailedWithoutObservation => {
                HarnessLaunchOptionsState::FailedWithoutObservation
            }
        },
        options: response.options.map(|options| HarnessLaunchOptions {
            models: options
                .models
                .into_iter()
                .map(|model| HarnessLaunchModel {
                    id: model.id,
                    observed_name: model.observed_name,
                    observed_description: model.observed_description,
                })
                .collect(),
            controls: options
                .controls
                .into_iter()
                .map(|control| HarnessLaunchControl {
                    id: control.id,
                    observed_label: control.observed_label,
                    observed_description: control.observed_description,
                    values: control
                        .values
                        .into_iter()
                        .map(|value| HarnessLaunchControlValue {
                            value: value.value,
                            observed_label: value.observed_label,
                            observed_description: value.observed_description,
                        })
                        .collect(),
                })
                .collect(),
            defaults: HarnessLaunchDefaults {
                model_id: options.defaults.model_id,
                control_values: options.defaults.control_values,
            },
            model_controls: options
                .model_controls
                .into_iter()
                .map(|scope| HarnessLaunchModelControls {
                    model_id: scope.model_id,
                    controls: scope
                        .controls
                        .into_iter()
                        .map(|control| HarnessLaunchControl {
                            id: control.id,
                            observed_label: control.observed_label,
                            observed_description: control.observed_description,
                            values: control
                                .values
                                .into_iter()
                                .map(|value| HarnessLaunchControlValue {
                                    value: value.value,
                                    observed_label: value.observed_label,
                                    observed_description: value.observed_description,
                                })
                                .collect(),
                        })
                        .collect(),
                    default_control_values: scope.default_control_values,
                })
                .collect(),
        }),
        observed_at: response.observed_at,
        probe_attempted_at: response.probe_attempted_at,
        probe_failure_code: response.probe_failure_code,
        readiness,
        probe_phase,
    }
}
