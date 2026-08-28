//! Read-only discovery of codex native integrations: every `[mcp_servers.*]`
//! entry in `<home>/.codex/config.toml` becomes one raw `mcp:<name>`
//! integration, spawn spec verbatim. Spec: "Discovery", codex rows.
//!
//! This file only parses. It never spawns, probes, or writes, and env values
//! it reads (which may hold user tokens) travel only inside
//! [`NativeSpawn`], whose `Debug` prints names, never values.
//!
//! One deliberate gap: the session MCP pipeline has no `cwd` field
//! ([`crate::domains::sessions::mcp_bindings::model::SessionMcpStdioServer`]),
//! so a config entry's `cwd` cannot ride along; such an entry still lists,
//! and its server runs from the session's own working directory.

use std::path::Path;

use super::model::{
    NativeIntegration, NativeIntegrationKind, NativeIntegrationRisk, NativeSpawn, MCP_ID_PREFIX,
};
use crate::domains::agents::model::AgentKind;

/// The vendor plugin's own MCP server name. Never listed raw (law "Injected
/// servers never reuse a harness-owned name"): the curated bundles are the
/// sanctioned re-admission of that capability, under Proliferate-owned names.
pub(super) const NODE_REPL_SERVER_NAME: &str = "node_repl";

/// Discover the raw MCP entries of `<home>/.codex/config.toml`. A missing
/// file means codex is not set up here: nothing to list. A file that is not
/// valid TOML yields exactly one unavailable error entry, never a panic.
pub(super) fn discover(home: &Path) -> Vec<NativeIntegration> {
    let config_path = home.join(".codex").join("config.toml");
    let Ok(contents) = std::fs::read_to_string(&config_path) else {
        return Vec::new();
    };
    let table: toml::Table = match contents.parse() {
        Ok(table) => table,
        Err(error) => return vec![parse_error_entry(&error)],
    };
    let Some(servers) = table.get("mcp_servers").and_then(toml::Value::as_table) else {
        return Vec::new();
    };
    servers
        .iter()
        // The vendor's own `node_repl` entry is skipped, not listed: injecting
        // it raw would collide with the plugin-owned server (codex cancels the
        // session-config copy), and the curated bundles already re-admit the
        // capability under Proliferate-owned names.
        .filter(|(name, _)| name.as_str() != NODE_REPL_SERVER_NAME)
        .map(|(name, entry)| integration_for(name, entry))
        .collect()
}

/// The env table of `[mcp_servers.node_repl.env]`, read fresh for the curated
/// bundles (spec: the bundle injects "the env block from the user's
/// `[mcp_servers.node_repl]`"). `None` when the file, the entry, or the table
/// is absent or unreadable — the bundle then falls back to derived values.
pub(super) fn node_repl_env(home: &Path) -> Option<Vec<(String, String)>> {
    let contents = std::fs::read_to_string(home.join(".codex").join("config.toml")).ok()?;
    let table: toml::Table = contents.parse().ok()?;
    let env = table
        .get("mcp_servers")?
        .get(NODE_REPL_SERVER_NAME)?
        .get("env")?
        .as_table()?;
    Some(string_pairs(env))
}

/// The whole-file parse error as a listing entry, so the settings pane shows
/// the user what to fix instead of a silently empty section. The reason
/// carries only the parser's message and position — never file content, which
/// on the broken line could be an env value.
fn parse_error_entry(error: &toml::de::Error) -> NativeIntegration {
    NativeIntegration {
        id: format!("{MCP_ID_PREFIX}config.toml"),
        agent_kind: AgentKind::Codex,
        kind: NativeIntegrationKind::McpStdio,
        display_name: "~/.codex/config.toml".to_string(),
        description: None,
        source: Some("~/.codex/config.toml".to_string()),
        available: false,
        unavailable_reason: Some(format!(
            "~/.codex/config.toml is not valid TOML: {}",
            error.message()
        )),
        risk: NativeIntegrationRisk::None,
        spawn: None,
        skill_text: None,
    }
}

