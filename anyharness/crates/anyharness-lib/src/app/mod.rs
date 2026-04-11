use std::path::PathBuf;
use std::sync::Arc;

use crate::acp::manager::AcpManager;
use crate::agents::reconcile_execution::AgentReconcileService;
use crate::cowork::artifacts::CoworkArtifactRuntime;
use crate::cowork::mcp_auth::CoworkMcpAuth;
use crate::cowork::runtime::{CoworkRuntime, CoworkSessionHooks};
use crate::cowork::service::CoworkService;
use crate::cowork::store::CoworkStore;
use crate::files::runtime::WorkspaceFilesRuntime;
use crate::git::WorkspaceFileSearchCache;
use crate::mobility::service::MobilityService;
use crate::persistence::Db;
use crate::processes::ProcessService;
use crate::repo_roots::service::RepoRootService;
use crate::repo_roots::store::RepoRootStore;
use crate::sessions::mcp::{load_data_cipher_from_env, DATA_KEY_ENV_VAR};
use crate::sessions::runtime::SessionRuntime;
use crate::sessions::service::SessionService;
use crate::sessions::store::SessionStore;
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
    pub session_service: Arc<SessionService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub mobility_service: Arc<MobilityService>,
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
        let cowork_session_hooks = Arc::new(CoworkSessionHooks::new(
            runtime_base_url.clone(),
            bearer_token.clone(),
            cowork_mcp_auth,
        ));
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
        let acp_manager = AcpManager::new();
        let terminal_service = Arc::new(TerminalService::new());
        let workspace_access_gate = Arc::new(WorkspaceAccessGate::new(
            WorkspaceStore::new(db.clone()),
            SessionStore::new(db.clone()),
            WorkspaceAccessStore::new(db.clone()),
            terminal_service.clone(),
        ));
        let session_runtime = Arc::new(SessionRuntime::new(
            session_service.clone(),
            workspace_runtime.clone(),
            acp_manager.clone(),
            runtime_home.clone(),
            session_data_cipher,
            cowork_session_hooks.clone(),
            workspace_access_gate.clone(),
        ));
        let cowork_runtime = Arc::new(CoworkRuntime::new(
            (*cowork_service).clone(),
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
            session_service.clone(),
            session_runtime.clone(),
            workspace_access_gate.clone(),
            setup_execution_service.clone(),
            terminal_service.clone(),
        ));
        Ok(Self {
            runtime_home,
            runtime_base_url,
            db,
            bearer_token,
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
            session_service,
            session_runtime,
            workspace_access_gate,
            mobility_service,
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
    PathBuf::from(home).join(".proliferate").join("anyharness")
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
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::{test_support, AppState};
    use crate::persistence::Db;

    #[test]
    fn app_state_allows_missing_bearer_token_when_not_required() {
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
        )
        .expect("expected app state");

        assert_eq!(state.bearer_token, None);
    }

    #[test]
    fn app_state_rejects_missing_bearer_token_when_required() {
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
        )
        .err()
        .expect("expected missing bearer token error");

        assert_eq!(
            error.to_string(),
            "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
        );
    }

    #[test]
    fn app_state_rejects_blank_bearer_token_when_required() {
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
        )
        .err()
        .expect("expected blank bearer token error");

        assert_eq!(
            error.to_string(),
            "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
        );
    }

    #[test]
    fn app_state_rejects_invalid_data_key() {
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
}
