use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionActionCapabilities, SessionExecutionPhase};
use tokio::sync::oneshot;

use crate::domains::sessions::mcp_bindings::acp::to_acp_servers;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::live::sessions::actor::command::{
    ForkSessionCommandError, ForkSessionCommandResult, SessionCommand,
};
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::driver::shutdown::close_native_session;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::QueueDurable;

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_idle_fork_lifecycle_command(
        &self,
        command: SessionCommand,
    ) {
        match command {
            SessionCommand::VerifyForkReady { respond_to } => {
                let result = verify_fork_ready(
                    &self.handle,
                    self.caps.queue.as_ref(),
                    &self.session_id,
                    self.action_capabilities,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::Fork { respond_to } => {
                let result = fork_native_session(
                    &self.conn,
                    &self.native_session_id,
                    &self.workspace_path,
                    &self.mcp_servers,
                    &self.handle,
                    self.caps.queue.as_ref(),
                    &self.session_id,
                    self.action_capabilities,
                    self.supports_native_close,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::CloseNativeSession {
                native_session_id,
                respond_to,
            } => {
                handle_close_native_child_session(
                    &self.conn,
                    native_session_id,
                    self.supports_native_close,
                    respond_to,
                )
                .await;
            }
            _ => unreachable!("non-fork command routed to fork lifecycle handler"),
        }
    }
}

pub(in crate::live::sessions::actor) async fn fork_native_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    workspace_path: &std::path::PathBuf,
    mcp_servers: &[SessionMcpServer],
    handle: &Arc<LiveSessionHandle>,
    store: &dyn QueueDurable,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
    supports_close: bool,
) -> Result<ForkSessionCommandResult, ForkSessionCommandError> {
    verify_fork_ready(handle, store, session_id, action_capabilities).await?;

    let mut request =
        acp::schema::ForkSessionRequest::new(native_session_id.to_string(), workspace_path.clone());
    if !mcp_servers.is_empty() {
        request = request.mcp_servers(to_acp_servers(mcp_servers));
    }
    let response = conn
        .send_request(request)
        .block_task()
        .await
        .map_err(|error| ForkSessionCommandError::Failed(error.to_string()))?;
    Ok(ForkSessionCommandResult {
        native_session_id: response.session_id.to_string(),
        supports_close,
    })
}

pub(in crate::live::sessions::actor) async fn verify_fork_ready(
    handle: &Arc<LiveSessionHandle>,
    store: &dyn QueueDurable,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
) -> Result<(), ForkSessionCommandError> {
    if !action_capabilities.fork {
        return Err(ForkSessionCommandError::Unsupported(
            "agent does not advertise ACP session/fork with load_session support".to_string(),
        ));
    }
    if handle.is_busy() {
        return Err(ForkSessionCommandError::Busy);
    }
    let execution = handle.execution_snapshot().await;
    if execution.phase != SessionExecutionPhase::Idle || !execution.pending_interactions.is_empty()
    {
        return Err(ForkSessionCommandError::Busy);
    }
    match store.peek_head_pending_prompt(session_id) {
        Ok(Some(_)) => return Err(ForkSessionCommandError::Busy),
        Ok(None) => {}
        Err(error) => {
            return Err(ForkSessionCommandError::Failed(format!(
                "failed to inspect pending prompt queue before fork: {error}"
            )));
        }
    }

    Ok(())
}

pub(in crate::live::sessions::actor) async fn close_native_child_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    supports_close: bool,
) -> anyhow::Result<()> {
    close_native_session(conn, native_session_id, supports_close).await
}

pub(in crate::live::sessions::actor) async fn handle_close_native_child_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: String,
    supports_close: bool,
    respond_to: oneshot::Sender<anyhow::Result<()>>,
) {
    let result = close_native_child_session(conn, &native_session_id, supports_close).await;
    let _ = respond_to.send(result);
}

pub(in crate::live::sessions::actor) fn reject_busy_close_native_child_session(
    respond_to: oneshot::Sender<anyhow::Result<()>>,
) {
    let _ = respond_to.send(Err(anyhow::anyhow!(
        "cannot close native child session while parent session is busy"
    )));
}
