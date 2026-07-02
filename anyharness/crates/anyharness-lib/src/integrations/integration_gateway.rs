//! Integration-gateway dotfile injection.
//!
//! The worker writes `<runtime_home>/integration-gateway.json` (0600) with the
//! URL and pre-formatted `Authorization` header value for the cloud
//! integration-gateway MCP endpoint. At session launch AnyHarness reads that
//! dotfile and injects an HTTP MCP server named `proliferate_integrations`.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Dotfile the worker writes into the runtime home.
pub const INTEGRATION_GATEWAY_DOTFILE: &str = "integration-gateway.json";
/// Stable identifier used for the injected MCP server.
pub const INTEGRATION_GATEWAY_ID: &str = "proliferate_integrations";

/// Resolved integration-gateway connection details.
///
/// Deserialization tolerates unknown fields (including the `version` tag) so
/// the worker can evolve the dotfile schema without breaking older runtimes.
#[derive(Debug, Clone, Deserialize)]
pub struct IntegrationGatewayConfig {
    pub url: String,
    pub authorization: String,
}

impl IntegrationGatewayConfig {
    /// Reads and parses `<runtime_home>/integration-gateway.json`.
    ///
    /// Returns `None` when the dotfile is missing, unreadable, or invalid.
    pub fn load(runtime_home: &Path) -> Option<IntegrationGatewayConfig> {
        let path = runtime_home.join(INTEGRATION_GATEWAY_DOTFILE);
        let contents = match std::fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                tracing::debug!(
                    path = %path.display(),
                    error = %error,
                    "integration gateway dotfile missing or unreadable"
                );
                return None;
            }
        };
        match serde_json::from_str::<IntegrationGatewayConfig>(&contents) {
            Ok(config) => Some(config),
            Err(error) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %error,
                    "integration gateway dotfile is invalid"
                );
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Temp runtime home that removes its directory when dropped.
    struct TempRuntimeHome {
        path: PathBuf,
    }

    impl Drop for TempRuntimeHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn temp_runtime_home() -> TempRuntimeHome {
        let path = std::env::temp_dir().join(format!(
            "anyharness-integration-gateway-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("temp runtime home should be created");
        TempRuntimeHome { path }
    }

    #[test]
    fn load_returns_none_when_dotfile_missing() {
        let runtime_home = temp_runtime_home();
        assert!(IntegrationGatewayConfig::load(&runtime_home.path).is_none());
    }

    #[test]
    fn load_parses_dotfile_ignoring_unknown_fields() {
        let runtime_home = temp_runtime_home();
        std::fs::write(
            runtime_home.path.join(INTEGRATION_GATEWAY_DOTFILE),
            r#"{
                "version": 1,
                "url": "https://cloud.test/v1/cloud/integration-gateway/mcp",
                "authorization": "Bearer secret-token",
                "future_field": "ignored"
            }"#,
        )
        .expect("write dotfile");

        let config =
            IntegrationGatewayConfig::load(&runtime_home.path).expect("config should parse");
        assert_eq!(
            config.url,
            "https://cloud.test/v1/cloud/integration-gateway/mcp"
        );
        assert_eq!(config.authorization, "Bearer secret-token");
    }

    #[test]
    fn load_returns_none_when_dotfile_invalid() {
        let runtime_home = temp_runtime_home();
        std::fs::write(
            runtime_home.path.join(INTEGRATION_GATEWAY_DOTFILE),
            "not valid json",
        )
        .expect("write dotfile");
        assert!(IntegrationGatewayConfig::load(&runtime_home.path).is_none());
    }
}
