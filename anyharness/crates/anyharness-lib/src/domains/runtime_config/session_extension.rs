use std::sync::Arc;

use crate::domains::plugins::mcp::{auth::SkillsMcpAuth, definition};
use crate::domains::plugins::skills::{
    context_has_skills, render_skill_index, SKILLS_MCP_CONNECTION_ID, SKILLS_MCP_SERVER_NAME,
};
use crate::domains::runtime_config::service::RuntimeConfigService;
use crate::domains::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras,
};
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::integrations::mcp::product_server::PRODUCT_MCP_TOKEN_HEADER_NAME;

#[derive(Clone)]
pub struct RuntimeConfigSessionLaunchExtension {
    runtime_config_service: Arc<RuntimeConfigService>,
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    skills_auth: Arc<SkillsMcpAuth>,
}

impl RuntimeConfigSessionLaunchExtension {
    pub fn new(
        runtime_config_service: Arc<RuntimeConfigService>,
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        skills_auth: Arc<SkillsMcpAuth>,
    ) -> Self {
        Self {
            runtime_config_service,
            runtime_base_url,
            runtime_bearer_token,
            skills_auth,
        }
    }

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

impl SessionExtension for RuntimeConfigSessionLaunchExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        if ctx.session.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly {
            return Ok(SessionLaunchExtras::default());
        }
        let Some(context) = self
            .runtime_config_service
            .session_context(&ctx.session.id)?
        else {
            return Ok(SessionLaunchExtras::default());
        };

        let mut extras = SessionLaunchExtras {
            mcp_servers: context.mcp_servers.clone(),
            mcp_binding_summaries: context.mcp_binding_summaries.clone(),
            ..SessionLaunchExtras::default()
        };

        if context_has_skills(&context) {
            if let Some(skill_index) = render_skill_index(&context) {
                extras.system_prompt_append.push(skill_index);
            }
            extras.mcp_servers.push(self.build_skills_mcp_server(ctx)?);
        }

        Ok(extras)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use anyharness_contract::v1::{
        RuntimeArtifactPayload, RuntimeArtifactRef, RuntimeConfigExternalScope,
        RuntimeConfigRevision, RuntimeMcpLaunch, RuntimeMcpServer, RuntimeMcpTransport,
        RuntimeMcpValue, RuntimeSkill, RuntimeSkillSourceKind, SessionMcpBindingOutcome,
        SessionMcpBindingSummary, SessionMcpTransport,
    };
    use sha2::{Digest, Sha256};

