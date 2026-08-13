use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;

use super::*;
use crate::domains::agent_operations::model::RuntimeIdentity;
use crate::domains::agent_operations::runtime::{
    AgentExecutionReads, AgentSessionReads, SubagentRelationshipReads,
};
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::model::{
    SessionExecutionState, SessionExecutionStatePhase, SessionMcpBindingPolicy, SessionRecord,
};
use crate::integrations::mcp::product_server::{
    dispatch_product_mcp_request, ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpServer,
    ProductMcpTokenValidation,
};

struct Sessions(Vec<SessionRecord>);

impl AgentSessionReads for Sessions {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        Ok(self
            .0
            .iter()
            .find(|session| session.id == session_id)
            .cloned())
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        Ok(self.0.clone())
    }
}

struct Relationships(Vec<SessionLinkRecord>);

impl SubagentRelationshipReads for Relationships {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        Ok(self
            .0
            .iter()
            .find(|link| link.child_session_id == child_session_id)
            .cloned())
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        Ok(self
            .0
            .iter()
            .filter(|link| link.parent_session_id == parent_session_id)
            .cloned()
            .collect())
    }
}

struct Execution;

#[async_trait]
impl AgentExecutionReads for Execution {
    async fn execution_state(
        &self,
        _session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(SessionExecutionState {
            phase: SessionExecutionStatePhase::Idle,
            has_live_handle: false,
        })
    }
}

fn session(id: &str, workspace_id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "codex".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: Some(id.to_string()),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-08-10T00:00:00Z".to_string(),
        updated_at: "2026-08-10T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn server() -> (WorkspaceProductMcpServer, Arc<WorkspaceMcpAuth>) {
    let sessions = Arc::new(Sessions(vec![
        session("P", "workspace-a"),
        session("Q", "workspace-b"),
        session("C", "workspace-a"),
    ]));
    let relationships = Arc::new(Relationships(vec![SessionLinkRecord {
        id: "link-c".to_string(),
        public_id: Some("subagent-c".to_string()),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: "P".to_string(),
        child_session_id: "C".to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some("C".to_string()),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-10T00:00:00Z".to_string(),
        closed_at: None,
    }]));
    let operations = Arc::new(AgentOperations::new(
        RuntimeIdentity::new("runtime-1"),
        sessions,
        relationships,
        Arc::new(Execution),
    ));
    let auth = Arc::new(WorkspaceMcpAuth::new(
        std::env::temp_dir().join(format!("workspace-mcp-contract-{}", uuid::Uuid::new_v4())),
    ));
    (
        WorkspaceProductMcpServer::new(operations, auth.clone()),
        auth,
    )
}

fn context(workspace_id: &str, session_id: &str) -> ProductMcpRequestContext {
    ProductMcpRequestContext::new(workspace_id, session_id, definition::ID)
}

#[derive(Debug, PartialEq, Eq)]
enum AuthenticatedDispatchError {
    InvalidCapability,
}

async fn authenticated_dispatch(
    server: &WorkspaceProductMcpServer,
    token: &str,
    request_context: ProductMcpRequestContext,
    body: serde_json::Value,
) -> Result<Option<serde_json::Value>, AuthenticatedDispatchError> {
    let validation = server
        .validate_capability_token(
            ProductMcpAuthHeader::Product { value: token },
            &request_context,
        )
        .expect("validate Workspace capability token");
    if validation != ProductMcpTokenValidation::Valid {
        return Err(AuthenticatedDispatchError::InvalidCapability);
    }
    Ok(dispatch_product_mcp_request(server, request_context, body)
        .await
        .expect("authenticated dispatch"))
}

#[tokio::test]
async fn workspace_mcp_initialize_list_and_read_calls_use_authenticated_context() {
    let (server, auth) = server();
    let token = auth
        .mint_capability_token("workspace-a", "P")
        .expect("mint Workspace capability token");
    let initialize = authenticated_dispatch(
        &server,
        &token,
        context("workspace-a", "P"),
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
    )
    .await
    .expect("initialize dispatch")
    .expect("initialize response");
    assert_eq!(
        initialize["result"]["serverInfo"]["name"],
        "proliferate-workspace"
    );

    let list = authenticated_dispatch(
        &server,
        &token,
        context("workspace-a", "P"),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
    )
    .await
    .expect("tools/list dispatch")
    .expect("tools/list response");
    assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 18);

    let whoami = authenticated_dispatch(
        &server,
        &token,
        context("workspace-a", "P"),
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "whoami", "arguments": {} }
        }),
    )
    .await
    .expect("whoami dispatch")
    .expect("whoami response");
    assert_eq!(
        whoami["result"]["structuredContent"]["agent"]["identity"]["sessionId"],
        "P"
    );

    let cross_workspace = authenticated_dispatch(
        &server,
        &token,
        context("workspace-a", "P"),
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "get_agent", "arguments": { "agentId": "Q" } }
        }),
    )
    .await
    .expect("get agent dispatch")
    .expect("get agent response");
    assert_eq!(
        cross_workspace["result"]["structuredContent"]["identity"]["sessionId"],
        "Q"
    );
}

#[tokio::test]
async fn workspace_mcp_denials_are_typed_and_do_not_leak_foreign_subagent_metadata() {
    let (server, auth) = server();
    let q_token = auth
        .mint_capability_token("workspace-b", "Q")
        .expect("mint Q Workspace capability token");
    let denied = authenticated_dispatch(
        &server,
        &q_token,
        context("workspace-b", "Q"),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "get_agent", "arguments": { "agentId": "C" } }
        }),
    )
    .await
    .expect("denied dispatch")
    .expect("denied response");
    assert_eq!(denied["result"]["isError"], true);
    assert_eq!(
        denied["result"]["structuredContent"]["error"]["code"],
        "AGENT_NOT_FOUND"
    );
    let serialized = denied.to_string();
    assert!(!serialized.contains("workspace-a"));
    assert!(!serialized.contains("subagent-c"));

    let p_token = auth
        .mint_capability_token("workspace-a", "P")
        .expect("mint P Workspace capability token");
    let spoofed = authenticated_dispatch(
        &server,
        &p_token,
        context("workspace-a", "P"),
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "whoami",
                "arguments": { "callerSessionId": "Q" }
            }
        }),
    )
    .await
    .expect("spoof dispatch")
    .expect("spoof response");
    assert_eq!(
        spoofed["result"]["structuredContent"]["error"]["code"],
        "WORKSPACE_MCP_ARGUMENTS_INVALID"
    );
}

#[tokio::test]
async fn workspace_capability_scope_rejects_mismatched_workspace_or_session_before_dispatch() {
    let (server, auth) = server();
    let token = auth
        .mint_capability_token("workspace-a", "P")
        .expect("mint Workspace capability token");
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} });

    for mismatched_context in [context("workspace-b", "P"), context("workspace-a", "Q")] {
        assert_eq!(
            authenticated_dispatch(&server, &token, mismatched_context, body.clone()).await,
            Err(AuthenticatedDispatchError::InvalidCapability)
        );
    }
}
