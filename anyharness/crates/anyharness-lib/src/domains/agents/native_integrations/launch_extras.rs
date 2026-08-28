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
mod tests {
    use super::*;
    use crate::domains::agents::native_integrations::model::{
        NativeIntegrationKind, NativeIntegrationRisk,
    };

    use crate::persistence::Db;

    fn store() -> NativeIntegrationSelectionStore {
        NativeIntegrationSelectionStore::new(Db::open_in_memory().unwrap())
    }

    fn integration(id: &str, spawn: Option<NativeSpawn>) -> NativeIntegration {
        NativeIntegration {
            id: id.to_string(),
            agent_kind: AgentKind::Codex,
            kind: match spawn {
                Some(NativeSpawn::Http { .. }) => NativeIntegrationKind::McpHttp,
                _ => NativeIntegrationKind::McpStdio,
            },
            display_name: "Linear".to_string(),
            description: None,
            source: None,
            available: true,
            unavailable_reason: None,
            risk: NativeIntegrationRisk::None,
            spawn,
            skill_text: None,
        }
    }

    fn stdio_spawn() -> NativeSpawn {
        NativeSpawn::Stdio {
            command: "linear-mcp".to_string(),
            args: vec!["--stdio".to_string()],
            env: vec![("LINEAR_API_KEY".to_string(), "secret".to_string())],
        }
    }

    fn computer_use_bundle() -> NativeIntegration {
        NativeIntegration {
            kind: NativeIntegrationKind::Bundle,
            display_name: "Computer Use".to_string(),
            risk: NativeIntegrationRisk::DesktopControl,
            spawn: Some(NativeSpawn::Stdio {
                command: "/Applications/ChatGPT.app/.../node_repl".to_string(),
                args: Vec::new(),
                env: vec![("SKY_CUA_SERVICE_PATH".to_string(), "/tmp/sky".to_string())],
            }),
            skill_text: Some("Use sky.* to control the desktop.".to_string()),
            ..integration("bundle:computer-use", None)
        }
    }

    fn chrome_bundle() -> NativeIntegration {
        NativeIntegration {
            kind: NativeIntegrationKind::Bundle,
            display_name: "Chrome".to_string(),
            risk: NativeIntegrationRisk::BrowserControl,
            spawn: Some(NativeSpawn::Stdio {
                command: "/Applications/ChatGPT.app/.../node_repl".to_string(),
                args: Vec::new(),
                env: vec![(
                    "BROWSER_USE_AVAILABLE_BACKENDS".to_string(),
                    "chrome".to_string(),
                )],
            }),
            skill_text: Some("Use browser.* to control Chrome.".to_string()),
            ..integration("bundle:chrome", None)
        }
    }

    /// A binding summary's outcome/reason/transport are wire enums this domain
    /// no longer names (AH-CONTRACT-1), so tests read one row back as the JSON
    /// it serializes to and assert on the wire words.
    fn summary_json(extras: &SessionLaunchExtras, index: usize) -> serde_json::Value {
        serde_json::to_value(&extras.mcp_binding_summaries[index]).unwrap()
    }

    fn assert_no_extras(extras: &SessionLaunchExtras) {
        assert!(extras.mcp_servers.is_empty());
        assert!(extras.system_prompt_append.is_empty());
        assert!(extras.first_prompt_system_prompt_append.is_empty());
        assert!(extras.mcp_binding_summaries.is_empty());
        assert!(extras.harness_args.is_empty());
    }

    fn claude_chrome_bundle() -> NativeIntegration {
        NativeIntegration {
            agent_kind: AgentKind::Claude,
            kind: NativeIntegrationKind::Bundle,
            display_name: "Claude in Chrome".to_string(),
            risk: NativeIntegrationRisk::BrowserControl,
            spawn: Some(NativeSpawn::HarnessArgs {
                args: std::collections::BTreeMap::from([("chrome".to_string(), String::new())]),
            }),
            ..integration("bundle:claude-chrome", None)
        }
    }

    #[test]
    fn a_selected_harness_args_bundle_merges_its_args_and_reports_applied_without_a_server() {
        let extras = extras_for_selections(
            &["bundle:claude-chrome".to_string()],
            &[claude_chrome_bundle()],
        );
        assert!(
            extras.mcp_servers.is_empty(),
            "the harness spawns its own server"
        );
        assert_eq!(
            extras.harness_args,
            std::collections::BTreeMap::from([("chrome".to_string(), String::new())])
        );
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
        let summary = summary_json(&extras, 0);
        assert_eq!(summary["id"], "bundle:claude-chrome");
        assert_eq!(summary["serverName"], "claude-in-chrome");
        assert_eq!(summary["displayName"], "Claude in Chrome");
        assert_eq!(summary["outcome"], "applied");
        assert_eq!(summary["transport"], "stdio");
    }

