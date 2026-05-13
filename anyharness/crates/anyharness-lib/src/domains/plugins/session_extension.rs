use std::sync::Arc;

use crate::domains::plugins::mcp::{auth::SkillsMcpAuth, definition};
use crate::domains::plugins::registry::PluginBundleRegistry;
use crate::domains::plugins::skills::{
    bundle_has_skills, render_skill_index, SKILLS_MCP_CONNECTION_ID, SKILLS_MCP_SERVER_NAME,
};
use crate::integrations::mcp::product_server::PRODUCT_MCP_TOKEN_HEADER_NAME;
use crate::sessions::extensions::{SessionExtension, SessionLaunchContext, SessionLaunchExtras};
use crate::sessions::mcp_bindings::contract::bindings_from_contract;
use crate::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};

#[derive(Clone)]
pub struct PluginSessionLaunchExtension {
    registry: PluginBundleRegistry,
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    skills_auth: Arc<SkillsMcpAuth>,
}

impl PluginSessionLaunchExtension {
    pub fn new(
        registry: PluginBundleRegistry,
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        skills_auth: Arc<SkillsMcpAuth>,
    ) -> Self {
        Self {
            registry,
            runtime_base_url,
            runtime_bearer_token,
            skills_auth,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use anyharness_contract::v1::{
        SessionMcpBindingOutcome, SessionMcpBindingSummary, SessionMcpHttpServer, SessionMcpServer,
        SessionMcpTransport, SessionPlugin, SessionPluginBundle, SessionPluginCredentialBinding,
        SessionPluginCredentialBindingStatus, SessionPluginSkill,
    };

    use super::PluginSessionLaunchExtension;
    use crate::domains::plugins::mcp::auth::SkillsMcpAuth;
    use crate::domains::plugins::registry::PluginBundleRegistry;
    use crate::sessions::extensions::{SessionExtension, SessionLaunchContext};
    use crate::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::workspaces::model::WorkspaceRecord;

    #[test]
    fn missing_bundle_adds_no_launch_extras() {
        let extension = extension(PluginBundleRegistry::default());
        let workspace = workspace_record();
        let session = session_record();

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("launch extras should resolve");

        assert!(extras.system_prompt_append.is_empty());
        assert!(extras.mcp_servers.is_empty());
    }

    #[test]
    fn mcp_only_bundle_mounts_plugin_servers_without_skills_mcp() {
        let registry = PluginBundleRegistry::default();
        registry.set_session_bundle("session-1", mcp_only_bundle());
        let extension = extension(registry);
        let workspace = workspace_record();
        let session = session_record();

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("launch extras should resolve");

        assert_eq!(extras.mcp_servers.len(), 1);
        assert!(extras.system_prompt_append.is_empty());
    }

    #[test]
    fn skill_bundle_mounts_skills_mcp_and_prompt_index() {
        let registry = PluginBundleRegistry::default();
        registry.set_session_bundle("session-1", skill_bundle());
        let extension = extension(registry);
        let workspace = workspace_record();
        let session = session_record();

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("launch extras should resolve");

        assert_eq!(extras.mcp_servers.len(), 2);
        assert_eq!(extras.system_prompt_append.len(), 1);
        assert!(extras.system_prompt_append[0].contains("connector.conn_github.triage"));
    }

    fn extension(registry: PluginBundleRegistry) -> PluginSessionLaunchExtension {
        PluginSessionLaunchExtension::new(
            registry,
            "http://127.0.0.1:1234".to_string(),
            None,
            Arc::new(SkillsMcpAuth::new(temp_runtime_home())),
        )
    }

    fn temp_runtime_home() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-plugin-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("temp runtime home should be created");
        path
    }

    fn mcp_only_bundle() -> SessionPluginBundle {
        SessionPluginBundle {
            plugins: vec![SessionPlugin {
                plugin_id: "connector.conn_github".to_string(),
                version: Some("1".to_string()),
                skills: Vec::new(),
                mcp_servers: vec![contract_mcp_server()],
                mcp_binding_summaries: vec![summary()],
                credential_bindings: vec![credential_binding()],
            }],
        }
    }

    fn skill_bundle() -> SessionPluginBundle {
        let mut bundle = mcp_only_bundle();
        bundle.plugins[0].skills = vec![SessionPluginSkill {
            skill_id: "connector.conn_github.triage".to_string(),
            display_name: "GitHub triage".to_string(),
            description: "Inspect GitHub state.".to_string(),
            instructions: "# GitHub triage".to_string(),
            resources: Vec::new(),
            required_mcp_servers: vec!["github".to_string()],
            credential_binding_ids: vec!["conn_github".to_string()],
        }];
        bundle
    }

    fn contract_mcp_server() -> SessionMcpServer {
        SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: "conn_github".to_string(),
            catalog_entry_id: Some("github".to_string()),
            server_name: "github".to_string(),
            url: "https://example.com/mcp".to_string(),
            headers: Vec::new(),
        })
    }

    fn summary() -> SessionMcpBindingSummary {
        SessionMcpBindingSummary {
            id: "conn_github".to_string(),
            server_name: "github".to_string(),
            display_name: Some("GitHub".to_string()),
            transport: SessionMcpTransport::Http,
            outcome: SessionMcpBindingOutcome::Applied,
            reason: None,
        }
    }

    fn credential_binding() -> SessionPluginCredentialBinding {
        SessionPluginCredentialBinding {
            id: "conn_github".to_string(),
            display_name: Some("GitHub".to_string()),
            status: SessionPluginCredentialBindingStatus::Ready,
        }
    }

    fn session_record() -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-05-13T00:00:00Z".to_string(),
            updated_at: "2026-05-13T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn workspace_record() -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: "local".to_string(),
            repo_root_id: None,
            path: "/workspace".to_string(),
            surface: "coding".to_string(),
            source_repo_root_path: "/workspace".to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-05-13T00:00:00Z".to_string(),
            updated_at: "2026-05-13T00:00:00Z".to_string(),
        }
    }
}

