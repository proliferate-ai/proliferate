//! The single access-policy funnel every cross-agent operation clears.
//!
//! Today it encodes reachability, not ownership: sessions are visible
//! runtime-wide (there is no per-workspace or per-owner scoping to apply), a
//! closed or dismissed session stays readable but takes no more input, an agent
//! is not its own peer, and `internal_only` sessions are not peers at all —
//! they are workflow/review plumbing the runtime drives, so they are refused as
//! a target for both intents and hidden from `search_sessions`. **It enforces
//! no ownership check at all** — any caller may `Read` or `Send` to any other
//! ordinary target, runtime-wide.
//!
//! Refusing an `internal_only` target is a *discovery* rule, not the execution
//! fence: a workflow-controlled session is refused a prompt by the session
//! mutation admission permit the peer send takes
//! ([`crate::domains::sessions::admission`]), which is what actually protects a
//! run in flight. This module only keeps such sessions out of the peer surface.
//!
//! The link-scoped ownership check that keeps the *subagent* tool class safe lives
//! entirely in `SubagentService::resolve_target` (and
//! `resolve_target_including_closed`), which every subagent call site still
//! runs before reaching this funnel.
//!
//! The peer tools (`send_agent_message`, `read_agent_transcript`) are the
//! deliberate exception: they have no link to resolve and are specified to
//! reach any session in the runtime, so for them this funnel is the *whole*
//! policy. That is a scope decision, not an oversight — a peer message is an
//! inbox item the receiver can ignore, whereas closing or promoting a session
//! acts on it. Keep new tools on the resolve path unless the same reasoning
//! applies.
//!
//! PR 5 is expected to route `close_agent`/promote through `authorize` with an
//! ownership-aware intent. Do not add a `Close`/`Promote` variant to
//! `AgentAccessIntent` — or route existing callers through it — until this
//! module actually carries the ownership/promotion check, backed by its own
//! tests. Dropping the `SubagentService` resolve call in favor of a bare
//! `authorize()` call before that lands would silently grant every session the
//! ability to close/promote every other session, and the current test suite
//! here would not catch it (it asserts runtime-wide access *is* allowed).

use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentAccessIntent {
    /// Reading a target: still allowed after it closes — transcripts outlive
    /// the agent.
    Read,
    /// Reaching a target's actor or prompt queue.
    Send,
}

#[derive(Debug, Clone)]
pub struct AgentAccess {
    pub caller: SessionRecord,
    pub target: SessionRecord,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentAccessError {
    #[error("caller session not found: {0}")]
    CallerNotFound(String),
    #[error("target session not found: {0}")]
    TargetNotFound(String),
    #[error("caller session is closed")]
    CallerClosed,
    #[error("target session is closed")]
    TargetClosed,
    #[error("target session was dismissed and cannot be messaged")]
    TargetDismissed,
    #[error("target session is internal runtime plumbing, not a reachable agent")]
    TargetInternalOnly,
    #[error("an agent cannot message itself")]
    SelfTarget,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub fn authorize(
    session_store: &SessionStore,
    caller_session_id: &str,
    target_session_id: &str,
    intent: AgentAccessIntent,
) -> Result<AgentAccess, AgentAccessError> {
    let caller = session_store
        .find_by_id(caller_session_id)?
        .ok_or_else(|| AgentAccessError::CallerNotFound(caller_session_id.to_string()))?;
    if is_closed(&caller) {
        return Err(AgentAccessError::CallerClosed);
    }
    let target = session_store
        .find_by_id(target_session_id)?
        .ok_or_else(|| AgentAccessError::TargetNotFound(target_session_id.to_string()))?;
    // Workflow and review plumbing is not part of the peer-reachable set. It is
    // not an agent the human is running, it is a session another product
    // feature drives; discovery hides it (`search_sessions`) and this refuses it
    // for BOTH intents so the two surfaces agree.
    if target.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly {
        return Err(AgentAccessError::TargetInternalOnly);
    }
    if intent == AgentAccessIntent::Send {
        // Self-send is the degenerate loop the rest of the design excludes
        // structurally (`session_links` carries CHECK(parent != child)). Reads
        // stay open: an agent re-reading its own transcript perturbs nothing.
        if caller.id == target.id {
            return Err(AgentAccessError::SelfTarget);
        }
        if is_closed(&target) {
            return Err(AgentAccessError::TargetClosed);
        }
        // A dismissed session is gone from the human's sidebar and the boot path
        // refuses it (`runtime/launch_policy.rs`), so a send would die deep
        // inside the runtime with an internal error. Refuse it here instead;
        // the transcript stays readable, exactly like a closed one.
        if target.dismissed_at.is_some() {
            return Err(AgentAccessError::TargetDismissed);
        }
    }
    Ok(AgentAccess { caller, target })
}

/// The one definition of "closed" this funnel enforces, shared with the wake
/// consumption so a closed session is the same session to both.
pub(crate) fn is_closed(session: &SessionRecord) -> bool {
    session.closed_at.is_some() || session.status == "closed"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::persistence::Db;

    fn session_record(id: &str, workspace_id: &str) -> SessionRecord {
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
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-07T00:00:00Z".to_string(),
            updated_at: "2026-08-07T00:00:00Z".to_string(),
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
        SessionStore::new(db)
    }

    #[test]
    fn visibility_is_runtime_wide_across_workspaces() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");
        store
            .insert(&session_record("target", "workspace-2"))
            .expect("insert target");

        let access = authorize(&store, "caller", "target", AgentAccessIntent::Send)
            .expect("authorize across workspaces");

        assert_eq!(access.caller.id, "caller");
        assert_eq!(access.target.id, "target");
    }

    #[test]
    fn closed_target_rejects_sends_but_stays_readable() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");
        let mut target = session_record("target", "workspace-1");
        target.closed_at = Some("2026-08-07T01:00:00Z".to_string());
        target.status = "closed".to_string();
        store.insert(&target).expect("insert target");

        let error = authorize(&store, "caller", "target", AgentAccessIntent::Send)
            .err()
            .expect("closed target rejects sends");
        assert!(matches!(error, AgentAccessError::TargetClosed));

        authorize(&store, "caller", "target", AgentAccessIntent::Read)
            .expect("closed target stays readable");
    }

