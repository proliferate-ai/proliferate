//! The Claude auth posture the Claude in Chrome bundle's availability reads.
//! Spec: "Curated bundles" → "Claude in Chrome": the CLI disables Chrome for
//! every token without the profile scope, which is every method this system
//! renders (gateway, api_key, seat — "env-var and setup-token sessions
//! default to user:inference only"); only a native login qualifies.
//!
//! This is a read of Proliferate's own state plus two file checks — the
//! discovery law ("never executes") holds. It deliberately does NOT go
//! through the readiness resolver, whose credential ladder can shell out to
//! the macOS keychain: a listing must never spawn anything.

use std::path::Path;

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::route_auth;

/// How the Claude harness will authenticate at its next launch, as far as
/// the Chrome gate cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeAuthPosture {
    /// The user's own `claude` login (OAuth with the profile scope) — the one
    /// posture under which the CLI keeps Chrome enabled.
    NativeLogin,
    /// An agent-auth route renders the credential (gateway, api_key, seat):
    /// inference-only from the CLI's point of view, Chrome disabled.
    Routed,
    /// Neither: no route and no native login on this machine.
    None,
}

/// Resolve the posture from the enrolled agent-auth state under
/// `runtime_home` and the user's `home` directory.
pub fn claude_auth_posture(runtime_home: &Path, home: &Path) -> ClaudeAuthPosture {
    if route_auth::launch_route_provides_credentials(runtime_home, AgentKind::Claude.as_str()) {
        return ClaudeAuthPosture::Routed;
    }
    if native_login_present(home) {
        ClaudeAuthPosture::NativeLogin
    } else {
        ClaudeAuthPosture::None
    }
}

/// The two on-disk marks of a native `claude` login: the credentials file
/// (Linux, or macOS with keychain storage off) or an `oauthAccount` block in
/// `~/.claude.json` (macOS keychain logins write only that). Presence only —
/// expiry is the launch's problem, and readiness already reports it.
fn native_login_present(home: &Path) -> bool {
    if home.join(".claude").join(".credentials.json").is_file() {
        return true;
    }
    let Ok(contents) = std::fs::read_to_string(home.join(".claude.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&contents)
        .ok()
        .and_then(|value| value.get("oauthAccount").cloned())
        .is_some_and(|account| account.is_object())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn no_route_and_no_login_marks_is_none() {
        let runtime_home = TempDir::new("posture-runtime-none");
        let home = TempDir::new("posture-home-none");
        assert_eq!(
            claude_auth_posture(&runtime_home.path, &home.path),
            ClaudeAuthPosture::None
        );
    }

    #[test]
    fn a_credentials_file_is_a_native_login() {
        let runtime_home = TempDir::new("posture-runtime-file");
        let home = TempDir::new("posture-home-file");
        std::fs::create_dir_all(home.path.join(".claude")).unwrap();
        std::fs::write(home.path.join(".claude/.credentials.json"), "{}").unwrap();
        assert_eq!(
            claude_auth_posture(&runtime_home.path, &home.path),
            ClaudeAuthPosture::NativeLogin
        );
    }

    #[test]
    fn an_oauth_account_block_in_claude_json_is_a_native_login() {
        let runtime_home = TempDir::new("posture-runtime-oauth");
        let home = TempDir::new("posture-home-oauth");
        std::fs::write(
            home.path.join(".claude.json"),
            r#"{"oauthAccount": {"emailAddress": "someone@example.com"}}"#,
        )
        .unwrap();
        assert_eq!(
            claude_auth_posture(&runtime_home.path, &home.path),
            ClaudeAuthPosture::NativeLogin
        );
    }

    #[test]
    fn a_claude_json_without_an_oauth_account_is_not_a_login() {
        let runtime_home = TempDir::new("posture-runtime-plain");
        let home = TempDir::new("posture-home-plain");
        std::fs::write(home.path.join(".claude.json"), r#"{"mcpServers": {}}"#).unwrap();
        assert_eq!(
            claude_auth_posture(&runtime_home.path, &home.path),
            ClaudeAuthPosture::None
        );
    }
}
