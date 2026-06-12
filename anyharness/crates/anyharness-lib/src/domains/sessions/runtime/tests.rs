use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::fork::validate_fork_parent;
use super::launch_env::build_session_launch_env;
use super::startup::choose_session_startup_strategy;
use crate::app::test_support;
use crate::domains::agents::model::{
    AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus, ResolvedArtifact,
};
use crate::domains::agents::registry::built_in_registry;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::mcp_bindings::assembly::join_system_prompt_append;
use crate::domains::sessions::{
    model::SessionEventRecord, model::SessionRecord, store::SessionStore,
};
use crate::live::sessions::SessionStartupStrategy;
use crate::origin::OriginContext;
use crate::persistence::Db;

fn resolved_agent(kind: AgentKind, native_path: Option<&str>) -> ResolvedAgent {
    let descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == kind)
        .expect("missing descriptor");

    ResolvedAgent {
        descriptor,
        status: ResolvedAgentStatus::Ready,
        credential_state: CredentialState::Ready,
        auth_slots: Vec::new(),
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

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-session-runtime-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

struct EnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &Path) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn seed_workspace(db: &Db) {
    test_support::seed_workspace_with_repo_root(db, "workspace-1", "local", "/tmp/workspace");
}

pub(super) fn session_record(agent_kind: &str) -> SessionRecord {
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
        mcp_binding_policy:
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
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
    let runtime_home = TempDirGuard::new("claude-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        runtime_home.path(),
        &BTreeMap::new(),
        None,
    )
    .expect("build env");

    assert_eq!(
        env.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
        Some("/tmp/managed/claude")
    );
}

#[test]
fn build_session_launch_env_sets_requested_model_for_claude() {
    let runtime_home = TempDirGuard::new("claude-model-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        runtime_home.path(),
        &BTreeMap::new(),
        Some("opus[1m]"),
    )
    .expect("build env");

    assert_eq!(
        env.get("ANTHROPIC_MODEL").map(String::as_str),
        Some("opus[1m]")
    );
    assert_eq!(
        env.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
        Some("/tmp/managed/claude")
    );
}

#[test]
fn build_session_launch_env_ignores_claude_without_native_path() {
    let runtime_home = TempDirGuard::new("claude-missing-native-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, None),
        runtime_home.path(),
        &BTreeMap::new(),
        None,
    )
    .expect("build env");

    assert!(env.is_empty());
}

#[test]
fn build_session_launch_env_sets_requested_model_without_claude_native_path() {
    let runtime_home = TempDirGuard::new("claude-model-only-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, None),
        runtime_home.path(),
        &BTreeMap::new(),
        Some("sonnet"),
    )
    .expect("build env");

    assert_eq!(
        env.get("ANTHROPIC_MODEL").map(String::as_str),
        Some("sonnet")
    );
    assert!(!env.contains_key("CLAUDE_CODE_EXECUTABLE"));
}

#[test]
fn build_session_launch_env_sets_clean_codex_home_for_local_codex() {
    let runtime_home = TempDirGuard::new("codex-runtime");
    let source_codex_home = TempDirGuard::new("codex-source");
    std::fs::write(
        source_codex_home.path().join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-test"}"#,
    )
    .expect("write source auth");
    let _codex_home_guard = EnvVarGuard::set("CODEX_HOME", source_codex_home.path());

    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Codex, Some("/tmp/managed/codex")),
        runtime_home.path(),
        &BTreeMap::new(),
        None,
    )
    .expect("build env");

    let codex_home = runtime_home.path().join("agent-auth").join("codex-local");
    assert_eq!(
        env.get("CODEX_HOME").map(String::as_str),
        Some(codex_home.to_string_lossy().as_ref())
    );
    let auth_json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(codex_home.join("auth.json")).expect("read auth"))
            .expect("parse auth");
    assert_eq!(auth_json["OPENAI_API_KEY"], "sk-test");

    let config_toml = std::fs::read_to_string(codex_home.join("config.toml")).expect("read config");
    assert!(config_toml.contains(r#"model = "gpt-5.5""#));
    assert!(config_toml.contains(r#"model_reasoning_effort = "medium""#));
    assert!(config_toml.contains("plugins = false"));
    assert!(!codex_home.join("hooks.json").exists());
}

#[test]
fn build_session_launch_env_does_not_override_protected_codex_home() {
    let runtime_home = TempDirGuard::new("codex-protected-runtime");
    let protected_env = BTreeMap::from([(
        "CODEX_HOME".to_string(),
        "/tmp/proliferate-gateway-codex".to_string(),
    )]);
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Codex, Some("/tmp/managed/codex")),
        runtime_home.path(),
        &protected_env,
        Some("ignored"),
    )
    .expect("build env");

    assert!(env.is_empty());
    assert!(!runtime_home.path().join("agent-auth").exists());
}

#[test]
fn build_session_launch_env_ignores_other_agents() {
    let runtime_home = TempDirGuard::new("other-agent-runtime");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Gemini, Some("/tmp/managed/gemini")),
        runtime_home.path(),
        &BTreeMap::new(),
        Some("ignored"),
    )
    .expect("build env");

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
fn choose_startup_strategy_resumes_sequence_when_history_exists_without_native_session() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record("codex");
    record.native_session_id = None;
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

    assert_eq!(strategy, SessionStartupStrategy::ResumeSeqFreshNative);
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
