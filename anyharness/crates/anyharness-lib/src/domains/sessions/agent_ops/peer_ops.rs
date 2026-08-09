//! What the peer tools decide before they touch the runtime.
//!
//! Split out from the dispatch calls so the whole decision — who may be
//! reached, what the target receives, and what is stored beside it — is
//! testable without a live actor. What follows a send is the ordinary
//! pending-prompt path: a busy target queues, an idle open target boots.

use crate::domains::sessions::admission::{
    SessionMutationAdmission, SessionMutationConflict, SessionMutationKind, SessionMutationPermit,
    SessionMutationSource,
};
use crate::domains::sessions::authorize::{authorize, AgentAccessError, AgentAccessIntent};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::envelope::{agent_message, AgentMessageSender};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::wakes::service::AgentWakeService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::operation_gate::{
    WorkspaceOperationGate, WorkspaceOperationKind, WorkspaceOperationLease,
};

/// Gate a transcript read. Read intent, always: an agent's transcript stays
/// readable after it closes — closing removes the agent, not its record.
pub(super) fn authorize_transcript_read(
    session_store: &SessionStore,
    caller_session_id: &str,
    target_session_id: &str,
) -> Result<SessionRecord, AgentAccessError> {
    Ok(authorize(
        session_store,
        caller_session_id,
        target_session_id,
        AgentAccessIntent::Read,
    )?
    .target)
}

#[derive(Debug, thiserror::Error)]
pub(super) enum AgentMessageError {
    #[error("message is required")]
    EmptyMessage,
    #[error(
        "that agent is finishing its final step before closing and takes no new messages. \
         Its transcript stays readable once it stops"
    )]
    TargetEndRequested,
    #[error(transparent)]
    Access(#[from] AgentAccessError),
}

#[derive(Debug, Clone)]
pub(super) struct PreparedAgentMessage {
    pub target: SessionRecord,
    pub sender_label: String,
    pub text: String,
    pub provenance: PromptProvenance,
}

/// Gate the send, then build the envelope. Any agent may message any *other*
/// agent: reach is runtime-wide and unlinked, so the refusals here are only the
/// ones about whether a target is an agent at all — an empty body, a session
/// that does not exist, itself, a closed or dismissed target (neither takes
/// more input, and neither is ever spun up again), and an `internal_only`
/// session (runtime plumbing, not a peer). Whether the target may be perturbed
/// *right now* is a separate question, answered by [`admit_peer_mutation`].
pub(super) fn prepare_agent_message(
    session_store: &SessionStore,
    link_service: &SessionLinkService,
    caller_session_id: &str,
    target_session_id: &str,
    message: &str,
) -> Result<PreparedAgentMessage, AgentMessageError> {
    if message.trim().is_empty() {
        return Err(AgentMessageError::EmptyMessage);
    }
    let access = authorize(
        session_store,
        caller_session_id,
        target_session_id,
        AgentAccessIntent::Send,
    )?;
    assert_target_still_takes_messages(link_service, target_session_id)?;
    let sender = AgentMessageSender::from_session(&access.caller);
    let (text, provenance) = agent_message(&sender, message).into_parts();
    Ok(PreparedAgentMessage {
        target: access.target,
        sender_label: sender.label,
        text,
        provenance,
    })
}

/// An end-requested agent takes no new messages.
///
/// Ruling 6 refuses sends to a CLOSED session, and before the soft close that
/// was the whole story: a close was instantaneous, so there was no third state.
/// There is now — an open session whose ownership row is stamped
/// `closed_by_session_id IS NOT NULL AND closed_at IS NULL` — and it can be a
/// whole turn wide. A prompt accepted into that window would enqueue
/// successfully and then never run: the actor refuses to start a turn while a
/// close is pending, and after the close it never boots again. Refusing at the
/// door tells the sender that, instead of stranding the message silently.
///
/// One indexed point read (`idx_session_links_pending_close_request`), the same
/// one the turn-finish hook makes.
pub(super) fn assert_target_still_takes_messages(
    link_service: &SessionLinkService,
    target_session_id: &str,
) -> Result<(), AgentMessageError> {
    let pending = link_service
        .find_pending_close_request(target_session_id)
        .map_err(|error| AgentMessageError::Access(AgentAccessError::Internal(error)))?;
    if pending.is_some() {
        return Err(AgentMessageError::TargetEndRequested);
    }
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PeerGateError {
    #[error(
        "that agent's execution is controlled by an active workflow run and cannot be \
         prompted or reconfigured until the run finishes"
    )]
    ControlledByWorkflow,
    #[error("session admission is unavailable")]
    AdmissionUnavailable,
    #[error("{0}")]
    WorkspaceBlocked(String),
}