    #[test]
    fn closed_caller_is_rejected_for_every_intent() {
        let store = store_fixture();
        let mut caller = session_record("caller", "workspace-1");
        caller.closed_at = Some("2026-08-07T01:00:00Z".to_string());
        store.insert(&caller).expect("insert caller");
        store
            .insert(&session_record("target", "workspace-1"))
            .expect("insert target");

        for intent in [AgentAccessIntent::Read, AgentAccessIntent::Send] {
            let error = authorize(&store, "caller", "target", intent)
                .err()
                .expect("closed caller is rejected");
            assert!(matches!(error, AgentAccessError::CallerClosed));
        }
    }

    #[test]
    fn dismissed_target_rejects_sends_but_stays_readable() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");
        let mut target = session_record("target", "workspace-1");
        target.dismissed_at = Some("2026-08-07T01:00:00Z".to_string());
        store.insert(&target).expect("insert target");

        let error = authorize(&store, "caller", "target", AgentAccessIntent::Send)
            .err()
            .expect("dismissed target rejects sends");
        assert!(matches!(error, AgentAccessError::TargetDismissed));
        assert_eq!(
            error.to_string(),
            "target session was dismissed and cannot be messaged"
        );

        authorize(&store, "caller", "target", AgentAccessIntent::Read)
            .expect("dismissed target stays readable");
    }

    #[test]
    fn an_internal_only_target_is_not_a_peer_in_either_direction() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");
        let mut target = session_record("target", "workspace-1");
        target.mcp_binding_policy = SessionMcpBindingPolicy::InternalOnly;
        store.insert(&target).expect("insert target");

        for intent in [AgentAccessIntent::Read, AgentAccessIntent::Send] {
            let error = authorize(&store, "caller", "target", intent)
                .err()
                .expect("internal-only target is rejected");
            assert!(matches!(error, AgentAccessError::TargetInternalOnly));
        }

        // The same caller reaching an ordinary session is untouched.
        store
            .insert(&session_record("peer", "workspace-2"))
            .expect("insert peer");
        authorize(&store, "caller", "peer", AgentAccessIntent::Send)
            .expect("an ordinary target stays reachable");
    }

    #[test]
    fn an_agent_cannot_send_to_itself_but_can_read_itself() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");

        let error = authorize(&store, "caller", "caller", AgentAccessIntent::Send)
            .err()
            .expect("self send is rejected");
        assert!(matches!(error, AgentAccessError::SelfTarget));

        authorize(&store, "caller", "caller", AgentAccessIntent::Read)
            .expect("reading your own transcript perturbs nothing");
    }

    #[test]
    fn missing_sessions_are_reported_by_side() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");

        let missing_target = authorize(&store, "caller", "ghost", AgentAccessIntent::Read)
            .err()
            .expect("missing target");
        assert!(matches!(missing_target, AgentAccessError::TargetNotFound(id) if id == "ghost"));

        let missing_caller = authorize(&store, "ghost", "caller", AgentAccessIntent::Read)
            .err()
            .expect("missing caller");
        assert!(matches!(missing_caller, AgentAccessError::CallerNotFound(id) if id == "ghost"));
    }
}
