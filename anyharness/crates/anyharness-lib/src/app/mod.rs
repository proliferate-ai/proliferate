mod agent_launch;
mod agent_operations;
mod config;
mod materialization;
mod mobility;
mod product_mcp;
mod sessions;
mod workflows;
mod workspaces;

use std::path::PathBuf;
use std::sync::Arc;

use crate::adapters::git::WorkspaceFileSearchCache;
use crate::adapters::hosting::PrStatusCache;
use crate::adapters::processes::ProcessService;
use crate::api::auth::AuthManager;
use crate::domains::activity::feeds::FeedService;
use crate::domains::activity::runtime::{ActivityRuntime, ActivitySessionHooks};
use crate::domains::activity::service::ActivityService;
use crate::domains::activity::store::ActivityStore;
use crate::domains::agent_operations::mcp::auth::WorkspaceMcpAuth;
use crate::domains::agent_operations::runtime::AgentOperations;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::catalog::sync::CatalogSyncService;
use crate::domains::agents::installer::reconcile::execution::AgentReconcileService;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::domains::agents::native_integrations::NativeIntegrationsService;
use crate::domains::agents::runtime::AgentRuntime;
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
use crate::domains::loops::hooks::LoopSessionHooks;
use crate::domains::loops::runtime::{LoopRuntime, SessionLoopFireExecutor};
use crate::domains::loops::scheduler::LoopScheduler;
use crate::domains::loops::service::LoopService;
use crate::domains::loops::store::LoopStore;
use crate::domains::materialization::runtime::MaterializationRuntime;
use crate::domains::mobility::runtime::MobilityRuntime;
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
use crate::domains::sessions::admission::{NoControllerPolicy, SessionMutationAdmission};
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
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::terminals::store::TerminalStore;
use crate::domains::workflows::session_extension::WorkflowSessionExtension;
use crate::domains::workflows::store::WorkflowStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::archive::WorkspaceArchiveService;
use crate::domains::workspaces::checkout_gate::CheckoutDeletionGate;
use crate::domains::workspaces::checkpoints::WorkspaceCheckpointService;
use crate::domains::workspaces::deletion::purge::WorkspacePurgeService;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::files_runtime::{
    WorkspaceFileProtection, WorkspaceFileProtectionRegistry, WorkspaceFilesRuntime,
};
use crate::domains::workspaces::inventory::WorktreeInventoryService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::options::WorkspaceOptionRuntime;
use crate::domains::workspaces::restore_runtime::RestoreWorktreeRuntime;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::setup_runtime::WorkspaceSetupRuntime;
use crate::domains::workspaces::store::{WorkspaceAccessStore, WorkspaceStore};
use crate::domains::workspaces::worktree_runtime::WorkspaceWorktreeRuntime;
use crate::live::sessions::LiveSessionManager;
use crate::live::terminals::{AgentLoginTerminalService, TerminalService};
use crate::live::workflows::WorkflowManager;
use crate::persistence::Db;