/// The session-mutation admission fence, on the peer paths (spec 2b).
///
/// `send_agent_message` is the first product-MCP tool that can perturb an
/// ARBITRARY session, so it is the first that must clear this fence itself;
/// `configure_agent` is the second, and takes the same fence with
/// [`SessionMutationKind::Config`]. Every other route into a session's prompt
/// queue or live config takes this permit (`api/http/sessions_prompt.rs`,
/// `api/http/sessions_config.rs`, the pending-prompt queue, goals/loops/
/// plans/reviews/resume/replay). The older MCP prompt paths were exempt
/// for a structural reason — they could only reach the far end of a
/// `session_links` row, and a workflow-controlled session is never on either
/// end — and runtime-wide peer reach deletes that argument.
///
/// The permit is held across the dispatch, so a workflow that takes control
/// mid-call cannot interleave, and a peer mutation is visible to the
/// destructive workspace paths that admit a whole workspace's session set.
pub(crate) async fn admit_peer_mutation(
    admission: &SessionMutationAdmission,
    target_session_id: &str,
    kind: SessionMutationKind,
) -> Result<SessionMutationPermit, PeerGateError> {
    admission
        .acquire(target_session_id, kind, &SessionMutationSource::external())
        .await
        .map_err(|conflict| match conflict {
            SessionMutationConflict::ControlledByWorkflow { run_id } => {
                tracing::info!(
                    target_session_id = %target_session_id,
                    controlling_run_id = %run_id,
                    "peer mutation rejected: target session is controlled by a workflow"
                );
                PeerGateError::ControlledByWorkflow
            }
            SessionMutationConflict::Internal(error) => {
                tracing::error!(
                    target_session_id = %target_session_id,
                    error = %error,
                    "peer mutation admission lookup failed"
                );
                PeerGateError::AdmissionUnavailable
            }
        })
}

/// The workspace write lease for a peer write — on the TARGET's workspace.
///
/// The route layer leases the workspace in the URL, which for a cross-workspace
/// peer call is the wrong one: the write lands in the TARGET workspace (a send
/// enqueues a durable row against a target session and can boot a harness child
/// process inside the target's checkout; a config change writes the target's
/// live config and can relaunch it), and it is the target workspace's retire
/// preflight that has to see that work in progress
/// (`workspaces/retire_preflight.rs` snapshots the gate for `SubagentWrite`).
/// So `send_agent_message` and `configure_agent` take no route lease at all —
/// both are deliberately absent from `tools::MUTATING_TOOL_NAMES` — and take
/// this one instead.
///
/// MUST be called AFTER [`admit_peer_mutation`]. The canonical lock order is
/// `session mutation permit -> workspace operation lease`
/// (PR1227-LOCK-01); the reverse is the order
/// `api/session_admission_tests.rs` proves deadlocks against retire/purge,
/// which hold every session permit in a workspace and then reach for that
/// workspace's exclusive lease. Exactly one workspace lease is taken here, so
/// there is no second lease to order against either.
pub(crate) async fn lease_target_workspace_for_peer_write(
    operation_gate: &WorkspaceOperationGate,
    access_gate: &WorkspaceAccessGate,
    target_workspace_id: &str,
) -> Result<WorkspaceOperationLease, PeerGateError> {
    let lease = operation_gate
        .acquire_shared(target_workspace_id, WorkspaceOperationKind::SubagentWrite)
        .await;
    // Same order the route uses: take the lease, then read the access state, so
    // a workspace that goes read-only cannot slip between the two.
    assert_workspace_can_be_mutated(access_gate, target_workspace_id)?;
    Ok(lease)
}

/// Access-state check with no lease attached — the caller-side half of what the
/// route used to do for this tool (`assert_workspace_mutable`).
pub(crate) fn assert_workspace_can_be_mutated(
    access_gate: &WorkspaceAccessGate,
    workspace_id: &str,
) -> Result<(), PeerGateError> {
    access_gate
        .assert_can_mutate_for_workspace(workspace_id)
        .map_err(|error| PeerGateError::WorkspaceBlocked(error.to_string()))
}

/// The reply IS the wake (ADR flow 2). When the caller answers an agent that was
/// waiting on it, the answer carried everything the pointer would only have
/// pointed at, so the schedule comes off rather than firing a redundant pointer
/// at the caller's turn end.
///
/// Only a REPLY arm is consumed. This runs after every send, and a send is not
/// necessarily an answer — a courtesy "starting now" would otherwise cancel a
/// standalone `schedule_agent_wake` and leave both agents idle forever. A
/// `wakeOnReply` arm is by construction the safety net for an answer, so the
/// answer consuming it is exactly its contract; an explicit schedule is a
/// standing request that only the target's turn finish ends.
///
/// Ordering: this runs AFTER the send lands. Disarming first would lose the
/// schedule if the send then failed — the watcher would be left waiting on
/// nothing. Consuming after means a crash in the gap leaves the schedule armed,
/// which costs the watcher one redundant pointer; that is the cheap side of the
/// trade, and it is why this is not (and cannot be) inside the send's own
/// transaction: the send is a runtime call that may boot an actor, not a write.
pub(super) fn consume_reply_wake(
    wake_service: &AgentWakeService,
    replying_session_id: &str,
    recipient_session_id: &str,
) -> bool {
    match wake_service.consume_reply_arm(recipient_session_id, replying_session_id) {
        Ok(consumed) => consumed,
        Err(error) => {
            tracing::warn!(
                replying_session_id,
                recipient_session_id,
                error = ?error,
                "failed to consume the recipient's wake schedule after a reply"
            );
            false
        }
    }
}

#[cfg(test)]
#[path = "peer_ops_tests.rs"]
mod tests;
