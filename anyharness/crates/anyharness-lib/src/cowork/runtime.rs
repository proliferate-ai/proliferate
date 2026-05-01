use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyharness_contract::v1::{
    CoworkCodingCompletionSummary, CoworkCodingSessionSummary, CoworkManagedWorkspaceSummary,
    CoworkManagedWorkspacesResponse, SessionLinkTurnCompletedPayload, SessionMcpBindingSummary,
    SubagentTurnOutcome,
};
use uuid::Uuid;

use super::delegation::model::{
    CreateCodingSessionInput, CreateCodingWorkspaceInput, SendCodingMessageInput,
};
use super::delegation::service::{CoworkDelegationError, CoworkDelegationService};
use super::mcp_auth::CoworkMcpAuth;
use super::model::{CoworkManagedWorkspaceRecord, CoworkRootRecord, CoworkThreadRecord};
use super::service::CoworkService;
use crate::acp::manager::AcpManager;
use crate::acp::session_actor::SessionCommand;
use crate::git::GitService;
use crate::origin::OriginContext;
use crate::repo_roots::model::{CreateRepoRootInput, RepoRootRecord};
use crate::repo_roots::service::RepoRootService;
use crate::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras, SessionTurnFinishedContext,
};
use crate::sessions::links::completions::LinkCompletionRecord;
use crate::sessions::links::model::SessionLinkRelation;
use crate::sessions::mcp::{SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer};
use crate::sessions::model::SessionRecord;
use crate::sessions::prompt::{PromptPayload, PromptProvenance};
use crate::sessions::runtime::{CreateAndStartSessionError, SendPromptOutcome, SessionRuntime};
use crate::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::sessions::service::SessionService;
use crate::sessions::store::SessionStore;
use crate::workspaces::creator_context::WorkspaceCreatorContext;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug)]
pub enum CoworkCreateThreadError {
    NotEnabled,
    Setup(anyhow::Error),
    CreateSession(CreateAndStartSessionError),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for CoworkCreateThreadError {
    fn from(value: anyhow::Error) -> Self {
        Self::Internal(value)
    }
}

#[derive(Debug, Clone)]
pub struct CoworkThreadSummary {
    pub thread: CoworkThreadRecord,
    pub title: Option<String>,
    pub updated_at: String,
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateCoworkThreadResult {
    pub thread: CoworkThreadSummary,
    pub workspace: WorkspaceRecord,
    pub session: SessionRecord,
}

#[derive(Debug, Clone)]
pub struct CreateCodingWorkspaceResult {
    pub managed_workspace: CoworkManagedWorkspaceRecord,
    pub workspace: WorkspaceRecord,
    pub ready: bool,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct CreateCodingSessionResult {
    pub session_link: crate::sessions::links::model::SessionLinkRecord,
    pub session: SessionRecord,
    pub prompt_status: String,
    pub wake_schedule_created: bool,
    pub wake_scheduled: bool,
}

#[derive(Debug)]
pub struct SendCodingMessageResult {
    pub coding_session_id: String,
    pub outcome: SendPromptOutcome,
    pub wake_schedule_created: bool,
    pub wake_scheduled: bool,
}

#[derive(Debug, Clone)]
pub struct CoworkCodingStatusResult {
    pub session: SessionRecord,
    pub execution: anyharness_contract::v1::SessionExecutionSummary,
    pub session_link: crate::sessions::links::model::SessionLinkRecord,
    pub wake_scheduled: bool,
    pub latest_completion: Option<LinkCompletionRecord>,
}

const COWORK_WORKSPACE_PATH_PLACEHOLDER: &str = "__PROLIFERATE_COWORK_WORKSPACE_PATH__";
const DEFAULT_CODING_WORKSPACE_NAME: &str = "coding-workspace";
const MAX_CODING_WORKSPACE_NAME_LEN: usize = 64;
const MAX_CODING_WORKSPACE_NAME_ATTEMPTS: usize = 100;

#[derive(Debug, Clone)]
struct CodingWorkspaceNamePlan {
    workspace_name: String,
    branch_name: String,
    target_path: PathBuf,
}

fn materialize_cowork_workspace_path(mcp_servers: &mut [SessionMcpServer], workspace_path: &str) {
    for server in mcp_servers {
        let SessionMcpServer::Stdio(server) = server else {
            continue;
        };
        for arg in &mut server.args {
            if arg == COWORK_WORKSPACE_PATH_PLACEHOLDER {
                *arg = workspace_path.to_string();
            }
        }
    }
}

#[derive(Clone)]
pub struct CoworkSessionHooks {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    mcp_auth: Arc<CoworkMcpAuth>,
    delegation_service: CoworkDelegationService,
    acp_manager: AcpManager,
    session_store: SessionStore,
    autosave_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl CoworkSessionHooks {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        mcp_auth: Arc<CoworkMcpAuth>,
        delegation_service: CoworkDelegationService,
        acp_manager: AcpManager,
        session_store: SessionStore,
    ) -> Self {
        Self {
            runtime_base_url,
            runtime_bearer_token,
            mcp_auth,
            delegation_service,
            acp_manager,
            session_store,
            autosave_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn cowork_launch_extras(
        &self,
        workspace: &WorkspaceRecord,
        session_id: &str,
    ) -> anyhow::Result<SessionLaunchExtras> {
        if workspace.surface != "cowork" {
            return Ok(SessionLaunchExtras::default());
        }

        if cowork_launch_extras_disabled() {
            tracing::warn!(
                workspace_id = %workspace.id,
                session_id,
                "[workspace-latency] cowork.runtime.launch_extras.disabled"
            );
            return Ok(SessionLaunchExtras::default());
        }

        let capability_token = self
            .mcp_auth
            .mint_capability_token(&workspace.id, session_id)?;
        let url = format!(
            "{}/v1/workspaces/{}/cowork/sessions/{}/mcp",
            self.runtime_base_url, workspace.id, session_id
        );

        let mut headers = Vec::new();
        if let Some(token) = self.runtime_bearer_token.as_ref() {
            headers.push(SessionMcpHeader {
                name: "authorization".to_string(),
                value: format!("Bearer {token}"),
            });
        }
        headers.push(SessionMcpHeader {
            name: self.mcp_auth.capability_header_name().to_string(),
            value: capability_token,
        });

        tracing::info!(
            workspace_id = %workspace.id,
            session_id,
            mcp_server_count = 1,
            system_prompt_append_count = cowork_artifact_system_prompt_append().len(),
            "[workspace-latency] cowork.runtime.launch_extras.resolved"
        );

        Ok(SessionLaunchExtras {
            system_prompt_append: cowork_artifact_system_prompt_append(),
            first_prompt_system_prompt_append: Vec::new(),
            mcp_servers: vec![SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: "cowork".to_string(),
                catalog_entry_id: None,
                server_name: "cowork".to_string(),
                url,
                headers,
            })],
            mcp_binding_summaries: Vec::new(),
        })
    }