#[cfg(test)]
use config::proliferate_home_dir_name;
pub use config::{default_runtime_home, ensure_runtime_home};
use config::{load_bearer_token, load_runtime_target_id, runtime_identity};

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
    pub launch_options_service: Arc<HarnessLaunchOptionsService>,
    /// Native integrations of the user's own harness installs: discovery merged
    /// with the selections the user re-admitted into sessions.
    pub native_integrations_service: Arc<NativeIntegrationsService>,
    /// The probe engine, for READS and for the user-initiated refresh: the status
    /// route and the launch-validation universe.
    pub launch_probe_service: Arc<LaunchProbeService>,
    /// The same engine, for the AUTOMATIC pokes — `None` under `cfg(test)`.
    ///
    /// A second field rather than a flag at each call site, so "may this site fire a
    /// probe on its own?" is answered once, by the type. The reason it exists is the
    /// same one that suppresses `spawn_startup_pass` in tests: an automatic poke ends
    /// in a real harness spawn, and suites that install a fake agent program and count
    /// its ACP requests would otherwise see someone else's probe in their assertions.
    /// Reads and the manual refresh keep the real engine above, because nothing there
    /// fires on its own.
    pub automatic_poke_engine: Option<Arc<LaunchProbeService>>,
    pub agent_reconcile_service: Arc<AgentReconcileService>,
    pub repo_root_service: Arc<RepoRootService>,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub workspace_setup_runtime: Arc<WorkspaceSetupRuntime>,
    pub workspace_worktree_runtime: Arc<WorkspaceWorktreeRuntime>,
    pub workspace_option_runtime: Arc<WorkspaceOptionRuntime>,
    pub restore_worktree_runtime: Arc<RestoreWorktreeRuntime>,
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
    pub agent_operations: Arc<AgentOperations>,
    pub product_mcp_endpoint_registry: Arc<ProductMcpEndpointRegistry>,
    pub session_service: Arc<SessionService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub workspace_operation_gate: Arc<WorkspaceOperationGate>,
    pub checkout_deletion_gate: Arc<CheckoutDeletionGate>,
    pub workspace_purge_service: Arc<WorkspacePurgeService>,
    pub workspace_archive_service: Arc<WorkspaceArchiveService>,
    pub workspace_checkpoint_service: Arc<WorkspaceCheckpointService>,
    pub worktree_inventory_service: Arc<WorktreeInventoryService>,
    pub mobility_runtime: Arc<MobilityRuntime>,
    pub materialization_runtime: Arc<MaterializationRuntime>,
    pub plan_service: Arc<PlanService>,
    pub plan_runtime: Arc<PlanRuntime>,
    pub goal_service: Arc<GoalService>,
    pub goal_runtime: Arc<GoalRuntime>,
    pub session_admission: Arc<crate::domains::sessions::admission::SessionMutationAdmission>,
    pub loop_service: Arc<LoopService>,
    pub loop_runtime: Arc<LoopRuntime>,
    pub activity_service: Arc<ActivityService>,
    pub activity_runtime: Arc<ActivityRuntime>,
    pub feed_service: FeedService,
    pub acp_manager: LiveSessionManager,
    pub terminal_service: Arc<TerminalService>,
    pub agent_login_terminal_service: Arc<AgentLoginTerminalService>,
    pub workflow_store: WorkflowStore,
    pub workflow_manager: Arc<WorkflowManager>,
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
            vec![Arc::new(CoworkDeleteParticipant)],
        );
        let repo_root_service = Arc::new(RepoRootService::new(RepoRootStore::new(db.clone())));
        let workspace_runtime = Arc::new(WorkspaceRuntime::new(
            WorkspaceStore::new(db.clone()),
            workspace_delete_workflow.clone(),
            (*repo_root_service).clone(),
            runtime_home.clone(),
        ));
        let agent_reconcile_service = Arc::new(AgentReconcileService::new());
        let catalog_sync_service = Arc::new(CatalogSyncService::from_bundled_and_staged_via_env(
            &runtime_home,
        ));
        let agent_runtime_without_probes = AgentRuntime::new(
            runtime_home.clone(),
            agent_reconcile_service.clone(),
            agent_seed_store.clone(),
            AgentCatalogService::new(catalog_sync_service.clone()),
            // Read once, here: the auto-install pass needs the surface for the
            // cursor-in-cloud carve-out, and reading it at the decision point
            // would put a process-global read inside the reconcile loop.
            crate::domains::agents::runtime::RuntimeSurface::from_env(),
        );
        let (launch_options_service, launch_probe_service, gateway_model_planner) =
            agent_launch::build_services(&db, &runtime_home);
        // The one handle every AUTOMATIC poke site takes. See `AppState`'s field for
        // why it is separate; the suppression is a property of the wiring rather
        // than of which event sites happened to be threaded.
        #[cfg(not(test))]
        let automatic_poke_engine = Some(launch_probe_service.clone());
        #[cfg(test)]
        let automatic_poke_engine: Option<Arc<LaunchProbeService>> = None;
        // The agent runtime carries the engine for its startup and install-completed
        // pokes. Attached rather than constructor-injected because the engine needs the
        // catalog service the runtime also takes; building the runtime first and
        // attaching second keeps both constructors acyclic.
        let agent_runtime = Arc::new(match automatic_poke_engine.clone() {
            Some(engine) => agent_runtime_without_probes.with_launch_probe(engine),
            None => agent_runtime_without_probes,
        });
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
        let session_service = Arc::new(SessionService::with_launch_options(
            SessionStore::new(db.clone()),
            session_delete_workflow.clone(),
            WorkspaceStore::new(db.clone()),
            AgentCatalogService::new(catalog_sync_service.clone()),
            // Launch validation reads this machine's own observations first
            // (model-catalog.md, "Launch validation"). A runtime IS the surface with a
            // snapshot, so the engine is the source here; surfaces without one keep
            // the shipped-catalog-only universe.
            launch_options_service.clone(),
            runtime_home.clone(),
        ));
        let plan_service = Arc::new(PlanService::new(PlanStore::new(db.clone())));
        let goal_service = Arc::new(GoalService::new(GoalStore::new(db.clone())));
        let loop_service = Arc::new(LoopService::new(LoopStore::new(db.clone())));
        let activity_service = Arc::new(ActivityService::new(ActivityStore::new(db.clone())));
        let feed_service = FeedService::new(ActivityStore::new(db.clone()));
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
        let agent_product_context = Arc::new(
            crate::domains::agent_operations::product_context::DurableAgentProductContextResolver::new(
                session_service.clone(),
                Arc::new(session_link_service.clone()),
            ),
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
            product_context: agent_product_context,
            automatic_poke_engine: automatic_poke_engine.clone(),
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
            session_link_service.clone(),
            LinkCompletionStore::new(db.clone()),
        ));
        let (review_hook_event_tx, review_hook_event_rx) = tokio::sync::mpsc::channel(256);
        let completion_delivery_wiring = sessions::wire_completion_delivery_before_sessions(&db);
        let subagent_session_hooks = completion_delivery_wiring.session_hooks.clone();
        let workspace_mcp_auth = Arc::new(WorkspaceMcpAuth::new(runtime_home.clone()));
        let review_mcp_auth = Arc::new(ReviewMcpAuth::new(runtime_home.clone()));
        let review_session_hooks = Arc::new(ReviewSessionHooks::new(
            review_hook_event_tx,
            review_service.clone(),
        ));
        let integration_gateway_session_launch_extension = Arc::new(
            IntegrationGatewaySessionLaunchExtension::new(runtime_home.clone()),
        );
        let (native_integrations_service, native_integrations_session_extension) =
            agent_launch::build_native_integrations(&db);
        let product_mcp_launch_catalog =
            product_mcp::build_product_mcp_launch_catalog(product_mcp::LaunchCatalogDeps {
                runtime_base_url: runtime_base_url.clone(),
                bearer_token: bearer_token.clone(),
                workspace_mcp_auth: workspace_mcp_auth.clone(),
                review_mcp_auth: review_mcp_auth.clone(),
                cowork_mcp_auth: cowork_mcp_auth.clone(),
            });
        let goal_runtime = Arc::new(GoalRuntime::new(
            goal_service.clone(),
            session_service.clone(),
            acp_manager.clone(),
            workspace_access_gate.clone(),
        ));
        let goal_session_hooks = Arc::new(GoalSessionHooks::new(goal_runtime.clone()));
        // Session mutation admission: gen-2 workflows never gate session
        // mutations (run sessions are ordinary chattable sessions), so the
        // mutation-gate controller lookup is the permanent no-controller
        // policy. Workspace DESTRUCTION still fences on non-terminal gen-2
        // runs via the separate destruction policy. The operability policy
        // stays the durable relationship lookup.
        let session_admission = Arc::new(SessionMutationAdmission::with_destruction_policy(
            Arc::new(NoControllerPolicy),
            Arc::new(
                crate::domains::workflows::policy::WorkflowSessionControllerPolicy::new(db.clone()),
            ),
            Arc::new(session_link_service.clone()),
        ));
        let loop_fire_executor = Arc::new(SessionLoopFireExecutor::new(
            loop_service.clone(),
            acp_manager.clone(),
            session_admission.clone(),
        ));
        let loop_scheduler = Arc::new(LoopScheduler::new(loop_fire_executor.clone()));
        let loop_runtime = Arc::new(LoopRuntime::new(
            loop_service.clone(),
            session_service.clone(),
            acp_manager.clone(),
            workspace_access_gate.clone(),
            loop_scheduler.clone(),
        ));
        let loop_session_hooks = Arc::new(LoopSessionHooks::new(loop_runtime.clone()));
        // Activity: read-only roster reconcile-on-attach.
        let activity_runtime = Arc::new(ActivityRuntime::new(
            activity_service.clone(),
            session_service.clone(),
            acp_manager.clone(),
        ));
        let activity_session_hooks = Arc::new(ActivitySessionHooks::new(activity_runtime.clone()));
        // Workflows gen-2: the extension registers now (SessionRuntime consumes
        // the list), the manager binds into it after the boot fence below.
        let workflow_store = WorkflowStore::new(db.clone());
        let workflow_session_extension = Arc::new(WorkflowSessionExtension::new(
            SessionStore::new(db.clone()),
            workflow_store.clone(),
        ));
        let session_extensions: Vec<
            Arc<dyn crate::domains::sessions::extensions::SessionExtension>,
        > = vec![
            cowork_session_hooks.clone(),
            subagent_session_hooks.clone(),
            review_session_hooks.clone(),
            integration_gateway_session_launch_extension.clone(),
            native_integrations_session_extension,
            goal_session_hooks,
            loop_session_hooks,
            activity_session_hooks,
            workflow_session_extension.clone(),
        ];
        // Checkpoints precede SessionRuntime; workspace lifecycle wraps it later.
        let workspace_checkpoint_service =
            workspaces::wire_checkpoints(&db, workspace_operation_gate.clone());
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
            workspace_operation_gate.clone(),
            plan_service.clone(),
            plan_service.clone(),
            gateway_model_planner.clone(),
            goal_service.clone(),
            loop_service.clone(),
            activity_service.clone(),
            workspace_checkpoint_service.clone(),
        ));
        loop_fire_executor.bind_session_runtime(&session_runtime);
        completion_delivery_wiring.spawn(&session_runtime);
        // Workflows gen-2, in this order: fence first (no actor may accept a
        // command against un-fenced rows), manager second, late-bind third.
        let _fenced_workflow_runs = workflows::run_boot_fence(&workflow_store);
        let workflow_manager = Arc::new(WorkflowManager::new(
            workflow_store.clone(),
            session_runtime.clone(),
            SessionStore::new(db.clone()),
            WorkspaceStore::new(db.clone()),
        ));
        workflow_session_extension.bind_manager(&workflow_manager);
        let workspace_lifecycle =
            workspaces::wire_workspace_lifecycle(workspaces::WorkspaceLifecycleWiringDeps {
                db: db.clone(),
                runtime_home: runtime_home.clone(),
                checkpoint_service: workspace_checkpoint_service.clone(),
                operation_gate: workspace_operation_gate.clone(),
                setup_runtime: workspace_setup_runtime.clone(),
                session_runtime: session_runtime.clone(),
                session_service: session_service.clone(),
                session_delete_workflow: session_delete_workflow.clone(),
                session_admission: session_admission.clone(),
                terminal_service: terminal_service.clone(),
                repo_root_service: repo_root_service.clone(),
            });
        let workspace_archive_service = workspace_lifecycle.archive;
        let workspace_purge_service = workspace_lifecycle.purge;
        let workspace_worktree_runtime = Arc::new(WorkspaceWorktreeRuntime::new(
            workspace_runtime.clone(),
            workspace_setup_runtime.clone(),
        ));
        let workspace_option_runtime = Arc::new(WorkspaceOptionRuntime::new(
            repo_root_service.clone(),
            workspace_runtime.clone(),
            workspace_worktree_runtime.clone(),
            workspace_access_gate.clone(),
        ));
        let restore_worktree_runtime = Arc::new(RestoreWorktreeRuntime::new(
            workspace_runtime.clone(),
            workspace_operation_gate.clone(),
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
        let mobility_runtime = mobility::wire_mobility(mobility::MobilityWiringDeps {
            db: db.clone(),
            runtime_home: runtime_home.clone(),
            workspace_runtime: workspace_runtime.clone(),
            checkpoint_service: workspace_checkpoint_service.clone(),
            session_service: session_service.clone(),
            session_runtime: session_runtime.clone(),
            session_link_service: Arc::new(session_link_service.clone()),
            workspace_access_gate: workspace_access_gate.clone(),
            terminal_service: terminal_service.clone(),
        });
        let materialization_runtime =
            materialization::wire_materialization(materialization::MaterializationWiringDeps {
                db: db.clone(),
                workspace_runtime: workspace_runtime.clone(),
                repo_root_service: repo_root_service.clone(),
                session_runtime: session_runtime.clone(),
                terminal_service: terminal_service.clone(),
            });
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
        let agent_operations =
            agent_operations::wire_agent_operations(agent_operations::AgentOperationsWiringDeps {
                runtime_identity: runtime_identity(&auth_manager, &runtime_home),
                session_service: session_service.clone(),
                session_link_service: Arc::new(session_link_service.clone()),
                subagent_service: subagent_service.clone(),
                session_runtime: session_runtime.clone(),
                workspace_option_runtime: workspace_option_runtime.clone(),
                session_admission: session_admission.clone(),
                workspace_operation_gate: workspace_operation_gate.clone(),
            });
        let product_mcp_endpoint_registry =
            product_mcp::build_product_mcp_endpoint_registry(product_mcp::EndpointRegistryDeps {
                agent_operations: agent_operations.clone(),
                workspace_mcp_auth,
                review_runtime: review_runtime.clone(),
                review_mcp_auth,
                cowork_artifact_runtime: cowork_artifact_runtime.clone(),
                cowork_runtime: cowork_runtime.clone(),
                cowork_mcp_auth,
            })
            .map_err(AppStateInitError::InvalidProductMcpRegistry)?;
        // Drive the emulated-loop scheduler (fires only live+idle sessions).
        #[cfg(not(test))]
        loop_scheduler.clone().spawn();
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
            launch_options_service,
            native_integrations_service,
            launch_probe_service,
            automatic_poke_engine,
            agent_reconcile_service,
            repo_root_service,
            workspace_runtime,
            workspace_setup_runtime,
            workspace_worktree_runtime,
            workspace_option_runtime,
            restore_worktree_runtime,
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
            agent_operations,
            product_mcp_endpoint_registry,
            session_service,
            session_runtime,
            workspace_access_gate,
            workspace_operation_gate,
            checkout_deletion_gate,
            workspace_purge_service,
            workspace_archive_service,
            workspace_checkpoint_service,
            worktree_inventory_service,
            mobility_runtime,
            materialization_runtime,
            plan_service,
            plan_runtime,
            goal_service,
            goal_runtime,
            session_admission,
            loop_service,
            loop_runtime,
            activity_service,
            activity_runtime,
            feed_service,
            acp_manager,
            terminal_service,
            agent_login_terminal_service,
            workflow_store,
            workflow_manager,
        })
    }
}

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