/// One `[mcp_servers.<name>]` entry as an integration. A malformed entry
/// (not a table, or neither `command` nor `url`) lists as unavailable with a
/// reason; an entry the user disabled natively (`enabled = false`) lists as
/// unavailable too, so re-admitting it into Proliferate takes a native edit
/// the user can see, not a silent override.
fn integration_for(name: &str, entry: &toml::Value) -> NativeIntegration {
    let mut integration = NativeIntegration {
        id: format!("{MCP_ID_PREFIX}{name}"),
        agent_kind: AgentKind::Codex,
        kind: NativeIntegrationKind::McpStdio,
        display_name: name.to_string(),
        description: None,
        source: Some(format!("~/.codex/config.toml · mcp_servers.{name}")),
        available: true,
        unavailable_reason: None,
        risk: NativeIntegrationRisk::None,
        spawn: None,
        skill_text: None,
    };
    let Some(entry) = entry.as_table() else {
        integration.available = false;
        integration.unavailable_reason = Some("entry is not a TOML table".to_string());
        return integration;
    };
    if let Some(url) = entry.get("url").and_then(toml::Value::as_str) {
        integration.kind = NativeIntegrationKind::McpHttp;
        integration.spawn = Some(NativeSpawn::Http {
            url: url.to_string(),
            headers: entry
                .get("http_headers")
                .and_then(toml::Value::as_table)
                .map(string_pairs)
                .unwrap_or_default(),
        });
    } else if let Some(command) = entry.get("command").and_then(toml::Value::as_str) {
        integration.spawn = Some(NativeSpawn::Stdio {
            command: command.to_string(),
            args: string_items(entry.get("args")),
            env: entry
                .get("env")
                .and_then(toml::Value::as_table)
                .map(string_pairs)
                .unwrap_or_default(),
        });
    } else {
        integration.available = false;
        integration.unavailable_reason = Some("entry has neither `command` nor `url`".to_string());
        return integration;
    }
    if entry.get("enabled").and_then(toml::Value::as_bool) == Some(false) {
        integration.available = false;
        integration.unavailable_reason =
            Some("disabled in ~/.codex/config.toml (enabled = false)".to_string());
    }
    integration
}

fn string_pairs(table: &toml::Table) -> Vec<(String, String)> {
    table
        .iter()
        .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string())))
        .collect()
}

