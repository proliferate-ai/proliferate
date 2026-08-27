//! Agents wire <-> domain mappers. Dep-less, sync, decisionless: no &state,
//! no IO. The only file that sees both vocabularies for the agents family.

use anyharness_contract::v1::{
    AgentAuthCredentialEvidence, AgentAuthCredentialSource, AgentAuthDisplay, AgentAuthEvidenceRef,
    AgentAuthEvidenceStrength, AgentAuthFactsSummary, AgentAuthGatewayHealth,
    AgentAuthLoginHandoff, AgentAuthNextAction, AgentAuthProbeLifecycle, AgentAuthProbePhase,
    AgentAuthSelectionFact, AgentAuthStateSummary, AgentCliAuthState, AgentCredentialState,
    AgentInstallProgress, AgentInstallProgressComponent, AgentInstallProgressPhase,
    AgentInstallState,
    AgentLoginTerminalRecord, AgentLoginTerminalStatus, AgentMintCaptureStatus,
    AgentReadinessState, AgentReconcileSummary,
    AgentSummary, ArtifactStatus, InstallAgentRequest,
    ReconcileAgentResult, ReconcileAgentsResponse, ReconcileJobStatus, ReconcileOutcome,
};

use crate::domains::agents::auth_state::{
    self, AuthDisplay, AuthRuntimeInputs, CredentialEvidence, CredentialEvidenceStrength,
    CredentialSource, EvidenceRef, GatewayHealth, LoginHandoff, NextAction, ProbeLifecycle,
    ProbePhase, SelectionFact,
};

use crate::domains::agents::auth::login_terminal::{
    AgentLoginTerminalRecord as InternalAgentLoginTerminalRecord,
    AgentLoginTerminalStatus as InternalAgentLoginTerminalStatus,
    MintCaptureStatus as InternalMintCaptureStatus,
};
use crate::domains::agents::installer::progress::InstallProgressPhase;
use crate::domains::agents::installer::reconcile::execution::{
    AgentInstallComponentProgress, AgentReconcileJobSnapshot, AgentReconcileJobStatus,
};
use crate::domains::agents::installer::reconcile::{
    AgentReconcileOutcome, AgentReconcileResult as InternalAgentReconcileResult,
};
use crate::domains::agents::installer::InstalledArtifactResult;
use crate::domains::agents::model::*;
use crate::domains::agents::readiness::service::has_user_path_copy;
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
        installed_only: Some(snapshot.installed_only),
        current_agent: snapshot
            .current_agent
            .as_ref()
            .map(|kind| kind.as_str().to_string()),
        progress: reconcile_progress_to_contract(&snapshot.components),
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

fn reconcile_progress_to_contract(
    components: &[AgentInstallComponentProgress],
) -> Option<AgentInstallProgress> {
    if components.is_empty() {
        return None;
    }
    let downloaded_bytes = components
        .iter()
        .map(|component| component.downloaded_bytes)
        .sum();
    let download_size_bytes = components
        .iter()
        .map(|component| component.download_size_bytes)
        .collect::<Option<Vec<_>>>()
        .map(|sizes| sizes.into_iter().sum());
    let completed_components = components
        .iter()
        .filter(|component| {
            matches!(
                component.phase,
                InstallProgressPhase::Completed
                    | InstallProgressPhase::Skipped
                    | InstallProgressPhase::Failed
            )
        })
        .count() as u32;
    Some(AgentInstallProgress {
        downloaded_bytes,
        download_size_bytes,
        completed_components,
        total_components: components.len() as u32,
        components: components
            .iter()
            .map(install_component_progress_to_contract)
            .collect(),
    })
}