    #[test]
    fn an_unavailable_harness_args_bundle_injects_no_args() {
        let mut unavailable = claude_chrome_bundle();
        unavailable.available = false;
        unavailable.spawn = None;
        unavailable.unavailable_reason = Some("sign in natively".to_string());
        let extras = extras_for_selections(&["bundle:claude-chrome".to_string()], &[unavailable]);
        assert!(extras.harness_args.is_empty());
        assert_eq!(summary_json(&extras, 0)["reason"], "native_unavailable");
    }

    #[test]
    fn a_raw_selection_named_after_the_clis_chrome_server_is_refused() {
        let extras = extras_for_selections(
            &["mcp:claude-in-chrome".to_string()],
            &[integration("mcp:claude-in-chrome", Some(stdio_spawn()))],
        );
        assert!(extras.mcp_servers.is_empty());
        assert_eq!(summary_json(&extras, 0)["reason"], "native_name_collision");
    }

    #[test]
    fn the_absence_of_selection_rows_resolves_to_exactly_todays_launch() {
        let extras = resolve_native_launch_extras(
            &store(),
            &std::env::temp_dir(),
            &std::env::temp_dir(),
            &AgentKind::Codex,
        )
        .unwrap();
        assert_no_extras(&extras);
    }

    #[test]
    fn the_cloud_surface_resolves_no_native_extras_even_with_selections() {
        let store = store();
        store
            .set_enabled("codex", "bundle:computer-use", true)
            .unwrap();
        let extras = resolve_on_surface(
            RuntimeSurface::Cloud,
            &store,
            &std::env::temp_dir(),
            &std::env::temp_dir(),
            &AgentKind::Codex,
        )
        .unwrap();
        assert_no_extras(&extras);
    }

    #[test]
    fn a_selection_discovery_no_longer_finds_reports_native_stale_and_injects_nothing() {
        let store = store();
        store.set_enabled("codex", "mcp:vanished", true).unwrap();
        let extras = resolve_on_surface(
            RuntimeSurface::Local,
            &store,
            &std::env::temp_dir(),
            &std::env::temp_dir(),
            &AgentKind::Codex,
        )
        .unwrap();
        assert!(extras.mcp_servers.is_empty());
        let index = extras
            .mcp_binding_summaries
            .iter()
            .position(|summary| summary.id == "mcp:vanished")
            .expect("stale selection must surface as a binding summary");
        let summary = summary_json(&extras, index);
        assert_eq!(summary["outcome"], "not_applied");
        assert_eq!(summary["reason"], "native_stale");
        assert_eq!(summary["serverName"], "vanished");
    }

    #[test]
    fn an_available_selected_stdio_integration_materializes_its_server_verbatim() {
        let extras = extras_for_selections(
            &["mcp:linear".to_string()],
            &[integration("mcp:linear", Some(stdio_spawn()))],
        );
        assert_eq!(extras.mcp_servers.len(), 1);
        let SessionMcpServer::Stdio(server) = &extras.mcp_servers[0] else {
            panic!("stdio spawn must materialize a stdio server");
        };
        assert_eq!(server.connection_id, "mcp:linear");
        assert_eq!(server.catalog_entry_id, None);
        assert_eq!(server.server_name, "linear");
        assert_eq!(server.command, "linear-mcp");
        assert_eq!(server.args, vec!["--stdio".to_string()]);
        assert_eq!(server.env.len(), 1);
        assert_eq!(server.env[0].name, "LINEAR_API_KEY");
        assert_eq!(server.env[0].value, "secret");
        let summary = summary_json(&extras, 0);
        assert_eq!(summary["id"], "mcp:linear");
        assert_eq!(summary["outcome"], "applied");
        assert_eq!(summary["reason"], serde_json::Value::Null);
        assert_eq!(summary["transport"], "stdio");
    }

    #[test]
    fn an_available_selected_http_integration_materializes_an_http_server_with_its_headers() {
        let spawn = NativeSpawn::Http {
            url: "https://mcp.linear.app/mcp".to_string(),
            headers: vec![("Authorization".to_string(), "Bearer token".to_string())],
        };
        let extras = extras_for_selections(
            &["mcp:linear".to_string()],
            &[integration("mcp:linear", Some(spawn))],
        );
        let SessionMcpServer::Http(server) = &extras.mcp_servers[0] else {
            panic!("http spawn must materialize an http server");
        };
        assert_eq!(server.connection_id, "mcp:linear");
        assert_eq!(server.url, "https://mcp.linear.app/mcp");
        assert_eq!(server.headers.len(), 1);
        assert_eq!(server.headers[0].name, "Authorization");
        assert_eq!(summary_json(&extras, 0)["transport"], "http");
    }

    #[test]
    fn a_selected_bundle_is_injected_under_the_proliferate_owned_cua_repl_name() {
        let extras = extras_for_selections(
            &["bundle:computer-use".to_string()],
            &[computer_use_bundle()],
        );
        let SessionMcpServer::Stdio(server) = &extras.mcp_servers[0] else {
            panic!("the bundle spawn is stdio");
        };
        assert_eq!(server.server_name, "cua_repl");
        assert_eq!(server.connection_id, "bundle:computer-use");
        assert_eq!(extras.mcp_binding_summaries[0].server_name, "cua_repl");
    }

