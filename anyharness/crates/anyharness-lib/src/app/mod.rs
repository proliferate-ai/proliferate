use std::path::PathBuf;
use std::sync::Arc;

use crate::acp::manager::AcpManager;
use crate::agents::catalog::ModelCatalogService;
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
use crate::sessions::attachment_storage::PromptAttachmentStorage;
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
use crate::sessions::workspace_naming::hooks::WorkspaceNamingSessionHooks;
use crate::sessions::workspace_naming::mcp_auth::WorkspaceNamingMcpAuth;
use crate::terminals::store::TerminalStore;
use crate::terminals::TerminalService;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::access_store::WorkspaceAccessStore;
use crate::workspaces::checkout_gate::CheckoutDeletionGate;
use crate::workspaces::inventory::WorktreeInventoryService;
use crate::workspaces::operation_gate::WorkspaceOperationGate;
use crate::workspaces::purge::WorkspacePurgeService;
use crate::workspaces::retention::WorkspaceRetentionService;
use crate::workspaces::retention_policy::WorktreeRetentionPolicyStore;
use crate::workspaces::retire_preflight::RetirePreflightChecker;
use crate::workspaces::runtime::WorkspaceRuntime;
use crate::workspaces::service::WorkspaceService;
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
    pub model_catalog_service: Arc<ModelCatalogService>,
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
    pub workspace_naming_session_hooks: Arc<WorkspaceNamingSessionHooks>,
    pub session_service: Arc<SessionService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub workspace_operation_gate: Arc<WorkspaceOperationGate>,
    pub checkout_deletion_gate: Arc<CheckoutDeletionGate>,
    pub retire_preflight_checker: Arc<RetirePreflightChecker>,
    pub workspace_purge_service: Arc<WorkspacePurgeService>,
    pub workspace_retention_service: Arc<WorkspaceRetentionService>,
    pub worktree_inventory_service: Arc<WorktreeInventoryService>,
    pub mobility_service: Arc<MobilityService>,
    pub plan_service: Arc<PlanService>,
    pub plan_runtime: Arc<PlanRuntime>,
    pub acp_manager: AcpManager,
    pub terminal_service: Arc<TerminalService>,
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
        let model_catalog_service = Arc::new(ModelCatalogService::new(runtime_home.clone()));
        #[cfg(not(test))]
        model_catalog_service.spawn_refresh();
        let process_service = Arc::new(ProcessService::new());
        let workspace_operation_gate = Arc::new(WorkspaceOperationGate::new());
        let checkout_deletion_gate = Arc::new(CheckoutDeletionGate::new());
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
            model_catalog_service.clone(),
        ));
        let plan_service = Arc::new(PlanService::new(PlanStore::new(db.clone())));
        let acp_manager = AcpManager::new(plan_service.clone());
        let terminal_service = Arc::new(TerminalService::new(
            TerminalStore::new(db.clone()),
            runtime_home.clone(),
        ));
        let worktree_inventory_service = Arc::new(WorktreeInventoryService::new(
            WorkspaceStore::new(db.clone()),
            SessionStore::new(db.clone()),
            checkout_deletion_gate.clone(),
            runtime_home.clone(),
        ));
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
            session_link_service.clone(),
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
        let workspace_naming_mcp_auth = Arc::new(WorkspaceNamingMcpAuth::new(runtime_home.clone()));
        let workspace_naming_session_hooks = Arc::new(WorkspaceNamingSessionHooks::new(
            runtime_base_url.clone(),
            bearer_token.clone(),
            workspace_naming_mcp_auth,
            SessionStore::new(db.clone()),
        ));
        let session_extensions: Vec<Arc<dyn crate::sessions::extensions::SessionExtension>> = vec![
            cowork_session_hooks.clone(),
            subagent_session_hooks.clone(),
            review_session_hooks.clone(),
            workspace_naming_session_hooks.clone(),
        ];
        let session_runtime = Arc::new(SessionRuntime::new(
            session_service.clone(),
            session_link_service.clone(),
            workspace_runtime.clone(),
            acp_manager.clone(),
            runtime_home.clone(),
            session_data_cipher,
            session_extensions,
            workspace_access_gate.clone(),
            plan_service.clone(),
        ));
        let retire_preflight_checker = Arc::new(RetirePreflightChecker::new(
            workspace_runtime.clone(),
            workspace_access_gate.clone(),
            workspace_operation_gate.clone(),
            session_runtime.clone(),
            session_service.clone(),
            terminal_service.clone(),
        ));
        let workspace_purge_service = Arc::new(WorkspacePurgeService::new(
            workspace_runtime.clone(),
            WorkspaceStore::new(db.clone()),
            SessionStore::new(db.clone()),
            PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_operation_gate.clone(),
            checkout_deletion_gate.clone(),
            retire_preflight_checker.clone(),
        ));
        let workspace_retention_service = Arc::new(WorkspaceRetentionService::new(
            workspace_runtime.clone(),
            WorkspaceStore::new(db.clone()),
            WorktreeRetentionPolicyStore::new(db.clone()),
            retire_preflight_checker.clone(),
            workspace_operation_gate.clone(),
            checkout_deletion_gate.clone(),
            runtime_home.clone(),
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
        let mobility_service = Arc::new(MobilityService::new(
            workspace_service.clone(),
            workspace_runtime.clone(),
            MobilityStore::new(db.clone()),
            session_service.clone(),
            session_runtime.clone(),
            subagent_service.clone(),
            workspace_access_gate.clone(),
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
        #[cfg(not(test))]
        workspace_retention_service.clone().spawn_startup_pass();
        Ok(Self {
            runtime_home,
            runtime_base_url,
            db,
            bearer_token,
            agent_seed_store,
            agent_reconcile_service,
            model_catalog_service,
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
            workspace_naming_session_hooks,
            session_service,
            session_runtime,
            workspace_access_gate,
            workspace_operation_gate,
            checkout_deletion_gate,
            retire_preflight_checker,
            workspace_purge_service,
            workspace_retention_service,
            worktree_inventory_service,
            mobility_service,
            plan_service,
            plan_runtime,
            acp_manager,
            terminal_service,
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
mod tests;
