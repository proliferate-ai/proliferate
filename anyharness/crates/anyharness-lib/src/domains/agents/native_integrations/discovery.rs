//! Entry point for read-only discovery: given a harness kind and the home
//! directory its native config lives under, what integrations exist?
//! Spec: "Discovery". Never spawns, probes, or writes.
//!
//! Curated bundles list first (spec: "Settings surface" shows bundles ahead
//! of raw entries), then the harness's raw `mcp:*` config entries verbatim.
//! Harness kinds without a parser (cursor, opencode, grok) discover nothing,
//! which by the absence-of-rows law means their launches are unchanged.

use std::path::Path;

use super::auth_posture::ClaudeAuthPosture;
use super::model::NativeIntegration;
use super::{bundles, discover_claude, discover_codex};
use crate::domains::agents::model::AgentKind;

/// What discovery reads against: the user's home directory (where `~/.codex`
/// and `~/.claude.json` live) and the already-resolved facts a bundle's
/// availability depends on. Facts arrive resolved so discovery itself stays a
/// pure read of `home`.
#[derive(Debug, Clone, Copy)]
pub struct DiscoveryContext<'a> {
    pub home: &'a Path,
    /// The Claude in Chrome bundle's auth gate (spec, "Claude in Chrome").
    pub claude_auth: ClaudeAuthPosture,
}

impl<'a> DiscoveryContext<'a> {
    pub fn new(home: &'a Path, claude_auth: ClaudeAuthPosture) -> Self {
        Self { home, claude_auth }
    }
}

/// Discover the native integrations of `kind`.
pub fn discover(kind: &AgentKind, ctx: &DiscoveryContext<'_>) -> Vec<NativeIntegration> {
    let mut integrations = bundles::discover(kind, ctx);
    integrations.extend(match kind {
        AgentKind::Codex => discover_codex::discover(ctx.home),
        AgentKind::Claude => discover_claude::discover(ctx.home),
        _ => Vec::new(),
    });
    integrations
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

    #[test]
    fn codex_discovery_lists_the_curated_bundles_before_the_raw_config_entries() {
        let home = TempDir::new("dispatch-codex");
        let codex = home.path().join(".codex");
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::write(
            codex.join("config.toml"),
            "[mcp_servers.linear]\nurl = \"https://mcp.linear.app/mcp\"\n",
        )
        .unwrap();
        let ctx = DiscoveryContext::new(home.path(), ClaudeAuthPosture::None);
        let ids: Vec<String> = discover(&AgentKind::Codex, &ctx)
            .into_iter()
            .map(|integration| integration.id)
            .collect();
        assert_eq!(
            ids,
            vec!["bundle:computer-use", "bundle:chrome", "mcp:linear"]
        );
    }

    #[test]
    fn claude_discovery_lists_the_chrome_bundle_before_its_raw_config_entries() {
        let home = TempDir::new("dispatch-claude");
        std::fs::write(
            home.path().join(".claude.json"),
            r#"{"mcpServers": {"filesystem": {"type": "stdio", "command": "npx"}}}"#,
        )
        .unwrap();
        let ctx = DiscoveryContext::new(home.path(), ClaudeAuthPosture::NativeLogin);
        let ids: Vec<String> = discover(&AgentKind::Claude, &ctx)
            .into_iter()
            .map(|integration| integration.id)
            .collect();
        assert_eq!(ids, vec!["bundle:claude-chrome", "mcp:filesystem"]);
    }

    #[test]
    fn a_harness_kind_without_a_parser_discovers_nothing() {
        let home = TempDir::new("dispatch-other");
        let ctx = DiscoveryContext::new(home.path(), ClaudeAuthPosture::None);
        assert!(discover(&AgentKind::Cursor, &ctx).is_empty());
    }
}
