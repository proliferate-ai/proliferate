use super::fork::validate_fork_parent;
use super::fork_anchor_gate_tests::{before_user_message_target, build_forkable_fork_state};
use super::startup_facts::choose_session_startup_strategy;
use crate::app::test_support;
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

// A9 Scope C: process-env guard for the revoked-credentials regression tests
// below. Mirrors `service/create_tests.rs`'s local `EnvVarGuard` (the
// `readiness` module's own guard is `pub(super)` and not reachable from
// here) — every user must hold `test_support::ENV_MUTEX` for its whole body.
struct EnvVarGuard {
    name: &'static str,
    original: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(name: &'static str, value: &std::ffi::OsStr) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    fn remove(name: &'static str) -> Self {
        let original = std::env::var_os(name);
        std::env::remove_var(name);
        Self { name, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            std::env::set_var(self.name, original);
        } else {
            std::env::remove_var(self.name);
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
        mcp_binding_policy:
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

/// Insert a startable session row: a current observation for its harness plus
/// the empty launch intent every persisted session row must carry.
fn insert_startable_session(state: &crate::app::AppState, record: &SessionRecord) {
    test_support::seed_observed_launch_options(&state.launch_options_service, &record.agent_kind);
    state
        .session_service
        .store()
        .insert(record)
        .expect("insert session");
    state
        .session_service
        .store()
        .seed_empty_launch_intent(&record.id);
}

pub(super) fn link_record(
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
        subagent_closed_at: None,
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
fn choose_startup_strategy_loads_started_fork_children_without_fresh_fallback() {
    // A fork child that has already run its own turn (`last_prompt_at` set) has
    // a durable native transcript; load it with no fallback and skip the parent
    // lookup.
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record("claude");
    parent.id = "parent-session".to_string();
    store.insert(&parent).expect("insert parent");

    let mut child = session_record("claude");
    child.id = "fork-child".to_string();
    child.native_session_id = Some("fork-native".to_string());
    child.last_prompt_at = Some("2026-03-25T00:05:00Z".to_string());
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
fn choose_startup_strategy_refuses_zero_turn_process_local_fork_with_native_id() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record("claude");
    parent.id = "parent-session".to_string();
    parent.native_session_id = Some("parent-native".to_string());
    store.insert(&parent).expect("insert parent");

    let mut child = session_record("claude");
    child.id = "fork-child".to_string();
    child.native_session_id = Some("stale-fork-native".to_string());
    child.last_prompt_at = None;
    let link = link_record(
        "fork-link",
        SessionLinkRelation::Fork,
        "parent-session",
        "fork-child",
    );
    store
        .insert_session_with_link(&child, &link)
        .expect("insert fork child and link");

    let error = choose_session_startup_strategy(&child, &store)
        .expect_err("cold process-local recovery must refuse");
    assert!(error.to_string().contains("exact-prefix recovery proof"));
}

#[test]
fn choose_startup_strategy_refuses_unstarted_process_local_fork_children() {
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

    let error = choose_session_startup_strategy(&child, &store)
        .expect_err("cold process-local recovery must refuse");
    assert!(error.to_string().contains("exact-prefix recovery proof"));
}

#[test]
fn choose_startup_strategy_refuses_snapshot_polluted_zero_turn_fork_child() {
    // End-to-end guard against the snapshot-pollution trap: build the child via
    // the real fork snapshot (which copies the parent's `turn_started` events),
    // so `has_turn_started_event(child)` is true. A zero-turn Claude child must
    // still refuse cold recovery — proving the policy keys on `last_prompt_at`
    // and not on the polluted `turn_started` signal.
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record("claude");
    parent.id = "parent-session".to_string();
    parent.native_session_id = Some("parent-native".to_string());
    store.insert(&parent).expect("insert parent");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "parent-session".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append parent turn");

    let mut child = session_record("claude");
    child.id = "fork-child".to_string();
    child.native_session_id = Some("stale-fork-native".to_string());
    child.last_prompt_at = None;
    let link = link_record(
        "fork-link",
        SessionLinkRelation::Fork,
        "parent-session",
        "fork-child",
    );
    store
        .insert_fork_session_with_link_and_event_snapshot(&child, &link)
        .expect("insert fork child with snapshot");

    // Precondition: the snapshot polluted the child's turn_started signal.
    assert!(
        store
            .has_turn_started_event("fork-child")
            .expect("has_turn_started_event"),
        "snapshot should have copied the parent's turn_started into the child"
    );

    let error = choose_session_startup_strategy(&child, &store)
        .expect_err("cold process-local recovery must refuse");
    assert!(error.to_string().contains("exact-prefix recovery proof"));
}

#[test]
fn choose_startup_strategy_loads_non_claude_zero_turn_fork_child_without_refork() {
    // Durable-fork adapters (e.g. Codex) get a reloadable native id at fork
    // time, so a zero-turn fork child keeps LoadNativeNoFallback rather than
    // re-forking — the re-fork path is specific to process-local fork ids.
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record("codex");
    parent.id = "parent-session".to_string();
    parent.native_session_id = Some("parent-native".to_string());
    store.insert(&parent).expect("insert parent");

    let mut child = session_record("codex");
    child.id = "fork-child".to_string();
    child.native_session_id = Some("fork-native".to_string());
    child.last_prompt_at = None;
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
fn fork_parent_validation_allows_api_origin_as_advisory_provenance() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db.clone());
    let link_service = SessionLinkService::new(SessionLinkStore::new(db), store);
    let mut record = session_record("claude");
    record.origin = Some(OriginContext::api_local_runtime());

    validate_fork_parent(&record, &link_service).expect("api-origin session can fork");
}

#[tokio::test(flavor = "current_thread")]
async fn create_and_start_session_rejects_missing_checkout_without_inserting_row() {
    use std::sync::Mutex;

    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::runtime::CreateAndStartSessionError;

    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-create-missing-checkout-{}",
        uuid::Uuid::new_v4()
    ));
    let state = crate::app::AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    // Local checkout whose directory does not exist on disk.
    let missing_path = std::env::temp_dir().join(format!(
        "anyharness-missing-checkout-dir-{}",
        uuid::Uuid::new_v4()
    ));
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-missing",
        "worktree",
        &missing_path.to_string_lossy(),
    );

