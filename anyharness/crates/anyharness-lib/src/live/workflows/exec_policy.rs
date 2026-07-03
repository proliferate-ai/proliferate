//! Workflow exec policy — "a workflow run always uses the harness's
//! bypass-equivalent" (goals-and-workflows-v1 §3.3 "Exec policy: always
//! bypass"). A workflow-owned session must never stall on a native permission
//! prompt; the only human-in-the-loop is the `human.approval` step.
//!
//! Two layered mechanisms, primary + safety net:
//!
//! 1. **Primary (native bypass mode).** When the executor opens a
//!    workflow-owned session it selects the harness's native
//!    bypass-equivalent permission mode ([`bypass_mode_for_kind`]). In that
//!    mode the goal-capable harnesses (claude, codex) do not emit permission
//!    requests at all, so agent turns AND native-goal auto-continuation ride
//!    the same session and never block. The mode is persisted on the session
//!    row, so it survives crash-resume.
//!
//! 2. **Fallback safety net (auto-approve).** A harness with no known native
//!    bypass mode (`bypass_mode_for_kind` → `None`) still gets registered as
//!    workflow-owned ([`WorkflowOwnedSessions`]); the inbound permission
//!    door's advisor ([`WorkflowAutoApproveAdvisor`]) then auto-approves its
//!    permission requests instead of parking them, so the run still never
//!    stalls. Every auto-approval is logged (`target: "workflow.autoapprove"`)
//!    for audit.
//!
//! # Why the net does not emit interaction events
//!
//! Auto-approval rides the [`PermissionAdvisor::advise`] "predecided" path,
//! whose contract is to answer immediately *without surfacing an interaction*
//! (same as the plan-predecision path in `domains/plans`). Emitting a
//! synthetic `InteractionRequested` into the ledger would make session replay
//! re-park on a historical auto-approval and wait for a resolution that never
//! comes, so the audit trail is the structured log line, not a ledger event.

use std::collections::HashSet;
use std::sync::{Arc, RwLock};

use agent_client_protocol as acp;

use crate::acp::permission_payload::{permission_option_mappings, permission_options};
use crate::live::sessions::model::{
    PermissionAdvice, PermissionAdvisor, PermissionQuestionView, SessionObserverContext,
};

/// The native bypass-equivalent permission mode id for a harness, or `None`
/// when the harness advertises no such mode.
///
/// The ids are catalog `mode`-control values (`catalogs/agents/catalog.json`):
/// claude's `bypassPermissions` and codex's `full-access` (codex's
/// "danger-full-access"). Every claude/codex model in the catalog advertises
/// its respective value in the per-model `mode` matrix, so session-create mode
/// validation always accepts it — passing an id here can never turn a workflow
/// session-open into a `ModeUnsupported` failure for those kinds.
///
/// **Extension point.** To bring a new harness under the always-bypass policy,
/// map its kind to the catalog `mode` value that grants unattended (no
/// approval prompt) execution. Returning `None` keeps the run correct via the
/// auto-approve safety net ([`WorkflowAutoApproveAdvisor`]) — it just relies on
/// the net rather than a native mode.
///
/// NOTE: for codex, `full-access` also lifts the sandbox (fs + network), not
/// only the approval prompt; that breadth is intended by the locked
/// always-bypass decision.
pub fn bypass_mode_for_kind(agent_kind: &str) -> Option<&'static str> {
    match agent_kind {
        "claude" => Some("bypassPermissions"),
        "codex" => Some("full-access"),
        _ => None,
    }
}

/// The set of session ids the workflow executor opened. Shared behind `Arc`
/// between the executor (which marks ids as it opens/rehydrates sessions) and
/// the inbound permission advisor (which auto-approves for them).
///
/// In-memory and grow-only for the runtime's lifetime. Entries are workflow
/// session UUIDs (never reused), so a stale entry can never mis-classify a
/// later session; the executor re-marks its sessions on crash-resume
/// (`hydrate_from_run`), so the net survives a restart.
#[derive(Default)]
pub struct WorkflowOwnedSessions {
    ids: RwLock<HashSet<String>>,
}

impl WorkflowOwnedSessions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark a session as workflow-owned (idempotent).
    pub fn mark(&self, session_id: &str) {
        self.ids.write().unwrap().insert(session_id.to_string());
    }

    /// Is this session workflow-owned?
    pub fn is_owned(&self, session_id: &str) -> bool {
        self.ids.read().unwrap().contains(session_id)
    }
}

/// Composite [`PermissionAdvisor`]: for a workflow-owned session it
/// auto-approves the request (the always-bypass safety net); otherwise it
/// delegates to `inner` (the plan advisor), leaving all non-workflow sessions
/// exactly as they were.
pub struct WorkflowAutoApproveAdvisor {
    owned: Arc<WorkflowOwnedSessions>,
    inner: Arc<dyn PermissionAdvisor>,
}

impl WorkflowAutoApproveAdvisor {
    pub fn new(owned: Arc<WorkflowOwnedSessions>, inner: Arc<dyn PermissionAdvisor>) -> Self {
        Self { owned, inner }
    }
}

impl PermissionAdvisor for WorkflowAutoApproveAdvisor {
    fn advise(
        &self,
        ctx: &SessionObserverContext,
        q: &PermissionQuestionView<'_>,
    ) -> PermissionAdvice {
        if !self.owned.is_owned(&ctx.session_id) {
            return self.inner.advise(ctx, q);
        }
        let selected_option_id = auto_approve_option_id(q.options);
        tracing::info!(
            target: "workflow.autoapprove",
            session_id = %ctx.session_id,
            workspace_id = %ctx.workspace_id,
            agent_kind = %ctx.agent_kind,
            tool_call_id = ?q.tool_call_id,
            selected_option_id = ?selected_option_id,
            "workflow-owned session: auto-approving permission request (bypass-equivalent exec policy)"
        );
        PermissionAdvice::Predecided {
            selected_option_id,
            persisted_events: Vec::new(),
        }
    }
}

