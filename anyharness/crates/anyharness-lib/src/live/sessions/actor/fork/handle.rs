use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionActionCapabilities, SessionExecutionPhase};
use tokio::sync::oneshot;

use crate::domains::sessions::mcp_bindings::acp::to_acp_servers;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::domains::sessions::runtime::opencode_sidedoor_client::OpencodeSidedoorClient;
use crate::live::sessions::actor::command::{
    ForkSessionCommandError, ForkSessionCommandResult, SessionCommand, SidedoorForkCommandError,
    SidedoorForkCommandResult,
};
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::driver::native_session::{
    native_fork_anchor_is_dispatch_ready, sanitized_native_fork_failure,
};
use crate::live::sessions::driver::opencode_sidedoor::SidedoorRuntime;
use crate::live::sessions::driver::shutdown::close_native_session;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::QueueDurable;

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_idle_fork_lifecycle_command(
        &self,
        command: SessionCommand,
    ) {
        match command {
            SessionCommand::VerifyForkReady {
                requires_targeted_fork,
                respond_to,
            } => {
                let result = verify_fork_ready(
                    &self.handle,
                    self.caps.queue.as_ref(),
                    &self.session_id,
                    self.action_capabilities,
                    requires_targeted_fork,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::Fork {
                provider_anchor,
                respond_to,
            } => {
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
                    provider_anchor,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::SidedoorTargetedFork {
                vendor_message_id,
                respond_to,
            } => {
                let result = sidedoor_targeted_fork(
                    self.sidedoor.as_ref(),
                    &self.native_session_id,
                    &vendor_message_id,
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
    workspace_path: &std::path::Path,
    mcp_servers: &[SessionMcpServer],
    handle: &Arc<LiveSessionHandle>,
    store: &dyn QueueDurable,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
    supports_close: bool,
    provider_anchor: Option<ProviderForkAnchor>,
) -> Result<ForkSessionCommandResult, ForkSessionCommandError> {
    if !native_fork_anchor_is_dispatch_ready(action_capabilities, provider_anchor.as_ref()) {
        return Err(ForkSessionCommandError::Unsupported(
            "agent does not advertise targeted fork support for the native anchor".to_string(),
        ));
    }
    verify_fork_ready(
        handle,
        store,
        session_id,
        action_capabilities,
        provider_anchor.is_some(),
    )
    .await?;

    let mut request =
        acp::schema::ForkSessionRequest::new(native_session_id.to_string(), workspace_path.to_path_buf());
    if !mcp_servers.is_empty() {
        request = request.mcp_servers(to_acp_servers(mcp_servers));
    }
    if let Some(anchor) = provider_anchor.as_ref() {
        request = request.meta(Some(anchor_meta(anchor)));
    }
    let response = conn
        .send_request(request)
        .block_task()
        .await
        .map_err(|error| {
            let (detail, error_class) = sanitized_native_fork_failure(&error);
            tracing::warn!(
                session_id,
                error_class,
                detail,
                "ACP native session fork failed"
            );
            ForkSessionCommandError::Failed(detail.to_string())
        })?;
    Ok(ForkSessionCommandResult {
        native_session_id: response.session_id.to_string(),
        supports_close,
    })
}

/// The OpenCode side-door targeted-fork actor operation. Runs on
/// the parent actor because the side-door state (port + password + readiness)
/// is process-local. Never dispatches an unvalidated id: the vendor does no
/// existence check and would silently full-copy an unknown id, so this
/// pre-validates the exact id via `get_message` (must be role "user") AND
/// `list_messages` membership BEFORE any fork POST.
pub(in crate::live::sessions::actor) async fn sidedoor_targeted_fork(
    sidedoor: Option<&SidedoorRuntime>,
    native_session_id: &str,
    vendor_message_id: &str,
    supports_close: bool,
) -> Result<SidedoorForkCommandResult, SidedoorForkCommandError> {
    // A non-Ready side-door at dispatch time is a hard error, never a silent
    // tip fork.
    let runtime = sidedoor.filter(|runtime| runtime.is_ready()).ok_or_else(|| {
        SidedoorForkCommandError::NotReady(
            "OpenCode side-door is not ready for targeted fork dispatch".to_string(),
        )
    })?;
    let client = OpencodeSidedoorClient::new(runtime.config.port, runtime.config.password.clone())
        .map_err(|error| SidedoorForkCommandError::Failed(error.to_string()))?;

    // Pre-validation gate 1: the id must resolve to a user message.
    let message = client
        .get_message(native_session_id, vendor_message_id)
        .await
        .map_err(|_| SidedoorForkCommandError::TargetNotFound)?;
    if message.info.role != "user" {
        return Err(SidedoorForkCommandError::TargetNotFound);
    }
    if message.info.id != vendor_message_id {
        return Err(SidedoorForkCommandError::InvalidForkTarget(
            "vendor returned a different message id than requested".to_string(),
        ));
    }
    // Pre-validation gate 2: the id must be present in the message listing.
    let listing = client
        .list_messages(native_session_id)
        .await
        .map_err(|error| SidedoorForkCommandError::Failed(error.to_string()))?;
    if !listing
        .iter()
        .any(|envelope| envelope.info.id == vendor_message_id)
    {
        return Err(SidedoorForkCommandError::InvalidForkTarget(
            "target message id not present in vendor listing".to_string(),
        ));
    }

    // Validated: dispatch the fork POST.
    let forked = client
        .fork(native_session_id, Some(vendor_message_id))
        .await
        .map_err(|error| SidedoorForkCommandError::Failed(error.to_string()))?;
    Ok(SidedoorForkCommandResult {
        native_session_id: forked.id,
        supports_close,
    })
}

/// Converts the anchor's `_meta.anyharness` JSON object into the outbound
/// ACP `Meta` map for a targeted `session/fork` request.
fn anchor_meta(anchor: &ProviderForkAnchor) -> acp::schema::Meta {
    match anchor.anchor_meta_json() {
        serde_json::Value::Object(map) => map,
        other => unreachable!("anchor_meta_json always returns an object, got {other:?}"),
    }
}

pub(in crate::live::sessions::actor) async fn verify_fork_ready(
    handle: &Arc<LiveSessionHandle>,
    store: &dyn QueueDurable,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
    requires_targeted_fork: bool,
) -> Result<(), ForkSessionCommandError> {
    if !action_capabilities.fork {
        return Err(ForkSessionCommandError::Unsupported(
            "agent does not advertise ACP session/fork with load_session support".to_string(),
        ));
    }
    if requires_targeted_fork && !action_capabilities.targeted_fork {
        return Err(ForkSessionCommandError::Unsupported(
            "agent does not advertise targeted fork support".to_string(),
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

#[cfg(test)]
#[path = "sidedoor_fork_tests.rs"]
mod sidedoor_fork_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_meta_matches_the_exact_wire_shape() {
        let meta = anchor_meta(&ProviderForkAnchor::UpToMessageId("msg-1".to_string()));
        assert_eq!(
            serde_json::to_value(&meta).ok(),
            Some(serde_json::json!({ "anyharness": { "upToMessageId": "msg-1" } }))
        );

        let meta = anchor_meta(&ProviderForkAnchor::LastTurnId("turn-1".to_string()));
        assert_eq!(
            serde_json::to_value(&meta).ok(),
            Some(serde_json::json!({ "anyharness": { "lastTurnId": "turn-1" } }))
        );
    }
}
