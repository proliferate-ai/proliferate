mod product_mcp;
mod sessions;

use std::path::PathBuf;
use std::sync::Arc;

use crate::adapters::git::WorkspaceFileSearchCache;
use crate::adapters::hosting::PrStatusCache;
use crate::adapters::processes::ProcessService;
use crate::api::auth::AuthManager;
use crate::domains::agents::catalog::gateway_probe::GatewayProbeStore;
use crate::domains::agents::catalog::gateway_resolver::GatewayModelResolver;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::catalog::sync::CatalogSyncService;
use crate::domains::agents::installer::reconcile::execution::AgentReconcileService;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::runtime::AgentRuntime;
use crate::domains::activity::service::ActivityService;
use crate::domains::activity::store::ActivityStore;
use crate::domains::artifacts::protection::ArtifactProtectionService;
use crate::domains::artifacts::runtime::ArtifactRuntime;
use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::cowork::delegation::service::CoworkDelegationService;
use crate::domains::cowork::mcp::auth::CoworkMcpAuth;
use crate::domains::cowork::runtime::{CoworkRuntime, CoworkSessionHooks};
use crate::domains::cowork::service::CoworkService;
use crate::domains::cowork::store::{CoworkDeleteParticipant, CoworkStore};
use crate::domains::goals::hooks::GoalSessionHooks;
use crate::domains::goals::runtime::GoalRuntime;
use crate::domains::goals::service::GoalService;
use crate::domains::goals::store::GoalStore;
use crate::domains::loops::service::LoopService;
use crate::domains::loops::store::LoopStore;
use crate::domains::mobility::service::MobilityService;
use crate::domains::mobility::store::MobilityStore;
use crate::domains::plans::runtime::PlanRuntime;
use crate::domains::plans::service::PlanService;
use crate::domains::plans::store::PlanStore;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::reviews::hooks::ReviewSessionHooks;
use crate::domains::reviews::mcp::auth::ReviewMcpAuth;
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::domains::reviews::service::ReviewService;
use crate::domains::reviews::store::{ReviewDeleteParticipant, ReviewStore};
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::sessions::links::completions::LinkCompletionStore;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::mcp_bindings::crypto::{load_data_cipher_from_env, DATA_KEY_ENV_VAR};
use crate::domains::sessions::mcp_bindings::integration_gateway::IntegrationGatewaySessionLaunchExtension;
use crate::domains::sessions::mcp_bindings::product_registry::ProductMcpEndpointRegistry;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::hooks::SubagentSessionHooks;
use crate::domains::sessions::subagents::mcp::auth::SubagentMcpAuth;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::subagents::store::SubagentStore;
use crate::domains::terminals::store::TerminalStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::access_store::WorkspaceAccessStore;
use crate::domains::workspaces::checkout_gate::CheckoutDeletionGate;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::files_runtime::{
    WorkspaceFileProtection, WorkspaceFileProtectionRegistry, WorkspaceFilesRuntime,
};
use crate::domains::workspaces::inventory::WorktreeInventoryService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::purge::WorkspacePurgeService;
use crate::domains::workspaces::retention::WorkspaceRetentionService;
use crate::domains::workspaces::retention_policy::WorktreeRetentionPolicyStore;
use crate::domains::workspaces::retire_preflight::RetirePreflightChecker;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::service::WorkspaceService;
use crate::domains::workspaces::setup_runtime::WorkspaceSetupRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::domains::workspaces::worktree_runtime::WorkspaceWorktreeRuntime;
use crate::live::sessions::LiveSessionManager;
use crate::live::terminals::{AgentLoginTerminalService, TerminalService};
use crate::persistence::Db;

#[derive(Debug, thiserror::Error)]
pub enum AppStateInitError {
    #[error(
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
         environment variable is missing or empty. Refusing to start without authentication."
    )]
    MissingBearerToken,
    #[error("Invalid {DATA_KEY_ENV_VAR}: {0}")]
    InvalidDataKey(String),
    #[error("Invalid product MCP endpoint registry: {0}")]
    InvalidProductMcpRegistry(#[source] anyhow::Error),
}

