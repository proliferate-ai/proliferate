//! Agents wire <-> domain mappers. Dep-less, sync, decisionless: no &state,
//! no IO. The only file that sees both vocabularies for the agents family.

use anyharness_contract::v1::{
    AgentCredentialState, AgentInstallState, AgentLaunchModelOption, AgentLaunchOption,
    AgentLaunchOptionsResponse, AgentLoginTerminalRecord, AgentLoginTerminalStatus,
    AgentReadinessState, AgentReconcileSummary, AgentSummary, ArtifactStatus, InstallAgentRequest,
    ReconcileAgentResult, ReconcileAgentsResponse, ReconcileJobStatus, ReconcileOutcome,
};

use crate::domains::agents::auth::login_terminal::{
    AgentLoginTerminalRecord as InternalAgentLoginTerminalRecord,
    AgentLoginTerminalStatus as InternalAgentLoginTerminalStatus,
};
use crate::domains::agents::installer::reconcile::execution::{
    AgentReconcileJobSnapshot, AgentReconcileJobStatus,
};
use crate::domains::agents::installer::reconcile::{
    AgentReconcileOutcome, AgentReconcileResult as InternalAgentReconcileResult,
};
use crate::domains::agents::installer::InstalledArtifactResult;
use crate::domains::agents::model::*;
use crate::domains::agents::runtime::AgentInstallRequest as DomainInstallAgentRequest;

pub(super) fn install_request(req: InstallAgentRequest) -> DomainInstallAgentRequest {
    DomainInstallAgentRequest {
        reinstall: req.reinstall,
        native_version: req.native_version,
        agent_process_version: req.agent_process_version,
    }
}

pub(super) fn reconcile_snapshot_to_contract(
    snapshot: &AgentReconcileJobSnapshot,
) -> ReconcileAgentsResponse {
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

pub(super) fn reconcile_summary_to_contract(
    snapshot: &AgentReconcileJobSnapshot,
) -> AgentReconcileSummary {
    let mut installed = 0u32;
    let mut already_installed = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    for result in &snapshot.results {
        match result.outcome {
            AgentReconcileOutcome::Installed => installed += 1,
            AgentReconcileOutcome::AlreadyInstalled => already_installed += 1,
            AgentReconcileOutcome::Skipped => skipped += 1,
            AgentReconcileOutcome::Failed => failed += 1,
        }
    }
    AgentReconcileSummary {
        status: match snapshot.status {
            AgentReconcileJobStatus::Idle => ReconcileJobStatus::Idle,
            AgentReconcileJobStatus::Queued => ReconcileJobStatus::Queued,
            AgentReconcileJobStatus::Running => ReconcileJobStatus::Running,
            AgentReconcileJobStatus::Completed => ReconcileJobStatus::Completed,
            AgentReconcileJobStatus::Failed => ReconcileJobStatus::Failed,
        },
        current_agent: snapshot
            .current_agent
            .as_ref()
            .map(|kind| kind.as_str().to_string()),
        installed,
        already_installed,
        skipped,
        failed,
    }
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

pub(super) fn to_summary(
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
        ResolvedAgentStatus::CredentialsRequired => Some(format!(
            "Set one of: {}",
            desc.auth.expected_env_vars().join(", ")
        )),
        ResolvedAgentStatus::LoginRequired => desc
            .auth
            .primary_login()
            .map(|_| format!("Sign in with {} in Proliferate.", desc.kind.display_name())),
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
        supports_login: desc.auth.supports_login(),
        expected_env_vars: desc.auth.expected_env_vars(),
        docs_url: desc.docs_url.clone(),
        message,
    }
}

pub(super) fn agent_login_terminal_to_contract(
    record: InternalAgentLoginTerminalRecord,
) -> AgentLoginTerminalRecord {
    AgentLoginTerminalRecord {
        id: record.id,
        kind: record.kind,
        title: record.title,
        status: match record.status {
            InternalAgentLoginTerminalStatus::Starting => AgentLoginTerminalStatus::Starting,
            InternalAgentLoginTerminalStatus::Running => AgentLoginTerminalStatus::Running,
            InternalAgentLoginTerminalStatus::Exited => AgentLoginTerminalStatus::Exited,
            InternalAgentLoginTerminalStatus::Failed => AgentLoginTerminalStatus::Failed,
        },
        cwd: record.cwd,
        command_display: record.command_display,
        exit_code: record.exit_code,
        created_at: record.created_at,
        updated_at: record.updated_at,
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

pub(super) fn to_installed_artifact_status(artifact: &InstalledArtifactResult) -> ArtifactStatus {
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

pub(super) fn launch_options_response(
    workspace_id: Option<String>,
    options: crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions,
) -> AgentLaunchOptionsResponse {
    AgentLaunchOptionsResponse {
        workspace_id,
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
    }
}
