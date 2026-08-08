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
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::admission::{NoControllerPolicy, SessionControllerPolicy};
    use crate::domains::sessions::extensions::SessionTurnOutcome;
    use crate::domains::sessions::links::model::{
        SessionLinkRelation, SessionLinkWorkspaceRelation,
    };
    use crate::domains::sessions::links::service::CreateSessionLinkInput;
    use crate::domains::sessions::links::store::SessionLinkStore;
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::domains::sessions::prompt::PromptPayload;
    use crate::domains::sessions::store::agent_wakes::AgentWakeReason;
    use crate::domains::terminals::store::TerminalStore;
    use crate::domains::workspaces::store::{WorkspaceAccessStore, WorkspaceStore};
    use crate::live::terminals::TerminalService;
    use crate::persistence::Db;
    use std::sync::Arc;

    fn session_record(id: &str, workspace_id: &str, title: Option<&str>) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: title.map(ToString::to_string),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn store_fixture() -> SessionStore {
        store_and_links_fixture().0
    }

    /// Two agents in two workspaces, plus the link service the send path reads
    /// ownership rows from (an end-requested target takes no new messages).
    fn store_and_links_fixture() -> (SessionStore, SessionLinkService) {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        test_support::seed_workspace_with_repo_root(&db, "workspace-2", "local", "/tmp/workspace-2");
        let store = SessionStore::new(db.clone());
        store
            .insert(&session_record(
                "ses_caller",
                "workspace-1",
                Some("Deploy Checker"),
            ))
            .expect("insert caller");
        store
            .insert(&session_record("ses_target", "workspace-2", Some("Schema audit")))
            .expect("insert target");
        let links = SessionLinkService::new(SessionLinkStore::new(db), store.clone());
        (store, links)
    }

    fn wake_service_fixture(store: &SessionStore) -> AgentWakeService {
        AgentWakeService::new(
            store.clone(),
            Arc::new(SessionMutationAdmission::new(Arc::new(NoControllerPolicy))),
        )
    }

    #[tokio::test]
    async fn a_reply_consumes_the_recipients_wake_so_no_pointer_follows_it() {
        // ses_target armed a wake on ses_caller and is waiting. ses_caller
        // answers: the reply carries the content, so the schedule comes off and
        // ses_caller's turn end wakes nobody.
        let store = store_fixture();
        let wakes = wake_service_fixture(&store);
        wakes
            .arm("ses_target", "ses_caller", AgentWakeReason::Reply)
            .expect("arm");

        assert!(consume_reply_wake(&wakes, "ses_caller", "ses_target"));

        assert!(wakes
            .consume_for_finished_turn("ses_caller", SessionTurnOutcome::Completed)
            .await
            .expect("the reply's turn finishes")
            .is_empty());
        assert!(store
            .list_pending_prompts("ses_target")
            .expect("pending prompts")
            .is_empty());
    }

    #[tokio::test]
    async fn a_send_that_is_not_a_reply_leaves_an_explicit_schedule_standing() {
        // M2. `consume_reply_wake` runs after EVERY send, including a courtesy
        // "starting now" that answers nothing. Only the arm that exists to be
        // answered may come off — otherwise the watcher's standalone schedule
        // vanishes and both agents wait forever.
        let store = store_fixture();
        let wakes = wake_service_fixture(&store);
        wakes
            .arm(
                "ses_target",
                "ses_caller",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("ses_target schedules a wake on ses_caller");

        assert!(!consume_reply_wake(&wakes, "ses_caller", "ses_target"));

        let fired = wakes
            .consume_for_finished_turn("ses_caller", SessionTurnOutcome::Completed)
            .await
            .expect("the sender's turn finishes");
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_target");
    }

    #[tokio::test]
    async fn a_reply_leaves_the_other_directions_schedule_alone() {
        // Both sides armed on each other. Answering one direction must not
        // silently cancel the other side's wait.
        let store = store_fixture();
        let wakes = wake_service_fixture(&store);
        wakes
            .arm("ses_target", "ses_caller", AgentWakeReason::Reply)
            .expect("arm");
        wakes
            .arm("ses_caller", "ses_target", AgentWakeReason::Reply)
            .expect("arm reverse");

        consume_reply_wake(&wakes, "ses_caller", "ses_target");

        let fired = wakes
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("the recipient's own turn finishes");
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_caller");
    }

    #[test]
    fn a_message_to_an_agent_that_was_not_waiting_consumes_nothing() {
        let store = store_fixture();
        let wakes = wake_service_fixture(&store);

        assert!(!consume_reply_wake(&wakes, "ses_caller", "ses_target"));
    }

    #[test]
    fn send_agent_message_arms_before_the_dispatch_and_consumes_after_it() {
        // The three tests above prove what `consume_reply_wake` DOES; none of
        // them prove `send_agent_message` calls it, because the send itself
        // needs a live runtime. This is the same source-order guard the
        // dual-lock handlers use (`api/session_admission_tests.rs`), for the
        // same reason: the ordering IS the guarantee.
        //
        // Arm before the dispatch, or a target that is already mid-turn
        // finishes that turn before the schedule exists and the wake is lost
        // (ruling 10). Consume after it, or a send that then FAILS would have
        // already cancelled a wake the watcher still needs.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/domains/sessions/agent_ops/calls.rs");
        let text = std::fs::read_to_string(&path).expect("read calls.rs");
        let start = text
            .find("async fn send_agent_message(")
            .expect("send_agent_message is defined in calls.rs");
        let rest = &text[start..];
        let body = &rest[..rest[1..].find("\nasync fn ").map_or(rest.len(), |at| at + 1)];

        let armed_at = body
            .find(".arm(")
            .expect("send_agent_message arms the wakeOnReply schedule");
        let dispatched_at = body
            .find("send_text_prompt_with_provenance(")
            .expect("send_agent_message dispatches the prompt");
        let consumed_at = body
            .find("consume_reply_wake(")
            .expect("send_agent_message consumes the recipient's pending wake");

        assert!(
            armed_at < dispatched_at,
            "wakeOnReply must be armed BEFORE the prompt dispatch"
        );
        assert!(
            dispatched_at < consumed_at,
            "the recipient's wake must be consumed AFTER the send lands"
        );
    }

    /// Read `calls.rs` once for the guards below. Same technique, and the same
    /// justification, as `send_agent_message_arms_before_the_dispatch...`
    /// above: these are orderings inside an async handler that needs a live
    /// runtime, and the ordering IS the guarantee.
    fn calls_source() -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/domains/sessions/agent_ops/calls.rs");
        std::fs::read_to_string(&path).expect("read calls.rs")
    }

    /// The slice from `signature` to the next top-level fn — whichever comes
    /// FIRST. Taking the earliest of the two matches rather than falling back
    /// to the plain-`fn` search only when no `async fn` follows anywhere: the
    /// fallback form never fires while any async fn exists further down the
    /// file, so the window silently swallows the next sync function and the
    /// guards below could be satisfied by a neighbour's text.
    /// Collapse every whitespace run to one space so the assertions below
    /// survive rustfmt's line breaking. `let _lease =\n    match foo(` and
    /// `let _lease = match foo(` are the same guarantee and must read the same.
    fn squashed(text: &str) -> String {
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn function_body<'a>(source: &'a str, signature: &str) -> &'a str {
        let start = source
            .find(signature)
            .unwrap_or_else(|| panic!("{signature} is not defined in the file under guard"));
        let rest = &source[start..];
        let end = [rest[1..].find("\nasync fn "), rest[1..].find("\nfn ")]
            .into_iter()
            .flatten()
            .min();
        &rest[..end.map_or(rest.len(), |at| at + 1)]
    }

    #[test]
    fn the_spawn_gate_runs_before_dispatch_not_only_in_the_tool_list() {
        // Tool lists are frozen at session launch, so hiding the spawn tools in
        // `tools/list` cannot bind an agent whose state changed afterwards — a
        // subagent launched before its promotion, or promoted after its launch,
        // holds a stale list either way. Only this check runs against the
        // caller's state at the moment it acts. It must also come BEFORE the
        // dispatch match, or the handler has already run by the time it refuses.
        let source = calls_source();
        let body = function_body(&source, "pub async fn call_tool(");

        let gate_at = body
            .find("is_spawn_style_tool(name)")
            .expect("call_tool gates the spawn-style tools at dispatch");
        let dispatch_at = body
            .find("match canonical_tool_name(name)")
            .expect("call_tool dispatches on the canonical tool name");
        assert!(
            gate_at < dispatch_at,
            "the spawn gate must refuse BEFORE the tool dispatches"
        );
        // Matched on the WIRE name: `canonical_tool_name` would map the
        // deprecated `create_subagent` spelling onto `spawn_subagent` and let a
        // launch-frozen subagent walk around the gate under the old name.
        assert!(
            !body[..gate_at].contains("canonical_tool_name(name)"),
            "the spawn gate must match the wire name, not the canonicalized one"
        );
        // Order alone would still be satisfied by a gate that logs and falls
        // through, so the block between the check and the dispatch has to
        // actually construct the refusal. Nothing in the crate calls
        // `call_tool`, so this needle is what stands in for exercising it.
        let gate_body = &body[gate_at..dispatch_at];
        assert!(
            gate_body.contains("return Err(anyhow::anyhow!(")
                && gate_body.contains("is not available to a subagent"),
            "the spawn gate must REFUSE, not merely notice: {gate_body}"
        );
    }

    #[test]
    fn close_agent_takes_the_targets_permit_before_any_workspace_lease() {
        // H1: a close mutates a session that need not be in the caller's link
        // tree or workspace, so it must take that session's mutation permit —
        // otherwise it runs straight through a workflow holding control. And it
        // must take it OUTERMOST (PR1227-LOCK-01): the reverse order is what
        // `api/session_admission_tests.rs` proves deadlocks against
        // retire/purge, which hold every session permit in a workspace and then
        // reach for that workspace's exclusive lease.
        let source = calls_source();
        let body = function_body(&source, "async fn close_agent(");

        let permit_at = body
            .find("admit_peer_mutation(")
            .expect("close_agent takes the target session's mutation permit");
        let lease_at = body
            .find("lease_target_workspace_for_peer_write(")
            .expect("close_agent leases the target workspace");
        let close_at = body
            .find("close_live_session(")
            .expect("close_agent closes the live session");

        assert!(
            body[permit_at..lease_at].contains("SessionMutationKind::Close"),
            "the permit must be taken for the Close kind"
        );
        assert!(
            permit_at < lease_at,
            "the session mutation permit must be taken BEFORE the workspace lease"
        );
        assert!(
            lease_at < close_at,
            "both gates must be held across the close itself"
        );
        // The attribution stamp is what arms a deferred close, so it must land
        // under the permit too — a refused call must arm nothing.
        let stamp_at = body
            .find("record_close_attribution(")
            .expect("close_agent records who closed the agent and why");
        assert!(
            permit_at < stamp_at,
            "the close request must not be armed by a call the fence would refuse"
        );
        // Order is only half of it: both guards must be HELD to the end of the
        // scope. `let _ = admit_peer_mutation(...)` drops the permit at the end
        // of its own statement, destroys the fence, and leaves every ordering
        // assertion above still passing — so the bindings are pinned by name.
        let held = squashed(body);
        assert!(
            held.contains("let _admission_permit = admit_peer_mutation("),
            "the permit must be BOUND (`let _admission_permit = ...`), not dropped at the \
             end of its own statement"
        );
        assert!(
            held.contains("let _target_workspace_lease = lease_target_workspace_for_peer_write("),
            "the workspace lease must be BOUND (`let _target_workspace_lease = ...`), not \
             dropped at the end of its own statement"
        );
    }

    #[test]
    fn the_deferred_half_of_a_soft_close_retakes_the_same_gates_in_the_same_order() {
        // The requesting call returned long ago and control can be acquired in
        // between, so the turn-finish completion cannot carry the gates — it
        // re-takes them, and in the same order, or the deferred path becomes a
        // second lock order.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/domains/sessions/ownership/hooks.rs");
        let source = std::fs::read_to_string(&path).expect("read ownership/hooks.rs");
        // The one body both deferred callers (turn finish, boot reconciliation)
        // go through.
        let body = function_body(&source, "async fn complete_close_request(");

        let permit_at = body
            .find("admit_peer_mutation(")
            .expect("the deferred close takes the target's mutation permit");
        let lease_at = body
            .find("lease_target_workspace_for_peer_write(")
            .expect("the deferred close leases the target workspace");
        let close_at = body
            .find("close_live_session(")
            .expect("the deferred close closes the live session");

        assert!(body[permit_at..lease_at].contains("SessionMutationKind::Close"));
        assert!(permit_at < lease_at);
        assert!(lease_at < close_at);
        // Held, not merely called — same reason as the synchronous half.
        let held = squashed(body);
        assert!(
            held.contains("let _permit = match admit_peer_mutation("),
            "the deferred permit must be BOUND across the close"
        );
        assert!(
            held.contains("let _lease = match lease_target_workspace_for_peer_write("),
            "the deferred workspace lease must be BOUND across the close"
        );
    }

    #[test]
    fn an_open_target_in_another_workspace_is_reachable() {
        let (store, links) = store_and_links_fixture();

        let prepared = prepare_agent_message(&store, &links, "ses_caller", "ses_target", "Ship it?")
            .expect("prepare message");

        assert_eq!(prepared.target.id, "ses_target");
        assert_eq!(prepared.target.workspace_id, "workspace-2");
        assert_eq!(prepared.sender_label, "Deploy Checker");
    }

    #[test]
    fn a_closed_target_is_rejected_before_any_prompt_is_built() {
        let (store, links) = store_and_links_fixture();
        let mut closed = session_record("ses_closed", "workspace-1", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        store.insert(&closed).expect("insert closed target");

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_closed", "Ship it?")
            .err()
            .expect("closed target is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetClosed)
        ));
        assert_eq!(error.to_string(), "target session is closed");
    }

    #[test]
    fn a_dismissed_target_is_rejected_before_the_boot_path_can_fail_opaquely() {
        let (store, links) = store_and_links_fixture();
        let mut dismissed = session_record("ses_dismissed", "workspace-1", Some("Deleted"));
        dismissed.dismissed_at = Some("2026-08-08T01:00:00Z".to_string());
        store.insert(&dismissed).expect("insert dismissed target");

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_dismissed", "Ship it?")
            .err()
            .expect("dismissed target is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetDismissed)
        ));
        // Readable, exactly like a closed one: dismissing removes the agent,
        // not its record.
        authorize_transcript_read(&store, "ses_caller", "ses_dismissed")
            .expect("a dismissed agent's transcript stays readable");
    }

    #[test]
    fn an_internal_only_target_is_not_a_peer() {
        let (store, links) = store_and_links_fixture();
        let mut internal = session_record("ses_internal", "workspace-1", Some("Workflow step"));
        internal.mcp_binding_policy = SessionMcpBindingPolicy::InternalOnly;
        store.insert(&internal).expect("insert internal target");

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_internal", "Ship it?")
            .err()
            .expect("internal-only target is rejected");
        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetInternalOnly)
        ));

        // Hidden from discovery AND refused as a read target, so the two
        // surfaces cannot disagree.
        let read = authorize_transcript_read(&store, "ses_caller", "ses_internal")
            .err()
            .expect("internal-only target is not readable either");
        assert!(matches!(read, AgentAccessError::TargetInternalOnly));
    }

    #[test]
    fn an_end_requested_target_is_refused_and_told_why() {
        // The soft-close window: the ownership row is stamped but still open,
        // so the session is not closed and `authorize` lets the send through.
        // A prompt accepted here would enqueue and then never run — the actor
        // starts no turn while a close is pending, and after the close it never
        // boots again — so the send is refused at the door with a reason the
        // calling agent can act on.
        let (store, links) = store_and_links_fixture();
        let link = links
            .create_link(CreateSessionLinkInput {
                relation: SessionLinkRelation::Subagent,
                parent_session_id: "ses_caller".to_string(),
                child_session_id: "ses_target".to_string(),
                workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                label: Some("Schema audit".to_string()),
                created_by_turn_id: None,
                created_by_tool_call_id: None,
            })
            .expect("link the target as a subagent");

        // Negative control: before the stamp, the very same send is accepted.
        prepare_agent_message(&store, &links, "ses_caller", "ses_target", "Ship it?")
            .expect("an open, un-requested target takes messages");

        links
            .record_close_attribution(&link.id, "ses_caller", Some("superseded"))
            .expect("stamp the close request");

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_target", "Ship it?")
            .err()
            .expect("an end-requested target is refused");
        assert!(matches!(error, AgentMessageError::TargetEndRequested));
        assert!(
            error.to_string().contains("takes no new messages"),
            "unexpected message: {error}"
        );

        // Reads are unaffected: closing removes the agent, not its record, and
        // the same is true while it is on its way out.
        authorize_transcript_read(&store, "ses_caller", "ses_target")
            .expect("an end-requested agent's transcript stays readable");
    }

    #[test]
    fn an_agent_cannot_message_itself() {
        let (store, links) = store_and_links_fixture();

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_caller", "Ship it?")
            .err()
            .expect("self send is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::SelfTarget)
        ));
    }

    #[test]
    fn an_unknown_target_is_named_in_the_error() {
        let (store, links) = store_and_links_fixture();

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_ghost", "Ship it?")
            .err()
            .expect("unknown target is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetNotFound(ref id)) if id == "ses_ghost"
        ));
    }

    #[test]
    fn a_closed_agents_transcript_stays_readable() {
        let (store, links) = store_and_links_fixture();
        let mut closed = session_record("ses_closed", "workspace-1", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        store.insert(&closed).expect("insert closed target");

        // The same target that refuses a send.
        prepare_agent_message(&store, &links, "ses_caller", "ses_closed", "Ship it?")
            .err()
            .expect("closed target refuses sends");
        let target = authorize_transcript_read(&store, "ses_caller", "ses_closed")
            .expect("closed target stays readable");

        assert_eq!(target.id, "ses_closed");
    }

    #[test]
    fn a_transcript_read_still_needs_a_live_caller_and_a_real_target() {
        let store = store_fixture();

        let missing = authorize_transcript_read(&store, "ses_caller", "ses_ghost")
            .err()
            .expect("unknown target is rejected");
        assert!(matches!(missing, AgentAccessError::TargetNotFound(ref id) if id == "ses_ghost"));

        let mut closed_caller = session_record("ses_gone", "workspace-1", None);
        closed_caller.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        store.insert(&closed_caller).expect("insert closed caller");
        let closed = authorize_transcript_read(&store, "ses_gone", "ses_target")
            .err()
            .expect("closed caller is rejected");
        assert!(matches!(closed, AgentAccessError::CallerClosed));
    }

    #[test]
    fn a_blank_message_is_rejected() {
        let (store, links) = store_and_links_fixture();

        let error = prepare_agent_message(&store, &links, "ses_caller", "ses_target", "  \n ")
            .err()
            .expect("blank message is rejected");

        assert!(matches!(error, AgentMessageError::EmptyMessage));
    }

    #[test]
    fn the_target_receives_the_envelope_and_the_row_stores_exactly_that_text() {
        let (store, links) = store_and_links_fixture();

        let prepared = prepare_agent_message(&store, &links, "ses_caller", "ses_target", "Ship it?")
            .expect("prepare message");

        assert_eq!(
            prepared.text,
            "Message from agent \"Deploy Checker\" (session ses_caller):\n\nShip it?\n\nTo reply, use send_agent_message with sessionId \"ses_caller\"."
        );
        assert_eq!(
            prepared.provenance,
            PromptProvenance::AgentSession {
                source_session_id: "ses_caller".to_string(),
                session_link_id: None,
                label: Some("Deploy Checker".to_string()),
            }
        );

        // The dispatch call builds exactly this payload from the two halves.
        let payload =
            PromptPayload::text(prepared.text.clone()).with_provenance(prepared.provenance.clone());
        assert_eq!(payload.text_summary, prepared.text);
        assert!(payload.public_provenance().is_some());
    }

    /// A controller policy that hands one session to one run — the durable
    /// lookup the Workflows domain implements in production.
    struct ControlledSession {
        session_id: &'static str,
        run_id: &'static str,
    }

    impl SessionControllerPolicy for ControlledSession {
        fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>> {
            Ok((session_id == self.session_id).then(|| self.run_id.to_string()))
        }
    }

    fn access_gate_fixture(db: &Db) -> WorkspaceAccessGate {
        let runtime_home = std::env::temp_dir().join(format!(
            "anyharness-peer-ops-test-{}",
            uuid::Uuid::new_v4()
        ));
        WorkspaceAccessGate::new(
            WorkspaceStore::new(db.clone()),
            SessionStore::new(db.clone()),
            WorkspaceAccessStore::new(db.clone()),
            Arc::new(TerminalService::new(
                TerminalStore::new(db.clone()),
                runtime_home,
            )),
        )
    }

    #[tokio::test]
    async fn a_workflow_controlled_target_is_refused_and_an_ordinary_one_is_admitted() {
        let admission = SessionMutationAdmission::new(Arc::new(ControlledSession {
            session_id: "ses_controlled",
            run_id: "run_7",
        }));

        let error = admit_peer_mutation(&admission, "ses_controlled", SessionMutationKind::Prompt)
            .await
            .err()
            .expect("a workflow-controlled target refuses the send");
        assert!(matches!(error, PeerGateError::ControlledByWorkflow));
        // The calling agent has to be able to act on this, so it says what is
        // wrong and when to retry — never the run id.
        assert!(
            error
                .to_string()
                .contains("controlled by an active workflow run"),
            "unexpected message: {error}"
        );
        assert!(!error.to_string().contains("run_7"));

        // Negative control: the same admission admits every other session, so
        // the refusal above is the controller policy and not a blanket block.
        let permit = admit_peer_mutation(&admission, "ses_target", SessionMutationKind::Prompt)
            .await
            .expect("an ordinary target is admitted");
        drop(permit);

        // The fence is the same one for a config change, so a controlled target
        // refuses `configure_agent` for the same reason and with the same
        // message — and an ordinary one is still admitted.
        let config_error =
            admit_peer_mutation(&admission, "ses_controlled", SessionMutationKind::Config)
                .await
                .err()
                .expect("a workflow-controlled target refuses the config change");
        assert!(matches!(config_error, PeerGateError::ControlledByWorkflow));
        assert!(!config_error.to_string().contains("run_7"));
        let config_permit =
            admit_peer_mutation(&admission, "ses_target", SessionMutationKind::Config)
                .await
                .expect("an ordinary target is admitted for a config change");
        drop(config_permit);
    }

    #[tokio::test]
    async fn an_uncontrolled_runtime_admits_every_peer_send() {
        let admission = SessionMutationAdmission::new(Arc::new(NoControllerPolicy));

        let permit = admit_peer_mutation(&admission, "ses_target", SessionMutationKind::Prompt)
            .await
            .expect("no controller means no fence");

        drop(permit);
    }

    #[tokio::test]
    async fn a_cross_workspace_send_leases_the_targets_workspace_not_the_callers() {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-2",
            "local",
            "/tmp/workspace-2",
        );
        let access_gate = access_gate_fixture(&db);
        let operation_gate = WorkspaceOperationGate::new();

        // Caller in workspace-1, target in workspace-2.
        let lease =
            lease_target_workspace_for_peer_write(&operation_gate, &access_gate, "workspace-2")
                .await
                .expect("target workspace lease");

        assert_eq!(
            operation_gate
                .snapshot("workspace-2")
                .await
                .count(WorkspaceOperationKind::SubagentWrite),
            1,
            "the target workspace's retire preflight must see this send"
        );
        assert_eq!(
            operation_gate
                .snapshot("workspace-1")
                .await
                .count(WorkspaceOperationKind::SubagentWrite),
            0,
            "the caller's workspace is not the one being mutated"
        );

        drop(lease);
        assert_eq!(
            operation_gate
                .snapshot("workspace-2")
                .await
                .count(WorkspaceOperationKind::SubagentWrite),
            0
        );
    }

    #[tokio::test]
    async fn a_send_into_an_unknown_workspace_is_refused_cleanly() {
        let db = Db::open_in_memory().expect("open db");
        let access_gate = access_gate_fixture(&db);
        let operation_gate = WorkspaceOperationGate::new();

        let error =
            lease_target_workspace_for_peer_write(&operation_gate, &access_gate, "workspace-gone")
                .await
                .err()
                .expect("an unmutable target workspace refuses the send");

        assert!(matches!(error, PeerGateError::WorkspaceBlocked(_)));
    }
}
