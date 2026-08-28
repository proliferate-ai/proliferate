//! Selections × discovery → what a session launch injects. Spec: "Delivery"
//! in `specs/systems/harnesses/native-integrations.md`.
//!
//! Each selected id resolves to exactly one of four outcomes, and none of
//! them is silence (law "Every injected server is enumerable"):
//! - discovered and runnable → a `SessionMcpServer` (or, for a harness-args
//!   bundle, its launch arguments), the bundle's skill text on both prompt
//!   channels, and an `Applied` binding summary;
//! - discovered but not runnable (artifacts missing, or a listing-only entry
//!   with no spawn spec) → a `NativeUnavailable` binding summary;
//! - no longer discovered → a `NativeStale` binding summary;
//! - runnable but its server name collides with a reserved name or with an
//!   earlier selection in the same launch → a `NativeNameCollision` binding
//!   summary (law "Injected servers never reuse a harness-owned name, and
//!   every launch's injected names are unique").

use std::path::Path;

use super::auth_posture::claude_auth_posture;
use super::discovery::DiscoveryContext;
use super::model::{NativeIntegration, NativeSpawn, BUNDLE_ID_PREFIX, MCP_ID_PREFIX};
use super::store::NativeIntegrationSelectionStore;
use super::{bundles, discover_codex, discovery};
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::runtime::RuntimeSurface;
use crate::domains::sessions::extensions::{
    LaunchBindingSkip, LaunchBindingTransport, SessionLaunchExtras,
};
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
    SessionMcpStdioServer,
};

/// Server names a raw `mcp:` selection may never inject under (law "Injected
/// servers never reuse a harness-owned name"). Sources: the vendor plugin's
/// own `node_repl` (codex cancels a session-config server that collides with
/// it); the names the curated bundles inject under (`bundles.rs`); and the
/// product MCP server names — the `acp_server_name` of each
/// `ProductMcpDefinition`, hardcoded here with their defining files named
/// because the product registry is assembled at app wiring time and is not
/// reachable from this pure resolution function.
const RESERVED_SERVER_NAMES: &[&str] = &[
    discover_codex::NODE_REPL_SERVER_NAME,
    bundles::CUA_REPL_SERVER_NAME,
    bundles::BROWSER_REPL_SERVER_NAME,
    // The Claude CLI's own in-process Chrome server (bundles.rs).
    bundles::CLAUDE_IN_CHROME_SERVER_NAME,
    // domains/agent_operations/mcp/definition.rs
    "proliferate_workspace",
    // domains/cowork/mcp/definition.rs
    "cowork",
    // domains/reviews/mcp/definition.rs
    "reviews",
];

/// Resolve the native launch extras for one session of `kind`, reading the
/// selection rows from `store` and discovering fresh from `home`; the
/// enrolled agent-auth state under `runtime_home` feeds the Claude in Chrome
/// bundle's auth posture.
pub fn resolve_native_launch_extras(
    store: &NativeIntegrationSelectionStore,
    home: &Path,
    runtime_home: &Path,
    kind: &AgentKind,
) -> anyhow::Result<SessionLaunchExtras> {
    resolve_on_surface(RuntimeSurface::from_env(), store, home, runtime_home, kind)
}

/// The same flow with the surface explicit, so the cloud law is testable
/// without mutating process env. The public signature is fixed by the
/// extension seam, so the surface is read per launch rather than at wiring
/// time; absent env means `Local`, the safe default.
fn resolve_on_surface(
    surface: RuntimeSurface,
    store: &NativeIntegrationSelectionStore,
    home: &Path,
    runtime_home: &Path,
    kind: &AgentKind,
) -> anyhow::Result<SessionLaunchExtras> {
    // Law "Local surface only": discovery resolves against the runtime
    // host's home directories, which a cloud sandbox does not have.
    if surface == RuntimeSurface::Cloud {
        tracing::debug!(
            agent_kind = kind.as_str(),
            "native integrations skipped: cloud surface has no native harness config"
        );
        return Ok(SessionLaunchExtras::default());
    }
    let selections = store.list_enabled(kind.as_str())?;
    // Law "The absence of rows is the absence of passthrough": zero rows is
    // exactly today's launch, without even a discovery read.
    if selections.is_empty() {
        return Ok(SessionLaunchExtras::default());
    }
    let ctx = DiscoveryContext::new(home, claude_auth_posture(runtime_home, home));
    let discovered = discovery::discover(kind, &ctx);
    Ok(extras_for_selections(&selections, &discovered))
}

/// The spec's Delivery pseudocode over an already-discovered list (the seam
/// the tests use, since discovery reads the real filesystem).
fn extras_for_selections(
    selections: &[String],
    discovered: &[NativeIntegration],
) -> SessionLaunchExtras {
    let mut extras = SessionLaunchExtras::default();
    let mut injected_names: Vec<String> = Vec::new();
    for selection_id in selections {
        let found = discovered
            .iter()
            .find(|integration| &integration.id == selection_id);
        let Some(integration) = found else {
            push_stale_summary(&mut extras, selection_id);
            continue;
        };
        match &integration.spawn {
            Some(spawn) if integration.available => {
                materialize(&mut extras, &mut injected_names, integration, spawn)
            }
            _ => push_unavailable_summary(&mut extras, integration),
        }
    }
    extras
}

