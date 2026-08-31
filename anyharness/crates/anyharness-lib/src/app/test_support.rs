use std::ffi::OsString;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use crate::domains::agents::launch_options::{
    HarnessLaunchDefaults, HarnessLaunchModel, HarnessLaunchOptions, HarnessLaunchOptionsService,
    HarnessLaunchOptionsState,
};
use crate::domains::agents::route_auth::{apply_state_file, AgentAuthState};
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::live_ports::SessionAttachmentSource;
use crate::domains::sessions::mcp_bindings::crypto::DATA_KEY_ENV_VAR;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::model::ActorCapabilities;
use crate::live::sessions::product_context::{
    AgentProductContext, AgentProductContextResolutionError, AgentProductContextResolver,
};
use crate::persistence::Db;

/// Store-backed [`ActorCapabilities`] for tests: the same wiring as
/// `app/sessions.rs` (one `SessionStore` behind the store traits plus a
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
        idle_reap: Arc::new(store.clone()),
        fork_dispatch: Arc::new(store.clone()),
        attachments: Arc::new(SessionAttachmentSource::new(
            store.clone(),
            attachment_storage,
        )),
        product_context: Arc::new(TestAgentProductContextResolver),
        observers: Vec::new(),
        permission_advisor: None,
        launch_observation_invalidator: None,
        seat_cooling: Some(Arc::new(
            crate::domains::agents::seat_cooling::SeatCoolingStore::new(store.db()),
        )),
    }
}

/// Seed the successful Claude observation reported by the scripted session
/// harness used throughout actor and workflow tests.
pub(crate) fn seed_scripted_claude_launch_options(service: &HarnessLaunchOptionsService) {
    seed_observed_launch_options(service, "claude");
}

/// Seed one target-observed launch-option statement for `harness_kind` so
/// intent validation at the start seam has a current-basis observation.
///
/// A stored row whose basis no longer matches projects as `Detecting`, so the
/// guard tests observation state rather than row presence: a fixture that
/// swaps the harness program after boot must be able to re-observe the new
/// basis instead of silently keeping a stale statement.
pub(crate) fn seed_observed_launch_options(
    service: &HarnessLaunchOptionsService,
    harness_kind: &str,
) {
    if service
        .read(harness_kind)
        .expect("read launch options")
        .is_some_and(|response| response.state == HarnessLaunchOptionsState::Observed)
    {
        return;
    }
    let started = service
        .begin_probe(harness_kind, "2026-08-10T23:58:00Z")
        .expect("begin launch-option observation");
    service
        .record_success(
            &started,
            &HarnessLaunchOptions {
                models: vec![HarnessLaunchModel {
                    id: "haiku".to_string(),
                    observed_name: Some("Haiku".to_string()),
                    observed_description: None,
                }],
                controls: Vec::new(),
                defaults: HarnessLaunchDefaults {
                    model_id: Some("haiku".to_string()),
                    control_values: Default::default(),
                },
                model_controls: Vec::new(),
            },
            "2026-08-10T23:58:01Z",
        )
        .expect("record scripted launch-option observation");
}

/// Install the product-owned API-key route used by scripted Claude fixtures.
/// Capability-affecting credentials must never ride the global/workspace env
/// that launch admission deliberately rejects.
///
/// Route-provided credentials never clear a native-CLI `InstallRequired` the
/// way env credentials do (`compute_readiness` checks the native artifact only
/// on the not-env-ready branch), so the fixture also installs a managed native
/// CLI stub — CI has no real `claude` on PATH.
pub(crate) fn install_scripted_claude_auth(runtime_home: &Path) {
    let native_dir = runtime_home.join("agents/claude/native");
    std::fs::create_dir_all(&native_dir).expect("create managed native dir");
    let native_stub = native_dir.join("claude");
    std::fs::write(&native_stub, "#!/bin/sh\nexit 0\n").expect("write native claude stub");
    crate::integrations::agent_cli::executable::make_executable(&native_stub)
        .expect("make native claude stub executable");
    let state: AgentAuthState = serde_json::from_value(serde_json::json!({
        "version": 2,
        "revision": 1,
        "harnesses": [{
            "harness_kind": "claude",
            "sources": [{
                "kind": "api_key",
                "env_var_name": "ANTHROPIC_API_KEY",
                "value": "test-not-a-real-key"
            }]
        }]
    }))
    .expect("scripted Claude agent-auth state");
    apply_state_file(runtime_home, &state).expect("install scripted Claude agent-auth state");
}

struct TestAgentProductContextResolver;

impl AgentProductContextResolver for TestAgentProductContextResolver {
    fn resolve(
        &self,
        _session_id: &str,
    ) -> Result<AgentProductContext, AgentProductContextResolutionError> {
        Ok(AgentProductContext::new(
            "You are currently an ordinary agent in this test workspace.",
        ))
    }
}

pub(crate) static ENV_MUTEX: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

/// Take the crate-wide process-environment lock for the length of a test body.
///
/// Every test that mutates or depends on a process-global variable —
/// `ANYHARNESS_BEARER_TOKEN`, `ANYHARNESS_DATA_KEY`, `PATH`, `HOME`, the
/// `ANYHARNESS_*_AGENT_PROGRAM` overrides — must hold this, and it has to be ONE
/// lock crate-wide: narrowing `PATH` to a temp dir breaks any test in the crate
/// that shells out, and an invalid `ANYHARNESS_DATA_KEY` breaks any test that
/// builds an `AppState`. Module-local locks would not exclude those.
///
/// The mutex is `tokio::sync` on purpose: test bodies hold it across real
/// awaits (HTTP dispatches, child processes, kill escalations), which is the
/// async mutex's *intended* semantics — and what lets `await_holding_lock`
/// stay a deny-level law for the std guards it exists to catch. Under nextest
/// (process-per-test, what CI runs) the lock is uncontended by construction;
/// under `cargo test --workspace` it still serializes env-touching tests,
/// with waiters yielding instead of blocking libtest threads. Tokio mutexes
/// do not poison, so one panicking test no longer cascades bogus
/// "poisoned mutex" failures through the rest of a shared-process run.
pub(crate) async fn lock_env() -> tokio::sync::MutexGuard<'static, ()> {
    ENV_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

/// Sync-test companion to [`lock_env`]: the same crate-wide lock, taken from
/// outside any runtime (a plain `#[test]`). Tokio's `blocking_lock` panics if
/// called from async context by contract — async tests use `lock_env().await`.
pub(crate) fn lock_env_blocking() -> tokio::sync::MutexGuard<'static, ()> {
    ENV_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .blocking_lock()
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
    store.seed_empty_launch_intent(session_id);
}

pub(crate) fn seed_repo_root(db: &Db, repo_root_id: &str, path: &str) {
    let now = "2026-03-25T00:00:00Z";
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (?1, 'external', ?2, NULL, 'main', NULL, NULL, NULL, NULL, ?3, ?3)",
            rusqlite::params![repo_root_id, path, now],
        )?;
        Ok(())
    })
    .expect("seed repo root");
}

pub(crate) fn seed_workspace_with_repo_root(db: &Db, workspace_id: &str, kind: &str, path: &str) {
    let repo_root_id = format!("repo-root-{workspace_id}");
    seed_repo_root(db, &repo_root_id, path);
    let now = "2026-03-25T00:00:00Z";
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (
                id, kind, repo_root_id, path, surface, lifecycle_state,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'standard', 'active', ?5, ?5)",
            rusqlite::params![workspace_id, kind, repo_root_id, path, now],
        )?;
        Ok(())
    })
    .expect("seed workspace and repo root");
}