fn string_items(value: Option<&toml::Value>) -> Vec<String> {
    value
        .and_then(toml::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| Some(item.as_str()?.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// House temp-dir idiom (no tempfile dev-dependency): unique dir under
    /// the system temp root, removed on drop.
    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-native-integrations-{prefix}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// A fixture home whose `.codex/config.toml` holds `contents`. The shape
    /// used in tests mirrors a real desktop-app config; the values are
    /// invented.
    fn home_with_config(prefix: &str, contents: &str) -> TempDir {
        let home = TempDir::new(prefix);
        let codex = home.path().join(".codex");
        std::fs::create_dir_all(&codex).expect("create .codex");
        std::fs::write(codex.join("config.toml"), contents).expect("write config.toml");
        home
    }

    #[test]
    fn a_home_without_a_codex_config_discovers_nothing() {
        let home = TempDir::new("no-config");
        assert!(discover(home.path()).is_empty());
    }

    #[test]
    fn a_stdio_entry_is_parsed_verbatim_including_its_env_pairs() {
        let home = home_with_config(
            "stdio",
            r#"
model = "gpt-5.6"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]
startup_timeout_sec = 20

[mcp_servers.filesystem.env]
FS_TOKEN = "fixture-secret"
"#,
        );
        let listed = discover(home.path());
        assert_eq!(listed.len(), 1);
        let integration = &listed[0];
        assert_eq!(integration.id, "mcp:filesystem");
        assert_eq!(integration.kind, NativeIntegrationKind::McpStdio);
        assert_eq!(integration.display_name, "filesystem");
        assert_eq!(
            integration.source.as_deref(),
            Some("~/.codex/config.toml · mcp_servers.filesystem")
        );
        assert!(integration.available);
        assert_eq!(integration.risk, NativeIntegrationRisk::None);
        assert_eq!(
            integration.spawn,
            Some(NativeSpawn::Stdio {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string()
                ],
                env: vec![("FS_TOKEN".to_string(), "fixture-secret".to_string())],
            })
        );
    }

    #[test]
    fn an_http_entry_is_parsed_with_its_url_and_headers() {
        let home = home_with_config(
            "http",
            r#"
[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"

[mcp_servers.linear.http_headers]
Authorization = "Bearer fixture-token"
"#,
        );
        let listed = discover(home.path());
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "mcp:linear");
        assert_eq!(listed[0].kind, NativeIntegrationKind::McpHttp);
        assert_eq!(
            listed[0].spawn,
            Some(NativeSpawn::Http {
                url: "https://mcp.linear.app/mcp".to_string(),
                headers: vec![(
                    "Authorization".to_string(),
                    "Bearer fixture-token".to_string()
                )],
            })
        );
    }

    #[test]
    fn the_vendor_node_repl_entry_is_skipped_and_only_the_other_entries_list() {
        let home = home_with_config(
            "node-repl-skipped",
            r#"
[mcp_servers.node_repl]
command = "/fixture/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
SKY_CUA_SERVICE_PATH = "/fixture/.codex/computer-use/Codex Computer Use.app"

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
"#,
        );
        let ids: Vec<String> = discover(home.path())
            .into_iter()
            .map(|integration| integration.id)
            .collect();
        assert_eq!(ids, vec!["mcp:linear"]);
    }

    #[test]
    fn an_entry_disabled_in_the_native_config_lists_as_unavailable() {
        let home = home_with_config(
            "disabled",
            r#"
[mcp_servers.excalidraw]
url = "https://mcp.excalidraw.example/mcp"
enabled = false
"#,
        );
        let listed = discover(home.path());
        assert!(!listed[0].available);
        assert_eq!(
            listed[0].unavailable_reason.as_deref(),
            Some("disabled in ~/.codex/config.toml (enabled = false)")
        );
    }

    #[test]
    fn an_entry_with_neither_command_nor_url_lists_as_unavailable_with_a_reason() {
        let home = home_with_config(
            "spawnless",
            r#"
[mcp_servers.broken]
startup_timeout_sec = 20
"#,
        );
        let listed = discover(home.path());
        assert!(!listed[0].available);
        assert_eq!(
            listed[0].unavailable_reason.as_deref(),
            Some("entry has neither `command` nor `url`")
        );
        assert!(listed[0].spawn.is_none());
    }

    #[test]
    fn a_malformed_config_yields_one_parse_error_entry_and_no_panic() {
        let home = home_with_config("malformed", "[mcp_servers.broken\ncommand = ");
        let listed = discover(home.path());
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].available);
        let reason = listed[0].unavailable_reason.as_deref().unwrap();
        assert!(
            reason.starts_with("~/.codex/config.toml is not valid TOML:"),
            "reason was: {reason}"
        );
        assert!(listed[0].spawn.is_none());
    }

    #[test]
    fn the_debug_form_of_a_discovered_integration_never_shows_env_values() {
        let home = home_with_config(
            "redaction",
            r#"
[mcp_servers.filesystem]
command = "npx"

[mcp_servers.filesystem.env]
FS_TOKEN = "fixture-secret"
"#,
        );
        let printed = format!("{:?}", discover(home.path()));
        assert!(printed.contains("FS_TOKEN"));
        assert!(!printed.contains("fixture-secret"));
    }

    #[test]
    fn node_repl_env_returns_the_user_env_table_and_none_when_absent() {
        let home = home_with_config(
            "node-repl-env",
            r#"
[mcp_servers.node_repl]
command = "/fixture/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/fixture/.codex"
"#,
        );
        assert_eq!(
            node_repl_env(home.path()),
            Some(vec![(
                "CODEX_HOME".to_string(),
                "/fixture/.codex".to_string()
            )])
        );
        let bare = home_with_config("node-repl-env-absent", "model = \"gpt-5.6\"\n");
        assert_eq!(node_repl_env(bare.path()), None);
    }
}