    let error = state
        .session_runtime
        .create_and_start_session(
            "workspace-missing",
            "claude",
            None,
            &std::collections::BTreeMap::new(),
            None,
            vec![],
            None,
            false,
            OriginContext::api_local_runtime(),
        )
        .await
        .expect_err("missing checkout should be refused");

    match error {
        CreateAndStartSessionError::WorkspaceDirectoryMissing { path } => {
            assert_eq!(path, missing_path.to_string_lossy());
        }
        other => panic!("expected WorkspaceDirectoryMissing, got {other:?}"),
    }

    let sessions = state
        .session_service
        .store()
        .list_by_workspace("workspace-missing")
        .expect("list sessions");
    assert!(
        sessions.is_empty(),
        "no durable session row should be inserted for a missing checkout"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn create_persisted_internal_session_rejects_missing_checkout_without_inserting_row() {
    // Workflow-run path: the internal creation seam must apply the same
    // checkout admission as the interactive create, so a workflow run against
    // a deleted checkout never inserts a durable session row and dispatch
    // classifies it as WorkspaceUnavailable.
    use std::sync::Mutex;

    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::runtime::{
        CreateAndStartSessionError, InternalSessionCreateError, InternalSessionCreateInput,
    };

    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-internal-missing-checkout-{}",
        uuid::Uuid::new_v4()
    ));
    let state = crate::app::AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    let missing_path = std::env::temp_dir().join(format!(
        "anyharness-internal-missing-checkout-dir-{}",
        uuid::Uuid::new_v4()
    ));
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-missing",
        "worktree",
        &missing_path.to_string_lossy(),
    );

    let error = state
        .session_runtime
        .create_persisted_internal_session(InternalSessionCreateInput {
            workspace_id: "workspace-missing".to_string(),
            agent_kind: "claude".to_string(),
            model_id: None,
            control_values: Default::default(),
            origin: OriginContext::api_local_runtime(),
            preselected_session_id: None,
        })
        .expect_err("missing checkout should be refused");

    // This exact error shape — Create(WorkspaceDirectoryMissing) — is what
    // `workflows::dispatch::map_create_error` classifies as
    // WorkspaceUnavailable (covered by
    // `missing_workspace_directory_classifies_as_workspace_unavailable`).
    match &error {
        InternalSessionCreateError::Create(
            CreateAndStartSessionError::WorkspaceDirectoryMissing { path },
        ) => {
            assert_eq!(path.as_str(), missing_path.to_string_lossy());
        }
        other => panic!("expected WorkspaceDirectoryMissing, got {other:?}"),
    }

    let sessions = state
        .session_service
        .store()
        .list_by_workspace("workspace-missing")
        .expect("list sessions");
    assert!(
        sessions.is_empty(),
        "no durable session row should be inserted for a missing checkout"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn ensure_live_session_rejects_missing_checkout_for_existing_session() {
    // Resume path: an already-persisted dormant session whose workspace
    // checkout was deleted must converge on the typed
    // WorkspaceDirectoryMissing at the common live-start seam, not a generic
    // ACP-start failure (which the HTTP layer would surface as a 500).
    use std::sync::Mutex;

    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::runtime::EnsureLiveSessionError;

    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-resume-missing-checkout-{}",
        uuid::Uuid::new_v4()
    ));
    let state = crate::app::AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    let missing_path = std::env::temp_dir().join(format!(
        "anyharness-resume-missing-checkout-dir-{}",
        uuid::Uuid::new_v4()
    ));
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-missing",
        "worktree",
        &missing_path.to_string_lossy(),
    );

    // Persist a dormant session row for that workspace directly in the store.
    let mut record = session_record("claude");
    record.workspace_id = "workspace-missing".to_string();
    insert_startable_session(&state, &record);

    let error = state
        .session_runtime
        .ensure_live_session(&record.id, None)
        .await
        .expect_err("missing checkout should be refused on resume");

    match error {
        EnsureLiveSessionError::WorkspaceDirectoryMissing { path } => {
            assert_eq!(path, missing_path.to_string_lossy());
        }
        other => panic!("expected WorkspaceDirectoryMissing, got {other:?}"),
    }
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

