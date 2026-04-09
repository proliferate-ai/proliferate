use anyharness_contract::v1::{
    AgentCredentialState, AgentInstallState, AgentReadinessState, AgentSummary, ArtifactStatus,
    InstallAgentRequest, InstallAgentResponse, LoginCommand, ProblemDetails, ReconcileAgentResult,
    ReconcileAgentsRequest, ReconcileAgentsResponse, ReconcileJobStatus, ReconcileOutcome,
    StartAgentLoginRequest, StartAgentLoginResponse,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use crate::agents::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use crate::agents::model::*;
use crate::agents::reconcile::{
    AgentReconcileOutcome, AgentReconcileResult as InternalAgentReconcileResult,
};
use crate::agents::reconcile_execution::{AgentReconcileJobSnapshot, AgentReconcileJobStatus};
use crate::agents::registry::built_in_registry;
use crate::agents::resolver::resolve_agent;
use crate::app::AppState;

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

#[utoipa::path(
    get,
    path = "/v1/agents",
    responses(
        (status = 200, description = "List all supported agents with readiness state", body = Vec<AgentSummary>),
    ),
    tag = "agents"
)]
pub async fn list_agents(State(state): State<AppState>) -> Json<Vec<AgentSummary>> {
    let registry = built_in_registry();
    let reconcile_snapshot = state.agent_reconcile_service.snapshot().await;
    let summaries: Vec<AgentSummary> = registry
        .iter()
        .map(|desc| {
            to_summary(
                &resolve_agent(desc, &state.runtime_home),
                Some(&reconcile_snapshot),
            )
        })
        .collect();
    Json(summaries)
}

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "Agent readiness summary", body = AgentSummary),
        (status = 404, description = "Agent not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn get_agent(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<AgentSummary>, ProblemResponse> {
    let registry = built_in_registry();
    let desc = registry.iter().find(|d| d.kind.as_str() == kind);
    let reconcile_snapshot = state.agent_reconcile_service.snapshot().await;
    match desc {
        Some(desc) => Ok(Json(to_summary(
            &resolve_agent(desc, &state.runtime_home),
            Some(&reconcile_snapshot),
        ))),
        None => Err(agent_not_found(&kind)),
    }
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/install",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    request_body = InstallAgentRequest,
    responses(
        (status = 200, description = "Agent installed successfully", body = InstallAgentResponse),
        (status = 400, description = "Agent not installable or not found", body = ProblemDetails),
        (status = 500, description = "Install failed", body = ProblemDetails),
        (status = 502, description = "Download or registry failed", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn install_agent(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Json(req): Json<InstallAgentRequest>,
) -> Result<Json<InstallAgentResponse>, ProblemResponse> {
    let registry = built_in_registry();
    let desc = registry.iter().find(|d| d.kind.as_str() == kind);
    let desc = match desc {
        Some(d) => d,
        None => return Err(agent_not_found(&kind)),
    };

    let options = InstallOptions {
        reinstall: req.reinstall,
        native_version: req.native_version,
        agent_process_version: req.agent_process_version,
    };

    tracing::info!(
        agent = %kind,
        reinstall = options.reinstall,
        native_version = ?options.native_version,
        agent_process_version = ?options.agent_process_version,
        runtime_home = %state.runtime_home.display(),
        "installing agent"
    );

    let installed_artifacts = installer::install_agent(desc, &state.runtime_home, &options)
        .map_err(|error| {
            tracing::error!(
                agent = %kind,
                reinstall = options.reinstall,
                native_version = ?options.native_version,
                agent_process_version = ?options.agent_process_version,
                runtime_home = %state.runtime_home.display(),
                error = %error,
                "agent install failed"
            );
            install_error_to_problem(error)
        })?;
    let resolved = resolve_agent(desc, &state.runtime_home);
    let summary = to_summary(&resolved, None);
    let already_installed = installed_artifacts.is_empty();

    tracing::info!(
        agent = %kind,
        already_installed,
        installed_artifact_count = installed_artifacts.len(),
        "agent install completed"
    );

    Ok(Json(InstallAgentResponse {
        agent: summary,
        already_installed,
        installed_artifacts: installed_artifacts
            .iter()
            .map(to_installed_artifact_status)
            .collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/login/start",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    request_body = StartAgentLoginRequest,
    responses(
        (status = 200, description = "Login instructions returned", body = StartAgentLoginResponse),
        (status = 400, description = "Login not supported", body = ProblemDetails),
        (status = 404, description = "Agent not found", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn start_agent_login(
    Path(kind): Path<String>,
    Json(_req): Json<StartAgentLoginRequest>,
) -> Result<Json<StartAgentLoginResponse>, ProblemResponse> {
    let registry = built_in_registry();
    let desc = registry.iter().find(|d| d.kind.as_str() == kind);
    let desc = match desc {
        Some(d) => d,
        None => return Err(agent_not_found(&kind)),
    };

    match &desc.auth.login {
        Some(login) => Ok(Json(StartAgentLoginResponse {
            kind: desc.kind.as_str().into(),
            label: login.label.clone(),
            mode: "terminal_command".into(),
            command: LoginCommand {
                program: login.command.program.clone(),
                args: login.command.args.clone(),
            },
            reuses_user_state: login.reuses_user_state,
            message: login.message.clone(),
        })),
        None => Err(problem(
            400,
            "Login not supported",
            Some(format!("Agent {kind} does not support native login")),
            Some("LOGIN_NOT_SUPPORTED"),
        )),
    }
}

#[utoipa::path(
    get,
    path = "/v1/agents/reconcile",
    responses(
        (status = 200, description = "Current agent reconcile status", body = ReconcileAgentsResponse),
    ),
    tag = "agents"
)]
pub async fn get_reconcile_status(State(state): State<AppState>) -> Json<ReconcileAgentsResponse> {
    let snapshot = state.agent_reconcile_service.snapshot().await;
    Json(reconcile_snapshot_to_contract(&snapshot))
}

#[utoipa::path(
    post,
    path = "/v1/agents/reconcile",
    request_body = ReconcileAgentsRequest,
    responses(
        (status = 202, description = "Agent reconcile started or reused", body = ReconcileAgentsResponse),
    ),
    tag = "agents"
)]
pub async fn reconcile_agents(
    State(state): State<AppState>,
    Json(req): Json<ReconcileAgentsRequest>,
) -> (StatusCode, Json<ReconcileAgentsResponse>) {
    let snapshot = state
        .agent_reconcile_service
        .start_or_get(
            built_in_registry(),
            state.runtime_home.clone(),
            req.reinstall,
        )
        .await;
    (
        StatusCode::ACCEPTED,
        Json(reconcile_snapshot_to_contract(&snapshot)),
    )
}

fn reconcile_result_to_contract(result: &InternalAgentReconcileResult) -> ReconcileAgentResult {
    ReconcileAgentResult {
        kind: result.kind.as_str().into(),
        outcome: match result.outcome {
            AgentReconcileOutcome::Installed => ReconcileOutcome::Installed,
            AgentReconcileOutcome::AlreadyInstalled => ReconcileOutcome::AlreadyInstalled,
            AgentReconcileOutcome::Skipped => ReconcileOutcome::Skipped,
            AgentReconcileOutcome::Failed => ReconcileOutcome::Failed,
        },
        message: result.message.clone(),
        installed_artifacts: result
            .installed_artifacts
            .iter()
            .map(to_installed_artifact_status)
            .collect(),
    }
}

fn reconcile_snapshot_to_contract(snapshot: &AgentReconcileJobSnapshot) -> ReconcileAgentsResponse {
    ReconcileAgentsResponse {
        status: match snapshot.status {
            AgentReconcileJobStatus::Idle => ReconcileJobStatus::Idle,
            AgentReconcileJobStatus::Queued => ReconcileJobStatus::Queued,
            AgentReconcileJobStatus::Running => ReconcileJobStatus::Running,
            AgentReconcileJobStatus::Completed => ReconcileJobStatus::Completed,
            AgentReconcileJobStatus::Failed => ReconcileJobStatus::Failed,
        },
        job_id: snapshot.job_id.clone(),
        reinstall: snapshot.reinstall,
        results: snapshot
            .results
            .iter()
            .map(reconcile_result_to_contract)
            .collect(),
        started_at: snapshot.started_at.clone(),
        finished_at: snapshot.finished_at.clone(),
        message: snapshot.message.clone(),
    }
}

fn to_summary(
    resolved: &ResolvedAgent,
    reconcile_snapshot: Option<&AgentReconcileJobSnapshot>,
) -> AgentSummary {
    let desc = &resolved.descriptor;

    let credential_state = match &resolved.credential_state {
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth => AgentCredentialState::Ready,
        CredentialState::MissingEnv => AgentCredentialState::MissingEnv,
        CredentialState::LoginRequired => AgentCredentialState::LoginRequired,
    };

    let readiness = match &resolved.status {
        ResolvedAgentStatus::Ready => AgentReadinessState::Ready,
        ResolvedAgentStatus::InstallRequired => AgentReadinessState::InstallRequired,
        ResolvedAgentStatus::CredentialsRequired => AgentReadinessState::CredentialsRequired,
        ResolvedAgentStatus::LoginRequired => AgentReadinessState::LoginRequired,
        ResolvedAgentStatus::Unsupported => AgentReadinessState::Unsupported,
        ResolvedAgentStatus::Error => AgentReadinessState::Error,
    };

    let message = match &resolved.status {
        ResolvedAgentStatus::Ready => None,
        ResolvedAgentStatus::InstallRequired => {
            if !resolved.agent_process.installed {
                resolved.agent_process.message.clone()
            } else {
                resolved.native.as_ref().and_then(|n| n.message.clone())
            }
        }
        ResolvedAgentStatus::CredentialsRequired => {
            Some(format!("Set one of: {}", desc.auth.env_vars.join(", ")))
        }
        ResolvedAgentStatus::LoginRequired => desc.auth.login.as_ref().map(|l| {
            format!(
                "Run `{} {}` to authenticate.",
                l.command.program,
                l.command.args.join(" ")
            )
        }),
        ResolvedAgentStatus::Unsupported => resolved
            .agent_process
            .message
            .clone()
            .or_else(|| {
                resolved
                    .native
                    .as_ref()
                    .and_then(|artifact| artifact.message.clone())
            })
            .or_else(|| Some("Agent is installed but not supported in this runtime.".into())),
        ResolvedAgentStatus::Error => resolved
            .agent_process
            .message
            .clone()
            .or_else(|| {
                resolved
                    .native
                    .as_ref()
                    .and_then(|artifact| artifact.message.clone())
            })
            .or_else(|| Some("Agent resolution encountered an error.".into())),
    };

    AgentSummary {
        kind: desc.kind.as_str().into(),
        display_name: desc.kind.display_name().into(),
        install_state: to_install_state(resolved, reconcile_snapshot),
        native_required: desc.native.is_some(),
        native: resolved.native.as_ref().map(to_artifact_status),
        agent_process: to_artifact_status(&resolved.agent_process),
        credential_state,
        readiness,
        supports_login: desc.auth.login.is_some(),
        expected_env_vars: desc.auth.env_vars.clone(),
        docs_url: desc.docs_url.clone(),
        message,
    }
}

fn to_install_state(
    resolved: &ResolvedAgent,
    reconcile_snapshot: Option<&AgentReconcileJobSnapshot>,
) -> AgentInstallState {
    if let Some(snapshot) = reconcile_snapshot {
        if matches!(
            snapshot.status,
            AgentReconcileJobStatus::Queued | AgentReconcileJobStatus::Running
        ) && snapshot.current_agent.as_ref() == Some(&resolved.descriptor.kind)
        {
            return AgentInstallState::Installing;
        }

        let latest_result = snapshot
            .results
            .iter()
            .rev()
            .find(|result| result.kind == resolved.descriptor.kind);
        if matches!(resolved.status, ResolvedAgentStatus::InstallRequired)
            && latest_result.is_some_and(|result| result.outcome == AgentReconcileOutcome::Failed)
        {
            return AgentInstallState::Failed;
        }
    }

    if matches!(resolved.status, ResolvedAgentStatus::InstallRequired) {
        AgentInstallState::InstallRequired
    } else {
        AgentInstallState::Installed
    }
}

fn to_artifact_status(artifact: &ResolvedArtifact) -> ArtifactStatus {
    ArtifactStatus {
        role: match artifact.role {
            ArtifactRole::NativeCli => "native_cli".into(),
            ArtifactRole::AgentProcess => "agent_process".into(),
        },
        installed: artifact.installed,
        source: artifact.source.clone(),
        version: artifact.version.clone(),
        path: artifact.path.as_ref().map(|p| p.display().to_string()),
        message: artifact.message.clone(),
    }
}

fn to_installed_artifact_status(artifact: &InstalledArtifactResult) -> ArtifactStatus {
    ArtifactStatus {
        role: match artifact.role {
            ArtifactRole::NativeCli => "native_cli".into(),
            ArtifactRole::AgentProcess => "agent_process".into(),
        },
        installed: true,
        source: Some(artifact.source.clone()),
        version: artifact.version.clone(),
        path: Some(artifact.path.display().to_string()),
        message: None,
    }
}

fn install_error_to_problem(error: InstallError) -> ProblemResponse {
    let detail = error.to_string();
    let (status, title, code) = match &error {
        InstallError::NotInstallable => (400, "Agent is not installable", "AGENT_NOT_INSTALLABLE"),
        InstallError::UnsupportedPlatform => (
            400,
            "Unsupported platform for managed install",
            "UNSUPPORTED_PLATFORM",
        ),
        InstallError::InvalidInstallSpec(_) => (
            500,
            "Agent install configuration is invalid",
            "AGENT_INSTALL_INVALID_SPEC",
        ),
        InstallError::CommandFailed { .. } => (500, "Agent install failed", "AGENT_INSTALL_FAILED"),
        InstallError::MissingManagedArtifact(_) => (
            500,
            "Installed artifact missing after install",
            "AGENT_INSTALL_INCOMPLETE",
        ),
        InstallError::FetchFailed { .. } => (
            502,
            "Failed to download agent artifact",
            "AGENT_DOWNLOAD_FAILED",
        ),
        InstallError::RegistryFailed(_) => {
            (502, "ACP registry lookup failed", "AGENT_REGISTRY_FAILED")
        }
        InstallError::Io(_) => (500, "Agent install failed", "AGENT_INSTALL_IO_ERROR"),
    };

    problem(status as u16, title, Some(detail), Some(code))
}