fn install_component_progress_to_contract(
    component: &AgentInstallComponentProgress,
) -> AgentInstallProgressComponent {
    AgentInstallProgressComponent {
        agent: component.agent.as_str().to_string(),
        role: match component.role {
            ArtifactRole::NativeCli => "native_cli".into(),
            ArtifactRole::AgentProcess => "agent_process".into(),
        },
        phase: match component.phase {
            InstallProgressPhase::Queued => AgentInstallProgressPhase::Queued,
            InstallProgressPhase::Downloading => AgentInstallProgressPhase::Downloading,
            InstallProgressPhase::Verifying => AgentInstallProgressPhase::Verifying,
            InstallProgressPhase::Extracting => AgentInstallProgressPhase::Extracting,
            InstallProgressPhase::Installing => AgentInstallProgressPhase::Installing,
            InstallProgressPhase::Finalizing => AgentInstallProgressPhase::Finalizing,
            InstallProgressPhase::Completed => AgentInstallProgressPhase::Completed,
            InstallProgressPhase::Skipped => AgentInstallProgressPhase::Skipped,
            InstallProgressPhase::Failed => AgentInstallProgressPhase::Failed,
        },
        downloaded_bytes: component.downloaded_bytes,
        download_size_bytes: component.download_size_bytes,
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
        failure_kind: result.failure_kind.map(|kind| kind.as_str().to_string()),
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
    auth_runtime: &AuthRuntimeInputs,
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

    let cli_auth_state = resolved.cli_auth_state.map(|state| match state {
        CliAuthState::Authenticated => AgentCliAuthState::Authenticated,
        CliAuthState::Expired => AgentCliAuthState::Expired,
        CliAuthState::Absent => AgentCliAuthState::Absent,
        CliAuthState::Unsupported => AgentCliAuthState::Unsupported,
    });

    AgentSummary {
        kind: desc.kind.as_str().into(),
        display_name: desc.kind.display_name().into(),
        install_state: to_install_state(resolved, reconcile_snapshot),
        native_required: desc.native.is_some(),
        native: resolved.native.as_ref().map(to_artifact_status),
        agent_process: to_artifact_status(&resolved.agent_process),
        credential_state,
        credentials_from_route: resolved.credentials_from_route,
        readiness,
        supports_login: desc.auth.supports_login(),
        expected_env_vars: desc.auth.expected_env_vars(),
        docs_url: desc.docs_url.clone(),
        message,
        cli_auth_state,
        user_path_copy_detected: has_user_path_copy(desc),
        auth_state: Some(to_auth_state_summary(resolved, auth_runtime)),
    }
}

/// Compute the canonical agent-auth evidence model for the wire. Builds the
/// orthogonal facts from the resolved agent, folds them through the ONE shared
/// derivation, and maps both onto the wire vocabulary. Additive: this never
/// touches `credentialState`/`readiness` above.
fn to_auth_state_summary(
    resolved: &ResolvedAgent,
    auth_runtime: &AuthRuntimeInputs,
) -> AgentAuthStateSummary {
    let facts = auth_state::facts_from_resolved_with_runtime(resolved, auth_runtime);
    let derived = auth_state::derive_agent_auth_state(&facts);
    AgentAuthStateSummary {
        display: auth_display_to_contract(derived.display),
        next_action: auth_next_action_to_contract(derived.next_action),
        evidence_ref: derived.evidence_ref.map(auth_evidence_ref_to_contract),
        evidence_age_seconds: derived.evidence_age_seconds,
        facts: auth_facts_to_contract(&facts),
        serving_seat_id: auth_runtime.seat_rotation.serving_seat_id.clone(),
        next_seat_id: auth_runtime.seat_rotation.next_seat_id.clone(),
        cooling_until: auth_runtime.seat_rotation.cooling_until.clone(),
    }
}

fn auth_display_to_contract(display: AuthDisplay) -> AgentAuthDisplay {
    match display {
        AuthDisplay::NotInstalled => AgentAuthDisplay::NotInstalled,
        AuthDisplay::Unsupported => AgentAuthDisplay::Unsupported,
        AuthDisplay::Misconfigured => AgentAuthDisplay::Misconfigured,
        AuthDisplay::Expired => AgentAuthDisplay::Expired,
        AuthDisplay::Unavailable => AgentAuthDisplay::Unavailable,
        AuthDisplay::Probing => AgentAuthDisplay::Probing,
        AuthDisplay::Usable => AgentAuthDisplay::Usable,
        AuthDisplay::Authenticated => AgentAuthDisplay::Authenticated,
        AuthDisplay::Selected => AgentAuthDisplay::Selected,
        AuthDisplay::Installed => AgentAuthDisplay::Installed,
    }
}

fn auth_next_action_to_contract(action: NextAction) -> AgentAuthNextAction {
    match action {
        NextAction::Install => AgentAuthNextAction::Install,
        NextAction::None => AgentAuthNextAction::None,
        NextAction::FixConfig => AgentAuthNextAction::FixConfig,
        NextAction::LogInOrPasteKey => AgentAuthNextAction::LogInOrPasteKey,
        NextAction::TopUpOrRetry => AgentAuthNextAction::TopUpOrRetry,
        NextAction::Wait => AgentAuthNextAction::Wait,
        NextAction::WaitForProbe => AgentAuthNextAction::WaitForProbe,
        NextAction::ChooseSource => AgentAuthNextAction::ChooseSource,
    }
}

fn auth_evidence_ref_to_contract(evidence: EvidenceRef) -> AgentAuthEvidenceRef {
    match evidence {
        EvidenceRef::ProbeObservation => AgentAuthEvidenceRef::ProbeObservation,
        EvidenceRef::GatewayKeyCheck => AgentAuthEvidenceRef::GatewayKeyCheck,
        EvidenceRef::AcknowledgedRoute => AgentAuthEvidenceRef::AcknowledgedRoute,
    }
}

fn auth_facts_to_contract(facts: &auth_state::AgentAuthFacts) -> AgentAuthFactsSummary {
    AgentAuthFactsSummary {
        installed: facts.installed,
        unsupported_route: facts.unsupported_route,
        misconfigured: facts.misconfigured,
        expired: facts.expired,
        credential: facts.credential.as_ref().map(auth_credential_to_contract),
        selection: facts.selection.as_ref().map(auth_selection_to_contract),
        probe: auth_probe_to_contract(&facts.probe),
        gateway: facts.gateway.map(auth_gateway_to_contract),
        handoff: facts.handoff.map(auth_handoff_to_contract),
    }
}

fn auth_credential_to_contract(credential: &CredentialEvidence) -> AgentAuthCredentialEvidence {
    AgentAuthCredentialEvidence {
        source: match credential.source {
            CredentialSource::Gateway => AgentAuthCredentialSource::Gateway,
            CredentialSource::ApiKeyByok => AgentAuthCredentialSource::ApiKeyByok,
            CredentialSource::NativeLogin => AgentAuthCredentialSource::NativeLogin,
        },
        strength: match credential.strength {
            CredentialEvidenceStrength::BarePresence => AgentAuthEvidenceStrength::BarePresence,
            CredentialEvidenceStrength::AcknowledgedRoute => {
                AgentAuthEvidenceStrength::AcknowledgedRoute
            }
            CredentialEvidenceStrength::Tier1Trial => AgentAuthEvidenceStrength::Tier1Trial,
            CredentialEvidenceStrength::ProbeObservation => {
                AgentAuthEvidenceStrength::ProbeObservation
            }
        },
        evidence_age_seconds: credential.evidence_age_seconds,
    }
}

fn auth_selection_to_contract(selection: &SelectionFact) -> AgentAuthSelectionFact {
    AgentAuthSelectionFact {
        acknowledged: selection.acknowledged,
        revision: selection.revision,
        satisfiable: selection.satisfiable,
        acknowledged_age_seconds: selection.acknowledged_age_seconds,
    }
}

/// The probe lifecycle's phase on the wire. Shared with the launch-options
/// response, which carries the same phase for the same harness.
pub(super) fn probe_phase_to_contract(phase: ProbePhase) -> AgentAuthProbePhase {
    match phase {
        ProbePhase::Idle => AgentAuthProbePhase::Idle,
        ProbePhase::Queued => AgentAuthProbePhase::Queued,
        ProbePhase::Running => AgentAuthProbePhase::Running,
        ProbePhase::Backoff => AgentAuthProbePhase::Backoff,
    }
}

fn auth_probe_to_contract(probe: &ProbeLifecycle) -> AgentAuthProbeLifecycle {
    AgentAuthProbeLifecycle {
        phase: probe_phase_to_contract(probe.phase),
        last_success_age_seconds: probe.last_success_age_seconds,
        last_failure_detail: probe.last_failure_detail.clone(),
        next_attempt_at: probe.next_attempt_at.clone(),
        observation_nonempty: probe.observation_nonempty,
    }
}

fn auth_gateway_to_contract(gateway: GatewayHealth) -> AgentAuthGatewayHealth {
    match gateway {
        GatewayHealth::Reachable => AgentAuthGatewayHealth::Reachable,
        GatewayHealth::Unreachable => AgentAuthGatewayHealth::Unreachable,
        GatewayHealth::Unauthorized => AgentAuthGatewayHealth::Unauthorized,
        GatewayHealth::ModelsDrifted => AgentAuthGatewayHealth::ModelsDrifted,
        GatewayHealth::BudgetExhausted => AgentAuthGatewayHealth::BudgetExhausted,
    }
}

fn auth_handoff_to_contract(handoff: LoginHandoff) -> AgentAuthLoginHandoff {
    match handoff {
        LoginHandoff::Initiated => AgentAuthLoginHandoff::Initiated,
        LoginHandoff::AwaitingBrowser => AgentAuthLoginHandoff::AwaitingBrowser,
        LoginHandoff::Completed => AgentAuthLoginHandoff::Completed,
        LoginHandoff::Cancelled => AgentAuthLoginHandoff::Cancelled,
        LoginHandoff::TimedOut => AgentAuthLoginHandoff::TimedOut,
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
        mint_status: record.mint_status.map(|status| match status {
            InternalMintCaptureStatus::Waiting => AgentMintCaptureStatus::Waiting,
            InternalMintCaptureStatus::Captured => AgentMintCaptureStatus::Captured,
            InternalMintCaptureStatus::Ready => AgentMintCaptureStatus::Ready,
            InternalMintCaptureStatus::Consumed => AgentMintCaptureStatus::Consumed,
            InternalMintCaptureStatus::Failed => AgentMintCaptureStatus::Failed,
        }),
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

#[cfg(test)]
mod progress_tests {
    use super::*;
    use crate::domains::agents::installer::progress::InstallProgressPhase;
    use crate::domains::agents::installer::reconcile::execution::AgentInstallComponentProgress;

    #[test]
    fn reconcile_progress_maps_roles_bytes_and_unknown_aggregate() {
        let snapshot = AgentReconcileJobSnapshot {
            status: AgentReconcileJobStatus::Running,
            job_id: Some("job-1".into()),
            reinstall: true,
            installed_only: false,
            current_agent: Some(AgentKind::Codex),
            agent_kinds: vec![AgentKind::Codex],
            components: vec![
                AgentInstallComponentProgress {
                    agent: AgentKind::Codex,
                    role: ArtifactRole::NativeCli,
                    phase: InstallProgressPhase::Downloading,
                    downloaded_bytes: 42,
                    download_size_bytes: Some(100),
                },
                AgentInstallComponentProgress {
                    agent: AgentKind::Codex,
                    role: ArtifactRole::AgentProcess,
                    phase: InstallProgressPhase::Installing,
                    downloaded_bytes: 0,
                    download_size_bytes: None,
                },
            ],
            results: Vec::new(),
            started_at: None,
            finished_at: None,
            message: None,
        };

        let response = reconcile_snapshot_to_contract(&snapshot);
        let progress = response.progress.expect("progress");
        assert_eq!(response.current_agent.as_deref(), Some("codex"));
        assert_eq!(progress.downloaded_bytes, 42);
        assert_eq!(progress.download_size_bytes, None);
        assert_eq!(progress.total_components, 2);
        assert_eq!(progress.components[0].role, "native_cli");
        assert_eq!(
            progress.components[0].phase,
            AgentInstallProgressPhase::Downloading
        );
        assert_eq!(progress.components[1].role, "agent_process");
        assert_eq!(progress.components[1].download_size_bytes, None);
    }
}