impl SessionExtension for PluginSessionLaunchExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        let Some(bundle) = self.registry.get_session_bundle(&ctx.session.id) else {
            return Ok(SessionLaunchExtras::default());
        };

        let mut extras = SessionLaunchExtras::default();
        for plugin in &bundle.plugins {
            extras
                .mcp_servers
                .extend(bindings_from_contract(plugin.mcp_servers.clone()));
            extras
                .mcp_binding_summaries
                .extend(plugin.mcp_binding_summaries.clone());
        }

        if bundle_has_skills(&bundle) {
            if let Some(skill_index) = render_skill_index(&bundle) {
                extras.system_prompt_append.push(skill_index);
            }
            extras.mcp_servers.push(self.build_skills_mcp_server(ctx)?);
        }

        Ok(extras)
    }
}

impl PluginSessionLaunchExtension {
    fn build_skills_mcp_server(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionMcpServer> {
        let mut headers = Vec::new();
        if let Some(token) = self.runtime_bearer_token.as_deref() {
            headers.push(SessionMcpHeader {
                name: "authorization".to_string(),
                value: format!("Bearer {token}"),
            });
        }
        headers.push(SessionMcpHeader {
            name: PRODUCT_MCP_TOKEN_HEADER_NAME.to_string(),
            value: self
                .skills_auth
                .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?,
        });

        Ok(SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: SKILLS_MCP_CONNECTION_ID.to_string(),
            catalog_entry_id: None,
            server_name: SKILLS_MCP_SERVER_NAME.to_string(),
            url: format!(
                "{}/v1/workspaces/{}/sessions/{}/mcp/{}",
                self.runtime_base_url,
                ctx.workspace.id,
                ctx.session.id,
                definition::DEFINITION.route_slug
            ),
            headers,
        }))
    }
}
