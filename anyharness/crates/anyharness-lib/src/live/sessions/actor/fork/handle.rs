use std::sync::atomic::Ordering;
use std::sync::Arc;

use agent_client_protocol::{self as acp, Agent};
use anyharness_contract::v1::{SessionActionCapabilities, SessionExecutionPhase};

use crate::live::sessions::actor::command::{ForkSessionCommandError, ForkSessionCommandResult};
use crate::live::sessions::connection::shutdown::close_native_session;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::sessions::mcp_bindings::acp::to_acp_servers;
use crate::sessions::mcp_bindings::model::SessionMcpServer;
use crate::sessions::store::SessionStore;
pub(in crate::live::sessions::actor) async fn fork_native_session(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    workspace_path: &std::path::PathBuf,
    mcp_servers: &[SessionMcpServer],
    handle: &Arc<LiveSessionHandle>,
    store: &SessionStore,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
    supports_close: bool,
) -> Result<ForkSessionCommandResult, ForkSessionCommandError> {
    verify_fork_ready(handle, store, session_id, action_capabilities).await?;

    let mut request =
        acp::ForkSessionRequest::new(native_session_id.to_string(), workspace_path.clone());
    if !mcp_servers.is_empty() {
        request = request.mcp_servers(to_acp_servers(mcp_servers));
    }
    let response = conn
        .fork_session(request)
        .await
        .map_err(|error| ForkSessionCommandError::Failed(error.to_string()))?;
    Ok(ForkSessionCommandResult {
        native_session_id: response.session_id.to_string(),
        supports_close,
    })
}

pub(in crate::live::sessions::actor) async fn verify_fork_ready(
    handle: &Arc<LiveSessionHandle>,
    store: &SessionStore,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
) -> Result<(), ForkSessionCommandError> {
    if !action_capabilities.fork {
        return Err(ForkSessionCommandError::Unsupported(
            "agent does not advertise ACP session/fork with load_session support".to_string(),
        ));
    }
    if handle.busy.load(Ordering::Acquire) {
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
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    supports_close: bool,
) -> anyhow::Result<()> {
    close_native_session(conn, native_session_id, supports_close).await
}