/// The option id that grants the requested action, for an auto-approval.
///
/// Reuses the shared allow/deny classifier ([`permission_option_mappings`]):
/// it prefers an allow-once/allow-always (or "approve"/"allow"/… text) option.
/// `None` — answered `Cancelled` — happens only when the request carries no
/// allow option at all; that still unblocks the turn rather than stalling it.
fn auto_approve_option_id(options: &[acp::schema::PermissionOption]) -> Option<String> {
    permission_option_mappings(&permission_options(options))
        .get("approve")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::{PermissionOption, PermissionOptionKind};
    use std::sync::Mutex;

    // --- bypass_mode_for_kind -------------------------------------------

    #[test]
    fn goal_capable_harnesses_map_to_their_catalog_bypass_mode() {
        assert_eq!(bypass_mode_for_kind("claude"), Some("bypassPermissions"));
        assert_eq!(bypass_mode_for_kind("codex"), Some("full-access"));
    }

    #[test]
    fn unknown_harness_has_no_native_bypass_mode() {
        assert_eq!(bypass_mode_for_kind("gemini"), None);
        assert_eq!(bypass_mode_for_kind(""), None);
        assert_eq!(bypass_mode_for_kind("cursor"), None);
    }

    // --- WorkflowOwnedSessions ------------------------------------------

    #[test]
    fn owned_registry_marks_and_reports_membership() {
        let owned = WorkflowOwnedSessions::new();
        assert!(!owned.is_owned("s1"));
        owned.mark("s1");
        owned.mark("s1"); // idempotent
        assert!(owned.is_owned("s1"));
        assert!(!owned.is_owned("s2"));
    }

    // --- auto_approve_option_id -----------------------------------------

    fn option(id: &str, kind: PermissionOptionKind) -> PermissionOption {
        PermissionOption::new(id.to_string(), id.to_string(), kind)
    }

    #[test]
    fn auto_approve_picks_the_allow_option() {
        let options = vec![
            option("deny", PermissionOptionKind::RejectOnce),
            option("allow", PermissionOptionKind::AllowOnce),
        ];
        assert_eq!(auto_approve_option_id(&options).as_deref(), Some("allow"));
    }

    #[test]
    fn auto_approve_is_none_when_no_allow_option_exists() {
        let options = vec![option("deny", PermissionOptionKind::RejectOnce)];
        assert_eq!(auto_approve_option_id(&options), None);
    }

    // --- WorkflowAutoApproveAdvisor -------------------------------------

    /// Records whether the inner advisor was consulted.
    struct SpyAdvisor {
        consulted: Mutex<bool>,
    }

    impl PermissionAdvisor for SpyAdvisor {
        fn advise(
            &self,
            _ctx: &SessionObserverContext,
            _q: &PermissionQuestionView<'_>,
        ) -> PermissionAdvice {
            *self.consulted.lock().unwrap() = true;
            PermissionAdvice::Park {
                pending_interaction: None,
            }
        }
    }

    fn ctx(session_id: &str) -> SessionObserverContext {
        SessionObserverContext {
            session_id: session_id.to_string(),
            workspace_id: "ws-1".to_string(),
            agent_kind: "gemini".to_string(),
            turn_id: None,
            next_seq: 0,
        }
    }

    #[test]
    fn workflow_owned_session_is_auto_approved_without_consulting_inner() {
        let owned = Arc::new(WorkflowOwnedSessions::new());
        owned.mark("wf-sess");
        let inner = Arc::new(SpyAdvisor {
            consulted: Mutex::new(false),
        });
        let advisor = WorkflowAutoApproveAdvisor::new(owned, inner.clone());

        let options = vec![option("allow", PermissionOptionKind::AllowOnce)];
        let question = PermissionQuestionView {
            session_id: "wf-sess",
            request_id: "req-1",
            tool_call_id: Some("tc-1"),
            options: &options,
        };

        match advisor.advise(&ctx("wf-sess"), &question) {
            PermissionAdvice::Predecided {
                selected_option_id,
                persisted_events,
            } => {
                assert_eq!(selected_option_id.as_deref(), Some("allow"));
                assert!(persisted_events.is_empty());
            }
            PermissionAdvice::Park { .. } => panic!("workflow-owned session must be predecided"),
        }
        assert!(
            !*inner.consulted.lock().unwrap(),
            "inner advisor must not be consulted for a workflow-owned session"
        );
    }

    #[test]
    fn non_workflow_session_delegates_to_inner() {
        let owned = Arc::new(WorkflowOwnedSessions::new());
        let inner = Arc::new(SpyAdvisor {
            consulted: Mutex::new(false),
        });
        let advisor = WorkflowAutoApproveAdvisor::new(owned, inner.clone());

        let options = vec![option("allow", PermissionOptionKind::AllowOnce)];
        let question = PermissionQuestionView {
            session_id: "human-sess",
            request_id: "req-1",
            tool_call_id: Some("tc-1"),
            options: &options,
        };

        match advisor.advise(&ctx("human-sess"), &question) {
            PermissionAdvice::Park { .. } => {}
            PermissionAdvice::Predecided { .. } => {
                panic!("non-workflow session must fall through to the inner advisor")
            }
        }
        assert!(
            *inner.consulted.lock().unwrap(),
            "inner advisor must be consulted for a non-workflow session"
        );
    }
}
