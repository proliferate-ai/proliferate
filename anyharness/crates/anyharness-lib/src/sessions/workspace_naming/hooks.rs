use std::sync::Arc;

use crate::sessions::extensions::{SessionExtension, SessionLaunchContext, SessionLaunchExtras};
use crate::sessions::mcp::{SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer};
use crate::sessions::store::SessionStore;
use crate::sessions::workspace_naming::eligibility;
use crate::sessions::workspace_naming::mcp_auth::WorkspaceNamingMcpAuth;

#[derive(Clone)]
pub struct WorkspaceNamingSessionHooks {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    mcp_auth: Arc<WorkspaceNamingMcpAuth>,
    session_store: SessionStore,
}

impl WorkspaceNamingSessionHooks {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        mcp_auth: Arc<WorkspaceNamingMcpAuth>,
        session_store: SessionStore,
    ) -> Self {
        Self {
            runtime_base_url,
            runtime_bearer_token,
            mcp_auth,
            session_store,
        }
    }

    pub fn validate_capability_token(
        &self,
        token: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<bool> {
        self.mcp_auth
            .validate_capability_token(token, workspace_id, session_id)
    }

    pub fn capability_header_name(&self) -> &'static str {
        self.mcp_auth.capability_header_name()
    }
}

impl SessionExtension for WorkspaceNamingSessionHooks {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        if !eligibility::eligible_for_launch(&self.session_store, ctx.workspace, ctx.session)? {
            return Ok(SessionLaunchExtras::default());
        }

        let capability_token = self
            .mcp_auth
            .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?;
        let url = format!(
            "{}/v1/workspaces/{}/sessions/{}/workspace-naming/mcp",
            self.runtime_base_url, ctx.workspace.id, ctx.session.id
        );

        let mut headers = Vec::new();
        if let Some(token) = self.runtime_bearer_token.as_ref() {
            headers.push(SessionMcpHeader {
                name: "authorization".to_string(),
                value: format!("Bearer {token}"),
            });
        }
        headers.push(SessionMcpHeader {
            name: self.mcp_auth.capability_header_name().to_string(),
            value: capability_token,
        });

        tracing::info!(
            workspace_id = %ctx.workspace.id,
            session_id = %ctx.session.id,
            "injecting workspace naming MCP server into session launch"
        );

        Ok(SessionLaunchExtras {
            system_prompt_append: workspace_naming_system_prompt_append(),
            mcp_servers: vec![SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: "workspace-naming".to_string(),
                catalog_entry_id: None,
                server_name: "workspace_naming".to_string(),
                url,
                headers,
            })],
            mcp_binding_summaries: Vec::new(),
        })
    }
}