#[tokio::test(flavor = "current_thread")]
async fn ensure_live_session_rejects_a_resume_with_revoked_credentials() {
    // A9 Scope C regression: the common live-start seam now checks
    // `resolve_launch_agent`'s status (mirroring create_session's gate), so a
    // dormant session whose agent's credentials regressed after creation
    // (e.g. revoked) is refused here with the typed condition instead of
    // falling through to a spawn attempt and a generic ACP-start failure.
    // opencode is ProviderManaged with no required slot, so "nothing
    // selected" is a real, deterministic credential gap (the Scope B fix).
    use std::sync::Mutex;

    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::runtime::EnsureLiveSessionError;
    use crate::integrations::agent_cli::executable::make_executable;

    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-resume-revoked-creds-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");

    // No enrolled agent-auth route and no provider env for opencode: a real
    // credential gap, not the unconditional Ready the pre-fix bug produced.
    let bin = runtime_home.join("opencode-acp");
    std::fs::write(
        &bin,
        "#!/bin/sh
exit 0
",
    )
    .expect("write override binary");
    make_executable(&bin).expect("make override binary executable");
    let _program_guard = EnvVarGuard::set("ANYHARNESS_OPENCODE_AGENT_PROGRAM", bin.as_os_str());
    let empty_home = std::env::temp_dir().join(format!(
        "anyharness-resume-revoked-creds-home-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&empty_home).expect("create empty home");
    let _home_guard = EnvVarGuard::set("HOME", empty_home.as_os_str());
    let _openai_guard = EnvVarGuard::remove("OPENAI_API_KEY");
    let _anthropic_guard = EnvVarGuard::remove("ANTHROPIC_API_KEY");
    let _anthropic_token_guard = EnvVarGuard::remove("ANTHROPIC_AUTH_TOKEN");
    let _gemini_guard = EnvVarGuard::remove("GEMINI_API_KEY");
    let _google_guard = EnvVarGuard::remove("GOOGLE_API_KEY");

    let state = crate::app::AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-revoked",
        "local",
        &workspace_path.to_string_lossy(),
    );

    let mut record = session_record("opencode");
    record.workspace_id = "workspace-revoked".to_string();
    insert_startable_session(&state, &record);

    let error = state
        .session_runtime
        .ensure_live_session(&record.id, None)
        .await
        .expect_err("a real opencode credential gap must be refused on resume");

    match error {
        EnsureLiveSessionError::AgentNotReady { agent_kind, .. } => {
            assert_eq!(agent_kind, "opencode");
        }
        other => panic!("expected AgentNotReady, got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(&runtime_home);
    let _ = std::fs::remove_dir_all(&empty_home);
}

#[tokio::test(flavor = "current_thread")]
async fn ensure_live_session_reports_an_unsatisfiable_selection_as_route_auth_not_agent_not_ready()
{
    // Review fix (A9 Scope C, cycle 1, item A): the readiness gate added
    // above must run AFTER the route-auth selection pre-check, mirroring
    // create_session's deliberate order (service/create.rs: fail closed on
    // an unsatisfiable selection BEFORE the readiness gate, so the auth
    // problem is reported as itself instead of misread as "agent is not
    // ready" — which reads to a user as "go install something" when the
    // real answer is "your gateway budget is exhausted"). Before the fix,
    // this scenario (an opencode state.json entry with present-but-empty
    // sources — a selection the machine cannot honor, distinct from "no
    // entry at all") resolved AgentNotReady(CredentialsRequired) on resume;
    // pre-A9 (and post-fix) it resolves RouteAuth(SelectionMissing) /
    // AGENT_ROUTE_SELECTION_MISSING, same as create_session would report
    // for the identical state.
    use std::sync::Mutex;

    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::agents::route_auth::RouteAuthError;
    use crate::domains::sessions::runtime::EnsureLiveSessionError;
    use crate::integrations::agent_cli::executable::make_executable;

    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-resume-selection-missing-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");

    let bin = runtime_home.join("opencode-acp");
    std::fs::write(
        &bin,
        "#!/bin/sh
exit 0
",
    )
    .expect("write override binary");
    make_executable(&bin).expect("make override binary executable");
    let _program_guard = EnvVarGuard::set("ANYHARNESS_OPENCODE_AGENT_PROGRAM", bin.as_os_str());
    let empty_home = std::env::temp_dir().join(format!(
        "anyharness-resume-selection-missing-home-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&empty_home).expect("create empty home");
    let _home_guard = EnvVarGuard::set("HOME", empty_home.as_os_str());
    let _openai_guard = EnvVarGuard::remove("OPENAI_API_KEY");
    let _anthropic_guard = EnvVarGuard::remove("ANTHROPIC_API_KEY");
    let _anthropic_token_guard = EnvVarGuard::remove("ANTHROPIC_AUTH_TOKEN");
    let _gemini_guard = EnvVarGuard::remove("GEMINI_API_KEY");
    let _google_guard = EnvVarGuard::remove("GOOGLE_API_KEY");

    // Present-but-empty sources for opencode: a selection the machine cannot
    // honor, per agent-auth.md's "present-but-empty fails closed" — distinct
    // from an absent entry (which would be Native, no error at all).
    let agent_auth_dir = runtime_home.join("agent-auth");
    std::fs::create_dir_all(&agent_auth_dir).expect("create agent-auth dir");
    std::fs::write(
        agent_auth_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"opencode","sources":[]}]}"#,
    )
    .expect("write agent-auth state");

    let state = crate::app::AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-selection-missing",
        "local",
        &workspace_path.to_string_lossy(),
    );

    let mut record = session_record("opencode");
    record.workspace_id = "workspace-selection-missing".to_string();
    insert_startable_session(&state, &record);

    let error = state
        .session_runtime
        .ensure_live_session(&record.id, None)
        .await
        .expect_err("an unsatisfiable selection must be refused on resume");

    match error {
        EnsureLiveSessionError::RouteAuth(RouteAuthError::SelectionMissing {
            harness_kind,
            ..
        }) => {
            assert_eq!(harness_kind, "opencode");
        }
        other => panic!("expected RouteAuth(SelectionMissing), got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(&runtime_home);
    let _ = std::fs::remove_dir_all(&empty_home);
}

#[tokio::test(flavor = "current_thread")]
async fn fork_session_rejects_a_parent_with_revoked_credentials() {
    // A9 Scope C regression: fork shares the same common live-start seam
    // (`ensure_live_session_handle` -> `start_live_session`) via
    // `fork_session`, so a parent whose agent's credentials regressed gets
    // the same typed `AgentNotReady`, not a generic ACP-start failure.
    use std::sync::Mutex;

    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::runtime::ForkSessionError;
    use crate::integrations::agent_cli::executable::make_executable;

    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-fork-revoked-creds-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");

    let bin = runtime_home.join("opencode-acp");
    std::fs::write(
        &bin,
        "#!/bin/sh
exit 0
",
    )
    .expect("write override binary");
    make_executable(&bin).expect("make override binary executable");
    let _program_guard = EnvVarGuard::set("ANYHARNESS_OPENCODE_AGENT_PROGRAM", bin.as_os_str());
    let empty_home = std::env::temp_dir().join(format!(
        "anyharness-fork-revoked-creds-home-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&empty_home).expect("create empty home");
    let _home_guard = EnvVarGuard::set("HOME", empty_home.as_os_str());
    let _openai_guard = EnvVarGuard::remove("OPENAI_API_KEY");
    let _anthropic_guard = EnvVarGuard::remove("ANTHROPIC_API_KEY");
    let _anthropic_token_guard = EnvVarGuard::remove("ANTHROPIC_AUTH_TOKEN");
    let _gemini_guard = EnvVarGuard::remove("GEMINI_API_KEY");
    let _google_guard = EnvVarGuard::remove("GOOGLE_API_KEY");

    let state = crate::app::AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-fork-revoked",
        "local",
        &workspace_path.to_string_lossy(),
    );

    let mut record = session_record("opencode");
    record.workspace_id = "workspace-fork-revoked".to_string();
    record.last_prompt_at = Some("2026-03-25T00:05:00Z".to_string());
    record.action_capabilities_json = Some(r#"{"fork":true}"#.to_string());
    insert_startable_session(&state, &record);

    let error = state
        .session_runtime
        .fork_session(&record.id, None, None, None)
        .await
        .expect_err("a real opencode credential gap on the parent must refuse the fork");

    match error {
        ForkSessionError::AgentNotReady { agent_kind, .. } => {
            assert_eq!(agent_kind, "opencode");
        }
        other => panic!("expected AgentNotReady, got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(&runtime_home);
    let _ = std::fs::remove_dir_all(&empty_home);
}

// ---------------------------------------------------------------------------
// Forks ADR rung 2: targeted-fork plumbing (idempotency, provenance, gating).
// These exercise the branches that short-circuit BEFORE the live-start seam
// (`ensure_live_session_handle`), so they need no spawned agent: target
// validation, the capability gate, and the idempotency lookup all resolve
// against the durable store.
// ---------------------------------------------------------------------------

// The shared fork fixtures (`build_forkable_fork_state`,
// `build_forkable_fork_state_for_agent`, `before_user_message_target`) live in
// the sibling `fork_anchor_gate_tests` module (split for the PROD-SIZE-1
// ratchet) and are imported at the top of this file.

#[tokio::test(flavor = "current_thread")]
async fn fork_rejects_item_less_target_with_invalid_fork_target() {
    use crate::domains::sessions::runtime::ForkSessionError;
    let (state, parent_id, runtime_home) = build_forkable_fork_state(r#"{"fork":true}"#);

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message_target(None)),
            None,
            None,
        )
        .await
        .expect_err("item-less target must be rejected at the product boundary");

    assert!(matches!(error, ForkSessionError::InvalidForkTarget(_)));
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn targeted_fork_fails_closed_without_the_capability_and_creates_no_child() {
    // The silent target-to-tip downgrade is the cardinal sin: a targeted
    // request on an agent that does not advertise `targeted_fork` must fail
    // closed with FORK_UNSUPPORTED and leave NO fork child behind — never a tip
    // child standing in for the requested boundary.
    use crate::domains::sessions::runtime::ForkSessionError;
    let (state, parent_id, runtime_home) = build_forkable_fork_state(r#"{"fork":true}"#);

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message_target(Some("item-1"))),
            None,
            None,
        )
        .await
        .expect_err("targeted fork without the capability must fail closed");

    assert!(matches!(error, ForkSessionError::Unsupported(_)));
    let link_service = SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    );
    let children = link_service.list_by_parent(&parent_id).expect("list links");
    assert!(
        children.is_empty(),
        "no fork child (tip or otherwise) may be created for a rejected targeted fork"
    );
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn same_key_different_payload_is_idempotency_conflict() {
    use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};
    use crate::domains::sessions::runtime::ForkSessionError;
    let (state, parent_id, runtime_home) = build_forkable_fork_state(r#"{"fork":true}"#);

    let operation = ForkOperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: "reserved-child".to_string(),
        request_digest: "a-different-payload-digest".to_string(),
        parent_session_id: parent_id.clone(),
        child_session_id: "reserved-child".to_string(),
        phase: ForkOperationPhase::Completed,
        anchor_turn_id: None,
        anchor_item_id: None,
        provider_anchor_kind: Some("tip".to_string()),
        provider_anchor_value: None,
        provider_anchor_inclusive: None,
        prefix_terminal_seq: Some(0),
        prefix_digest: Some("digest".to_string()),
        adapter_version: None,
        native_version: None,
        native_child_session_id: None,
        checkpoint_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
    };
    state
        .session_service
        .store()
        .insert_fork_operation(&operation)
        .expect("insert operation");

    let error = state
        .session_runtime
        .fork_session(&parent_id, None, Some("reserved-child".to_string()), None)
        .await
        .expect_err("same key + different payload conflicts");
    assert!(matches!(error, ForkSessionError::IdempotencyConflict));
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn unknown_native_outcome_blocks_redispatch_on_the_same_key() {
    // Double-fork guard (ADR 4.4): a prior operation whose native outcome is
    // unknown parks at `native_outcome_unknown`; the same key + same payload
    // refuses to re-dispatch rather than risk a second native child.
    use super::fork::canonical_fork_request_digest;
    use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};
    use crate::domains::sessions::runtime::ForkSessionError;
    let (state, parent_id, runtime_home) = build_forkable_fork_state(r#"{"fork":true}"#);

    let operation = ForkOperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: "reserved-child".to_string(),
        request_digest: canonical_fork_request_digest(&parent_id, None),
        parent_session_id: parent_id.clone(),
        child_session_id: "reserved-child".to_string(),
        phase: ForkOperationPhase::NativeOutcomeUnknown,
        anchor_turn_id: None,
        anchor_item_id: None,
        provider_anchor_kind: Some("tip".to_string()),
        provider_anchor_value: None,
        provider_anchor_inclusive: None,
        prefix_terminal_seq: Some(0),
        prefix_digest: Some("digest".to_string()),
        adapter_version: None,
        native_version: None,
        native_child_session_id: None,
        checkpoint_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
    };
    state
        .session_service
        .store()
        .insert_fork_operation(&operation)
        .expect("insert operation");

    let error = state
        .session_runtime
        .fork_session(&parent_id, None, Some("reserved-child".to_string()), None)
        .await
        .expect_err("unknown native outcome blocks redispatch");
    assert!(matches!(error, ForkSessionError::NativeOutcomeUnknown));
    let _ = std::fs::remove_dir_all(&runtime_home);
}
