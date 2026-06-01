use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyharness_contract::v1::{
    ContentPart, SessionEvent, SessionLinkTurnCompletedPayload, SubagentTurnOutcome,
};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::delegation::model::{
    CreateCodingSessionInput, CreateCodingWorkspaceInput, SendCodingMessageInput,
};
use super::delegation::service::{CoworkDelegationError, CoworkDelegationService};
use super::model::{CoworkManagedWorkspaceRecord, CoworkRootRecord, CoworkThreadRecord};
use super::service::CoworkService;
use crate::adapters::git::GitService;
use crate::live::sessions::LiveSessionManager;
use crate::origin::OriginContext;
use crate::repo_roots::model::{CreateRepoRootInput, RepoRootRecord};
use crate::repo_roots::service::RepoRootService;
use crate::sessions::extensions::{
    SessionClosingActions, SessionClosingContext, SessionExtension, SessionTurnFinishedContext,
};
use crate::sessions::links::completions::LinkCompletionRecord;
use crate::sessions::links::model::{SessionLinkRecord, SessionLinkRelation};
use crate::sessions::model::SessionRecord;
use crate::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
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

#[derive(Debug, thiserror::Error)]
pub enum CoworkCanonicalThreadError {
    #[error("workspace not found")]
    WorkspaceNotFound,
    #[error("session not found")]
    SessionNotFound,
    #[error("session does not belong to workspace")]
    SessionWorkspaceMismatch,
    #[error("cowork session is closed")]
    SessionClosed,
    #[error("workspace is not a cowork workspace")]
    NotCoworkWorkspace,
    #[error("session is not the canonical cowork session")]
    NotCanonicalCoworkSession,
    #[error("cowork thread does not belong to workspace")]
    ThreadWorkspaceMismatch,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoworkManagedWorkspacesContext {
    pub workspaces: Vec<CoworkManagedWorkspaceContext>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoworkManagedWorkspaceContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cowork_workspace_id: Option<String>,
    pub ownership_id: String,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    pub sessions: Vec<CoworkCodingSessionContext>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoworkCodingSessionContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cowork_agent_id: Option<String>,
    pub session_link_id: String,
    pub coding_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub status: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    pub wake_scheduled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_completion: Option<CoworkCodingCompletion>,
    pub link_created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_closed_at: Option<String>,
    pub session_created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoworkCodingCompletion {
    pub completion_id: String,
    pub child_turn_id: String,
    pub child_last_event_seq: i64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_event_seq: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_prompt_seq: Option<i64>,
    pub created_at: String,
}

const DEFAULT_CODING_WORKSPACE_NAME: &str = "coding-workspace";
const MAX_CODING_WORKSPACE_NAME_LEN: usize = 64;
const MAX_CODING_WORKSPACE_NAME_ATTEMPTS: usize = 100;

#[derive(Debug, Clone)]
struct CodingWorkspaceNamePlan {
    workspace_name: String,
    branch_name: String,
    target_path: PathBuf,
}

#[derive(Clone)]
pub struct CoworkSessionHooks {
    delegation_service: CoworkDelegationService,
    acp_manager: LiveSessionManager,
    session_store: SessionStore,
    autosave_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl CoworkSessionHooks {
    pub fn new(
        delegation_service: CoworkDelegationService,
        acp_manager: LiveSessionManager,
        session_store: SessionStore,
    ) -> Self {
        Self {
            delegation_service,
            acp_manager,
            session_store,
            autosave_locks: Arc::new(Mutex::new(HashMap::new())),
        }
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
            if let Err(error) = GitService::commit_all_if_dirty(
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
    fn on_session_closing(
        &self,
        ctx: SessionClosingContext,
    ) -> anyhow::Result<SessionClosingActions> {
        self.delegation_service
            .mark_managed_workspaces_closed_by_parent(&ctx.session_id, &ctx.closed_at)?;
        Ok(SessionClosingActions::default())
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
    acp_manager: LiveSessionManager,
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
        link.public_id.as_deref(),
        ctx.outcome,
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
        let _ = handle
            .send_queued_prompt(prompt_payload, record.seq)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    }
    Ok(())
}

fn cowork_coding_wake_prompt_text(
    label: Option<&str>,
    cowork_agent_id: Option<&str>,
    outcome: crate::sessions::extensions::SessionTurnOutcome,
) -> String {
    let label = label.unwrap_or("cowork agent");
    let cowork_agent_id = cowork_agent_id.unwrap_or("unknown");
    format!(
        "Cowork agent \"{label}\" finished a turn.\n\ncoworkAgentId: {cowork_agent_id}\nOutcome: {}\n\nUse read_cowork_agent_latest_turns or search_cowork_agent_transcript with this coworkAgentId before relying on the result.",
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
        workspace_delegation_enabled: bool,
    ) -> Result<CreateCoworkThreadResult, CoworkCreateThreadError> {
        let total_started = Instant::now();
        tracing::info!(
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
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
        let durable_create_started = Instant::now();
        let durable_session = match self.session_runtime.create_durable_session(
            &worktree.workspace.id,
            agent_kind,
            model_id,
            mode_id,
            None,
            Vec::new(),
            None,
            crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            false,
            None,
            None,
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
        let response_session = durable_session.clone();
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
            session_id = %response_session.id,
            start_deferred = true,
            total_elapsed_ms = total_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.completed"
        );

        Ok(CreateCoworkThreadResult {
            thread: CoworkThreadSummary {
                thread,
                title: response_session.title.clone(),
                updated_at: response_session.updated_at.clone(),
                last_activity_at: response_session.last_prompt_at.clone(),
            },
            workspace: worktree.workspace,
            session: response_session,
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
    ) -> Result<(CoworkThreadRecord, WorkspaceRecord, SessionRecord), CoworkCanonicalThreadError>
    {
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)?
            .ok_or(CoworkCanonicalThreadError::WorkspaceNotFound)?;
        let session = self
            .session_service
            .get_session(session_id)?
            .ok_or(CoworkCanonicalThreadError::SessionNotFound)?;
        if session.workspace_id != workspace_id {
            return Err(CoworkCanonicalThreadError::SessionWorkspaceMismatch);
        }
        if session.closed_at.is_some() || session.status == "closed" {
            return Err(CoworkCanonicalThreadError::SessionClosed);
        }
        if workspace.surface != "cowork" {
            return Err(CoworkCanonicalThreadError::NotCoworkWorkspace);
        }
        let thread = self
            .cowork_service
            .find_thread_by_session(session_id)?
            .ok_or(CoworkCanonicalThreadError::NotCanonicalCoworkSession)?;
        if thread.workspace_id != workspace_id {
            return Err(CoworkCanonicalThreadError::ThreadWorkspaceMismatch);
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

    pub fn resolved_workspace_launch_options(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<
        crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions,
    > {
        self.session_runtime
            .resolved_workspace_launch_options(workspace_id)
    }

    pub fn validate_managed_coding_workspace(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> Result<CoworkManagedWorkspaceRecord, CoworkDelegationError> {
        self.delegation_service
            .find_managed_workspace(parent_session_id, workspace_id)
    }

    pub fn resolve_managed_coding_workspace(
        &self,
        parent_session_id: &str,
        cowork_workspace_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<CoworkManagedWorkspaceRecord, CoworkDelegationError> {
        self.delegation_service.resolve_managed_workspace_target(
            parent_session_id,
            cowork_workspace_id,
            workspace_id,
        )
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
            public_id: Some(format!("cowork_workspace_{}", Uuid::new_v4().simple())),
            parent_session_id: parent_session_id.to_string(),
            workspace_id: worktree.workspace.id.clone(),
            source_workspace_id: Some(source_workspace.id.clone()),
            label: label.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            closed_at: None,
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
                input.harness_id.as_deref(),
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
                let _ = self.session_service.delete_session(&session.id);
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
                    let _ = self.session_service.delete_session(&session.id);
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
                let _ = self.session_service.delete_session(&session.id);
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
                if let Err(close_error) = self.session_runtime.close_live_session(&started.id).await
                {
                    tracing::warn!(
                        session_id = %started.id,
                        error = ?close_error,
                        "failed to close cowork agent after initial prompt dispatch failure"
                    );
                }
                if let Err(delete_error) = self.session_service.delete_session(&started.id) {
                    tracing::warn!(
                        session_id = %started.id,
                        error = ?delete_error,
                        "failed to delete cowork agent after initial prompt dispatch failure"
                    );
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

    pub fn resolve_coding_session_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
    ) -> Result<crate::sessions::links::model::SessionLinkRecord, CoworkDelegationError> {
        self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            false,
        )
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

    pub fn schedule_coding_wake_for_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
    ) -> Result<(crate::sessions::links::model::SessionLinkRecord, bool), CoworkDelegationError>
    {
        self.delegation_service.schedule_coding_wake_for_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
        )
    }

    pub async fn coding_status(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
    ) -> Result<CoworkCodingStatusResult, CoworkDelegationError> {
        let link = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            None,
            Some(coding_session_id),
            true,
        )?;
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

    pub async fn coding_status_for_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
    ) -> Result<CoworkCodingStatusResult, CoworkDelegationError> {
        let link = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            true,
        )?;
        self.coding_status(parent_session_id, &link.child_session_id)
            .await
    }

    pub async fn close_coding_session_for_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
    ) -> Result<
        (
            crate::sessions::links::model::SessionLinkRecord,
            bool,
            String,
        ),
        CoworkDelegationError,
    > {
        let link = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            true,
        )?;
        let already_closed = link.closed_at.is_some();
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(session) = self
            .delegation_service
            .session_store()
            .find_by_id(&link.child_session_id)?
        {
            if session.closed_at.is_none() {
                self.session_runtime
                    .close_live_session(&link.child_session_id)
                    .await
                    .map_err(|error| {
                        CoworkDelegationError::Internal(anyhow::anyhow!("{error:?}"))
                    })?;
            }
        }
        if !already_closed {
            self.delegation_service.close_coding_link(&link, &now)?;
        }
        let refreshed = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            true,
        )?;
        Ok((refreshed, already_closed, now))
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

    pub fn read_coding_events_for_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
        since_seq: Option<i64>,
        limit: Option<usize>,
    ) -> Result<crate::sessions::delegation::DelegatedEventSlice, CoworkDelegationError> {
        let link = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            true,
        )?;
        self.read_coding_events(parent_session_id, &link.child_session_id, since_seq, limit)
    }

    pub fn read_coding_latest_turns_for_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<(SessionLinkRecord, Vec<Value>), CoworkDelegationError> {
        let link = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            true,
        )?;
        let limit = limit.unwrap_or(3).clamp(1, 10);
        let mut completions = self
            .delegation_service
            .list_completions_for_link(&link.id)?;
        completions.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.completion_id.cmp(&left.completion_id))
        });
        completions.truncate(limit);
        completions.reverse();
        let turns = completions
            .into_iter()
            .map(|completion| {
                json!({
                    "childTurnId": completion.child_turn_id,
                    "outcome": completion.outcome.as_str(),
                    "createdAt": completion.created_at,
                    "childLastEventSeq": completion.child_last_event_seq,
                    "parentEventSeq": completion.parent_event_seq,
                    "parentPromptSeq": completion.parent_prompt_seq,
                })
            })
            .collect();
        Ok((link, turns))
    }

    pub fn search_coding_transcript_for_target(
        &self,
        parent_session_id: &str,
        cowork_agent_id: Option<&str>,
        coding_session_id: Option<&str>,
        query: &str,
        limit: Option<usize>,
    ) -> Result<(SessionLinkRecord, Vec<Value>), CoworkDelegationError> {
        let link = self.delegation_service.resolve_coding_session_target(
            parent_session_id,
            cowork_agent_id,
            coding_session_id,
            true,
        )?;
        let query = query.trim();
        if query.is_empty() {
            return Err(CoworkDelegationError::Internal(anyhow::anyhow!(
                "query is required"
            )));
        }
        let needle = query.to_lowercase();
        let limit = limit.unwrap_or(10).clamp(1, 25);
        let mut matches = Vec::new();
        for record in self
            .delegation_service
            .session_store()
            .list_events_limited(&link.child_session_id, 500)?
        {
            if matches.len() >= limit {
                break;
            }
            let text = cowork_transcript_search_text(&record);
            let Some(index) = text.to_lowercase().find(&needle) else {
                continue;
            };
            matches.push(json!({
                "seq": record.seq,
                "timestamp": record.timestamp,
                "turnId": record.turn_id,
                "itemId": record.item_id,
                "snippet": cowork_search_snippet(&text, index, query.len()),
            }));
        }
        Ok((link, matches))
    }

    pub async fn managed_workspaces_context(
        &self,
        parent_session_id: &str,
    ) -> Result<CoworkManagedWorkspacesContext, CoworkDelegationError> {
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
                    let status = normalized_session_status(&session.status).to_string();
                    let latest_completion = self
                        .delegation_service
                        .latest_completion_for_link(&link.id)?
                        .map(|record| CoworkCodingCompletion {
                            completion_id: record.completion_id,
                            child_turn_id: record.child_turn_id,
                            child_last_event_seq: record.child_last_event_seq,
                            outcome: record.outcome.as_str().to_string(),
                            parent_event_seq: record.parent_event_seq,
                            parent_prompt_seq: record.parent_prompt_seq,
                            created_at: record.created_at,
                        });
                    Ok(CoworkCodingSessionContext {
                        cowork_agent_id: link.public_id.clone(),
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
                        link_closed_at: link.closed_at,
                        session_created_at: session.created_at,
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            summaries.push(CoworkManagedWorkspaceContext {
                cowork_workspace_id: managed.public_id,
                ownership_id: managed.id,
                workspace_id: managed.workspace_id,
                source_workspace_id: managed.source_workspace_id,
                label: managed.label,
                created_at: managed.created_at,
                closed_at: managed.closed_at,
                sessions,
            });
        }
        Ok(CoworkManagedWorkspacesContext {
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
            None,
            None,
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
            if let Err(error) = self.session_service.delete_session(&session.id) {
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

fn normalize_required_prompt(value: String) -> Result<String, CoworkDelegationError> {
    if value.trim().is_empty() {
        return Err(CoworkDelegationError::Internal(anyhow::anyhow!(
            "prompt is required"
        )));
    }
    Ok(value)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_optional_ref(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn normalized_session_status(status: &str) -> &'static str {
    match status {
        "starting" => "starting",
        "idle" => "idle",
        "running" => "running",
        "completed" => "completed",
        "closed" => "closed",
        "errored" => "errored",
        _ => "errored",
    }
}

fn cowork_transcript_search_text(record: &crate::sessions::model::SessionEventRecord) -> String {
    let Ok(event) = serde_json::from_str::<SessionEvent>(&record.payload_json) else {
        return String::new();
    };
    match event {
        SessionEvent::ItemCompleted(item_event) => {
            let mut text = String::new();
            if let Some(title) = item_event.item.title {
                text.push_str(&title);
                text.push('\n');
            }
            if let Some(tool) = item_event.item.native_tool_name {
                text.push_str(&tool);
                text.push('\n');
            }
            append_content_text(&mut text, &item_event.item.content_parts);
            text
        }
        SessionEvent::ItemStarted(item_event) => {
            let mut text = String::new();
            if let Some(title) = item_event.item.title {
                text.push_str(&title);
                text.push('\n');
            }
            if let Some(tool) = item_event.item.native_tool_name {
                text.push_str(&tool);
                text.push('\n');
            }
            append_content_text(&mut text, &item_event.item.content_parts);
            text
        }
        SessionEvent::Error(error) => format!("{:?}", error.details),
        _ => String::new(),
    }
}

fn append_content_text(target: &mut String, parts: &[ContentPart]) {
    for part in parts {
        if let ContentPart::Text { text } = part {
            if !target.is_empty() {
                target.push('\n');
            }
            target.push_str(text);
        }
    }
}

fn cowork_search_snippet(text: &str, index: usize, needle_len: usize) -> String {
    const CONTEXT_CHARS: usize = 120;
    let start = text[..index]
        .char_indices()
        .rev()
        .nth(CONTEXT_CHARS)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    let raw_end = index.saturating_add(needle_len);
    let end = text[raw_end.min(text.len())..]
        .char_indices()
        .nth(CONTEXT_CHARS)
        .map(|(idx, _)| raw_end.min(text.len()) + idx)
        .unwrap_or(text.len());
    let mut snippet = text[start..end].replace('\n', " ");
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < text.len() {
        snippet.push_str("...");
    }
    trim_snippet(&snippet, 260)
}

fn trim_snippet(text: &str, max_chars: usize) -> String {
    let mut iter = text.chars();
    let trimmed = iter.by_ref().take(max_chars).collect::<String>();
    if iter.next().is_some() {
        format!("{trimmed}...")
    } else {
        trimmed
    }
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
        cowork_transcript_search_text, workspace_name_with_suffix,
    };
    use crate::sessions::model::SessionEventRecord;

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

    #[test]
    fn cowork_transcript_search_uses_sanitized_text_not_raw_tool_payloads() {
        let record = SessionEventRecord {
            id: 0,
            session_id: "child-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "item_completed".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: Some("item-1".to_string()),
            payload_json: r#"{
                "type": "item_completed",
                "item": {
                    "kind": "tool_invocation",
                    "status": "completed",
                    "sourceAgentKind": "claude",
                    "title": "Visible tool title",
                    "nativeToolName": "visible_tool",
                    "rawInput": { "token": "secret-token" },
                    "rawOutput": { "result": "secret-output" },
                    "contentParts": [
                        { "type": "text", "text": "safe transcript text" }
                    ]
                }
            }"#
            .to_string(),
        };

        let text = cowork_transcript_search_text(&record);

        assert!(text.contains("Visible tool title"));
        assert!(text.contains("safe transcript text"));
        assert!(!text.contains("secret-token"));
        assert!(!text.contains("secret-output"));
    }
}