/// One runnable selection: its server (or launch arguments), its skill text,
/// its `Applied` summary. `injected_names` are the server names earlier
/// selections in this launch already claimed.
fn materialize(
    extras: &mut SessionLaunchExtras,
    injected_names: &mut Vec<String>,
    integration: &NativeIntegration,
    spawn: &NativeSpawn,
) {
    let server_name = server_name_for(&integration.id);
    // Belt-and-braces behind discovery's own node_repl skip: a raw selection
    // may not claim a reserved name (curated-bundle ids get theirs from the
    // compiled-in recipes, so only `mcp:` names are user-controlled), and no
    // two selections in one launch may share a name — codex-acp's session
    // config is name-keyed, so a collision silently clobbers one side.
    let claims_reserved_name = !integration.id.starts_with(BUNDLE_ID_PREFIX)
        && RESERVED_SERVER_NAMES.contains(&server_name.as_str());
    if claims_reserved_name || injected_names.contains(&server_name) {
        push_collision_summary(extras, integration, spawn, &server_name);
        return;
    }
    injected_names.push(server_name.clone());
    // A harness-args bundle injects no server of Proliferate's: the harness
    // spawns its own once the flag is present. It still claims its name
    // above and reports `Applied` below, so it is enumerable like a server.
    if let NativeSpawn::HarnessArgs { args } = spawn {
        extras
            .harness_args
            .extend(args.iter().map(|(key, value)| (key.clone(), value.clone())));
        push_skill_text(extras, integration);
        extras.push_binding_applied(
            &integration.id,
            &server_name,
            Some(integration.display_name.clone()),
            transport_of(spawn),
        );
        return;
    }
    let server = match spawn {
        NativeSpawn::Stdio { command, args, env } => {
            SessionMcpServer::Stdio(SessionMcpStdioServer {
                connection_id: integration.id.clone(),
                catalog_entry_id: None,
                server_name: server_name.clone(),
                command: command.clone(),
                args: args.clone(),
                env: env
                    .iter()
                    .map(|(name, value)| SessionMcpEnvVar {
                        name: name.clone(),
                        value: value.clone(),
                    })
                    .collect(),
            })
        }
        NativeSpawn::Http { url, headers } => SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: integration.id.clone(),
            catalog_entry_id: None,
            server_name: server_name.clone(),
            url: url.clone(),
            headers: headers
                .iter()
                .map(|(name, value)| SessionMcpHeader {
                    name: name.clone(),
                    value: value.clone(),
                })
                .collect(),
        }),
        NativeSpawn::HarnessArgs { .. } => unreachable!("handled above"),
    };
    extras.mcp_servers.push(server);
    push_skill_text(extras, integration);
    extras.push_binding_applied(
        &integration.id,
        &server_name,
        Some(integration.display_name.clone()),
        transport_of(spawn),
    );
}

/// Both prompt channels on purpose, mirroring assembly.rs: most harnesses
/// consume the systemPrompt.append session meta, Codex only receives the
/// first-prompt channel, and no harness reads both — nothing is delivered
/// twice.
fn push_skill_text(extras: &mut SessionLaunchExtras, integration: &NativeIntegration) {
    if let Some(skill_text) = &integration.skill_text {
        extras.system_prompt_append.push(skill_text.clone());
        extras
            .first_prompt_system_prompt_append
            .push(skill_text.clone());
    }
}

/// Runnable, but its name is reserved or already claimed this launch:
/// refused and visible as an error row, never silently clobbered.
fn push_collision_summary(
    extras: &mut SessionLaunchExtras,
    integration: &NativeIntegration,
    spawn: &NativeSpawn,
    server_name: &str,
) {
    extras.push_binding_not_applied(
        &integration.id,
        server_name,
        Some(integration.display_name.clone()),
        transport_of(spawn),
        LaunchBindingSkip::NativeNameCollision,
    );
}

/// Discovered but not runnable: visible as an error row, never dropped.
fn push_unavailable_summary(extras: &mut SessionLaunchExtras, integration: &NativeIntegration) {
    extras.push_binding_not_applied(
        &integration.id,
        &server_name_for(&integration.id),
        Some(integration.display_name.clone()),
        // A listing-only entry names no transport; stdio is the reporting
        // default (the row is an error entry either way).
        integration
            .spawn
            .as_ref()
            .map_or(LaunchBindingTransport::Stdio, transport_of),
        LaunchBindingSkip::NativeUnavailable,
    );
}

/// Selected but no longer discovered: the config entry is gone, so only the
/// id is known.
fn push_stale_summary(extras: &mut SessionLaunchExtras, integration_id: &str) {
    extras.push_binding_not_applied(
        integration_id,
        &server_name_for(integration_id),
        None,
        // The vanished entry's transport is unknowable; stdio is the
        // reporting default (the row is an error entry either way).
        LaunchBindingTransport::Stdio,
        LaunchBindingSkip::NativeStale,
    );
}

fn transport_of(spawn: &NativeSpawn) -> LaunchBindingTransport {
    match spawn {
        NativeSpawn::Stdio { .. } => LaunchBindingTransport::Stdio,
        NativeSpawn::Http { .. } => LaunchBindingTransport::Http,
        // The harness's own in-process server is a stdio server from the
        // model's side; the row reports that transport.
        NativeSpawn::HarnessArgs { .. } => LaunchBindingTransport::Stdio,
    }
}

/// The ACP server name a selection is injected under: each curated bundle
/// injects the vendor's server under its own compiled-in name
/// ([`bundles::server_name_for_bundle_id`]); a raw `mcp:` id is the user's
/// own server name with the prefix stripped. A `bundle:` id this binary no
/// longer ships (a stale selection) falls through to the same prefix strip —
/// it only ever names an error row.
fn server_name_for(integration_id: &str) -> String {
    if let Some(bundle_name) = bundles::server_name_for_bundle_id(integration_id) {
        return bundle_name.to_string();
    }
    integration_id
        .strip_prefix(MCP_ID_PREFIX)
        .or_else(|| integration_id.strip_prefix(BUNDLE_ID_PREFIX))
        .unwrap_or(integration_id)
        .to_string()
}

#[cfg(test)]
#[path = "launch_extras_tests.rs"]
mod tests;
