use std::ffi::OsString;
use std::sync::{Arc, Mutex, OnceLock};

use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::live_ports::SessionAttachmentSource;
use crate::domains::sessions::mcp_bindings::crypto::DATA_KEY_ENV_VAR;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::model::ActorCapabilities;
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
