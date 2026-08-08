use std::ffi::OsString;
use std::sync::{Arc, Mutex, OnceLock};

use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::live_ports::SessionAttachmentSource;
use crate::domains::sessions::mcp_bindings::crypto::DATA_KEY_ENV_VAR;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::subagents::store::SubagentStore;
use crate::domains::terminals::store::TerminalStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::store::{WorkspaceAccessStore, WorkspaceStore};
use crate::live::sessions::model::ActorCapabilities;
use crate::live::terminals::TerminalService;
use crate::persistence::Db;

/// Store-backed [`ActorCapabilities`] for tests: the same wiring as
/// `app/sessions.rs` (one `SessionStore` behind the four store traits plus a
/// real `SessionAttachmentSource`), with no observers and no advisor.
pub(crate) fn actor_capabilities_for_store(store: &SessionStore) -> ActorCapabilities {
    let attachment_storage = PromptAttachmentStorage::new(
        std::env::temp_dir().join(format!("anyharness-test-{}", uuid::Uuid::new_v4())),
    );
    ActorCapabilities {
        events: Arc::new(store.clone()),
        queue: Arc::new(store.clone()),
        background: Arc::new(store.clone()),
        state: Arc::new(store.clone()),
        attachments: Arc::new(SessionAttachmentSource::new(
            store.clone(),
            attachment_storage,
        )),
        // No link store here (the helper only takes a session store), so no
        // soft-close fence. Tests that exercise the fence supply their own.
        close_requests: None,
        observers: Vec::new(),
        permission_advisor: None,
    }
}

pub(crate) static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

/// Take the crate-wide process-environment lock for the length of a test body.
///
/// Every test that mutates or depends on a process-global variable —
/// `ANYHARNESS_BEARER_TOKEN`, `ANYHARNESS_DATA_KEY`, `PATH`, `HOME`, the
/// `ANYHARNESS_*_AGENT_PROGRAM` overrides — must hold this, and it has to be ONE
/// lock crate-wide: narrowing `PATH` to a temp dir breaks any test in the crate
/// that shells out, and an invalid `ANYHARNESS_DATA_KEY` breaks any test that
/// builds an `AppState`. Module-local locks would not exclude those.
///
/// `.expect` on poisoning matches the crate's existing 88 call sites: a poisoned
/// lock means another test already panicked, and the run is failing either way.
pub(crate) fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex")
}

pub(crate) struct BearerTokenEnvGuard {
    previous: Option<OsString>,
}

impl Drop for BearerTokenEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var("ANYHARNESS_BEARER_TOKEN", value),
            None => std::env::remove_var("ANYHARNESS_BEARER_TOKEN"),
        }
    }
}

pub(crate) fn set_bearer_token_env(value: Option<&str>) -> BearerTokenEnvGuard {
    let previous = std::env::var_os("ANYHARNESS_BEARER_TOKEN");
    match value {
        Some(token) => std::env::set_var("ANYHARNESS_BEARER_TOKEN", token),
        None => std::env::remove_var("ANYHARNESS_BEARER_TOKEN"),
    }
    BearerTokenEnvGuard { previous }
}

pub(crate) struct DataKeyEnvGuard {
    previous: Option<OsString>,
}

impl Drop for DataKeyEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var(DATA_KEY_ENV_VAR, value),
            None => std::env::remove_var(DATA_KEY_ENV_VAR),
        }
    }
}

pub(crate) fn set_data_key_env(value: Option<&str>) -> DataKeyEnvGuard {
    let previous = std::env::var_os(DATA_KEY_ENV_VAR);
    match value {
        Some(key) => std::env::set_var(DATA_KEY_ENV_VAR, key),
        None => std::env::remove_var(DATA_KEY_ENV_VAR),
    }
    DataKeyEnvGuard { previous }
}

pub(crate) struct ProliferateDevEnvGuard {
    previous: Option<OsString>,
}

impl Drop for ProliferateDevEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var("PROLIFERATE_DEV", value),
            None => std::env::remove_var("PROLIFERATE_DEV"),
        }
    }
}

