use std::path::PathBuf;
use std::sync::Arc;

use crate::acp::manager::AcpManager;
use crate::agents::reconcile_execution::AgentReconcileService;
use crate::agents::seed::AgentSeedStore;
use crate::cowork::artifacts::CoworkArtifactRuntime;
use crate::cowork::delegation::service::CoworkDelegationService;
use crate::cowork::mcp_auth::CoworkMcpAuth;
use crate::cowork::runtime::{CoworkRuntime, CoworkSessionHooks};
use crate::cowork::service::CoworkService;
use crate::cowork::store::CoworkStore;
use crate::files::runtime::WorkspaceFilesRuntime;
use crate::git::WorkspaceFileSearchCache;
use crate::mobility::service::MobilityService;
use crate::mobility::store::MobilityStore;
use crate::persistence::Db;
use crate::plans::runtime::PlanRuntime;
use crate::plans::service::PlanService;
use crate::plans::store::PlanStore;
use crate::processes::ProcessService;
use crate::repo_roots::service::RepoRootService;
use crate::repo_roots::store::RepoRootStore;
use crate::reviews::hooks::ReviewSessionHooks;
use crate::reviews::mcp_auth::ReviewMcpAuth;
use crate::reviews::runtime::ReviewRuntime;
use crate::reviews::service::ReviewService;
use crate::reviews::store::ReviewStore;
use crate::sessions::links::completions::LinkCompletionStore;
use crate::sessions::links::service::SessionLinkService;
use crate::sessions::links::store::SessionLinkStore;
use crate::sessions::mcp::{load_data_cipher_from_env, DATA_KEY_ENV_VAR};
use crate::sessions::runtime::SessionRuntime;
use crate::sessions::service::SessionService;
use crate::sessions::store::SessionStore;
use crate::sessions::subagents::hooks::SubagentSessionHooks;
use crate::sessions::subagents::mcp_auth::SubagentMcpAuth;
use crate::sessions::subagents::service::SubagentService;
use crate::sessions::subagents::store::SubagentStore;
use crate::terminals::TerminalService;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::access_store::WorkspaceAccessStore;
use crate::workspaces::runtime::WorkspaceRuntime;
use crate::workspaces::service::WorkspaceService;
use crate::workspaces::setup_execution::SetupExecutionService;
use crate::workspaces::store::WorkspaceStore;

#[derive(Debug, thiserror::Error)]
pub enum AppStateInitError {
    #[error(
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
         environment variable is missing or empty. Refusing to start without authentication."
    )]
    MissingBearerToken,
    #[error("Invalid {DATA_KEY_ENV_VAR}: {0}")]
    InvalidDataKey(String),
}

#[derive(Clone)]
pub struct AppState {
    pub runtime_home: PathBuf,
    pub runtime_base_url: String,
    pub db: Db,
    pub bearer_token: Option<String>,
    pub agent_seed_store: AgentSeedStore,
    pub agent_reconcile_service: Arc<AgentReconcileService>,
    pub repo_root_service: Arc<RepoRootService>,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub files_runtime: Arc<WorkspaceFilesRuntime>,
    pub process_service: Arc<ProcessService>,
    pub workspace_file_search_cache: Arc<WorkspaceFileSearchCache>,
    pub cowork_service: Arc<CoworkService>,
    pub cowork_artifact_runtime: Arc<CoworkArtifactRuntime>,
    pub cowork_session_hooks: Arc<CoworkSessionHooks>,
    pub cowork_runtime: Arc<CoworkRuntime>,
    pub subagent_service: Arc<SubagentService>,
    pub subagent_session_hooks: Arc<SubagentSessionHooks>,
    pub review_service: Arc<ReviewService>,
    pub review_session_hooks: Arc<ReviewSessionHooks>,
    pub review_runtime: Arc<ReviewRuntime>,
    pub session_service: Arc<SessionService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub mobility_service: Arc<MobilityService>,
    pub plan_service: Arc<PlanService>,
    pub plan_runtime: Arc<PlanRuntime>,
    pub acp_manager: AcpManager,
    pub terminal_service: Arc<TerminalService>,
    pub setup_execution_service: Arc<SetupExecutionService>,
}

