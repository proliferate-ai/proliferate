use std::path::PathBuf;

use super::fork::validate_fork_parent;
use super::startup::{build_session_launch_env, choose_session_startup_strategy};
use crate::domains::agents::model::{
    AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus, ResolvedArtifact,
};
use crate::domains::agents::registry::built_in_registry;
use crate::live::sessions::SessionStartupStrategy;
use crate::origin::OriginContext;
use crate::persistence::Db;
use crate::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::sessions::links::service::SessionLinkService;
use crate::sessions::links::store::SessionLinkStore;
use crate::sessions::mcp_bindings::assembly::join_system_prompt_append;
use crate::sessions::{model::SessionEventRecord, model::SessionRecord, store::SessionStore};

fn resolved_agent(kind: AgentKind, native_path: Option<&str>) -> ResolvedAgent {
    let descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == kind)
        .expect("missing descriptor");

    ResolvedAgent {
        descriptor,
        status: ResolvedAgentStatus::Ready,
        credential_state: CredentialState::Ready,
        native: native_path.map(|path| ResolvedArtifact {
            role: ArtifactRole::NativeCli,
            installed: true,
            source: Some("managed".into()),
            version: None,
            path: Some(PathBuf::from(path)),
            message: None,
        }),
        agent_process: ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: true,
            source: Some("managed".into()),
            version: None,
            path: Some(PathBuf::from("/tmp/claude-agent-acp")),
            message: None,
        },
        spawn: None,
    }
}

fn seed_workspace(db: &Db) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");
}

fn session_record(agent_kind: &str) -> SessionRecord {
    SessionRecord {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: agent_kind.to_string(),
        native_session_id: Some("native-1".to_string()),
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
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn link_record(
    id: &str,
    relation: SessionLinkRelation,
    parent_session_id: &str,
    child_session_id: &str,
) -> SessionLinkRecord {
    SessionLinkRecord {
        id: id.to_string(),
        public_id: Some(format!(
            "{}_{}",
            relation.public_id_prefix(),
            id.replace('-', "")
        )),
        relation,
        parent_session_id: parent_session_id.to_string(),
        child_session_id: child_session_id.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        closed_at: None,
    }
}

#[test]
fn join_system_prompt_append_trims_and_joins_entries() {
    let joined = join_system_prompt_append(Some(vec![
        "  Rename the branch  ".to_string(),
        "".to_string(),
        "Use kebab-case.".to_string(),
    ]));

    assert_eq!(
        joined.as_deref(),
        Some("Rename the branch\n\nUse kebab-case.")
    );
}

#[test]
fn join_system_prompt_append_ignores_blank_inputs() {
    assert!(join_system_prompt_append(None).is_none());
    assert!(join_system_prompt_append(Some(vec!["   ".to_string()])).is_none());
}

#[test]
fn build_session_launch_env_sets_claude_code_executable_for_claude() {
    let env = build_session_launch_env(&resolved_agent(
        AgentKind::Claude,
        Some("/tmp/managed/claude"),
    ));

    assert_eq!(
        env.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
        Some("/tmp/managed/claude")
    );
}

#[test]
fn build_session_launch_env_ignores_claude_without_native_path() {
    let env = build_session_launch_env(&resolved_agent(AgentKind::Claude, None));

    assert!(env.is_empty());
}

#[test]
fn build_session_launch_env_ignores_non_claude_agents() {
    let env = build_session_launch_env(&resolved_agent(
        AgentKind::Codex,
        Some("/tmp/managed/codex"),
    ));

    assert!(env.is_empty());
}

#[test]
fn choose_startup_strategy_prefers_fresh_when_no_native_session_exists() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record("claude");
    record.native_session_id = None;

    let strategy =
        choose_session_startup_strategy(&record, &store).expect("select startup strategy");

    assert_eq!(strategy, SessionStartupStrategy::Fresh);
}

#[test]
fn choose_startup_strategy_uses_fresh_native_for_zero_turn_claude_sessions() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record("claude");

    let strategy =
        choose_session_startup_strategy(&record, &store).expect("select startup strategy");

    assert_eq!(strategy, SessionStartupStrategy::ResumeSeqFreshNative);
}

