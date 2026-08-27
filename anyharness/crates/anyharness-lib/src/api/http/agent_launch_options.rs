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
use crate::domains::agents::launch_probe::{LivePhaseReading, ProbeEngineMode};
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
    // Recompose the status document too. Probe writers deliberately no longer
    // recompose (a verdict carrying an older state-file read used to revert the
    // served auth world), so this door is what makes pressing Refresh pick up a
    // document that changed without passing through this runtime's apply door.
    // Blocking-pool work: two state.json reads, native detection over the real
    // `$HOME`, a seat-cooling read and a status row read+write.
    let status_service = state.agent_status_service.clone();
    let refreshed = kind.clone();
    super::blocking::run_blocking("agent-auth manual status refresh", move || {
        status_service.refresh(
            &refreshed,
            crate::domains::agents::status::RefreshCause::ManualRefresh,
        );
        Ok::<(), std::convert::Infallible>(())
    })
    .await?
    .ok();
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
    let can_manually_refresh = can_manually_refresh(state);
    // Read the SLOT FIRST and the row second, and never the other way round.
    //
    // These two reads cannot be made atomic, so one of them is always the older
    // half of the answer. Row-first is the unsafe order: an attempt that commits
    // between the reads leaves the row saying `probing` (read before the commit)
    // beside a slot saying `idle` (read after it) — the exact pair that means
    // ORPHAN, so the fresh observation would be settled away and served as
    // terminal, and the client would stop polling before ever seeing it.
    // Slot-first cannot produce that pair. Its worst case is a slot livelier than
    // the row, which reports an in-flight phase for one extra tick — a client that
    // polls 1.5s longer than it had to, and nothing else.
    let now = chrono::Utc::now();
    let live = state.launch_probe_service.live_probe_phase(kind, now);
    match state
        .launch_options_service
        .read_with_probe_state(kind)
        .map_err(|error| ApiError::internal(format!("launch-options read failed: {error}")))?
    {
        Some(mut read) => {
            let probe_phase = refine(state, live, read.read_at, attempt_started_at(&read), now);
            if read.probe_in_flight && !phase_is_in_flight(probe_phase.as_ref()) {
                // The row claimed an attempt and nothing honoured the claim. The
                // state has to withdraw it too: `refreshing` is waited on without
                // consulting the phase at all, so a phase-only withdrawal would
                // leave the wire contradicting itself and the client polling.
                read.settle_orphan();
            }
            Ok(to_contract(
                read.response,
                readiness,
                probe_phase,
                can_manually_refresh,
            ))
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
            probe_phase: refine(state, live, now, None, now),
            can_manually_refresh,
        }),
    }
}

/// Can a refresh dispatched at THIS runtime run at all?
///
/// Engine ownership only, deliberately. `refresh_now` also rejects a harness that
/// is not installed, but install state is already on this very response as
/// `readiness`, and folding the two into one boolean would make a surface unable
/// to tell "install this harness" from "this runtime can never refresh anything" —
/// two different remedies behind one false. Ownership is the fact that appears
/// nowhere else on any wire.
fn can_manually_refresh(state: &AppState) -> bool {
    state.launch_probe_service.mode() == ProbeEngineMode::Owner
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
fn refine(
    state: &AppState,
    live: LivePhaseReading,
    row_read_at: chrono::DateTime<chrono::Utc>,
    in_flight_since: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<AgentAuthProbePhase> {
    state
        .launch_probe_service
        .refine_row_claim(live, row_read_at, in_flight_since, now)
        .map(probe_phase_to_contract)
}

/// When the row's in-flight attempt began, for the age bound that decides whether
/// it can still be believed. An unparseable stamp is not believed at all: a claim
/// whose age cannot be established is exactly the claim that could be forever old.
fn attempt_started_at(read: &domain::LaunchOptionsRead) -> Option<chrono::DateTime<chrono::Utc>> {
    if !read.probe_in_flight {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(&read.response.probe_attempted_at)
        .ok()
        .map(|value| value.with_timezone(&chrono::Utc))
}

/// Is the response's phase one a client should keep waiting on?
fn phase_is_in_flight(phase: Option<&AgentAuthProbePhase>) -> bool {
    matches!(
        phase,
        Some(AgentAuthProbePhase::Queued | AgentAuthProbePhase::Running)
    )
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
    can_manually_refresh: bool,
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
        can_manually_refresh,
    }
}
