//! Read-only discovery of claude native integrations: every `mcpServers`
//! entry in `<home>/.claude.json` becomes one raw `mcp:<name>` integration,
//! spawn spec verbatim. Spec: "Discovery", claude row.
//!
//! The spec's claude row also names the workspace's `.mcp.json`; the
//! `discover` signature carries only a home directory (selections are global
//! per agent kind, not workspace-scoped), so workspace files are out of
//! discovery's reach here and stay a later, additive enrichment.

use std::path::Path;

use super::model::{
    NativeIntegration, NativeIntegrationKind, NativeIntegrationRisk, NativeSpawn, MCP_ID_PREFIX,
};
use crate::domains::agents::model::AgentKind;

/// Discover the raw MCP entries of `<home>/.claude.json`. A missing file
/// means claude is not set up here: nothing to list. A file that is not
/// valid JSON yields exactly one unavailable error entry, never a panic.
pub(super) fn discover(home: &Path) -> Vec<NativeIntegration> {
    let Ok(contents) = std::fs::read_to_string(home.join(".claude.json")) else {
        return Vec::new();
    };
    let value: serde_json::Value = match serde_json::from_str(&contents) {
        Ok(value) => value,
        Err(error) => return vec![parse_error_entry(&error)],
    };
    let Some(servers) = value
        .get("mcpServers")
        .and_then(serde_json::Value::as_object)
    else {
        return Vec::new();
    };
    servers
        .iter()
        .map(|(name, entry)| integration_for(name, entry))
        .collect()
}

/// The whole-file parse error as a listing entry. serde_json's message names
/// only the position, never file content, so no config value can leak.
fn parse_error_entry(error: &serde_json::Error) -> NativeIntegration {
    NativeIntegration {
        id: format!("{MCP_ID_PREFIX}.claude.json"),
        agent_kind: AgentKind::Claude,
        kind: NativeIntegrationKind::McpStdio,
        display_name: "~/.claude.json".to_string(),
        description: None,
        source: Some("~/.claude.json".to_string()),
        available: false,
        unavailable_reason: Some(format!("~/.claude.json is not valid JSON: {error}")),
        risk: NativeIntegrationRisk::None,
        spawn: None,
        skill_text: None,
    }
}

/// One `mcpServers.<name>` entry as an integration. Claude Code writes
/// `"type": "stdio" | "http"` (older files may omit it — a `command` means
/// stdio, a `url` means http); anything else, including the legacy `sse`
/// transport the session pipeline does not speak, lists as unavailable.
fn integration_for(name: &str, entry: &serde_json::Value) -> NativeIntegration {
    let mut integration = NativeIntegration {
        id: format!("{MCP_ID_PREFIX}{name}"),
        agent_kind: AgentKind::Claude,
        kind: NativeIntegrationKind::McpStdio,
        display_name: name.to_string(),
        description: None,
        source: Some(format!("~/.claude.json · mcpServers.{name}")),
        available: true,
        unavailable_reason: None,
        risk: NativeIntegrationRisk::None,
        spawn: None,
        skill_text: None,
    };
    let command = entry.get("command").and_then(serde_json::Value::as_str);
    let url = entry.get("url").and_then(serde_json::Value::as_str);
    let declared_type = entry.get("type").and_then(serde_json::Value::as_str);
    let is_stdio = declared_type == Some("stdio") || (declared_type.is_none() && command.is_some());
    let is_http = declared_type == Some("http") || (declared_type.is_none() && url.is_some());
    if is_stdio && command.is_some() {
        integration.spawn = Some(NativeSpawn::Stdio {
            command: command.unwrap_or_default().to_string(),
            args: string_items(entry.get("args")),
            env: string_pairs(entry.get("env")),
        });
    } else if is_http && url.is_some() {
        integration.kind = NativeIntegrationKind::McpHttp;
        integration.spawn = Some(NativeSpawn::Http {
            url: url.unwrap_or_default().to_string(),
            headers: string_pairs(entry.get("headers")),
        });
    } else {
        integration.available = false;
        integration.unavailable_reason = Some(match declared_type {
            Some("stdio") => "stdio entry has no `command`".to_string(),
            Some("http") => "http entry has no `url`".to_string(),
            Some(transport) => format!("unsupported transport `{transport}`"),
            None => "entry has neither `command` nor `url`".to_string(),
        });
    }
    integration
}

fn string_pairs(value: Option<&serde_json::Value>) -> Vec<(String, String)> {
    value
        .and_then(serde_json::Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn string_items(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
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

    fn home_with_claude_json(prefix: &str, contents: &str) -> TempDir {
        let home = TempDir::new(prefix);
        std::fs::write(home.path().join(".claude.json"), contents).expect("write .claude.json");
        home
    }

    #[test]
    fn a_home_without_a_claude_json_discovers_nothing() {
        let home = TempDir::new("claude-no-config");
        assert!(discover(home.path()).is_empty());
    }

    #[test]
    fn a_stdio_entry_is_parsed_verbatim_including_its_env_pairs() {
        let home = home_with_claude_json(
            "claude-stdio",
            r#"{
                "mcpServers": {
                    "filesystem": {
                        "type": "stdio",
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
                        "env": {"FS_TOKEN": "fixture-secret"}
                    }
                }
            }"#,
        );
        let listed = discover(home.path());
        assert_eq!(listed.len(), 1);
        let integration = &listed[0];
        assert_eq!(integration.id, "mcp:filesystem");
        assert_eq!(integration.agent_kind, AgentKind::Claude);
        assert_eq!(integration.kind, NativeIntegrationKind::McpStdio);
        assert_eq!(
            integration.source.as_deref(),
            Some("~/.claude.json · mcpServers.filesystem")
        );
        assert!(integration.available);
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
    fn an_http_entry_without_a_declared_type_is_inferred_from_its_url() {
        let home = home_with_claude_json(
            "claude-http",
            r#"{
                "mcpServers": {
                    "linear": {
                        "url": "https://mcp.linear.app/mcp",
                        "headers": {"Authorization": "Bearer fixture-token"}
                    }
                }
            }"#,
        );
        let listed = discover(home.path());
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
    fn a_legacy_sse_entry_lists_as_unavailable_naming_the_transport() {
        let home = home_with_claude_json(
            "claude-sse",
            r#"{"mcpServers": {"old": {"type": "sse", "url": "https://sse.example/mcp"}}}"#,
        );
        let listed = discover(home.path());
        assert!(!listed[0].available);
        assert_eq!(
            listed[0].unavailable_reason.as_deref(),
            Some("unsupported transport `sse`")
        );
        assert!(listed[0].spawn.is_none());
    }

    #[test]
    fn a_malformed_claude_json_yields_one_parse_error_entry_and_no_panic() {
        let home = home_with_claude_json("claude-malformed", "{\"mcpServers\": {");
        let listed = discover(home.path());
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].available);
        let reason = listed[0].unavailable_reason.as_deref().unwrap();
        assert!(
            reason.starts_with("~/.claude.json is not valid JSON:"),
            "reason was: {reason}"
        );
    }

    #[test]
    fn the_debug_form_of_a_discovered_integration_never_shows_header_values() {
        let home = home_with_claude_json(
            "claude-redaction",
            r#"{
                "mcpServers": {
                    "linear": {
                        "url": "https://mcp.linear.app/mcp",
                        "headers": {"Authorization": "Bearer fixture-token"}
                    }
                }
            }"#,
        );
        let printed = format!("{:?}", discover(home.path()));
        assert!(printed.contains("Authorization"));
        assert!(!printed.contains("fixture-token"));
    }
}