    pub fn validate_capability_token(
        &self,
        token: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<bool> {
        self.mcp_auth
            .validate_capability_token(token, workspace_id, session_id)
    }

    pub fn capability_header_name(&self) -> &'static str {
        self.mcp_auth.capability_header_name()
    }

    fn notify_turn_finished(&self, workspace: &WorkspaceRecord, session_id: &str) {
        if workspace.surface != "cowork" {
            return;
        }

        let workspace_id = workspace.id.clone();
        let workspace_path = workspace.path.clone();
        let session_id = session_id.to_string();
        let lock = self.autosave_lock(&workspace_id);
        tokio::spawn(async move {
            let _guard = lock.lock().await;
            if let Err(error) = GitService::autosave_cowork_workspace(
                std::path::Path::new(&workspace_path),
                "Cowork autosave",
            ) {
                tracing::warn!(
                    workspace_id = %workspace_id,
                    session_id = %session_id,
                    error = %error,
                    "failed to autosave cowork workspace after turn end"
                );
            }
        });
    }

    fn autosave_lock(&self, workspace_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .autosave_locks
            .lock()
            .expect("cowork autosave lock map should not be poisoned");
        locks
            .entry(workspace_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
}

impl SessionExtension for CoworkSessionHooks {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        self.cowork_launch_extras(ctx.workspace, &ctx.session.id)
    }

    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        self.notify_turn_finished(&ctx.workspace, &ctx.session_id);
        let service = self.delegation_service.clone();
        let acp_manager = self.acp_manager.clone();
        let session_store = self.session_store.clone();
        tokio::spawn(async move {
            if let Err(error) =
                deliver_cowork_coding_completion(service, acp_manager, session_store, ctx).await
            {
                tracing::warn!(error = %error, "failed to process cowork coding completion");
            }
        });
    }
}

async fn deliver_cowork_coding_completion(
    service: CoworkDelegationService,
    acp_manager: AcpManager,
    session_store: SessionStore,
    ctx: SessionTurnFinishedContext,
) -> anyhow::Result<()> {
    if ctx.turn_id.trim().is_empty() {
        return Ok(());
    }
    let Some(link) = service.find_coding_parent_for_child(&ctx.session_id)? else {
        return Ok(());
    };

    let now = chrono::Utc::now().to_rfc3339();
    let completion = LinkCompletionRecord {
        completion_id: Uuid::new_v4().to_string(),
        session_link_id: link.id.clone(),
        child_turn_id: ctx.turn_id.clone(),
        child_last_event_seq: ctx.last_event_seq,
        outcome: ctx.outcome,
        parent_event_seq: None,
        parent_prompt_seq: None,
        created_at: now.clone(),
        updated_at: now,
    };
    let prompt = cowork_coding_wake_prompt_text(
        link.label.as_deref(),
        &link.child_session_id,
        &link.id,
        ctx.outcome,
        ctx.last_event_seq,
    );
    let prompt_payload = PromptPayload::text(prompt).with_provenance(PromptProvenance::LinkWake {
        relation: SessionLinkRelation::CoworkCodingSession
            .as_str()
            .to_string(),
        session_link_id: link.id.clone(),
        completion_id: completion.completion_id.clone(),
        label: link.label.clone(),
    });
    let Some(inserted) = service.insert_completion_and_consume_schedule(
        &completion,
        &link.parent_session_id,
        &prompt_payload,
    )?
    else {
        return Ok(());
    };

    let payload = SessionLinkTurnCompletedPayload {
        relation: SessionLinkRelation::CoworkCodingSession
            .as_str()
            .to_string(),
        completion_id: inserted.completion.completion_id.clone(),
        session_link_id: link.id.clone(),
        parent_session_id: link.parent_session_id.clone(),
        child_session_id: link.child_session_id.clone(),
        child_turn_id: ctx.turn_id.clone(),
        child_last_event_seq: ctx.last_event_seq,
        outcome: to_contract_outcome(ctx.outcome),
        label: link.label.clone(),
    };
    match acp_manager
        .emit_runtime_event(
            &link.parent_session_id,
            session_store.clone(),
            RuntimeInjectedSessionEvent::SessionLinkTurnCompleted(payload),
        )
        .await
    {
        Ok(envelope) => {
            let _ = service.mark_parent_event_seq(&inserted.completion.completion_id, envelope.seq);
        }
        Err(error) => {
            tracing::warn!(
                parent_session_id = %link.parent_session_id,
                child_session_id = %link.child_session_id,
                completion_id = %inserted.completion.completion_id,
                error = %error,
                "failed to inject cowork coding completion event"
            );
        }
    }

    if let (Some(record), Some(handle)) = (
        inserted.wake_prompt.as_ref(),
        acp_manager.get_handle(&link.parent_session_id).await,
    ) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .command_tx
            .send(SessionCommand::Prompt {
                payload: prompt_payload,
                prompt_id: None,
                latency: None,
                from_queue_seq: Some(record.seq),
                respond_to: tx,
            })
            .await?;
        let _ = rx.await?.map_err(|error| anyhow::anyhow!("{error:?}"))?;
    }
    Ok(())
}

fn cowork_coding_wake_prompt_text(
    label: Option<&str>,
    child_session_id: &str,
    session_link_id: &str,
    outcome: crate::sessions::extensions::SessionTurnOutcome,
    child_last_event_seq: i64,
) -> String {
    let label = label.unwrap_or("coding session");
    format!(
        "Coding session \"{label}\" finished a turn.\n\nChild session: {child_session_id}\nSession link: {session_link_id}\nOutcome: {}\nLast child event seq: {child_last_event_seq}\n\nUse the cowork coding-session tools to inspect the child session before continuing.",
        outcome.as_str()
    )
}

fn to_contract_outcome(
    outcome: crate::sessions::extensions::SessionTurnOutcome,
) -> SubagentTurnOutcome {
    match outcome {
        crate::sessions::extensions::SessionTurnOutcome::Completed => {
            SubagentTurnOutcome::Completed
        }
        crate::sessions::extensions::SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
        crate::sessions::extensions::SessionTurnOutcome::Cancelled => {
            SubagentTurnOutcome::Cancelled
        }
    }
}

pub struct CoworkRuntime {
    cowork_service: CoworkService,
    delegation_service: CoworkDelegationService,
    repo_root_service: RepoRootService,
    workspace_runtime: Arc<WorkspaceRuntime>,
    session_service: Arc<SessionService>,
    session_runtime: Arc<SessionRuntime>,
    runtime_home: PathBuf,
}

impl CoworkRuntime {
    pub fn new(
        cowork_service: CoworkService,
        delegation_service: CoworkDelegationService,
        repo_root_service: RepoRootService,
        workspace_runtime: Arc<WorkspaceRuntime>,
        session_service: Arc<SessionService>,
        session_runtime: Arc<SessionRuntime>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            cowork_service,
            delegation_service,
            repo_root_service,
            workspace_runtime,
            session_service,
            session_runtime,
            runtime_home,
        }
    }