    #[test]
    fn selecting_both_bundles_injects_two_servers_under_distinct_names_both_applied() {
        let extras = extras_for_selections(
            &[
                "bundle:computer-use".to_string(),
                "bundle:chrome".to_string(),
            ],
            &[computer_use_bundle(), chrome_bundle()],
        );
        assert_eq!(extras.mcp_servers.len(), 2);
        let names: Vec<&str> = extras
            .mcp_servers
            .iter()
            .map(|server| match server {
                SessionMcpServer::Stdio(server) => server.server_name.as_str(),
                SessionMcpServer::Http(server) => server.server_name.as_str(),
            })
            .collect();
        assert_eq!(names, vec!["cua_repl", "browser_repl"]);
        assert_eq!(extras.mcp_binding_summaries.len(), 2);
        for index in 0..extras.mcp_binding_summaries.len() {
            let summary = summary_json(&extras, index);
            assert_eq!(summary["outcome"], "applied");
            assert_eq!(summary["reason"], serde_json::Value::Null);
        }
    }

    #[test]
    fn a_raw_selection_claiming_a_reserved_server_name_is_refused_as_a_name_collision() {
        // Discovery already skips the vendor's node_repl entry; this guard is
        // the belt-and-braces layer, so feed it a crafted discovery list.
        for reserved in ["mcp:node_repl", "mcp:cua_repl", "mcp:proliferate_workspace"] {
            let extras = extras_for_selections(
                &[reserved.to_string()],
                &[integration(reserved, Some(stdio_spawn()))],
            );
            assert!(extras.mcp_servers.is_empty(), "{reserved} must not inject");
            let summary = summary_json(&extras, 0);
            assert_eq!(summary["id"], reserved);
            assert_eq!(summary["outcome"], "not_applied");
            assert_eq!(summary["reason"], "native_name_collision");
        }
    }

    #[test]
    fn a_selection_duplicating_an_earlier_selections_server_name_is_refused_not_clobbered() {
        let extras = extras_for_selections(
            &["mcp:linear".to_string(), "mcp:linear".to_string()],
            &[integration("mcp:linear", Some(stdio_spawn()))],
        );
        // The first claim of the name wins; the duplicate is a visible error.
        assert_eq!(extras.mcp_servers.len(), 1);
        assert_eq!(extras.mcp_binding_summaries.len(), 2);
        assert_eq!(summary_json(&extras, 0)["outcome"], "applied");
        assert_eq!(summary_json(&extras, 1)["reason"], "native_name_collision");
    }

    #[test]
    fn bundle_skill_text_rides_both_prompt_append_channels() {
        let extras = extras_for_selections(
            &["bundle:computer-use".to_string()],
            &[computer_use_bundle()],
        );
        let skill_text = vec!["Use sky.* to control the desktop.".to_string()];
        assert_eq!(extras.system_prompt_append, skill_text);
        assert_eq!(extras.first_prompt_system_prompt_append, skill_text);
    }

    #[test]
    fn a_selected_integration_with_missing_artifacts_reports_native_unavailable_and_injects_nothing(
    ) {
        let mut unavailable = computer_use_bundle();
        unavailable.available = false;
        unavailable.unavailable_reason = Some("ChatGPT.app not installed".to_string());
        let extras = extras_for_selections(&["bundle:computer-use".to_string()], &[unavailable]);
        assert!(extras.mcp_servers.is_empty());
        assert!(extras.system_prompt_append.is_empty());
        assert!(extras.first_prompt_system_prompt_append.is_empty());
        let summary = summary_json(&extras, 0);
        assert_eq!(summary["id"], "bundle:computer-use");
        assert_eq!(summary["displayName"], "Computer Use");
        assert_eq!(summary["outcome"], "not_applied");
        assert_eq!(summary["reason"], "native_unavailable");
    }

    #[test]
    fn a_selected_listing_only_entry_without_a_spawn_reports_native_unavailable() {
        let extras = extras_for_selections(
            &["mcp:broken".to_string()],
            &[integration("mcp:broken", None)],
        );
        assert!(extras.mcp_servers.is_empty());
        assert_eq!(summary_json(&extras, 0)["reason"], "native_unavailable");
    }

    #[test]
    fn discovered_integrations_the_user_did_not_select_are_not_injected() {
        let extras = extras_for_selections(
            &["mcp:linear".to_string()],
            &[
                integration("mcp:linear", Some(stdio_spawn())),
                integration("mcp:unselected", Some(stdio_spawn())),
            ],
        );
        assert_eq!(extras.mcp_servers.len(), 1);
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
        assert_eq!(extras.mcp_binding_summaries[0].id, "mcp:linear");
    }
}