#[test]
fn choose_startup_strategy_loads_claude_when_last_prompt_was_recorded() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record("claude");
    record.last_prompt_at = Some("2026-03-25T00:05:00Z".to_string());

    let strategy =
        choose_session_startup_strategy(&record, &store).expect("select startup strategy");

    assert_eq!(
        strategy,
        SessionStartupStrategy::LoadNative("native-1".to_string())
    );
}

#[test]
fn choose_startup_strategy_loads_claude_when_turn_history_exists_without_last_prompt_at() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record("claude");
    store.insert(&record).expect("insert session");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append turn_started");

    let strategy =
        choose_session_startup_strategy(&record, &store).expect("select startup strategy");

    assert_eq!(
        strategy,
        SessionStartupStrategy::LoadNative("native-1".to_string())
    );
}

#[test]
fn choose_startup_strategy_keeps_non_claude_agents_on_native_load_path() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record("codex");

    let strategy =
        choose_session_startup_strategy(&record, &store).expect("select startup strategy");

    assert_eq!(
        strategy,
        SessionStartupStrategy::LoadNative("native-1".to_string())
    );
}

#[test]
fn choose_startup_strategy_loads_fork_children_without_fresh_fallback() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record("claude");
    parent.id = "parent-session".to_string();
    store.insert(&parent).expect("insert parent");

    let mut child = session_record("claude");
    child.id = "fork-child".to_string();
    child.native_session_id = Some("fork-native".to_string());
    let link = link_record(
        "fork-link",
        SessionLinkRelation::Fork,
        "parent-session",
        "fork-child",
    );
    store
        .insert_session_with_link(&child, &link)
        .expect("insert fork child and link");

    let strategy =
        choose_session_startup_strategy(&child, &store).expect("select startup strategy");

    assert_eq!(
        strategy,
        SessionStartupStrategy::LoadNativeNoFallback("fork-native".to_string())
    );
}

#[test]
fn choose_startup_strategy_forks_unstarted_fork_children_from_parent_native_id() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record("claude");
    parent.id = "parent-session".to_string();
    parent.native_session_id = Some("parent-native".to_string());
    store.insert(&parent).expect("insert parent");

    let mut child = session_record("claude");
    child.id = "fork-child".to_string();
    child.native_session_id = None;
    let link = link_record(
        "fork-link",
        SessionLinkRelation::Fork,
        "parent-session",
        "fork-child",
    );
    store
        .insert_session_with_link(&child, &link)
        .expect("insert fork child and link");

    let strategy =
        choose_session_startup_strategy(&child, &store).expect("select startup strategy");

    assert_eq!(
        strategy,
        SessionStartupStrategy::ForkFromNative {
            parent_native_session_id: "parent-native".to_string()
        }
    );
    assert!(
        strategy.resumes_durable_history(),
        "fork startup appends after the copied parent transcript snapshot"
    );
}

#[test]
fn fork_parent_validation_allows_api_origin_as_advisory_provenance() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db.clone());
    let link_service = SessionLinkService::new(SessionLinkStore::new(db), store);
    let mut record = session_record("claude");
    record.origin = Some(OriginContext::api_local_runtime());

    validate_fork_parent(&record, &link_service).expect("api-origin session can fork");
}

#[test]
fn fork_link_child_unique_index_rejects_multiple_fork_parents() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db.clone());
    let mut parent_one = session_record("claude");
    parent_one.id = "parent-one".to_string();
    store.insert(&parent_one).expect("insert parent one");
    let mut parent_two = session_record("claude");
    parent_two.id = "parent-two".to_string();
    store.insert(&parent_two).expect("insert parent two");

    let mut child = session_record("claude");
    child.id = "fork-child".to_string();
    let first_link = link_record(
        "fork-link-one",
        SessionLinkRelation::Fork,
        "parent-one",
        "fork-child",
    );
    store
        .insert_session_with_link(&child, &first_link)
        .expect("insert fork child");

    let second_link = link_record(
        "fork-link-two",
        SessionLinkRelation::Fork,
        "parent-two",
        "fork-child",
    );
    let link_store = SessionLinkStore::new(db);

    assert!(link_store.insert(&second_link).is_err());
}
