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

/// Restores `$HOME` on drop. Used to redirect `dirs::home_dir()`-backed writes
/// (e.g. the ambient `~/.codex` mobility-install mirror) into a temp dir so a
/// test never touches the developer's real home. Serialize with [`ENV_MUTEX`].
pub(crate) struct HomeEnvGuard {
    previous: Option<OsString>,
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}

pub(crate) fn set_home_env(value: Option<&std::path::Path>) -> HomeEnvGuard {
    let previous = std::env::var_os("HOME");
    match value {
        Some(path) => std::env::set_var("HOME", path),
        None => std::env::remove_var("HOME"),
    }
    HomeEnvGuard { previous }
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