impl AppState {
    pub fn new(
        runtime_home: PathBuf,
        runtime_base_url: String,
        db: Db,
        require_bearer_auth: bool,
        agent_seed_store: AgentSeedStore,
    ) -> Result<Self, AppStateInitError> {
        let bearer_token = load_bearer_token(require_bearer_auth)?;
        let session_data_cipher =
            load_data_cipher_from_env().map_err(AppStateInitError::InvalidDataKey)?;
        let repo_root_service = Arc::new(RepoRootService::new(RepoRootStore::new(db.clone())));
        let workspace_service = Arc::new(WorkspaceService::new(
            WorkspaceStore::new(db.clone()),
            runtime_home.clone(),
        ));
        let workspace_runtime = Arc::new(WorkspaceRuntime::new(
            (*workspace_service).clone(),
            WorkspaceStore::new(db.clone()),
            (*repo_root_service).clone(),
            runtime_home.clone(),
        ));
        let agent_reconcile_service = Arc::new(AgentReconcileService::new());
        let process_service = Arc::new(ProcessService::new());
        let workspace_file_search_cache = Arc::new(WorkspaceFileSearchCache::new());
        let cowork_service = Arc::new(CoworkService::new(CoworkStore::new(db.clone())));
        let cowork_artifact_runtime = Arc::new(CoworkArtifactRuntime::new());
        let cowork_mcp_auth = Arc::new(CoworkMcpAuth::new(runtime_home.clone()));
        let files_runtime = Arc::new(WorkspaceFilesRuntime::new(
            workspace_runtime.clone(),
            cowork_artifact_runtime.clone(),
            workspace_file_search_cache.clone(),
        ));
        let session_service = Arc::new(SessionService::new(
            SessionStore::new(db.clone()),
            WorkspaceStore::new(db.clone()),
            runtime_home.clone(),
        ));
        let plan_service = Arc::new(PlanService::new(PlanStore::new(db.clone())));
        let acp_manager = AcpManager::new(plan_service.clone());
        let terminal_service = Arc::new(TerminalService::new());
        let workspace_access_gate = Arc::new(WorkspaceAccessGate::new(
            WorkspaceStore::new(db.clone()),
            SessionStore::new(db.clone()),
            WorkspaceAccessStore::new(db.clone()),
            terminal_service.clone(),
        ));
        let session_link_service = SessionLinkService::new(
            SessionLinkStore::new(db.clone()),
            SessionStore::new(db.clone()),
        );
        let cowork_delegation_service = CoworkDelegationService::new(
            (*cowork_service).clone(),
            SessionStore::new(db.clone()),
            session_link_service.clone(),
            LinkCompletionStore::new(db.clone()),
            workspace_runtime.clone(),
            workspace_access_gate.clone(),
        );
        let cowork_session_hooks = Arc::new(CoworkSessionHooks::new(
            runtime_base_url.clone(),
            bearer_token.clone(),
            cowork_mcp_auth,
            cowork_delegation_service.clone(),
            acp_manager.clone(),
            SessionStore::new(db.clone()),
        ));
        let subagent_service = Arc::new(SubagentService::new(
            SessionStore::new(db.clone()),
            session_link_service.clone(),
            SubagentStore::new(db.clone()),
            workspace_runtime.clone(),
            workspace_access_gate.clone(),
        ));
        let review_service = Arc::new(ReviewService::new(
            ReviewStore::new(db.clone()),
            SessionStore::new(db.clone()),
            session_link_service,
            plan_service.clone(),
        ));
        acp_manager.set_review_service(review_service.clone());
        let (review_hook_event_tx, review_hook_event_rx) = tokio::sync::mpsc::channel(256);
        let subagent_mcp_auth = Arc::new(SubagentMcpAuth::new(runtime_home.clone()));
        let subagent_session_hooks = Arc::new(SubagentSessionHooks::new(
            runtime_base_url.clone(),
            bearer_token.clone(),
            subagent_mcp_auth,
            subagent_service.clone(),
            acp_manager.clone(),
            SessionStore::new(db.clone()),
        ));
        let review_mcp_auth = Arc::new(ReviewMcpAuth::new(runtime_home.clone()));
        let review_session_hooks = Arc::new(ReviewSessionHooks::new(
            runtime_base_url.clone(),
            bearer_token.clone(),
            review_mcp_auth,
            review_hook_event_tx,
        ));
        let session_extensions: Vec<Arc<dyn crate::sessions::extensions::SessionExtension>> = vec![
            cowork_session_hooks.clone(),
            subagent_session_hooks.clone(),
            review_session_hooks.clone(),
        ];
        let session_runtime = Arc::new(SessionRuntime::new(
            session_service.clone(),
            workspace_runtime.clone(),
            acp_manager.clone(),
            runtime_home.clone(),
            session_data_cipher,
            session_extensions,
            workspace_access_gate.clone(),
            plan_service.clone(),
        ));
        let cowork_runtime = Arc::new(CoworkRuntime::new(
            (*cowork_service).clone(),
            cowork_delegation_service,
            (*repo_root_service).clone(),
            workspace_runtime.clone(),
            session_service.clone(),
            session_runtime.clone(),
            runtime_home.clone(),
        ));
        let setup_execution_service = Arc::new(SetupExecutionService::new());
        let mobility_service = Arc::new(MobilityService::new(
            workspace_service.clone(),
            workspace_runtime.clone(),
            MobilityStore::new(db.clone()),
            session_service.clone(),
            session_runtime.clone(),
            subagent_service.clone(),
            workspace_access_gate.clone(),
            setup_execution_service.clone(),
            terminal_service.clone(),
        ));
        let plan_runtime = Arc::new(PlanRuntime::new(
            plan_service.clone(),
            session_runtime.clone(),
            session_service.clone(),
            runtime_home.clone(),
        ));
        let review_runtime = Arc::new(ReviewRuntime::new(
            review_service.clone(),
            session_runtime.clone(),
            workspace_runtime.clone(),
            runtime_home.clone(),
        ));
        review_runtime
            .clone()
            .spawn_background_tasks(review_hook_event_rx);
        Ok(Self {
            runtime_home,
            runtime_base_url,
            db,
            bearer_token,
            agent_seed_store,
            agent_reconcile_service,
            repo_root_service,
            workspace_runtime,
            files_runtime,
            process_service,
            workspace_file_search_cache,
            cowork_service,
            cowork_artifact_runtime,
            cowork_session_hooks,
            cowork_runtime,
            subagent_service,
            subagent_session_hooks,
            review_service,
            review_session_hooks,
            review_runtime,
            session_service,
            session_runtime,
            workspace_access_gate,
            mobility_service,
            plan_service,
            plan_runtime,
            acp_manager,
            terminal_service,
            setup_execution_service,
        })
    }
}

