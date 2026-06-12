use crate::domains::agents::model::*;

pub(super) fn compute_readiness(
    native: &Option<ResolvedArtifact>,
    agent_process: &ResolvedArtifact,
    credential_state: &CredentialState,
    auth: &AuthSpec,
    compatibility_issue: Option<&String>,
) -> ResolvedAgentStatus {
    if !agent_process.installed {
        return ResolvedAgentStatus::InstallRequired;
    }

    if compatibility_issue.is_some() {
        return ResolvedAgentStatus::Unsupported;
    }

    match credential_state {
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth => ResolvedAgentStatus::Ready,
        _ if native
            .as_ref()
            .is_some_and(|native_artifact| !native_artifact.installed) =>
        {
            ResolvedAgentStatus::InstallRequired
        }
        CredentialState::MissingEnv => ResolvedAgentStatus::CredentialsRequired,
        CredentialState::LoginRequired => {
            if auth.supports_login() {
                ResolvedAgentStatus::LoginRequired
            } else {
                ResolvedAgentStatus::CredentialsRequired
            }
        }
    }
}