#[derive(Clone)]
pub struct AppState {
    pub runtime_home: PathBuf,
    pub runtime_base_url: String,
    pub db: Db,
    pub bearer_token: Option<String>,
    pub auth_manager: AuthManager,
    pub agent_seed_store: AgentSeedStore,
    pub agent_runtime: Arc<AgentRuntime>,
    pub catalog_sync_service: Arc<CatalogSyncService>,
    pub gateway_model_resolver: Arc<GatewayModelResolver>,
    pub agent_reconcile_service: Arc<AgentReconcileService>,
    pub repo_root_service: Arc<RepoRootService>,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub workspace_setup_runtime: Arc<WorkspaceSetupRuntime>,
    pub workspace_worktree_runtime: Arc<WorkspaceWorktreeRuntime>,
    pub files_runtime: Arc<WorkspaceFilesRuntime>,
    pub process_service: Arc<ProcessService>,
    pub workspace_file_search_cache: Arc<WorkspaceFileSearchCache>,
    pub pr_status_cache: Arc<PrStatusCache>,
    pub artifact_runtime: Arc<ArtifactRuntime>,
    pub cowork_service: Arc<CoworkService>,
    pub cowork_artifact_runtime: Arc<CoworkArtifactRuntime>,
    pub cowork_session_hooks: Arc<CoworkSessionHooks>,
    pub cowork_runtime: Arc<CoworkRuntime>,
    pub subagent_service: Arc<SubagentService>,
    pub subagent_session_hooks: Arc<SubagentSessionHooks>,
    pub review_service: Arc<ReviewService>,
    pub review_session_hooks: Arc<ReviewSessionHooks>,
    pub integration_gateway_session_launch_extension: Arc<IntegrationGatewaySessionLaunchExtension>,
    pub review_runtime: Arc<ReviewRuntime>,
    pub product_mcp_endpoint_registry: Arc<ProductMcpEndpointRegistry>,
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
    pub goal_service: Arc<GoalService>,
    pub goal_runtime: Arc<GoalRuntime>,
    pub loop_service: Arc<LoopService>,
    pub activity_service: Arc<ActivityService>,
    pub acp_manager: LiveSessionManager,
    pub terminal_service: Arc<TerminalService>,
    pub agent_login_terminal_service: Arc<AgentLoginTerminalService>,
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
        let auth_manager = AuthManager::new(load_runtime_target_id());
        let session_data_cipher =
            load_data_cipher_from_env().map_err(AppStateInitError::InvalidDataKey)?;
        let session_delete_workflow = SessionDeleteWorkflow::with_participants(
            db.clone(),
            vec![
                Arc::new(CoworkDeleteParticipant),
                Arc::new(ReviewDeleteParticipant),
            ],
        );
        let workspace_delete_workflow = WorkspaceDeleteWorkflow::with_participants(
            db.clone(),
            session_delete_workflow.clone(),
            vec![Arc::new(CoworkDeleteParticipant)],
        );
        let repo_root_service = Arc::new(RepoRootService::new(RepoRootStore::new(db.clone())));
        let workspace_service = Arc::new(WorkspaceService::new(WorkspaceStore::new(db.clone())));
        let workspace_runtime = Arc::new(WorkspaceRuntime::new(
            WorkspaceStore::new(db.clone()),
            workspace_delete_workflow.clone(),
            (*repo_root_service).clone(),
            runtime_home.clone(),
        ));
        let agent_reconcile_service = Arc::new(AgentReconcileService::new());
        let catalog_sync_service = Arc::new(CatalogSyncService::from_bundled());
        let agent_runtime = Arc::new(AgentRuntime::new(
            runtime_home.clone(),
            agent_reconcile_service.clone(),
            agent_seed_store.clone(),
            AgentCatalogService::new(catalog_sync_service.clone()),
        ));
        catalog_sync_service
            .set_catalog_applied_poke(catalog_applied_reconcile_poke(agent_runtime.clone()));
        // Gateway model resolver (spec §2/§3): catalog gatewayPolicy + the
        // sqlite probe store -> the render plane's GatewayModelPlan.
        let gateway_model_resolver = Arc::new(GatewayModelResolver::new(
            catalog_sync_service.clone(),
            GatewayProbeStore::new(db.clone()),
        ));
        let process_service = Arc::new(ProcessService::new());
        let workspace_operation_gate = Arc::new(WorkspaceOperationGate::new());
        let checkout_deletion_gate = Arc::new(CheckoutDeletionGate::new());
        let workspace_file_search_cache = Arc::new(WorkspaceFileSearchCache::new());
        let pr_status_cache = Arc::new(PrStatusCache::new());
        let artifact_runtime = Arc::new(ArtifactRuntime::new());
        let cowork_service = Arc::new(CoworkService::new(CoworkStore::new(db.clone())));
        let cowork_artifact_runtime = Arc::new(CoworkArtifactRuntime::from_artifact_runtime(
            artifact_runtime.clone(),
        ));
        let cowork_mcp_auth = Arc::new(CoworkMcpAuth::new(runtime_home.clone()));
        let artifact_protection_service =
            Arc::new(ArtifactProtectionService::for_surfaces(["cowork"]));
        let file_protection_registry = WorkspaceFileProtectionRegistry::new(vec![
            artifact_protection_service as Arc<dyn WorkspaceFileProtection>,
        ]);
        let files_runtime = Arc::new(WorkspaceFilesRuntime::new(
            workspace_runtime.clone(),
            file_protection_registry,
            workspace_file_search_cache.clone(),
        ));
        let session_service = Arc::new(SessionService::new(
            SessionStore::new(db.clone()),
            session_delete_workflow.clone(),
            WorkspaceStore::new(db.clone()),
            AgentCatalogService::new(catalog_sync_service.clone()),
            runtime_home.clone(),
        ));
        let plan_service = Arc::new(PlanService::new(PlanStore::new(db.clone())));
        let goal_service = Arc::new(GoalService::new(GoalStore::new(db.clone())));
        let loop_service = Arc::new(LoopService::new(LoopStore::new(db.clone())));
        let activity_service = Arc::new(ActivityService::new(ActivityStore::new(db.clone())));
        let terminal_service = Arc::new(TerminalService::new(
            TerminalStore::new(db.clone()),
            runtime_home.clone(),
        ));
        let agent_login_terminal_service = Arc::new(AgentLoginTerminalService::new());
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
        let workspace_setup_runtime = Arc::new(WorkspaceSetupRuntime::new(
            workspace_runtime.clone(),
            terminal_service.clone(),
            workspace_access_gate.clone(),
            workspace_operation_gate.clone(),
        ));
        let session_link_service = SessionLinkService::new(
            SessionLinkStore::new(db.clone()),
            SessionStore::new(db.clone()),
        );
        let review_service = Arc::new(ReviewService::new(
            ReviewStore::new(db.clone()),
            SessionStore::new(db.clone()),
            session_delete_workflow.clone(),
            session_link_service.clone(),
            plan_service.clone(),
        ));
        let acp_manager = sessions::wire_live_sessions(&sessions::LiveSessionsWiringDeps {
            db: db.clone(),
            runtime_home: runtime_home.clone(),
            plan_service: plan_service.clone(),
            review_service: review_service.clone(),
            goal_service: goal_service.clone(),
            loop_service: loop_service.clone(),
            activity_service: activity_service.clone(),
        });
        let cowork_delegation_service = CoworkDelegationService::new(
            (*cowork_service).clone(),
            SessionStore::new(db.clone()),
            session_link_service.clone(),
            LinkCompletionStore::new(db.clone()),
            workspace_runtime.clone(),
            workspace_access_gate.clone(),
        );
        let cowork_session_hooks = Arc::new(CoworkSessionHooks::new(
            cowork_delegation_service.clone(),
            acp_manager.clone(),
        ));
        let subagent_service = Arc::new(SubagentService::new(
            SessionStore::new(db.clone()),
            session_delete_workflow.clone(),
            session_link_service.clone(),
            SubagentStore::new(db.clone()),
            workspace_runtime.clone(),
            workspace_access_gate.clone(),
        ));
        let (review_hook_event_tx, review_hook_event_rx) = tokio::sync::mpsc::channel(256);
        let subagent_mcp_auth = Arc::new(SubagentMcpAuth::new(runtime_home.clone()));
        let subagent_session_hooks = Arc::new(SubagentSessionHooks::new(
            subagent_service.clone(),
            acp_manager.clone(),
        ));
        let review_mcp_auth = Arc::new(ReviewMcpAuth::new(runtime_home.clone()));
        let review_session_hooks = Arc::new(ReviewSessionHooks::new(
            review_hook_event_tx,
            review_service.clone(),
        ));
        let integration_gateway_session_launch_extension = Arc::new(
            IntegrationGatewaySessionLaunchExtension::new(runtime_home.clone()),
        );
        let product_mcp_launch_catalog =
            product_mcp::build_product_mcp_launch_catalog(product_mcp::LaunchCatalogDeps {
                runtime_base_url: runtime_base_url.clone(),
                bearer_token: bearer_token.clone(),
                review_mcp_auth: review_mcp_auth.clone(),
                subagent_mcp_auth: subagent_mcp_auth.clone(),
                cowork_mcp_auth: cowork_mcp_auth.clone(),
                subagent_service: subagent_service.clone(),
            });
        let goal_runtime = Arc::new(GoalRuntime::new(
            goal_service.clone(),
            session_service.clone(),
            acp_manager.clone(),
            workspace_access_gate.clone(),
        ));
        let goal_session_hooks = Arc::new(GoalSessionHooks::new(goal_runtime.clone()));
        let session_extensions: Vec<
            Arc<dyn crate::domains::sessions::extensions::SessionExtension>,
        > = vec![
            cowork_session_hooks.clone(),
            subagent_session_hooks.clone(),
            review_session_hooks.clone(),
            integration_gateway_session_launch_extension.clone(),
            goal_session_hooks,
        ];
        let session_runtime = Arc::new(SessionRuntime::new(
            session_service.clone(),
            session_link_service.clone(),
            workspace_runtime.clone(),
            acp_manager.clone(),
            runtime_home.clone(),
            session_data_cipher,
            session_extensions,
            product_mcp_launch_catalog,
            workspace_access_gate.clone(),
            plan_service.clone(),
            plan_service.clone(),
            gateway_model_resolver.clone(),
            goal_service.clone(),
            loop_service.clone(),
            activity_service.clone(),
        ));
        let retire_preflight_checker = Arc::new(RetirePreflightChecker::new(
            workspace_runtime.clone(),
            workspace_access_gate.clone(),
            workspace_operation_gate.clone(),
            session_runtime.clone(),
            session_service.clone(),
            terminal_service.clone(),
            runtime_home.clone(),
        ));
        let workspace_purge_service = Arc::new(WorkspacePurgeService::new(
            workspace_runtime.clone(),
            session_runtime.clone(),
            workspace_delete_workflow.clone(),
            SessionStore::new(db.clone()),
            PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_operation_gate.clone(),
            checkout_deletion_gate.clone(),
            retire_preflight_checker.clone(),
            runtime_home.clone(),
        ));
        let workspace_retention_service = Arc::new(WorkspaceRetentionService::new(
            workspace_runtime.clone(),
            WorkspaceStore::new(db.clone()),
            SessionStore::new(db.clone()),
            TerminalStore::new(db.clone()),
            WorktreeRetentionPolicyStore::new(db.clone()),
            retire_preflight_checker.clone(),
            workspace_operation_gate.clone(),
            checkout_deletion_gate.clone(),
            runtime_home.clone(),
        ));
        let workspace_worktree_runtime = Arc::new(WorkspaceWorktreeRuntime::new(
            workspace_runtime.clone(),
            workspace_setup_runtime.clone(),
            workspace_retention_service.clone(),
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
            ReviewStore::new(db.clone()),
            workspace_access_gate.clone(),
            terminal_service.clone(),
        ));
        let plan_runtime = Arc::new(PlanRuntime::new(
            plan_service.clone(),
            session_runtime.clone(),
            session_service.clone(),
            acp_manager.clone(),
            workspace_access_gate.clone(),
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
        let product_mcp_endpoint_registry =
            product_mcp::build_product_mcp_endpoint_registry(product_mcp::EndpointRegistryDeps {
                review_runtime: review_runtime.clone(),
                review_mcp_auth,
                subagent_service: subagent_service.clone(),
                session_runtime: session_runtime.clone(),
                workspace_runtime: workspace_runtime.clone(),
                subagent_mcp_auth,
                cowork_artifact_runtime: cowork_artifact_runtime.clone(),
                cowork_runtime: cowork_runtime.clone(),
                cowork_mcp_auth,
            })
            .map_err(AppStateInitError::InvalidProductMcpRegistry)?;
        #[cfg(not(test))]
        workspace_retention_service.clone().spawn_startup_pass();
        // Hydrate the bundled agent seed (if pending) and run an installed-only
        // reconcile against the catalog pins — desktop sidecar AND cloud workers,
        // non-blocking + best-effort. See AgentRuntime::spawn_startup_pass.
        #[cfg(not(test))]
        agent_runtime.clone().spawn_startup_pass();
        Ok(Self {
            runtime_home,
            runtime_base_url,
            db,
            bearer_token,
            auth_manager,
            agent_seed_store,
            agent_runtime,
            catalog_sync_service,
            gateway_model_resolver,
            agent_reconcile_service,
            repo_root_service,
            workspace_runtime,
            workspace_setup_runtime,
            workspace_worktree_runtime,
            files_runtime,
            process_service,
            workspace_file_search_cache,
            pr_status_cache,
            artifact_runtime,
            cowork_service,
            cowork_artifact_runtime,
            cowork_session_hooks,
            cowork_runtime,
            subagent_service,
            subagent_session_hooks,
            review_service,
            review_session_hooks,
            integration_gateway_session_launch_extension,
            review_runtime,
            product_mcp_endpoint_registry,
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
            goal_service,
            goal_runtime,
            loop_service,
            activity_service,
            acp_manager,
            terminal_service,
            agent_login_terminal_service,
        })
    }
}

/// The reconcile poke: catalog sync stays free of any AgentRuntime
/// dependency — it gets a capability that fire-and-forget kicks the one
/// reconcile engine after a successful catalog swap.
fn catalog_applied_reconcile_poke(agent_runtime: Arc<AgentRuntime>) -> Arc<dyn Fn() + Send + Sync> {
    Arc::new(move || {
        let agent_runtime = agent_runtime.clone();
        tokio::spawn(async move {
            // installed-only: a cloud-catalog swap updates already-installed
            // agents to the new pins; missing agents install on demand.
            agent_runtime.start_reconcile(false, true).await;
        });
    })
}

fn load_runtime_target_id() -> Option<String> {
    std::env::var("ANYHARNESS_RUNTIME_TARGET_ID")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
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
pub(crate) mod test_support;

#[cfg(test)]
mod tests;
