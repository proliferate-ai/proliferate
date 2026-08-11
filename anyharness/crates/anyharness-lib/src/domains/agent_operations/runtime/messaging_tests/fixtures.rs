use super::*;

pub(super) fn session(
    id: &str,
    workspace_id: &str,
    status: &str,
    title: Option<&str>,
) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        workspace_id: workspace_id.into(),
        agent_kind: "codex".into(),
        native_session_id: Some(format!("native-{id}")),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: title.map(str::to_string),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: status.into(),
        created_at: "2026-08-11T00:00:00Z".into(),
        updated_at: "2026-08-11T00:00:00Z".into(),
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

pub(super) fn link(parent: &str, child: &str, closed: bool) -> SessionLinkRecord {
    SessionLinkRecord {
        id: "link-child".into(),
        public_id: Some("subagent-child".into()),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: parent.into(),
        child_session_id: child.into(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some("Child".into()),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-11T00:00:00Z".into(),
        subagent_closed_at: closed.then(|| "2026-08-11T00:30:00Z".into()),
        closed_at: None,
    }
}

pub(super) fn workspace(id: &str) -> WorkspaceRecord {
    let path = format!("/tmp/{id}");
    let mut workspace = test_workspace_record(WorkspaceKind::Local, &path);
    workspace.id = id.into();
    workspace
}

pub(super) fn caller(fixture: &Fixture, session_id: &str) -> AuthenticatedAgentCaller {
    fixture.operations.authenticated_caller(session_id)
}

pub(super) fn input(fixture: &Fixture, target: &str, message: &str) -> SendMessageInput {
    SendMessageInput {
        target: AgentIdentity::new(fixture.operations.runtime_identity().clone(), target),
        message: message.into(),
    }
}