fn workspace_naming_system_prompt_append() -> Vec<String> {
    vec![r#"Your first action in this first turn MUST be a direct call to the workspace naming MCP tool. If MCP tools are namespaced, the exact tool name is mcp__workspace_naming__set_workspace_display_name. The tool is already available in your active tool list; do not use ToolSearch, subagents, or any other tool to find or invoke it. Call it with a concise human-readable task title derived from the user's request. Do not send a user-visible response, clarification, plan, or any other tool call before naming the workspace. After the workspace is named, continue with the user's request. Do not rename the git branch for naming alone."#.to_string()]
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::origin::OriginContext;
    use crate::persistence::Db;
    use crate::sessions::extensions::{SessionExtension, SessionLaunchContext};
    use crate::sessions::model::{SessionEventRecord, SessionMcpBindingPolicy, SessionRecord};
    use crate::sessions::store::SessionStore;
    use crate::sessions::workspace_naming::mcp_auth::WorkspaceNamingMcpAuth;
    use crate::workspaces::model::WorkspaceRecord;
    use crate::workspaces::store::WorkspaceStore;

    use super::WorkspaceNamingSessionHooks;

    fn workspace(id: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: "local".to_string(),
            repo_root_id: None,
            path: format!("/tmp/{id}"),
            surface: "standard".to_string(),
            source_repo_root_path: format!("/tmp/{id}"),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: Some(OriginContext::human_desktop()),
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn session(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: Some(OriginContext::human_desktop()),
        }
    }

    fn hooks(store: SessionStore) -> WorkspaceNamingSessionHooks {
        let runtime_home =
            std::env::temp_dir().join(format!("workspace-naming-hooks-{}", uuid::Uuid::new_v4()));
        WorkspaceNamingSessionHooks::new(
            "http://127.0.0.1:1234".to_string(),
            Some("runtime-token".to_string()),
            Arc::new(WorkspaceNamingMcpAuth::new(runtime_home)),
            store,
        )
    }

    #[test]
    fn first_pre_prompt_session_gets_binding_with_bearer_and_capability_headers() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db);
        let workspace = workspace("workspace-1");
        let session = session("session-1", &workspace.id);
        workspace_store
            .insert(&workspace)
            .expect("insert workspace");
        session_store.insert(&session).expect("insert session");

        let extras = hooks(session_store)
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("extras");

        assert_eq!(extras.system_prompt_append.len(), 1);
        assert!(extras.system_prompt_append[0].contains("Your first action"));
        assert!(
            extras.system_prompt_append[0].contains("MUST be a direct call to")
                && extras.system_prompt_append[0]
                    .contains("mcp__workspace_naming__set_workspace_display_name")
        );
        assert!(extras.system_prompt_append[0].contains("do not use ToolSearch"));
        assert_eq!(extras.mcp_servers.len(), 1);
        let crate::sessions::mcp::SessionMcpServer::Http(server) = &extras.mcp_servers[0] else {
            panic!("expected http server");
        };
        assert_eq!(server.server_name, "workspace_naming");
        assert!(
            server
                .headers
                .iter()
                .any(|header| header.name == "authorization"
                    && header.value == "Bearer runtime-token")
        );
        assert!(server
            .headers
            .iter()
            .any(|header| header.name == "x-workspace-naming-session-token"));
    }

    #[test]
    fn old_single_session_with_last_prompt_gets_no_binding() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db);
        let workspace = workspace("workspace-1");
        let mut session = session("session-1", &workspace.id);
        session.last_prompt_at = Some("2026-01-01T00:00:30Z".to_string());
        workspace_store
            .insert(&workspace)
            .expect("insert workspace");
        session_store.insert(&session).expect("insert session");

        let extras = hooks(session_store)
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("extras");

        assert!(extras.mcp_servers.is_empty());
        assert!(extras.system_prompt_append.is_empty());
    }

    #[test]
    fn old_single_session_with_turn_started_gets_no_binding() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db);
        let workspace = workspace("workspace-1");
        let session = session("session-1", &workspace.id);
        workspace_store
            .insert(&workspace)
            .expect("insert workspace");
        session_store.insert(&session).expect("insert session");
        session_store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: session.id.clone(),
                seq: 1,
                timestamp: "2026-01-01T00:00:05Z".to_string(),
                event_type: "turn_started".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append event");

        let extras = hooks(session_store)
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &session,
            })
            .expect("extras");

        assert!(extras.mcp_servers.is_empty());
        assert!(extras.system_prompt_append.is_empty());
    }

    #[test]
    fn first_promptable_session_gets_binding_when_other_visible_session_is_empty() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db);
        let workspace = workspace("workspace-1");
        let empty_session = session("session-1", &workspace.id);
        let candidate_session = session("session-2", &workspace.id);
        workspace_store
            .insert(&workspace)
            .expect("insert workspace");
        session_store
            .insert(&empty_session)
            .expect("insert empty session");
        session_store
            .insert(&candidate_session)
            .expect("insert candidate session");

        let extras = hooks(session_store)
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &candidate_session,
            })
            .expect("extras");

        assert_eq!(extras.mcp_servers.len(), 1);
        assert_eq!(extras.system_prompt_append.len(), 1);
    }

    #[test]
    fn session_gets_no_binding_when_another_visible_session_has_turn_started() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db);
        let workspace = workspace("workspace-1");
        let prompted_session = session("session-1", &workspace.id);
        let candidate_session = session("session-2", &workspace.id);
        workspace_store
            .insert(&workspace)
            .expect("insert workspace");
        session_store
            .insert(&prompted_session)
            .expect("insert prompted session");
        session_store
            .insert(&candidate_session)
            .expect("insert candidate session");
        session_store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: prompted_session.id.clone(),
                seq: 1,
                timestamp: "2026-01-01T00:00:05Z".to_string(),
                event_type: "turn_started".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append event");

        let extras = hooks(session_store)
            .resolve_launch_extras(&SessionLaunchContext {
                workspace: &workspace,
                session: &candidate_session,
            })
            .expect("extras");

        assert!(extras.mcp_servers.is_empty());
        assert!(extras.system_prompt_append.is_empty());
    }
}
