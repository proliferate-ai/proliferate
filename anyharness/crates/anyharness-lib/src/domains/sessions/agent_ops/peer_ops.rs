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
/// *right now* is a separate question, answered by [`admit_peer_send`].
pub(super) fn prepare_agent_message(
    session_store: &SessionStore,
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
    let sender = AgentMessageSender::from_session(&access.caller);
    let (text, provenance) = agent_message(&sender, message).into_parts();
    Ok(PreparedAgentMessage {
        target: access.target,
        sender_label: sender.label,
        text,
        provenance,
    })
}

#[derive(Debug, thiserror::Error)]
pub(super) enum PeerSendGateError {
    #[error(
        "that agent's execution is controlled by an active workflow run and cannot be \
         prompted until the run finishes"
    )]
    ControlledByWorkflow,
    #[error("session admission is unavailable")]
    AdmissionUnavailable,
    #[error("{0}")]
    WorkspaceBlocked(String),
}

/// The session-mutation admission fence, on the peer send path (spec 2b).
///
/// `send_agent_message` is the first product-MCP tool that can prompt an
/// ARBITRARY session, so it is the first that must clear this fence itself.
/// Every other route into a session's prompt queue takes this permit
/// (`api/http/sessions_prompt.rs`, the pending-prompt queue, goals/loops/
/// plans/reviews/config/resume/replay). The older MCP prompt paths were exempt
/// for a structural reason — they could only reach the far end of a
/// `session_links` row, and a workflow-controlled session is never on either
/// end — and runtime-wide peer reach deletes that argument.
///
/// The permit is held across the dispatch, so a workflow that takes control
/// mid-send cannot interleave, and a peer send is visible to the destructive
/// workspace paths that admit a whole workspace's session set.
pub(super) async fn admit_peer_send(
    admission: &SessionMutationAdmission,
    target_session_id: &str,
) -> Result<SessionMutationPermit, PeerSendGateError> {
    admission
        .acquire(
            target_session_id,
            SessionMutationKind::Prompt,
            &SessionMutationSource::external(),
        )
        .await
        .map_err(|conflict| match conflict {
            SessionMutationConflict::ControlledByWorkflow { run_id } => {
                tracing::info!(
                    target_session_id = %target_session_id,
                    controlling_run_id = %run_id,
                    "peer message rejected: target session is controlled by a workflow"
                );
                PeerSendGateError::ControlledByWorkflow
            }
            SessionMutationConflict::Internal(error) => {
                tracing::error!(
                    target_session_id = %target_session_id,
                    error = %error,
                    "peer message admission lookup failed"
                );
                PeerSendGateError::AdmissionUnavailable
            }
        })
}

