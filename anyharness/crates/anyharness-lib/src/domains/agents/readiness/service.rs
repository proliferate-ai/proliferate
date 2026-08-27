use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::artifacts::{
    agent_process_has_path_artifact, found_artifact, resolve_agent_process_artifact,
    resolve_agent_process_fallback, resolve_agent_process_path_fallback, resolve_native_artifact,
};
use super::compatibility::detect_runtime_compatibility_issue;
use super::overrides::resolve_agent_process_override;
use super::status::compute_readiness;
use crate::domains::agent_auth::auth::credentials::{
    detect_auth_slots_in_scope, detect_cli_auth_state, CredentialEnvScope,
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

/// Host-scoped readiness with the enrolled agent-auth route layered on, which is
/// what every read surface wants.
///
/// Route-awareness here is the settings/launch-agreement law
/// (agent-distribution.md, "Readiness projection"): *"The settings read surface
/// and the launch path resolve readiness the same way (route-aware); the UI never
/// shows `CredentialsRequired` for a harness that would launch fine."* Before
/// this, `GET /v1/agents` resolved native-only while launch resolved route-aware,
/// so a gateway-enrolled harness with no native login read `CredentialsRequired`
/// in settings and launched fine — the projection lied on the one surface a user
/// reads.
///
/// The route can only clear the credential rungs; see
/// [`route_credentials_upgrade_status`].
/// Whether the user has their own copy of this agent on PATH, regardless of
/// whether a managed copy also exists and wins resolution. R2.0's settings
/// notice ("Proliferate now maintains its own managed copy; your own install
/// is untouched") needs exactly this "both exist" fact, which the resolved
/// artifact alone cannot carry — see `agent_process_has_path_artifact`.
pub fn has_user_path_copy(descriptor: &AgentDescriptor) -> bool {
    agent_process_has_path_artifact(descriptor)
}

pub fn resolve_agent(descriptor: &AgentDescriptor, runtime_home: &Path) -> ResolvedAgent {
    let resolved = resolve_agent_unrouted(descriptor, runtime_home);
    apply_launch_route_upgrade(resolved, descriptor, runtime_home)
}

/// Readiness from artifacts + the HOST-ambient env + local discovery ONLY, with
/// no agent-auth route consulted. This answers the narrower question "is the
/// vendor CLI installed and logged in on this machine", which is what the login
/// flow needs (an enrolled gateway route must not suppress the login command) and
/// what the install path reports.
pub fn resolve_agent_unrouted(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> ResolvedAgent {
    resolve_agent_in_scope(descriptor, runtime_home, CredentialEnvScope::HostAmbient)
}

/// [`resolve_agent_unrouted`], but looking the descriptor up by [`AgentKind`]
/// against the built-in registry first. For callers that only have the kind
/// (every `live::sessions::probe::ProbeOptions` builder: `AcpProbeRunner::run`,
/// the `catalog-probe` CLI, and the probe-materialization test all call this
/// directly), so the registry-lookup-then-resolve pair — required at each of
/// those call sites once `live/` stopped doing it internally (grid plan PR 7)
/// — has one implementation instead of three, including the "kind not in
/// registry" error text.
pub fn resolve_agent_unrouted_by_kind(
    kind: &AgentKind,
    runtime_home: &Path,
) -> Result<ResolvedAgent, AgentKindNotRegisteredError> {
    let registry = crate::domains::agents::registry::built_in_registry();
    let descriptor = find_descriptor_by_kind(&registry, kind)?;
    Ok(resolve_agent_unrouted(descriptor, runtime_home))
}

/// The lookup half of [`resolve_agent_unrouted_by_kind`], split out so the
/// not-in-registry arm is testable against a hand-built slice instead of only
/// the real bundled registry (which always carries every [`AgentKind`]
/// variant today, so the error arm is otherwise unreachable from a test).
fn find_descriptor_by_kind<'a>(
    registry: &'a [AgentDescriptor],
    kind: &AgentKind,
) -> Result<&'a AgentDescriptor, AgentKindNotRegisteredError> {
    registry
        .iter()
        .find(|descriptor| &descriptor.kind == kind)
        .ok_or_else(|| AgentKindNotRegisteredError(kind.as_str().to_string()))
}

#[derive(Debug, thiserror::Error)]
#[error("agent kind {0} not in registry")]
pub struct AgentKindNotRegisteredError(String);

/// Workspace-scoped readiness: the composed workspace env, never the host's
/// ambient env (agent-distribution.md's ambient law). No route layered on — use
/// [`resolve_launch_agent`] for the launch answer.
pub fn resolve_agent_with_env(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    workspace_env: &BTreeMap<String, String>,
) -> ResolvedAgent {
    resolve_agent_in_scope(
        descriptor,
        runtime_home,
        CredentialEnvScope::Workspace(workspace_env),
    )
}

fn resolve_agent_in_scope(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    scope: CredentialEnvScope<'_>,
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

    let (credential_state, auth_slots) =
        detect_auth_slots_in_scope(&descriptor.auth, &home_dir, scope);

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
        // Set only by `apply_launch_route_upgrade`; this layer knows nothing
        // about routes.
        credentials_from_route: false,
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
/// and session launch admission use this. It differs from the
/// settings read ([`resolve_agent`]) ONLY in env scope — workspace-composed vs
/// host-ambient — because both are now route-aware; that shared route layer is
/// what makes the two surfaces agree.
pub fn resolve_launch_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    workspace_env: &BTreeMap<String, String>,
) -> ResolvedAgent {
    let resolved = resolve_agent_with_env(descriptor, runtime_home, workspace_env);
    apply_launch_route_upgrade(resolved, descriptor, runtime_home)
}

/// The ONE place a resolved agent absorbs its enrolled agent-auth route. Both the
/// settings read and the launch path go through it, which is precisely how they
/// are kept from disagreeing (agent-distribution.md's route-aware law).
///
/// A no-op when the agent is already credential-ready (the route has nothing to
/// add) or when no route is in effect for this harness.
fn apply_launch_route_upgrade(
    mut resolved: ResolvedAgent,
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> ResolvedAgent {
    let already_ready = matches!(
        resolved.credential_state,
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth
    );
    // Deliberately the UNROTATED route-auth read: readiness asks "does a
    // route provide credentials at all?", which no rotation pick changes —
    // and a readiness sweep must never consult (let alone appear to advance)
    // per-launch seat rotation state. Only the session-launch path rotates.
    if already_ready
        || !crate::domains::agent_auth::route_auth::launch_route_provides_credentials(
            runtime_home,
            descriptor.kind.as_str(),
        )
    {
        return resolved;
    }
    let upgraded = route_credentials_upgrade_status(resolved.status);
    if upgraded == ResolvedAgentStatus::Ready {
        // The route supplies credentials the launcher injects at spawn.
        // `ReadyViaLocalAuth` is the closest existing state: ready via a
        // non-env, runtime-materialized credential rather than a workspace
        // env var.
        resolved.credential_state = CredentialState::ReadyViaLocalAuth;
        // Record the PROVENANCE of that readiness. Route-upgraded-ready and
        // natively-ready are the same `credential_state` on the wire, so a
        // consumer that means "the vendor CLI is logged in" (first-run adoption,
        // CLI status chrome) needs this flag to tell them apart.
        resolved.credentials_from_route = true;
    }
    resolved.status = upgraded;
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
