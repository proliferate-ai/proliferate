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
fn a_selected_integration_with_missing_artifacts_reports_native_unavailable_and_injects_nothing() {
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
