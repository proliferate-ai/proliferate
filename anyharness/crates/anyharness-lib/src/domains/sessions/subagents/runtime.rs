use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::FutureExt;
use tokio::sync::{watch, Mutex};

use super::model::{CloseSubagentOutcome, SubagentActiveWorkCloseMode};
use super::service::{SubagentError, SubagentService};
use crate::domains::sessions::runtime::{SessionLifecycleError, SessionRuntime};
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};

const CLOSE_OPERATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const CLOSE_LEASE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, thiserror::Error)]
pub enum CloseSubagentTaskFailure {
    #[error("session not found while closing: {0}")]
    SessionNotFound(String),
    #[error("session is held by workflow run {run_id}")]
    WorkflowHeld { run_id: String },
    #[error("workspace mutation blocked: {0}")]
    MutationBlocked(String),
    #[error("subagent close timed out; the session remains closing")]
    TimedOut,
    #[error("subagent close could not acquire its workspace operation lease in time")]
    LeaseTimedOut,
    #[error("subagent close failed: {0}")]
    Internal(String),
}

#[derive(Debug, thiserror::Error)]
pub enum CloseSubagentError {
    #[error(transparent)]
    Subagent(#[from] SubagentError),
    #[error(transparent)]
    Task(#[from] CloseSubagentTaskFailure),
}

impl From<SessionLifecycleError> for CloseSubagentTaskFailure {
    fn from(error: SessionLifecycleError) -> Self {
        match error {
            SessionLifecycleError::SessionNotFound(session_id) => Self::SessionNotFound(session_id),
            SessionLifecycleError::WorkflowHeld { run_id } => Self::WorkflowHeld { run_id },
            SessionLifecycleError::Access(error) => Self::MutationBlocked(error.to_string()),
            SessionLifecycleError::Internal(error) => Self::Internal(error.to_string()),
        }
    }
}

impl From<SubagentError> for CloseSubagentTaskFailure {
    fn from(error: SubagentError) -> Self {
        match error {
            SubagentError::ParentNotFound(session_id)
            | SubagentError::ChildNotFound(session_id) => Self::SessionNotFound(session_id),
            SubagentError::MutationBlocked(detail) => Self::MutationBlocked(detail),
            other => Self::Internal(other.to_string()),
        }
    }
}

impl From<anyhow::Error> for CloseSubagentTaskFailure {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error.to_string())
    }
}

type CloseTaskResult = Result<CloseSubagentOutcome, CloseSubagentTaskFailure>;
type CloseTaskReceiver = watch::Receiver<Option<CloseTaskResult>>;

#[derive(Clone)]
pub struct SubagentRuntime {
    service: Arc<SubagentService>,
    session_runtime: Arc<SessionRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
    close_tasks: Arc<Mutex<HashMap<String, CloseTaskReceiver>>>,
}