    pub fn get_root(&self) -> anyhow::Result<Option<(CoworkRootRecord, RepoRootRecord)>> {
        let Some(root) = self.cowork_service.get_root()? else {
            return Ok(None);
        };
        let repo_root = self
            .repo_root_service
            .get_repo_root(&root.repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("cowork repo root missing: {}", root.repo_root_id))?;
        Ok(Some((root, repo_root)))
    }

    pub fn status(&self) -> anyhow::Result<(Option<(CoworkRootRecord, RepoRootRecord)>, usize)> {
        let root = self.get_root()?;
        let thread_count = self.cowork_service.list_threads()?.len();
        Ok((root, thread_count))
    }

    pub fn ensure_root(&self) -> anyhow::Result<(CoworkRootRecord, RepoRootRecord)> {
        if let Some(root) = self.get_root()? {
            return Ok(root);
        }

        let repo_path = self.runtime_home.join("cowork").join("root");
        ensure_managed_repo(&repo_path)?;
        let repo_root = self
            .repo_root_service
            .ensure_repo_root(CreateRepoRootInput {
                kind: "managed".into(),
                path: repo_path.display().to_string(),
                display_name: Some("Cowork".into()),
                default_branch: Some("main".into()),
                remote_provider: None,
                remote_owner: None,
                remote_repo_name: None,
                remote_url: None,
            })?;
        let root = self.cowork_service.upsert_root(&repo_root.id)?;
        Ok((root, repo_root))
    }

    pub fn enable(&self) -> anyhow::Result<(CoworkRootRecord, RepoRootRecord)> {
        self.ensure_root()
    }

