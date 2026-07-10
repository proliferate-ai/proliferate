use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::artifacts::{
    found_artifact, resolve_agent_process_artifact, resolve_agent_process_fallback,
    resolve_agent_process_path_fallback, resolve_native_artifact,
};
use super::compatibility::detect_runtime_compatibility_issue;
use super::overrides::resolve_agent_process_override;
use super::status::compute_readiness;
use crate::domains::agents::auth::credentials::{
    detect_auth_slots, detect_auth_slots_with_env, detect_cli_auth_state,
};
use crate::domains::agents::model::*;

#[cfg(test)]
use super::artifacts::{
    managed_launcher_candidates, managed_npm_executable_relpath, not_found_artifact,
};
#[cfg(test)]
use super::compatibility::{claude_launch_requires_node, parse_node_version, NodeVersion};
#[cfg(test)]
use super::overrides::is_override_program_valid;
#[cfg(test)]
use super::paths::{
    artifact_root, managed_registry_binary_for_names, managed_registry_npm_binary_for_names,
};

pub fn resolve_agent(descriptor: &AgentDescriptor, runtime_home: &Path) -> ResolvedAgent {
    resolve_agent_with_env(descriptor, runtime_home, &BTreeMap::new())
}

pub fn resolve_agent_with_env(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    additional_env: &BTreeMap<String, String>,
) -> ResolvedAgent {
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));

    let native = descriptor
        .native
        .as_ref()
        .map(|spec| resolve_native_artifact(spec, &descriptor.kind, runtime_home));

    let mut spawn = None;
    let mut agent_process = if let Some((spawn_spec, override_artifact)) =
        resolve_agent_process_override(descriptor)
    {
        spawn = Some(spawn_spec);
        override_artifact
    } else {
        resolve_agent_process_artifact(&descriptor.agent_process, &descriptor.kind, runtime_home)
    };
    if spawn.is_none() {
        if let Some((fallback_artifact, fallback_spawn)) =
            resolve_agent_process_fallback(descriptor, native.as_ref(), &agent_process)
        {
            agent_process = fallback_artifact;
            spawn = fallback_spawn;
        } else if !agent_process.installed {
            if let Some(found) = resolve_agent_process_path_fallback(descriptor) {
                agent_process = found_artifact(ArtifactRole::AgentProcess, found, "path");
            }
        }
    }
    let compatibility_issue = detect_runtime_compatibility_issue(
        descriptor,
        &agent_process,
        spawn.as_ref(),
        runtime_home,
    );
    if let Some(message) = compatibility_issue.as_ref() {
        agent_process.message = Some(message.clone());
    }

    let (credential_state, auth_slots) = if additional_env.is_empty() {
        detect_auth_slots(&descriptor.auth, &home_dir)
    } else {
        detect_auth_slots_with_env(&descriptor.auth, &home_dir, additional_env)
    };

    let cli_auth_state = detect_cli_auth_state(&descriptor.auth, &home_dir);

    let status = compute_readiness(
        &native,
        &agent_process,
        &credential_state,
        &descriptor.auth,
        compatibility_issue.as_ref(),
    );

    let mut native = native;
    let mut agent_process = agent_process;
    super::versions::apply_manifest_versions(
        crate::domains::agents::installer::manifest::read_manifest(
            runtime_home,
            descriptor.kind.as_str(),
        )
        .as_ref(),
        &mut native,
        &mut agent_process,
    );

    ResolvedAgent {
        descriptor: descriptor.clone(),
        status,
        credential_state,
        auth_slots,
        cli_auth_state,
        native,
        agent_process,
        spawn,
    }
}

/// Launch-time readiness: [`resolve_agent_with_env`] PLUS the enrolled
/// agent-auth route state, so an enrolled gateway/api_key route makes the agent
/// credential-ready EXACTLY as the launcher will inject it at spawn.
///
/// This is the fix for issue #1106: the native readiness path only sees the
/// materialized workspace env, never `agent-auth/state.json`, so a gateway-route
/// session (whose credentials live in state.json and are injected only at
/// launch by `route_auth::resolve_launch_route_auth`) was reported
/// `LoginRequired`/`CredentialsRequired` and the session-create gate rejected
/// it — even though the launch path had valid credentials. Operators worked
/// around it by copying gateway credentials into a workspace env file, which in
/// turn corrupted auth-context classification (the raw `ANTHROPIC_AUTH_TOKEN`
/// activated the native `anthropic-api` context alongside `gateway`), unlocking
/// native-only models like `default` on what was really a gateway launch and
/// 400ing at LiteLLM.
///
/// Readiness and launch now consult ONE credential state. A route ONLY clears
/// the credential/login gaps — the credential is exactly what the route injects
/// at spawn. It never touches `InstallRequired` (a missing ACP agent process OR
/// native binary) or `Unsupported` (runtime incompatibility): a route cannot
/// conjure a binary, and the launcher still needs one (the ACP adapter shells
/// out to the vendor CLI — e.g. Claude launches via `CLAUDE_CODE_EXECUTABLE`),
/// so readiness must not report a binary-less agent as launchable (see
/// [`route_credentials_upgrade_status`]).
///
/// The launch paths (`create_session`, `ensure_live_session`/`start_live_session`,
/// and `resolved_workspace_launch_options`) use this. Native-readiness surfaces
/// (`GET /v1/agents`, login, reconcile, probe) keep using
/// [`resolve_agent`]/[`resolve_agent_with_env`]: they answer "is the vendor CLI
/// installed and logged in", which is a different question from "can the runtime
/// launch this agent through the enrolled route".
pub fn resolve_launch_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    workspace_env: &BTreeMap<String, String>,
) -> ResolvedAgent {
    let mut resolved = resolve_agent_with_env(descriptor, runtime_home, workspace_env);
    let already_ready = matches!(
        resolved.credential_state,
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth
    );
    if !already_ready
        && crate::domains::agents::route_auth::launch_route_provides_credentials(
            runtime_home,
            descriptor.kind.as_str(),
        )
    {
        let upgraded = route_credentials_upgrade_status(resolved.status);
        if upgraded == ResolvedAgentStatus::Ready {
            // The route supplies credentials the launcher injects at spawn.
            // `ReadyViaLocalAuth` is the closest existing state: ready via a
            // non-env, runtime-materialized credential rather than a workspace
            // env var.
            resolved.credential_state = CredentialState::ReadyViaLocalAuth;
        }
        resolved.status = upgraded;
    }
    resolved
}

/// Given a native-readiness verdict for an agent whose enrolled route supplies
/// launch credentials, decide the launch-time status. A route ONLY clears the
/// credential gaps (`CredentialsRequired`, `LoginRequired`) — the credential is
/// what it injects. It NEVER clears `InstallRequired` (a missing ACP agent
/// process OR native binary — the adapter still shells out to the vendor CLI) or
/// `Unsupported` (runtime incompatibility): a route cannot conjure a binary, so
/// readiness must not mask a binary-less agent as launchable. `Ready`/`Error`
/// pass through unchanged.
fn route_credentials_upgrade_status(status: ResolvedAgentStatus) -> ResolvedAgentStatus {
    match status {
        ResolvedAgentStatus::CredentialsRequired | ResolvedAgentStatus::LoginRequired => {
            ResolvedAgentStatus::Ready
        }
        other => other,
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