/// The workspace write lease for a peer send — on the TARGET's workspace.
///
/// The route layer leases the workspace in the URL, which for a cross-workspace
/// send is the wrong one: the send mutates the TARGET workspace (it enqueues a
/// durable row against a target session and can boot a harness child process
/// inside the target's checkout), and it is the target workspace's retire
/// preflight that has to see that work in progress
/// (`workspaces/retire_preflight.rs` snapshots the gate for `SubagentWrite`).
/// So `send_agent_message` takes no route lease at all — it is deliberately
/// absent from `tools::MUTATING_TOOL_NAMES` — and takes this one instead.
///
/// MUST be called AFTER [`admit_peer_send`]. The canonical lock order is
/// `session mutation permit -> workspace operation lease`
/// (PR1227-LOCK-01); the reverse is the order
/// `api/session_admission_tests.rs` proves deadlocks against retire/purge,
/// which hold every session permit in a workspace and then reach for that
/// workspace's exclusive lease. Exactly one workspace lease is taken here, so
/// there is no second lease to order against either.
pub(super) async fn lease_target_workspace_for_send(
    operation_gate: &WorkspaceOperationGate,
    access_gate: &WorkspaceAccessGate,
    target_workspace_id: &str,
) -> Result<WorkspaceOperationLease, PeerSendGateError> {
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
pub(super) fn assert_workspace_can_be_mutated(
    access_gate: &WorkspaceAccessGate,
    workspace_id: &str,
) -> Result<(), PeerSendGateError> {
    access_gate
        .assert_can_mutate_for_workspace(workspace_id)
        .map_err(|error| PeerSendGateError::WorkspaceBlocked(error.to_string()))
}

/// The reply IS the wake (ADR flow 2). When the caller answers an agent that was
/// waiting on it, the answer carried everything the pointer would only have
/// pointed at, so the schedule comes off rather than firing a redundant pointer
/// at the caller's turn end.
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
    match wake_service.disarm(recipient_session_id, replying_session_id) {
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
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::domains::sessions::prompt::PromptPayload;
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
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        test_support::seed_workspace_with_repo_root(&db, "workspace-2", "local", "/tmp/workspace-2");
        let store = SessionStore::new(db);
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
        store
    }

    #[test]
    fn a_reply_consumes_the_recipients_wake_so_no_pointer_follows_it() {
        // ses_target armed a wake on ses_caller and is waiting. ses_caller
        // answers: the reply carries the content, so the schedule comes off and
        // ses_caller's turn end wakes nobody.
        let store = store_fixture();
        let wakes = AgentWakeService::new(store.clone());
        wakes.arm("ses_target", "ses_caller").expect("arm");

        assert!(consume_reply_wake(&wakes, "ses_caller", "ses_target"));

        assert!(wakes
            .consume_for_finished_turn("ses_caller", SessionTurnOutcome::Completed)
            .expect("the reply's turn finishes")
            .is_empty());
        assert!(store
            .list_pending_prompts("ses_target")
            .expect("pending prompts")
            .is_empty());
    }

    #[test]
    fn a_reply_leaves_the_other_directions_schedule_alone() {
        // Both sides armed on each other. Answering one direction must not
        // silently cancel the other side's wait.
        let store = store_fixture();
        let wakes = AgentWakeService::new(store.clone());
        wakes.arm("ses_target", "ses_caller").expect("arm");
        wakes.arm("ses_caller", "ses_target").expect("arm reverse");

        consume_reply_wake(&wakes, "ses_caller", "ses_target");

        let fired = wakes
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("the recipient's own turn finishes");
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_caller");
    }

    #[test]
    fn a_message_to_an_agent_that_was_not_waiting_consumes_nothing() {
        let store = store_fixture();
        let wakes = AgentWakeService::new(store.clone());

        assert!(!consume_reply_wake(&wakes, "ses_caller", "ses_target"));
    }

    #[test]
    fn an_open_target_in_another_workspace_is_reachable() {
        let store = store_fixture();

        let prepared = prepare_agent_message(&store, "ses_caller", "ses_target", "Ship it?")
            .expect("prepare message");

        assert_eq!(prepared.target.id, "ses_target");
        assert_eq!(prepared.target.workspace_id, "workspace-2");
        assert_eq!(prepared.sender_label, "Deploy Checker");
    }

    #[test]
    fn a_closed_target_is_rejected_before_any_prompt_is_built() {
        let store = store_fixture();
        let mut closed = session_record("ses_closed", "workspace-1", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        store.insert(&closed).expect("insert closed target");

        let error = prepare_agent_message(&store, "ses_caller", "ses_closed", "Ship it?")
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
        let store = store_fixture();
        let mut dismissed = session_record("ses_dismissed", "workspace-1", Some("Deleted"));
        dismissed.dismissed_at = Some("2026-08-08T01:00:00Z".to_string());
        store.insert(&dismissed).expect("insert dismissed target");

        let error = prepare_agent_message(&store, "ses_caller", "ses_dismissed", "Ship it?")
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
        let store = store_fixture();
        let mut internal = session_record("ses_internal", "workspace-1", Some("Workflow step"));
        internal.mcp_binding_policy = SessionMcpBindingPolicy::InternalOnly;
        store.insert(&internal).expect("insert internal target");

        let error = prepare_agent_message(&store, "ses_caller", "ses_internal", "Ship it?")
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
    fn an_agent_cannot_message_itself() {
        let store = store_fixture();

        let error = prepare_agent_message(&store, "ses_caller", "ses_caller", "Ship it?")
            .err()
            .expect("self send is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::SelfTarget)
        ));
    }

    #[test]
    fn an_unknown_target_is_named_in_the_error() {
        let store = store_fixture();

        let error = prepare_agent_message(&store, "ses_caller", "ses_ghost", "Ship it?")
            .err()
            .expect("unknown target is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetNotFound(ref id)) if id == "ses_ghost"
        ));
    }

    #[test]
    fn a_closed_agents_transcript_stays_readable() {
        let store = store_fixture();
        let mut closed = session_record("ses_closed", "workspace-1", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        store.insert(&closed).expect("insert closed target");

        // The same target that refuses a send.
        prepare_agent_message(&store, "ses_caller", "ses_closed", "Ship it?")
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
        let store = store_fixture();

        let error = prepare_agent_message(&store, "ses_caller", "ses_target", "  \n ")
            .err()
            .expect("blank message is rejected");

        assert!(matches!(error, AgentMessageError::EmptyMessage));
    }

    #[test]
    fn the_target_receives_the_envelope_and_the_row_stores_exactly_that_text() {
        let store = store_fixture();

        let prepared = prepare_agent_message(&store, "ses_caller", "ses_target", "Ship it?")
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

        let error = admit_peer_send(&admission, "ses_controlled")
            .await
            .err()
            .expect("a workflow-controlled target refuses the send");
        assert!(matches!(error, PeerSendGateError::ControlledByWorkflow));
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
        let permit = admit_peer_send(&admission, "ses_target")
            .await
            .expect("an ordinary target is admitted");
        drop(permit);
    }

    #[tokio::test]
    async fn an_uncontrolled_runtime_admits_every_peer_send() {
        let admission = SessionMutationAdmission::new(Arc::new(NoControllerPolicy));

        let permit = admit_peer_send(&admission, "ses_target")
            .await
            .expect("no controller means no fence");

        drop(permit);
    }

    #[tokio::test]
    async fn a_cross_workspace_send_leases_the_targets_workspace_not_the_callers() {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        test_support::seed_workspace_with_repo_root(&db, "workspace-2", "local", "/tmp/workspace-2");
        let access_gate = access_gate_fixture(&db);
        let operation_gate = WorkspaceOperationGate::new();

        // Caller in workspace-1, target in workspace-2.
        let lease = lease_target_workspace_for_send(&operation_gate, &access_gate, "workspace-2")
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

        let error = lease_target_workspace_for_send(&operation_gate, &access_gate, "workspace-gone")
            .await
            .err()
            .expect("an unmutable target workspace refuses the send");

        assert!(matches!(error, PeerSendGateError::WorkspaceBlocked(_)));
    }
}