    use super::RuntimeConfigSessionLaunchExtension;
    use crate::domains::plugins::mcp::auth::SkillsMcpAuth;
    use crate::domains::runtime_config::model::RuntimeConfigApplyInput;
    use crate::domains::runtime_config::service::RuntimeConfigService;
    use crate::domains::runtime_config::store::RuntimeConfigStore;
    use crate::domains::sessions::extensions::{SessionExtension, SessionLaunchContext};
    use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };
    use crate::persistence::Db;

    #[test]
    fn launch_extras_come_from_bound_runtime_config_context() {
        let service = Arc::new(RuntimeConfigService::new(RuntimeConfigStore::new(
            Db::open_in_memory().expect("db"),
        )));
        let request = apply_request();
        service.apply_config(request.clone()).expect("apply");
        service
            .bind_session_to_expected("session-1", &expectation(&request.revision))
            .expect("bind session");
        let extension = extension(service);
        let workspace = workspace_record();
        let session = session_record();

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("launch extras");

        assert_eq!(extras.mcp_servers.len(), 2);
        assert!(extras
            .mcp_servers
            .iter()
            .any(|server| server_name(server) == "github"));
        assert!(extras
            .mcp_servers
            .iter()
            .any(|server| server_name(server) == "proliferate_skills"));
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
        assert_eq!(extras.system_prompt_append.len(), 1);
        assert!(extras.system_prompt_append[0].contains("plugin:github:use"));
    }

    #[test]
    fn missing_runtime_config_context_adds_no_launch_extras() {
        let extension = extension(Arc::new(RuntimeConfigService::new(
            RuntimeConfigStore::new(Db::open_in_memory().expect("db")),
        )));
        let workspace = workspace_record();
        let session = session_record();

        let extras = extension
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("launch extras");

        assert!(extras.mcp_servers.is_empty());
        assert!(extras.system_prompt_append.is_empty());
    }

    fn extension(
        runtime_config_service: Arc<RuntimeConfigService>,
    ) -> RuntimeConfigSessionLaunchExtension {
        RuntimeConfigSessionLaunchExtension::new(
            runtime_config_service,
            "http://127.0.0.1:1234".to_string(),
            None,
            Arc::new(SkillsMcpAuth::new(temp_runtime_home())),
        )
    }

    fn temp_runtime_home() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-runtime-config-extension-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("temp runtime home should be created");
        path
    }

    fn apply_request() -> RuntimeConfigApplyInput {
        let instruction_content = "# Use GitHub\n";
        let instruction_hash = runtime_artifact_hash(instruction_content);
        let artifact = RuntimeArtifactRef {
            hash: instruction_hash.clone(),
            content_type: "text/markdown".to_string(),
            byte_size: instruction_content.as_bytes().len() as i64,
            source_ref: Some("plugin:github:instructions".to_string()),
            resource_id: None,
            display_name: None,
        };
        RuntimeConfigApplyInput {
            revision: RuntimeConfigRevision {
                id: "rev-1".to_string(),
                sequence: 2,
                content_hash: "sha256:manifest".to_string(),
                external_scope: Some(RuntimeConfigExternalScope {
                    provider: "proliferate-cloud".to_string(),
                    id: "profile-1".to_string(),
                    target_id: Some("target-1".to_string()),
                }),
            },
            manifest: anyharness_contract::v1::RuntimeConfigManifest {
                mcp_servers: vec![RuntimeMcpServer {
                    id: "mcp:1".to_string(),
                    connection_id: "conn-1".to_string(),
                    catalog_entry_id: Some("github".to_string()),
                    server_name: "github".to_string(),
                    transport: RuntimeMcpTransport::Http,
                    launch: RuntimeMcpLaunch::Http {
                        url: RuntimeMcpValue::Literal {
                            value: "https://example.test/mcp".to_string(),
                        },
                        headers: Vec::new(),
                        query: Vec::new(),
                    },
                    credential_refs: Vec::new(),
                }],
                mcp_binding_summaries: vec![SessionMcpBindingSummary {
                    id: "mcp:1".to_string(),
                    server_name: "github".to_string(),
                    display_name: Some("GitHub".to_string()),
                    transport: SessionMcpTransport::Http,
                    outcome: SessionMcpBindingOutcome::Applied,
                    reason: None,
                }],
                skills: vec![RuntimeSkill {
                    id: "plugin:github:use".to_string(),
                    source_kind: RuntimeSkillSourceKind::Plugin,
                    display_name: "Use GitHub".to_string(),
                    description: "Use GitHub".to_string(),
                    instruction_artifact: artifact.clone(),
                    resources: Vec::new(),
                    required_mcp_server_ids: vec!["conn-1".to_string()],
                    credential_refs: Vec::new(),
                }],
                artifacts: vec![artifact],
                direct_attach_auth: None,
                warnings: Vec::new(),
            },
            artifact_payloads: vec![RuntimeArtifactPayload {
                hash: instruction_hash,
                content_type: "text/markdown".to_string(),
                byte_size: instruction_content.as_bytes().len() as i64,
                source_ref: Some("plugin:github:instructions".to_string()),
                resource_id: None,
                display_name: None,
                content: instruction_content.to_string(),
            }],
            credential_values: Vec::new(),
            source: "worker".to_string(),
        }
    }

    fn runtime_artifact_hash(content: &str) -> String {
        format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
    }

    fn session_record() -> SessionRecord {
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
            kind: WorkspaceKind::Local,
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace".to_string(),
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
            created_at: "2026-05-13T00:00:00Z".to_string(),
            updated_at: "2026-05-13T00:00:00Z".to_string(),
        }
    }

    fn server_name(server: &SessionMcpServer) -> &str {
        match server {
            SessionMcpServer::Http(server) => &server.server_name,
            SessionMcpServer::Stdio(server) => &server.server_name,
        }
    }

    fn expectation(
        revision: &RuntimeConfigRevision,
    ) -> anyharness_contract::v1::RuntimeConfigRevisionExpectation {
        anyharness_contract::v1::RuntimeConfigRevisionExpectation {
            revision_id: revision.id.clone(),
            sequence: Some(revision.sequence),
            content_hash: revision.content_hash.clone(),
            external_scope: revision.external_scope.clone(),
        }
    }
}