    pub async fn create_thread(
        &self,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        mut mcp_servers: Vec<SessionMcpServer>,
        mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
        workspace_delegation_enabled: bool,
    ) -> Result<CreateCoworkThreadResult, CoworkCreateThreadError> {
        let total_started = Instant::now();
        let mcp_server_count = mcp_servers.len();
        tracing::info!(
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            mcp_server_count,
            workspace_delegation_enabled,
            "[workspace-latency] cowork.runtime.create_thread.start"
        );

        let (root, repo_root) = self.ensure_root().map_err(CoworkCreateThreadError::Setup)?;

        let thread_id = Uuid::new_v4().to_string();
        let branch_name = format!("thread/{thread_id}");
        let thread_path = self
            .runtime_home
            .join("cowork")
            .join("threads")
            .join(&thread_id);
        if let Some(parent) = thread_path.parent() {
            fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }

        let worktree_started = Instant::now();
        let worktree = self.workspace_runtime.create_worktree_with_surface(
            &repo_root.id,
            &thread_path.display().to_string(),
            &branch_name,
            Some(repo_root.default_branch.as_deref().unwrap_or("main")),
            None,
            "cowork",
            OriginContext::cowork(),
            None,
        )?;
        tracing::info!(
            thread_id = %thread_id,
            workspace_id = %worktree.workspace.id,
            elapsed_ms = worktree_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.worktree_created"
        );
        materialize_cowork_workspace_path(&mut mcp_servers, &worktree.workspace.path);
        let durable_create_started = Instant::now();
        let durable_session = match self.session_runtime.create_durable_session(
            &worktree.workspace.id,
            agent_kind,
            model_id,
            mode_id,
            None,
            mcp_servers,
            mcp_binding_summaries,
            crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            false,
            OriginContext::cowork(),
        ) {
            Ok(session) => session,
            Err(error) => {
                self.cleanup_failed_thread_bootstrap(
                    &repo_root,
                    &worktree.workspace,
                    None,
                    &thread_path,
                );
                return Err(CoworkCreateThreadError::CreateSession(error));
            }
        };
        tracing::info!(
            thread_id = %thread_id,
            workspace_id = %worktree.workspace.id,
            session_id = %durable_session.id,
            elapsed_ms = durable_create_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.durable_session_created"
        );

        let thread_record = CoworkThreadRecord {
            id: thread_id.clone(),
            repo_root_id: root.repo_root_id.clone(),
            workspace_id: worktree.workspace.id.clone(),
            session_id: durable_session.id.clone(),
            agent_kind: agent_kind.to_string(),
            requested_model_id: model_id.map(str::to_string),
            branch_name,
            workspace_delegation_enabled,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let thread = match self.cowork_service.create_thread(thread_record) {
            Ok(thread) => thread,
            Err(error) => {
                self.cleanup_failed_thread_bootstrap(
                    &repo_root,
                    &worktree.workspace,
                    Some(&durable_session),
                    &thread_path,
                );
                return Err(CoworkCreateThreadError::Internal(error));
            }
        };
        let start_started = Instant::now();
        let session_runtime = self.session_runtime.clone();
        let session_for_start = durable_session.clone();
        let start_thread_id = thread_id.clone();
        let start_workspace_id = worktree.workspace.id.clone();
        let start_session_store = self.session_service.store().clone();
        tokio::spawn(async move {
            tracing::info!(
                thread_id = %start_thread_id,
                workspace_id = %start_workspace_id,
                session_id = %session_for_start.id,
                "[workspace-latency] cowork.runtime.create_thread.live_start.start"
            );
            match session_runtime
                .start_persisted_session(&session_for_start, None)
                .await
            {
                Ok(started) => {
                    tracing::info!(
                        thread_id = %start_thread_id,
                        workspace_id = %start_workspace_id,
                        session_id = %started.id,
                        native_session_id = %started.native_session_id.as_deref().unwrap_or_default(),
                        elapsed_ms = start_started.elapsed().as_millis(),
                        "[workspace-latency] cowork.runtime.create_thread.live_start.completed"
                    );
                }
                Err(error) => {
                    let now = chrono::Utc::now().to_rfc3339();
                    if let Err(status_error) =
                        start_session_store.update_status(&session_for_start.id, "errored", &now)
                    {
                        tracing::warn!(
                            thread_id = %start_thread_id,
                            workspace_id = %start_workspace_id,
                            session_id = %session_for_start.id,
                            error = %status_error,
                            "[workspace-latency] cowork.runtime.create_thread.live_start.status_update_failed"
                        );
                    }
                    tracing::warn!(
                        thread_id = %start_thread_id,
                        workspace_id = %start_workspace_id,
                        session_id = %session_for_start.id,
                        elapsed_ms = start_started.elapsed().as_millis(),
                        error = ?error,
                        "[workspace-latency] cowork.runtime.create_thread.live_start.failed"
                    );
                }
            }
        });
        tracing::info!(
            thread_id = %thread_id,
            workspace_id = %worktree.workspace.id,
            session_id = %durable_session.id,
            start_deferred = true,
            total_elapsed_ms = total_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.completed"
        );

        Ok(CreateCoworkThreadResult {
            thread: CoworkThreadSummary {
                thread,
                title: durable_session.title.clone(),
                updated_at: durable_session.updated_at.clone(),
                last_activity_at: durable_session.last_prompt_at.clone(),
            },
            workspace: worktree.workspace,
            session: durable_session,
        })
    }

    pub fn list_threads(&self) -> anyhow::Result<Vec<CoworkThreadSummary>> {
        let mut threads = self
            .cowork_service
            .list_threads()?
            .into_iter()
            .map(|thread| {
                let session = self
                    .session_service
                    .get_session(&thread.session_id)?
                    .ok_or_else(|| {
                        anyhow::anyhow!("session missing for cowork thread {}", thread.id)
                    })?;
                Ok((thread, session))
            })
            .collect::<anyhow::Result<Vec<_>>>()?
            .into_iter()
            .filter(|(_, session)| session.dismissed_at.is_none() && session.closed_at.is_none())
            .map(|(thread, session)| CoworkThreadSummary {
                title: session.title.clone(),
                updated_at: session.updated_at.clone(),
                last_activity_at: session.last_prompt_at.clone(),
                thread,
            })
            .collect::<Vec<_>>();

        threads.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(threads)
    }

    pub fn validate_canonical_thread(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<(CoworkThreadRecord, WorkspaceRecord, SessionRecord)> {
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found"))?;
        let session = self
            .session_service
            .get_session(session_id)?
            .ok_or_else(|| anyhow::anyhow!("session not found"))?;
        if session.workspace_id != workspace_id {
            anyhow::bail!("session does not belong to workspace");
        }
        if workspace.surface != "cowork" {
            anyhow::bail!("workspace is not a cowork workspace");
        }
        let thread = self
            .cowork_service
            .find_thread_by_session(session_id)?
            .ok_or_else(|| anyhow::anyhow!("session is not the canonical cowork session"))?;
        if thread.workspace_id != workspace_id {
            anyhow::bail!("cowork thread does not belong to workspace");
        }
        Ok((thread, workspace, session))
    }

    pub fn workspace_delegation_enabled(&self, parent_session_id: &str) -> anyhow::Result<bool> {
        self.delegation_service
            .workspace_delegation_enabled(parent_session_id)
    }

    pub fn list_coding_workspace_launch_options(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<super::delegation::model::CodingWorkspaceLaunchOption>, CoworkDelegationError>
    {
        self.delegation_service
            .list_source_workspace_options(parent_session_id)
    }

    pub fn workspace_session_launch_catalog(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<crate::sessions::service::WorkspaceSessionLaunchCatalogData> {
        self.session_runtime
            .workspace_session_launch_catalog(workspace_id)
    }

    pub fn validate_managed_coding_workspace(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> Result<CoworkManagedWorkspaceRecord, CoworkDelegationError> {
        self.delegation_service
            .find_managed_workspace(parent_session_id, workspace_id)
    }

    pub fn session_record(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.session_service.get_session(session_id)
    }

    pub fn live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<anyharness_contract::v1::SessionLiveConfigSnapshot>> {
        self.session_runtime.live_config_snapshot(session_id)
    }

    pub fn repo_default_branch_for_workspace(
        &self,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Option<String>> {
        let Some(repo_root_id) = workspace.repo_root_id.as_deref() else {
            return Ok(None);
        };
        Ok(self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .and_then(|repo_root| repo_root.default_branch))
    }

    pub async fn create_coding_workspace(
        &self,
        parent_session_id: &str,
        input: CreateCodingWorkspaceInput,
    ) -> Result<CreateCodingWorkspaceResult, CoworkDelegationError> {
        let parent_thread = self
            .delegation_service
            .validate_parent_can_delegate(parent_session_id)?;
        let source_workspace = self
            .delegation_service
            .validate_source_workspace(&input.source_workspace_id)?;
        let repo_root_id = source_workspace.repo_root_id.clone().ok_or_else(|| {
            CoworkDelegationError::IneligibleSourceWorkspace(
                "workspace has no repo root metadata".into(),
            )
        })?;
        let repo_root = self
            .repo_root_service
            .get_repo_root(&repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;
        let base_branch = repo_root
            .default_branch
            .as_deref()
            .or(source_workspace.original_branch.as_deref())
            .or(source_workspace.current_branch.as_deref())
            .unwrap_or("main")
            .to_string();
        let requested_label = normalize_optional_text(input.label);
        let name_plan = allocate_coding_workspace_name(
            &repo_root.path,
            &self.runtime_home,
            requested_label.as_deref(),
            input.workspace_name.as_deref(),
            input.branch_name.as_deref(),
        )?;
        let label =
            requested_label.or_else(|| Some(coding_workspace_label(&name_plan.workspace_name)));
        if let Some(parent) = name_plan.target_path.parent() {
            fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }
        let target_path_string = name_plan.target_path.display().to_string();
        let creator_context = WorkspaceCreatorContext::Agent {
            source_session_id: parent_session_id.to_string(),
            source_session_workspace_id: Some(parent_thread.workspace_id.clone()),
            session_link_id: None,
            source_workspace_id: Some(source_workspace.id.clone()),
            label: label.clone(),
        };

        let worktree = self.workspace_runtime.create_worktree_with_surface(
            &repo_root_id,
            &target_path_string,
            &name_plan.branch_name,
            Some(&base_branch),
            None,
            "standard",
            OriginContext::cowork(),
            Some(creator_context),
        )?;
        let managed_workspace = CoworkManagedWorkspaceRecord {
            id: Uuid::new_v4().to_string(),
            parent_session_id: parent_session_id.to_string(),
            workspace_id: worktree.workspace.id.clone(),
            source_workspace_id: Some(source_workspace.id.clone()),
            label: label.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        if let Err(error) = self
            .delegation_service
            .insert_managed_workspace(&managed_workspace)
        {
            self.cleanup_failed_coding_workspace(
                &repo_root,
                &worktree.workspace,
                &name_plan.target_path,
            );
            return Err(error);
        }

        Ok(CreateCodingWorkspaceResult {
            managed_workspace,
            workspace: worktree.workspace,
            ready: true,
            status: "ready".to_string(),
        })
    }

    pub async fn create_coding_session(
        &self,
        parent_session_id: &str,
        input: CreateCodingSessionInput,
    ) -> Result<CreateCodingSessionResult, CoworkDelegationError> {
        let parent_thread = self
            .delegation_service
            .validate_parent_can_delegate(parent_session_id)?;
        let prompt = normalize_required_prompt(input.prompt)?;
        let managed = self
            .delegation_service
            .find_managed_workspace(parent_session_id, &input.workspace_id)?;
        let session = self
            .create_durable_coding_session(
                &managed.workspace_id,
                &parent_thread,
                input.agent_kind.as_deref(),
                input.model_id.as_deref(),
                input.mode_id.as_deref(),
            )
            .map_err(|error| CoworkDelegationError::Internal(anyhow::anyhow!("{error:?}")))?;
        let label = normalize_optional_text(input.label);
        let link = match self.delegation_service.create_coding_session_link(
            parent_session_id,
            &managed.workspace_id,
            &session.id,
            label.clone(),
        ) {
            Ok(link) => link,
            Err(error) => {
                let _ = self.session_service.store().delete_session(&session.id);
                return Err(error);
            }
        };
        let mut wake_schedule_created = false;
        if input.wake_on_completion {
            match self
                .delegation_service
                .schedule_coding_wake(parent_session_id, &session.id)
            {
                Ok((_link, created)) => {
                    wake_schedule_created = created;
                }
                Err(error) => {
                    let _ = self.session_service.store().delete_session(&session.id);
                    return Err(error);
                }
            }
        }
        let started = match self
            .session_runtime
            .start_persisted_session(&session, None)
            .await
        {
            Ok(started) => started,
            Err(error) => {
                if input.wake_on_completion {
                    let _ = self.delegation_service.delete_wake_schedule(&link.id);
                }
                let _ = self.session_service.store().delete_session(&session.id);
                return Err(CoworkDelegationError::Internal(anyhow::anyhow!(
                    "{error:?}"
                )));
            }
        };
        let outcome = match self
            .send_parent_prompt_to_coding_session(
                parent_session_id,
                &started.id,
                &link.id,
                label,
                prompt,
            )
            .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                if input.wake_on_completion {
                    let _ = self.delegation_service.delete_wake_schedule(&link.id);
                }
                return Err(error);
            }
        };
        Ok(CreateCodingSessionResult {
            session_link: link,
            session: started,
            prompt_status: prompt_outcome_label(&outcome).to_string(),
            wake_schedule_created,
            wake_scheduled: input.wake_on_completion,
        })
    }

    pub async fn send_coding_message(
        &self,
        parent_session_id: &str,
        input: SendCodingMessageInput,
    ) -> Result<SendCodingMessageResult, CoworkDelegationError> {
        let prompt = normalize_required_prompt(input.prompt)?;
        let link = self
            .delegation_service
            .authorize_coding_session(parent_session_id, &input.coding_session_id)?;
        let mut wake_schedule_created = false;
        if input.wake_on_completion {
            let (_link, created) = self
                .delegation_service
                .schedule_coding_wake(parent_session_id, &input.coding_session_id)?;
            wake_schedule_created = created;
        }
        let outcome = match self
            .session_runtime
            .send_text_prompt_with_provenance(
                &input.coding_session_id,
                prompt,
                CoworkDelegationService::parent_to_child_provenance(
                    parent_session_id,
                    &link.id,
                    link.label,
                ),
            )
            .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                if input.wake_on_completion {
                    let _ = self.delegation_service.delete_wake_schedule(&link.id);
                }
                return Err(CoworkDelegationError::Internal(anyhow::anyhow!(
                    "{error:?}"
                )));
            }
        };
        Ok(SendCodingMessageResult {
            coding_session_id: input.coding_session_id,
            outcome,
            wake_schedule_created,
            wake_scheduled: input.wake_on_completion,
        })
    }

    pub fn schedule_coding_wake(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
    ) -> Result<(crate::sessions::links::model::SessionLinkRecord, bool), CoworkDelegationError>
    {
        self.delegation_service
            .schedule_coding_wake(parent_session_id, coding_session_id)
    }

    pub async fn coding_status(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
    ) -> Result<CoworkCodingStatusResult, CoworkDelegationError> {
        let link = self
            .delegation_service
            .authorize_coding_session(parent_session_id, coding_session_id)?;
        let session = self
            .delegation_service
            .session_store()
            .find_by_id(coding_session_id)?
            .ok_or_else(|| CoworkDelegationError::CodingSessionNotOwned)?;
        let execution = self
            .session_runtime
            .session_execution_summary(&session)
            .await;
        let wake_scheduled = self
            .delegation_service
            .list_wake_schedules(&[link.id.clone()])?
            .into_iter()
            .next()
            .is_some();
        let latest_completion = self
            .delegation_service
            .latest_completion_for_link(&link.id)?;
        Ok(CoworkCodingStatusResult {
            session,
            execution,
            session_link: link,
            wake_scheduled,
            latest_completion,
        })
    }

    pub fn read_coding_events(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
        since_seq: Option<i64>,
        limit: Option<usize>,
    ) -> Result<crate::sessions::delegation::DelegatedEventSlice, CoworkDelegationError> {
        self.delegation_service.read_coding_events(
            parent_session_id,
            coding_session_id,
            since_seq,
            limit,
        )
    }

    pub async fn managed_workspaces_context(
        &self,
        parent_session_id: &str,
    ) -> Result<CoworkManagedWorkspacesResponse, CoworkDelegationError> {
        let workspaces = self
            .delegation_service
            .list_managed_workspaces(parent_session_id)?;
        let mut summaries = Vec::with_capacity(workspaces.len());
        for managed in workspaces {
            let linked_sessions = self
                .delegation_service
                .list_coding_session_links(parent_session_id, &managed.workspace_id)?
                .into_iter()
                .filter(|(_, session)| {
                    session.dismissed_at.is_none() && session.closed_at.is_none()
                })
                .collect::<Vec<_>>();
            let link_ids = linked_sessions
                .iter()
                .map(|(link, _session)| link.id.clone())
                .collect::<Vec<_>>();
            let scheduled = self
                .delegation_service
                .list_wake_schedules(&link_ids)?
                .into_iter()
                .map(|schedule| schedule.session_link_id)
                .collect::<HashSet<_>>();
            let sessions = linked_sessions
                .into_iter()
                .map(|(link, session)| {
                    let status = session.to_contract().status;
                    let latest_completion = self
                        .delegation_service
                        .latest_completion_for_link(&link.id)?
                        .map(|record| CoworkCodingCompletionSummary {
                            completion_id: record.completion_id,
                            child_turn_id: record.child_turn_id,
                            child_last_event_seq: record.child_last_event_seq,
                            outcome: record.outcome.as_str().to_string(),
                            parent_event_seq: record.parent_event_seq,
                            parent_prompt_seq: record.parent_prompt_seq,
                            created_at: record.created_at,
                        });
                    Ok(CoworkCodingSessionSummary {
                        session_link_id: link.id.clone(),
                        coding_session_id: session.id,
                        title: session.title,
                        label: link.label,
                        status,
                        agent_kind: session.agent_kind,
                        model_id: session.current_model_id.or(session.requested_model_id),
                        mode_id: session.current_mode_id.or(session.requested_mode_id),
                        wake_scheduled: scheduled.contains(&link.id),
                        latest_completion,
                        link_created_at: link.created_at,
                        session_created_at: session.created_at,
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            summaries.push(CoworkManagedWorkspaceSummary {
                ownership_id: managed.id,
                workspace_id: managed.workspace_id,
                source_workspace_id: managed.source_workspace_id,
                label: managed.label,
                created_at: managed.created_at,
                sessions,
            });
        }
        Ok(CoworkManagedWorkspacesResponse {
            workspaces: summaries,
        })
    }

    fn create_durable_coding_session(
        &self,
        workspace_id: &str,
        parent_thread: &CoworkThreadRecord,
        agent_kind: Option<&str>,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let resolved_agent_kind =
            normalize_optional_ref(agent_kind).unwrap_or(parent_thread.agent_kind.as_str());
        let resolved_mode_id = normalize_optional_ref(mode_id)
            .or_else(|| default_cowork_coding_mode_for_agent(resolved_agent_kind));

        self.session_runtime.create_durable_session(
            workspace_id,
            resolved_agent_kind,
            normalize_optional_ref(model_id).or(parent_thread.requested_model_id.as_deref()),
            resolved_mode_id,
            None,
            Vec::new(),
            None,
            crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            false,
            OriginContext::cowork(),
        )
    }

    async fn send_parent_prompt_to_coding_session(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
        session_link_id: &str,
        label: Option<String>,
        prompt: String,
    ) -> Result<SendPromptOutcome, CoworkDelegationError> {
        self.session_runtime
            .send_text_prompt_with_provenance(
                coding_session_id,
                prompt,
                CoworkDelegationService::parent_to_child_provenance(
                    parent_session_id,
                    session_link_id,
                    label,
                ),
            )
            .await
            .map_err(|error| {
                tracing::warn!(
                    parent_session_id,
                    coding_session_id,
                    error = ?error,
                    "failed to dispatch cowork coding prompt"
                );
                CoworkDelegationError::Internal(anyhow::anyhow!("{error:?}"))
            })
    }

    fn cleanup_failed_coding_workspace(
        &self,
        repo_root: &RepoRootRecord,
        workspace: &WorkspaceRecord,
        worktree_path: &PathBuf,
    ) {
        if let Err(error) = self.workspace_runtime.cleanup_failed_worktree(
            &repo_root.path,
            &workspace.id,
            &worktree_path.display().to_string(),
        ) {
            tracing::warn!(
                workspace_id = %workspace.id,
                repo_root_id = %repo_root.id,
                path = %worktree_path.display(),
                error = %error,
                "failed to clean up cowork coding workspace after bootstrap failure"
            );
        }
    }

    fn cleanup_failed_thread_bootstrap(
        &self,
        repo_root: &RepoRootRecord,
        workspace: &WorkspaceRecord,
        session: Option<&SessionRecord>,
        thread_path: &PathBuf,
    ) {
        if let Some(session) = session {
            if let Err(error) = self.session_service.store().delete_session(&session.id) {
                tracing::warn!(
                    session_id = %session.id,
                    workspace_id = %workspace.id,
                    error = %error,
                    "failed to clean up cowork session after bootstrap failure"
                );
            }
        }

        if let Err(error) = self.workspace_runtime.cleanup_failed_worktree(
            &repo_root.path,
            &workspace.id,
            &thread_path.display().to_string(),
        ) {
            tracing::warn!(
                workspace_id = %workspace.id,
                repo_root_id = %repo_root.id,
                path = %thread_path.display(),
                error = %error,
                "failed to clean up cowork worktree after bootstrap failure"
            );
        }
    }
}

fn cowork_launch_extras_disabled() -> bool {
    std::env::var("ANYHARNESS_DISABLE_COWORK_LAUNCH_EXTRAS")
        .ok()
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
}

fn cowork_artifact_system_prompt_append() -> Vec<String> {
    vec![
        "You are operating in Proliferate Cowork mode.".to_string(),
        "This session belongs to a managed cowork thread workspace.".to_string(),
        "Continue work in this thread unless the user explicitly asks to start a new thread."
            .to_string(),
        "Use create_artifact, update_artifact, and delete_artifact for user-visible artifacts."
            .to_string(),
        "Never edit .proliferate/artifacts.json directly.".to_string(),
        "Do not use generic file writes on artifact-backed paths.".to_string(),
        "Use normal file tools only for supporting non-artifact files.".to_string(),
        "JSX artifacts must default-export a React component with no required props.".to_string(),
        "JSX artifacts may only import allowlisted libraries.".to_string(),
    ]
}

fn normalize_required_prompt(value: String) -> Result<String, CoworkDelegationError> {
    let prompt = value.trim().to_string();
    if prompt.is_empty() {
        return Err(CoworkDelegationError::Internal(anyhow::anyhow!(
            "prompt is required"
        )));
    }
    Ok(prompt)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_optional_ref(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

pub(crate) fn default_cowork_coding_mode_for_agent(agent_kind: &str) -> Option<&'static str> {
    match agent_kind.trim().to_ascii_lowercase().as_str() {
        "claude" => Some("bypassPermissions"),
        "codex" => Some("full-access"),
        "gemini" => Some("yolo"),
        _ => None,
    }
}

fn prompt_outcome_label(outcome: &SendPromptOutcome) -> &'static str {
    match outcome {
        SendPromptOutcome::Running { .. } => "running",
        SendPromptOutcome::Queued { .. } => "queued",
    }
}

fn ensure_managed_repo(path: &PathBuf) -> anyhow::Result<()> {
    fs::create_dir_all(path)?;
    if path.join(".git").exists() {
        return Ok(());
    }

    run_git(None, ["init", "-b", "main", &path.display().to_string()])?;
    run_git(Some(path), ["config", "user.name", "AnyHarness"])?;
    run_git(
        Some(path),
        ["config", "user.email", "anyharness@local.invalid"],
    )?;
    run_git(
        Some(path),
        ["commit", "--allow-empty", "-m", "Initialize cowork root"],
    )?;
    Ok(())
}

fn run_git<const N: usize>(cwd: Option<&PathBuf>, args: [&str; N]) -> anyhow::Result<()> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }

    anyhow::bail!(
        "git command failed: git {}: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn allocate_coding_workspace_name(
    repo_root_path: &str,
    runtime_home: &PathBuf,
    label: Option<&str>,
    workspace_name: Option<&str>,
    branch_name: Option<&str>,
) -> Result<CodingWorkspaceNamePlan, CoworkDelegationError> {
    let explicit_workspace_name = normalize_optional_ref(workspace_name);
    let explicit_branch_name = normalize_optional_ref(branch_name);
    let explicit_workspace_slug = match explicit_workspace_name {
        Some(value) => Some(coding_workspace_slug(value).ok_or_else(|| {
            CoworkDelegationError::InvalidCodingWorkspaceRequest(
                "workspaceName must contain at least one letter or number".to_string(),
            )
        })?),
        None => None,
    };
    let explicit_branch_name = match explicit_branch_name {
        Some(value) => {
            validate_coding_workspace_branch_name(value)?;
            Some(value.to_string())
        }
        None => None,
    };
    let base_workspace_name = explicit_workspace_slug
        .clone()
        .or_else(|| label.and_then(coding_workspace_slug))
        .or_else(|| {
            explicit_branch_name
                .as_deref()
                .and_then(coding_workspace_name_from_branch)
        })
        .unwrap_or_else(|| DEFAULT_CODING_WORKSPACE_NAME.to_string());
    let target_base_dir = runtime_home.join("cowork").join("coding-workspaces");
    let workspace_name_is_explicit = explicit_workspace_slug.is_some();
    let branch_name_is_explicit = explicit_branch_name.is_some();

    for attempt in 0..MAX_CODING_WORKSPACE_NAME_ATTEMPTS {
        let workspace_name = workspace_name_with_suffix(&base_workspace_name, attempt);
        let branch_name = explicit_branch_name
            .clone()
            .unwrap_or_else(|| format!("cowork/coding/{workspace_name}"));
        validate_coding_workspace_branch_name(&branch_name)?;
        let target_path = target_base_dir.join(&workspace_name);
        let target_exists = target_path.exists();
        let branch_exists = git_branch_exists(repo_root_path, &branch_name);

        if !target_exists && !branch_exists {
            return Ok(CodingWorkspaceNamePlan {
                workspace_name,
                branch_name,
                target_path,
            });
        }

        if workspace_name_is_explicit && target_exists {
            return Err(CoworkDelegationError::InvalidCodingWorkspaceRequest(
                format!("coding workspace name already exists: {workspace_name}"),
            ));
        }
        if branch_name_is_explicit && branch_exists {
            return Err(CoworkDelegationError::InvalidCodingWorkspaceRequest(
                format!("coding workspace branch already exists: {branch_name}"),
            ));
        }
        if workspace_name_is_explicit && branch_exists {
            return Err(CoworkDelegationError::InvalidCodingWorkspaceRequest(
                format!("coding workspace branch already exists: {branch_name}"),
            ));
        }
    }

    Err(CoworkDelegationError::InvalidCodingWorkspaceRequest(
        "unable to allocate a coding workspace name".to_string(),
    ))
}

fn coding_workspace_slug(value: &str) -> Option<String> {
    let mut slug = String::new();
    let mut last_was_separator = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator {
            slug.push('-');
            last_was_separator = true;
        }
    }

    let mut slug = slug.trim_matches('-').to_string();
    if slug.len() > MAX_CODING_WORKSPACE_NAME_LEN {
        slug.truncate(MAX_CODING_WORKSPACE_NAME_LEN);
        slug = slug.trim_matches('-').to_string();
    }

    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

fn coding_workspace_name_from_branch(branch_name: &str) -> Option<String> {
    branch_name
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .next_back()
        .and_then(coding_workspace_slug)
}

fn workspace_name_with_suffix(base: &str, attempt: usize) -> String {
    if attempt == 0 {
        return base.to_string();
    }

    let suffix = format!("-{}", attempt + 1);
    if base.len() + suffix.len() <= MAX_CODING_WORKSPACE_NAME_LEN {
        return format!("{base}{suffix}");
    }

    let keep_len = MAX_CODING_WORKSPACE_NAME_LEN.saturating_sub(suffix.len());
    let mut prefix = base.chars().take(keep_len).collect::<String>();
    prefix = prefix.trim_matches('-').to_string();
    format!("{prefix}{suffix}")
}

fn coding_workspace_label(workspace_name: &str) -> String {
    let label = workspace_name
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut chars = label.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => DEFAULT_CODING_WORKSPACE_NAME.to_string(),
    }
}

fn validate_coding_workspace_branch_name(branch_name: &str) -> Result<(), CoworkDelegationError> {
    let output = Command::new("git")
        .args(["check-ref-format", "--branch", branch_name])
        .output()
        .map_err(|error| {
            CoworkDelegationError::Internal(anyhow::anyhow!(
                "failed to validate branch name: {error}"
            ))
        })?;
    if output.status.success() {
        return Ok(());
    }

    Err(CoworkDelegationError::InvalidCodingWorkspaceRequest(
        format!("invalid branchName: {branch_name}"),
    ))
}

fn git_branch_exists(repo_root_path: &str, branch_name: &str) -> bool {
    Command::new("git")
        .args([
            "-C",
            repo_root_path,
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch_name}"),
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{
        coding_workspace_label, coding_workspace_name_from_branch, coding_workspace_slug,
        materialize_cowork_workspace_path, workspace_name_with_suffix,
        COWORK_WORKSPACE_PATH_PLACEHOLDER,
    };
    use crate::sessions::mcp::{SessionMcpServer, SessionMcpStdioServer};

    #[test]
    fn materializes_cowork_workspace_path_in_stdio_args() {
        let mut servers = vec![SessionMcpServer::Stdio(SessionMcpStdioServer {
            connection_id: "filesystem-1".to_string(),
            catalog_entry_id: Some("filesystem".to_string()),
            server_name: "filesystem".to_string(),
            command: "filesystem".to_string(),
            args: vec![COWORK_WORKSPACE_PATH_PLACEHOLDER.to_string()],
            env: vec![],
        })];

        materialize_cowork_workspace_path(&mut servers, "/tmp/cowork/thread-1");

        let SessionMcpServer::Stdio(server) = &servers[0] else {
            panic!("expected stdio server");
        };
        assert_eq!(server.args, vec!["/tmp/cowork/thread-1"]);
    }

    #[test]
    fn normalizes_coding_workspace_names() {
        assert_eq!(
            coding_workspace_slug("Runtime sweep!"),
            Some("runtime-sweep".to_string()),
        );
        assert_eq!(coding_workspace_slug("***"), None);
        assert_eq!(
            coding_workspace_name_from_branch("feature/runtime-sweep"),
            Some("runtime-sweep".to_string()),
        );
        assert_eq!(coding_workspace_label("runtime-sweep"), "Runtime sweep");
    }

    #[test]
    fn suffixes_long_coding_workspace_names_inside_limit() {
        let base = "a".repeat(super::MAX_CODING_WORKSPACE_NAME_LEN);
        let suffixed = workspace_name_with_suffix(&base, 1);

        assert_eq!(suffixed.len(), super::MAX_CODING_WORKSPACE_NAME_LEN);
        assert!(suffixed.ends_with("-2"));
    }
}