impl SubagentRuntime {
    pub fn new(
        service: Arc<SubagentService>,
        session_runtime: Arc<SessionRuntime>,
        operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        Self {
            service,
            session_runtime,
            operation_gate,
            close_tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Gracefully closes a parent-owned subagent relationship without deleting
    /// the child session or transcript. Concurrent callers join one tracked,
    /// bounded operation. The operation owns its workspace lease, so dropping
    /// an HTTP/MCP request cannot release the lease while the actor still
    /// drains. A timeout leaves the durable state honestly `closing` for retry
    /// or restart recovery; it never reports a still-running actor as closed.
    #[tracing::instrument(
        skip_all,
        fields(parent_session_id = %parent_session_id, subagent_id = %subagent_id)
    )]
    pub async fn close_subagent(
        &self,
        parent_session_id: &str,
        subagent_id: &str,
    ) -> Result<CloseSubagentOutcome, CloseSubagentError> {
        let link = self.service.resolve_target_including_closed(
            parent_session_id,
            Some(subagent_id),
            None,
        )?;
        let parent = self
            .service
            .session_store()
            .find_by_id(parent_session_id)
            .map_err(SubagentError::Internal)?
            .ok_or_else(|| SubagentError::ParentNotFound(parent_session_id.to_string()))?;
        let task_key = link.id.clone();

        let mut receiver = {
            let mut tasks = self.close_tasks.lock().await;
            if let Some(receiver) = tasks.get(&task_key) {
                receiver.clone()
            } else {
                let (result_tx, result_rx) = watch::channel(None);
                tasks.insert(task_key.clone(), result_rx.clone());

                let service = self.service.clone();
                let session_runtime = self.session_runtime.clone();
                let operation_gate = self.operation_gate.clone();
                let close_tasks = self.close_tasks.clone();
                let parent_session_id = parent_session_id.to_string();
                let subagent_id = subagent_id.to_string();
                let workspace_id = parent.workspace_id;
                let task_key_for_worker = task_key.clone();
                tokio::spawn(async move {
                    let operation = async {
                        let lease = tokio::time::timeout(
                            CLOSE_LEASE_TIMEOUT,
                            operation_gate.acquire_shared(
                                &workspace_id,
                                WorkspaceOperationKind::SubagentWrite,
                            ),
                        )
                        .await
                        .map_err(|_| CloseSubagentTaskFailure::LeaseTimedOut)?;
                        let result = tokio::time::timeout(
                            CLOSE_OPERATION_TIMEOUT,
                            close_owned(
                                &service,
                                &session_runtime,
                                &parent_session_id,
                                &subagent_id,
                            ),
                        )
                        .await
                        .map_err(|_| CloseSubagentTaskFailure::TimedOut)?;
                        drop(lease);
                        result
                    };
                    let result = match std::panic::AssertUnwindSafe(operation).catch_unwind().await
                    {
                        Ok(result) => result,
                        Err(_) => Err(CloseSubagentTaskFailure::Internal(
                            "close operation panicked".to_string(),
                        )),
                    };
                    if let Err(error) = &result {
                        tracing::warn!(
                            parent_session_id = %parent_session_id,
                            subagent_id = %subagent_id,
                            error = %error,
                            "subagent close operation did not complete"
                        );
                    }
                    result_tx.send_replace(Some(result));
                    close_tasks.lock().await.remove(&task_key_for_worker);
                });
                result_rx
            }
        };

        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result.map_err(CloseSubagentError::Task);
            }
            receiver.changed().await.map_err(|_| {
                CloseSubagentError::Task(CloseSubagentTaskFailure::Internal(
                    "close operation ended without a result".to_string(),
                ))
            })?;
        }
    }
}

async fn close_owned(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    subagent_id: &str,
) -> CloseTaskResult {
    let link =
        service.resolve_target_including_closed(parent_session_id, Some(subagent_id), None)?;
    let already_closed = link.closed_at.is_some();
    let child = service.session_store().find_by_id(&link.child_session_id)?;
    let already_closing = child
        .as_ref()
        .is_some_and(|child| child.status == "closing");
    if !already_closed && !already_closing {
        service.assert_parent_workspace_mutable(parent_session_id)?;
    }

    // Clean stale schedules even on an idempotent retry. For an open link the
    // final link close repeats this deletion in the same transaction as
    // closed_at, protecting against a concurrent scheduler.
    service.delete_wake_schedule_for_link(&link.id)?;

    if let Some(child) = child {
        if child.closed_at.is_none() && child.status != "closed" {
            session_runtime
                .close_live_session(&link.child_session_id)
                .await
                .map_err(CloseSubagentTaskFailure::from)?;
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    service.close_link(&link, &now)?;

    let refreshed =
        service.resolve_target_including_closed(parent_session_id, Some(subagent_id), None)?;
    let resolved_subagent_id = refreshed.public_id.clone().ok_or_else(|| {
        CloseSubagentTaskFailure::Internal(
            "resolved subagent relationship is missing its stable public id".to_string(),
        )
    })?;
    Ok(CloseSubagentOutcome {
        parent_session_id: parent_session_id.to_string(),
        subagent_id: resolved_subagent_id,
        session_link_id: refreshed.id,
        child_session_id: refreshed.child_session_id,
        label: refreshed.label,
        closed_at: refreshed.closed_at.unwrap_or(now),
        already_closed,
        active_work_close_mode: SubagentActiveWorkCloseMode::FinishCurrentTurn,
    })
}