pub(crate) fn set_proliferate_dev_env(value: Option<&str>) -> ProliferateDevEnvGuard {
    let previous = std::env::var_os("PROLIFERATE_DEV");
    match value {
        Some(flag) => std::env::set_var("PROLIFERATE_DEV", flag),
        None => std::env::remove_var("PROLIFERATE_DEV"),
    }
    ProliferateDevEnvGuard { previous }
}

/// Insert one minimal session row directly through the store.
///
/// The 25-field `SessionRecord` literal every admission/workflow proof needs in
/// order to have a bindable session; only the id, workspace, and status ever
/// differ between call sites, so those are the parameters and the rest is the
/// same "no agent has touched it yet" shape.
pub(crate) fn insert_session_row(
    store: &SessionStore,
    workspace_id: &str,
    session_id: &str,
    status: &str,
) {
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};

    let now = chrono::Utc::now().to_rfc3339();
    let record = SessionRecord {
        id: session_id.to_string(),
        workspace_id: workspace_id.to_string(),
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
        status: status.to_string(),
        created_at: now.clone(),
        updated_at: now,
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InternalOnly,
        system_prompt_append: None,
        subagents_enabled: false,
        action_capabilities_json: None,
        origin: Some(crate::origin::OriginContext::system_local_runtime()),
    };
    store.insert(&record).expect("insert session row");
}

/// A store-backed [`SubagentService`] and the link service behind it.
///
/// The spawn gates (`validate_parent_can_spawn`,
/// `validate_caller_can_spawn_agent`) read the session store, the link store,
/// the workspace record and the access gate together, so proving what they
/// refuse needs the real wiring rather than a stub — this is the same
/// composition `app/mod.rs` builds, over an in-memory db. The link service is
/// handed back because the state those gates read (a subagent link, a promoted
/// one, eight of them) is written through it.
pub(crate) struct SubagentServiceFixture {
    pub service: SubagentService,
    pub links: SessionLinkService,
    pub sessions: SessionStore,
}

pub(crate) fn subagent_service_fixture(db: &Db) -> SubagentServiceFixture {
    let sessions = SessionStore::new(db.clone());
    let links = SessionLinkService::new(SessionLinkStore::new(db.clone()), sessions.clone());
    let session_delete_workflow = SessionDeleteWorkflow::new(db.clone());
    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-subagent-service-test-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_runtime = Arc::new(WorkspaceRuntime::new(
        WorkspaceStore::new(db.clone()),
        WorkspaceDeleteWorkflow::new(db.clone(), session_delete_workflow.clone()),
        RepoRootService::new(RepoRootStore::new(db.clone())),
        runtime_home.clone(),
    ));
    let access_gate = Arc::new(WorkspaceAccessGate::new(
        WorkspaceStore::new(db.clone()),
        sessions.clone(),
        WorkspaceAccessStore::new(db.clone()),
        Arc::new(TerminalService::new(
            TerminalStore::new(db.clone()),
            runtime_home,
        )),
    ));
    let service = SubagentService::new(
        sessions.clone(),
        session_delete_workflow,
        links.clone(),
        SubagentStore::new(db.clone()),
        workspace_runtime,
        access_gate,
    );
    SubagentServiceFixture {
        service,
        links,
        sessions,
    }
}

pub(crate) fn seed_workspace_with_repo_root(db: &Db, workspace_id: &str, kind: &str, path: &str) {
    let repo_root_id = format!("repo-root-{workspace_id}");
    let now = "2026-03-25T00:00:00Z";
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (?1, 'external', ?2, NULL, 'main', NULL, NULL, NULL, NULL, ?3, ?3)",
            rusqlite::params![repo_root_id, path, now],
        )?;
        conn.execute(
            "INSERT INTO workspaces (
                id, kind, repo_root_id, path, surface, lifecycle_state, cleanup_state,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'standard', 'active', 'none', ?5, ?5)",
            rusqlite::params![workspace_id, kind, repo_root_id, path, now],
        )?;
        Ok(())
    })
    .expect("seed workspace and repo root");
}