fn load_bearer_token(require_bearer_auth: bool) -> Result<Option<String>, AppStateInitError> {
    let bearer_token = std::env::var("ANYHARNESS_BEARER_TOKEN")
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty());

    if require_bearer_auth && bearer_token.is_none() {
        tracing::error!(
            "Bearer authentication required, but ANYHARNESS_BEARER_TOKEN is missing or empty"
        );
        return Err(AppStateInitError::MissingBearerToken);
    }

    match bearer_token.as_ref() {
        Some(_) => tracing::info!("Bearer authentication enabled"),
        None => tracing::warn!(
            "Bearer authentication disabled because ANYHARNESS_BEARER_TOKEN is not configured"
        ),
    }

    Ok(bearer_token)
}

pub fn default_runtime_home() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    let dir = proliferate_home_dir_name(cfg!(debug_assertions));
    PathBuf::from(home).join(dir).join("anyharness")
}

fn proliferate_home_dir_name(debug_build: bool) -> &'static str {
    if std::env::var_os("PROLIFERATE_DEV").is_some() || debug_build {
        ".proliferate-local"
    } else {
        ".proliferate"
    }
}

pub fn ensure_runtime_home(path: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    std::fs::create_dir_all(path.join("agents"))?;
    std::fs::create_dir_all(path.join("logs"))?;
    std::fs::create_dir_all(path.join("secrets"))?;
    std::fs::create_dir_all(path.join("tmp"))?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};

    use crate::sessions::mcp::DATA_KEY_ENV_VAR;

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
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::{proliferate_home_dir_name, test_support, AppState};
    use crate::{agents::seed::AgentSeedStore, persistence::Db};

    #[tokio::test(flavor = "current_thread")]
    async fn app_state_allows_missing_bearer_token_when_not_required() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(None);

        let state = AppState::new(
            PathBuf::from("/tmp/anyharness-app-state-no-token"),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("expected in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("expected app state");

        assert_eq!(state.bearer_token, None);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn app_state_rejects_missing_bearer_token_when_required() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(None);

        let error = AppState::new(
            PathBuf::from("/tmp/anyharness-app-state-required-token"),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("expected in-memory db"),
            true,
            AgentSeedStore::not_configured_dev(),
        )
        .err()
        .expect("expected missing bearer token error");

        assert_eq!(
            error.to_string(),
            "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn app_state_rejects_blank_bearer_token_when_required() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(Some("   "));
        let _data_key_guard = test_support::set_data_key_env(None);

        let error = AppState::new(
            PathBuf::from("/tmp/anyharness-app-state-blank-token"),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("expected in-memory db"),
            true,
            AgentSeedStore::not_configured_dev(),
        )
        .err()
        .expect("expected blank bearer token error");

        assert_eq!(
            error.to_string(),
            "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn app_state_rejects_invalid_data_key() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(Some("not-base64"));

        let error = AppState::new(
            PathBuf::from("/tmp/anyharness-app-state-invalid-data-key"),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("expected in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .err()
        .expect("expected invalid data key error");

        assert!(
            error
                .to_string()
                .starts_with("Invalid ANYHARNESS_DATA_KEY:"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn proliferate_home_dir_name_uses_local_dir_for_debug_builds() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _dev_guard = test_support::set_proliferate_dev_env(None);

        assert_eq!(proliferate_home_dir_name(true), ".proliferate-local");
    }

    #[test]
    fn proliferate_home_dir_name_uses_local_dir_when_env_is_set() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _dev_guard = test_support::set_proliferate_dev_env(Some("1"));

        assert_eq!(proliferate_home_dir_name(false), ".proliferate-local");
    }

    #[test]
    fn proliferate_home_dir_name_uses_production_dir_for_release_without_env() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _dev_guard = test_support::set_proliferate_dev_env(None);

        assert_eq!(proliferate_home_dir_name(false), ".proliferate");
    }
}
