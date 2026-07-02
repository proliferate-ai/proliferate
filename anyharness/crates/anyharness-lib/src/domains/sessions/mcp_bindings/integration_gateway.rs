//! Session-launch extension injecting the integration-gateway MCP server.
//!
//! The worker writes `<runtime_home>/integration-gateway.json`; at session
//! launch this extension reads it (via the pure loader in
//! `crate::integrations::integration_gateway`) and injects an HTTP MCP server
//! named `proliferate_integrations`.

use std::path::{Path, PathBuf};

use crate::domains::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras,
};
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::integrations::integration_gateway::{
    IntegrationGatewayConfig, INTEGRATION_GATEWAY_DOTFILE, INTEGRATION_GATEWAY_ID,
};

/// Session extension that injects the integration-gateway MCP server when the
/// dotfile is present and the session accepts external MCP servers.
#[derive(Clone)]
pub struct IntegrationGatewaySessionLaunchExtension {
    runtime_home: PathBuf,
}

impl IntegrationGatewaySessionLaunchExtension {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self { runtime_home }
    }

    /// Runtime home this extension reads the gateway dotfile from. Must match
    /// the runtime home the server was started with (`--runtime-home`), since
    /// that is where the worker writes the dotfile.
    pub fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }
}

impl SessionExtension for IntegrationGatewaySessionLaunchExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        if ctx.session.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly {
            return Ok(SessionLaunchExtras::default());
        }
        let Some(config) = IntegrationGatewayConfig::load(&self.runtime_home) else {
            return Ok(SessionLaunchExtras::default());
        };
        // Log the host only — the URL may carry path segments and the config
        // carries an Authorization value that must never reach the logs.
        let gateway_host = url::Url::parse(&config.url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_else(|| "<unparseable>".to_string());
        tracing::info!(
            session_id = %ctx.session.id,
            gateway_host = %gateway_host,
            "injecting integration gateway MCP server"
        );
        let server = SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: INTEGRATION_GATEWAY_ID.to_string(),
            catalog_entry_id: None,
            server_name: INTEGRATION_GATEWAY_ID.to_string(),
            url: config.url,
            headers: vec![SessionMcpHeader {
                name: "authorization".to_string(),
                value: config.authorization,
            }],
        });
        Ok(SessionLaunchExtras {
            mcp_servers: vec![server],
            ..SessionLaunchExtras::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::domains::sessions::model::SessionRecord;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };
    use std::path::{Path, PathBuf};

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
            "anyharness-gateway-extension-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("temp runtime home should be created");
        TempRuntimeHome { path }
    }

    fn workspace_record() -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: "repo-root-1".to_string(),
            path: "/tmp/workspace".to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    fn session_record(policy: SessionMcpBindingPolicy) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: policy,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn write_dotfile(runtime_home: &Path, url: &str) {
        std::fs::write(
            runtime_home.join(INTEGRATION_GATEWAY_DOTFILE),
            format!(r#"{{"version": 1, "url": "{url}", "authorization": "Bearer secret-token"}}"#),
        )
        .expect("write dotfile");
    }

    #[test]
    fn resolve_launch_extras_injects_gateway_server_from_configured_runtime_home() {
        let runtime_home = temp_runtime_home();
        write_dotfile(
            &runtime_home.path,
            "https://cloud.test/v1/cloud/integration-gateway/mcp",
        );
        let extension = IntegrationGatewaySessionLaunchExtension::new(runtime_home.path.clone());
        let workspace = workspace_record();
        let session = session_record(SessionMcpBindingPolicy::InheritWorkspace);

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("extras should resolve");

        assert_eq!(extras.mcp_servers.len(), 1);
        let SessionMcpServer::Http(server) = &extras.mcp_servers[0] else {
            panic!("expected HTTP MCP server");
        };
        assert_eq!(server.server_name, INTEGRATION_GATEWAY_ID);
        assert_eq!(
            server.url,
            "https://cloud.test/v1/cloud/integration-gateway/mcp"
        );
        assert_eq!(server.headers.len(), 1);
        assert_eq!(server.headers[0].name, "authorization");
        assert_eq!(server.headers[0].value, "Bearer secret-token");
    }

    #[test]
    fn resolve_launch_extras_skips_internal_only_sessions() {
        let runtime_home = temp_runtime_home();
        write_dotfile(
            &runtime_home.path,
            "https://cloud.test/v1/cloud/integration-gateway/mcp",
        );
        let extension = IntegrationGatewaySessionLaunchExtension::new(runtime_home.path.clone());
        let workspace = workspace_record();
        let session = session_record(SessionMcpBindingPolicy::InternalOnly);

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("extras should resolve");

        assert!(extras.mcp_servers.is_empty());
    }
}
