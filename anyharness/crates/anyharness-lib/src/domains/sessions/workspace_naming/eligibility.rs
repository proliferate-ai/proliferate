use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::workspace_naming::mcp::definition::{
    ACP_SERVER_NAME, BINDING_SUMMARY_ID,
};
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::origin::{OriginContext, OriginEntrypoint, OriginKind};
use anyharness_contract::v1::{SessionMcpBindingOutcome, SessionMcpBindingSummary};

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceNamingAvailabilityError {
    #[error("{0}")]
    Unavailable(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub fn eligible_for_launch(
    session_store: &SessionStore,
    workspace: &WorkspaceRecord,
    session: &SessionRecord,
) -> anyhow::Result<bool> {
    if !workspace_display_name_empty(workspace) {
        return Ok(false);
    }
    if !is_human_desktop_or_cloud(session.origin.as_ref()) {
        return Ok(false);
    }
    if session.last_prompt_at.is_some() {
        return Ok(false);
    }
    if session_store.has_turn_started_event(&session.id)? {
        return Ok(false);
    }
    workspace_has_no_visible_prompted_sessions(session_store, &workspace.id, Some(&session.id))
}

pub fn validate_tool_call(
    session_store: &SessionStore,
    workspace: &WorkspaceRecord,
    session: &SessionRecord,
) -> anyhow::Result<()> {
    validate_tool_call_availability(session_store, workspace, session).map_err(
        |error| match error {
            WorkspaceNamingAvailabilityError::Unavailable(message) => anyhow::anyhow!(message),
            WorkspaceNamingAvailabilityError::Internal(error) => error,
        },
    )
}

pub fn validate_tool_call_availability(
    session_store: &SessionStore,
    workspace: &WorkspaceRecord,
    session: &SessionRecord,
) -> Result<(), WorkspaceNamingAvailabilityError> {
    if session.workspace_id != workspace.id {
        return Err(WorkspaceNamingAvailabilityError::Unavailable(
            "session does not belong to workspace".to_string(),
        ));
    }
    if !workspace_display_name_empty(workspace) {
        return Err(WorkspaceNamingAvailabilityError::Unavailable(
            "workspace already has a display name".to_string(),
        ));
    }
    let has_launch_binding = session_has_applied_workspace_naming_binding(session);
    if !current_session_is_visible(session_store, &workspace.id, &session.id)
        .map_err(WorkspaceNamingAvailabilityError::Internal)?
    {
        return Err(WorkspaceNamingAvailabilityError::Unavailable(
            "workspace naming is only available for visible sessions".to_string(),
        ));
    }
    if !has_launch_binding
        && !current_session_is_visible_and_first_prompted(session_store, &workspace.id, &session.id)
            .map_err(WorkspaceNamingAvailabilityError::Internal)?
    {
        return Err(WorkspaceNamingAvailabilityError::Unavailable(
            "workspace naming is only available before another visible session starts work"
                .to_string(),
        ));
    }
    if session_store
        .count_turn_started_events(&session.id)
        .map_err(|error| WorkspaceNamingAvailabilityError::Internal(error.into()))?
        > 1
    {
        return Err(WorkspaceNamingAvailabilityError::Unavailable(
            "workspace naming is only available during the first turn".to_string(),
        ));
    }
    if session_store
        .has_terminal_turn_event(&session.id)
        .map_err(|error| WorkspaceNamingAvailabilityError::Internal(error.into()))?
    {
        return Err(WorkspaceNamingAvailabilityError::Unavailable(
            "workspace naming is no longer available after the first turn completes".to_string(),
        ));
    }
    Ok(())
}

fn session_has_applied_workspace_naming_binding(session: &SessionRecord) -> bool {
    let Some(value) = session
        .mcp_binding_summaries_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Ok(summaries) = serde_json::from_str::<Vec<SessionMcpBindingSummary>>(value) else {
        return false;
    };
    summaries.iter().any(|summary| {
        summary.outcome == SessionMcpBindingOutcome::Applied
            && (summary.id == BINDING_SUMMARY_ID || summary.server_name == ACP_SERVER_NAME)
    })
}

fn current_session_is_visible(
    session_store: &SessionStore,
    workspace_id: &str,
    session_id: &str,
) -> anyhow::Result<bool> {
    Ok(session_store
        .list_visible_by_workspace(workspace_id)?
        .iter()
        .any(|record| record.id == session_id))
}

fn current_session_is_visible_and_first_prompted(
    session_store: &SessionStore,
    workspace_id: &str,
    session_id: &str,
) -> anyhow::Result<bool> {
    let visible = session_store.list_visible_by_workspace(workspace_id)?;
    if !visible.iter().any(|record| record.id == session_id) {
        return Ok(false);
    }

    for record in visible {
        if record.id == session_id {
            continue;
        }
        if session_has_prompt_history(session_store, &record)? {
            return Ok(false);
        }
    }

    Ok(true)
}

fn workspace_has_no_visible_prompted_sessions(
    session_store: &SessionStore,
    workspace_id: &str,
    ignored_session_id: Option<&str>,
) -> anyhow::Result<bool> {
    for record in session_store.list_visible_by_workspace(workspace_id)? {
        if ignored_session_id.is_some_and(|session_id| record.id == session_id) {
            continue;
        }
        if session_has_prompt_history(session_store, &record)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn session_has_prompt_history(
    session_store: &SessionStore,
    session: &SessionRecord,
) -> anyhow::Result<bool> {
    if session.last_prompt_at.is_some() {
        return Ok(true);
    }
    session_store.has_turn_started_event(&session.id)
}

fn workspace_display_name_empty(workspace: &WorkspaceRecord) -> bool {
    workspace
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
}

fn is_human_desktop_or_cloud(origin: Option<&OriginContext>) -> bool {
    matches!(
        origin,
        Some(OriginContext {
            kind: OriginKind::Human,
            entrypoint: OriginEntrypoint::Desktop | OriginEntrypoint::Cloud,
        })
    )
}

#[cfg(test)]
mod tests {
    use crate::domains::repo_roots::model::RepoRootRecord;
    use crate::domains::repo_roots::store::RepoRootStore;
    use crate::domains::sessions::model::{
        SessionEventRecord, SessionMcpBindingPolicy, SessionRecord,
    };
    use crate::domains::sessions::store::SessionStore;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };
    use crate::domains::workspaces::store::WorkspaceStore;
    use crate::origin::OriginContext;
    use crate::persistence::Db;

    use super::validate_tool_call;

    fn workspace(id: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: format!("repo-root-{id}"),
            path: format!("/tmp/{id}"),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: Some(OriginContext::human_desktop()),
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn insert_workspace(db: &Db, store: &WorkspaceStore, workspace: &WorkspaceRecord) {
        RepoRootStore::new(db.clone())
            .insert(&RepoRootRecord {
                id: workspace.repo_root_id.clone(),
                kind: "external".to_string(),
                path: workspace.path.clone(),
                display_name: None,
                default_branch: workspace.original_branch.clone(),
                remote_provider: None,
                remote_owner: None,
                remote_repo_name: None,
                remote_url: None,
                created_at: workspace.created_at.clone(),
                updated_at: workspace.updated_at.clone(),
            })
            .expect("insert repo root");
        store.insert(workspace).expect("insert workspace");
    }

    fn session(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
            agent_auth_scope: None,
            required_agent_auth_revision: None,
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
            action_capabilities_json: None,
            origin: Some(OriginContext::human_desktop()),
        }
    }

    fn attach_workspace_naming_binding(session: &mut SessionRecord) {
        session.mcp_binding_summaries_json = Some(
            r#"[{"id":"internal:workspace_naming","serverName":"workspace_naming","displayName":"Workspace Naming","transport":"http","outcome":"applied"}]"#
                .to_string(),
        );
    }

    fn append_event(store: &SessionStore, session_id: &str, seq: i64, event_type: &str) {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: session_id.to_string(),
                seq,
                timestamp: format!("2026-01-01T00:00:{seq:02}Z"),
                event_type: event_type.to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: format!(r#"{{"type":"{event_type}"}}"#),
            })
            .expect("append event");
    }

    #[test]
    fn tool_call_is_allowed_during_first_open_turn() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let workspace = workspace("workspace-1");
        let session = session("session-1", &workspace.id);
        insert_workspace(&db, &workspace_store, &workspace);
        session_store.insert(&session).expect("insert session");
        append_event(&session_store, &session.id, 1, "turn_started");

        validate_tool_call(&session_store, &workspace, &session).expect("first open turn allowed");
    }

    #[test]
    fn tool_call_is_rejected_after_terminal_turn_event() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let workspace = workspace("workspace-1");
        let session = session("session-1", &workspace.id);
        insert_workspace(&db, &workspace_store, &workspace);
        session_store.insert(&session).expect("insert session");
        append_event(&session_store, &session.id, 1, "turn_started");
        append_event(&session_store, &session.id, 2, "turn_ended");

        let error = validate_tool_call(&session_store, &workspace, &session)
            .expect_err("terminal turn should reject");
        assert!(error.to_string().contains("after the first turn completes"));
    }

    #[test]
    fn tool_call_is_rejected_when_workspace_already_has_display_name() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let mut workspace = workspace("workspace-1");
        workspace.display_name = Some("Existing name".to_string());
        let session = session("session-1", &workspace.id);
        insert_workspace(&db, &workspace_store, &workspace);
        session_store.insert(&session).expect("insert session");

        let error = validate_tool_call(&session_store, &workspace, &session)
            .expect_err("overwrite should reject");
        assert!(error.to_string().contains("already has a display name"));
    }

    #[test]
    fn tool_call_allows_other_visible_sessions_without_prompt_history() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let workspace = workspace("workspace-1");
        let first_session = session("session-1", &workspace.id);
        let second_session = session("session-2", &workspace.id);
        insert_workspace(&db, &workspace_store, &workspace);
        session_store
            .insert(&first_session)
            .expect("insert session");
        session_store
            .insert(&second_session)
            .expect("insert second session");
        append_event(&session_store, &first_session.id, 1, "turn_started");

        validate_tool_call(&session_store, &workspace, &first_session)
            .expect("empty visible sessions should not block the first prompted session");
    }

    #[test]
    fn tool_call_honors_launch_binding_when_another_session_prompts_after_launch() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let workspace = workspace("workspace-1");
        let mut first_session = session("session-1", &workspace.id);
        attach_workspace_naming_binding(&mut first_session);
        let mut second_session = session("session-2", &workspace.id);
        second_session.last_prompt_at = Some("2026-01-01T00:00:30Z".to_string());
        insert_workspace(&db, &workspace_store, &workspace);
        session_store
            .insert(&first_session)
            .expect("insert session");
        session_store
            .insert(&second_session)
            .expect("insert second session");
        append_event(&session_store, &first_session.id, 1, "turn_started");

        validate_tool_call(&session_store, &workspace, &first_session)
            .expect("launch-selected naming session should remain valid during first open turn");
    }

    #[test]
    fn tool_call_is_rejected_when_another_visible_session_has_prompt_history() {
        let db = Db::open_in_memory().expect("db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let workspace = workspace("workspace-1");
        let first_session = session("session-1", &workspace.id);
        let mut second_session = session("session-2", &workspace.id);
        second_session.last_prompt_at = Some("2026-01-01T00:00:30Z".to_string());
        insert_workspace(&db, &workspace_store, &workspace);
        session_store
            .insert(&first_session)
            .expect("insert session");
        session_store
            .insert(&second_session)
            .expect("insert second session");
        append_event(&session_store, &first_session.id, 1, "turn_started");

        let error = validate_tool_call(&session_store, &workspace, &first_session)
            .expect_err("prompted visible session should reject");
        assert!(error
            .to_string()
            .contains("another visible session starts work"));
    }
}
