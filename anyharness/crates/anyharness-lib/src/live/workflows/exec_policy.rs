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

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock, Weak};

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

/// The registry of sessions a workflow run currently owns, keyed by session id
/// to the owning run id. Shared behind `Arc` between the executor (which marks
/// ids as it opens/rehydrates/binds sessions), the inbound permission advisor
/// (which auto-approves for owned sessions — the always-bypass net), and the
/// session runtime (which rejects mutating verbs on a held session — C13 L17
/// lockout). The run row is the durable lock (contract §2.3); this registry is
/// an in-memory cache of it, hydrated on boot from non-terminal runs' session
/// maps and re-armed on crash-resume (`hydrate_from_run`).
///
/// Ownership + hold are the SAME condition (E8 "block everything"): a session
/// appears here iff a non-terminal run owns it. **Release** is derived from the
/// run going terminal (C13 / D15 / addendum item 3–4): [`release_run`] drops
/// every entry for the run — which simultaneously (a) unmarks the always-bypass
/// net (item 3: a demoted interactive session must stop being auto-approved) and
/// (b) unlocks the session (C13: held-ness is derived, no per-session write).
/// No session is ever closed at release (item 4: keep alive, demote).
///
/// A `released` set records run ids that have gone terminal so a late
/// `hydrate_from_run` (crash-resume racing a terminal write) can never resurrect
/// a released id (addendum item 3).
#[derive(Default)]
struct WorkflowOwnershipState {
    /// session_id -> owning run_id.
    ids: HashMap<String, String>,
    /// Run ids that reached terminal; acquisition never re-arms these.
    released: HashSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowSessionAcquireError {
    TransitionMismatch,
    RunReleased,
    HeldByOther { run_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowSessionAcquisition {
    Acquired,
    AlreadyOwned,
}

/// Opaque proof that this task owns the session's launch/hold transition gate.
/// The workflow executor holds it from ownership acquisition through actor
/// quiesce/relaunch; public resume holds the same gate from authorization
/// through live-handle reuse or process launch.
pub(crate) struct SessionProcessTransitionGuard {
    session_id: String,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

impl SessionProcessTransitionGuard {
    pub(crate) fn matches(&self, session_id: &str) -> bool {
        self.session_id == session_id
    }
}

#[derive(Default)]
pub struct WorkflowOwnedSessions {
    /// Ownership and release tombstones share one lock. This makes acquire,
    /// release, and rollback linearizable: no check-then-write can resurrect a
    /// terminal run or silently steal a session from another run.
    state: RwLock<WorkflowOwnershipState>,
    transition_gates: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
}

impl WorkflowOwnedSessions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Atomically acquire a session for a run. Same-run acquisition is
    /// idempotent; released runs and cross-run ownership are explicit errors.
    pub(crate) fn try_acquire(
        &self,
        transition: &SessionProcessTransitionGuard,
        session_id: &str,
        run_id: &str,
    ) -> Result<WorkflowSessionAcquisition, WorkflowSessionAcquireError> {
        if !transition.matches(session_id) {
            return Err(WorkflowSessionAcquireError::TransitionMismatch);
        }
        let mut state = self.state.write().unwrap();
        if state.released.contains(run_id) {
            return Err(WorkflowSessionAcquireError::RunReleased);
        }
        match state.ids.get(session_id) {
            Some(owner) if owner == run_id => Ok(WorkflowSessionAcquisition::AlreadyOwned),
            Some(owner) => Err(WorkflowSessionAcquireError::HeldByOther {
                run_id: owner.clone(),
            }),
            None => {
                state.ids.insert(session_id.to_string(), run_id.to_string());
                Ok(WorkflowSessionAcquisition::Acquired)
            }
        }
    }

    pub(crate) async fn lock_process_transition(
        &self,
        session_id: &str,
    ) -> SessionProcessTransitionGuard {
        let gate = {
            let mut gates = self.transition_gates.lock().unwrap();
            let gate = gates
                .get(session_id)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(tokio::sync::Mutex::new(())));
            gates.insert(session_id.to_string(), Arc::downgrade(&gate));
            gate
        };
        SessionProcessTransitionGuard {
            session_id: session_id.to_string(),
            _guard: gate.lock_owned().await,
        }
    }

    /// Is this session workflow-owned? (The always-bypass advisor's question.)
    pub fn is_owned(&self, session_id: &str) -> bool {
        self.state.read().unwrap().ids.contains_key(session_id)
    }

    /// The run holding this session, if any — the lockout guard's question
    /// (C13). `Some(run_id)` means every mutating verb is blocked and routes to
    /// the take-over modal (E8).
    pub fn held_run(&self, session_id: &str) -> Option<String> {
        self.state.read().unwrap().ids.get(session_id).cloned()
    }

    /// Every live ownership-cache entry for one run, including a prepared
    /// session whose durable slot write failed. Terminal quiescence uses this
    /// superset of the run-row session map so prepared bindings cannot become
    /// unreachable before cleanup.
    pub(crate) fn session_ids_for_run(&self, run_id: &str) -> Vec<String> {
        let mut session_ids = self
            .state
            .read()
            .unwrap()
            .ids
            .iter()
            .filter(|(_, owner)| owner.as_str() == run_id)
            .map(|(session_id, _)| session_id.clone())
            .collect::<Vec<_>>();
        session_ids.sort();
        session_ids
    }

    /// Roll back one not-yet-durably-registered session preparation. This does
    /// not mark the run released; other successfully registered slots remain
    /// owned until normal terminal cleanup.
    pub(crate) fn unmark_prepared(
        &self,
        transition: &SessionProcessTransitionGuard,
        session_id: &str,
        run_id: &str,
    ) -> Result<(), WorkflowSessionAcquireError> {
        if !transition.matches(session_id) {
            return Err(WorkflowSessionAcquireError::TransitionMismatch);
        }
        let mut state = self.state.write().unwrap();
        if state
            .ids
            .get(session_id)
            .is_some_and(|owner| owner == run_id)
        {
            state.ids.remove(session_id);
        }
        Ok(())
    }

    /// Release every session the run owned (terminal / take-over). Derived
    /// unlock (C13) + bypass unmark (item 3): drops the entries and records the
    /// run as released so a racing re-hydration can't re-arm them. Returns the
    /// released session ids so the caller can restore their worker gateway
    /// binding (addendum item 2) and demote them (item 4). Never closes a
    /// session.
    pub fn release_run(&self, run_id: &str) -> Vec<String> {
        let mut state = self.state.write().unwrap();
        state.released.insert(run_id.to_string());
        let released: Vec<String> = state
            .ids
            .iter()
            .filter(|(_, owner)| owner.as_str() == run_id)
            .map(|(session_id, _)| session_id.clone())
            .collect();
        for session_id in &released {
            state.ids.remove(session_id);
        }
        released
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

    async fn acquire(
        owned: &WorkflowOwnedSessions,
        session_id: &str,
        run_id: &str,
    ) -> Result<WorkflowSessionAcquisition, WorkflowSessionAcquireError> {
        let transition = owned.lock_process_transition(session_id).await;
        owned.try_acquire(&transition, session_id, run_id)
    }

    #[tokio::test]
    async fn owned_registry_marks_and_reports_membership() {
        let owned = WorkflowOwnedSessions::new();
        assert!(!owned.is_owned("s1"));
        assert_eq!(
            acquire(&owned, "s1", "run-1").await,
            Ok(WorkflowSessionAcquisition::Acquired)
        );
        assert_eq!(
            acquire(&owned, "s1", "run-1").await,
            Ok(WorkflowSessionAcquisition::AlreadyOwned)
        );
        assert!(owned.is_owned("s1"));
        assert_eq!(owned.held_run("s1").as_deref(), Some("run-1"));
        assert!(!owned.is_owned("s2"));
        assert!(owned.held_run("s2").is_none());
    }

    #[tokio::test]
    async fn release_run_unmarks_every_session_and_returns_them() {
        let owned = WorkflowOwnedSessions::new();
        acquire(&owned, "s1", "run-1").await.unwrap();
        acquire(&owned, "s2", "run-1").await.unwrap();
        acquire(&owned, "s3", "run-2").await.unwrap();
        let mut released = owned.release_run("run-1");
        released.sort();
        assert_eq!(released, vec!["s1".to_string(), "s2".to_string()]);
        // run-1's sessions are unmarked (bypass off + unlocked); run-2 untouched.
        assert!(!owned.is_owned("s1"));
        assert!(owned.held_run("s1").is_none());
        assert!(!owned.is_owned("s2"));
        assert!(owned.is_owned("s3"));
        assert_eq!(owned.held_run("s3").as_deref(), Some("run-2"));
    }

    #[tokio::test]
    async fn mark_after_release_does_not_resurrect_a_demoted_session() {
        // addendum item 3: a crash-resume re-hydration racing a terminal write
        // must not re-arm a released run's sessions.
        let owned = WorkflowOwnedSessions::new();
        acquire(&owned, "s1", "run-1").await.unwrap();
        owned.release_run("run-1");
        assert_eq!(
            acquire(&owned, "s1", "run-1").await,
            Err(WorkflowSessionAcquireError::RunReleased)
        );
        assert!(!owned.is_owned("s1"));
        assert!(owned.held_run("s1").is_none());
    }

    #[tokio::test]
    async fn concurrent_release_and_reacquire_cannot_resurrect_terminal_run() {
        let owned = Arc::new(WorkflowOwnedSessions::new());
        acquire(&owned, "s1", "run-1").await.unwrap();
        let barrier = Arc::new(tokio::sync::Barrier::new(3));

        let acquire = {
            let owned = owned.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                acquire(&owned, "s1", "run-1").await
            })
        };
        let release = {
            let owned = owned.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                owned.release_run("run-1")
            })
        };
        barrier.wait().await;
        let acquisition = acquire.await.expect("acquire task");
        release.await.expect("release task");

        assert!(matches!(
            acquisition,
            Ok(WorkflowSessionAcquisition::AlreadyOwned)
                | Err(WorkflowSessionAcquireError::RunReleased)
        ));
        assert!(owned.held_run("s1").is_none());
    }

    #[tokio::test]
    async fn concurrent_runs_cannot_both_acquire_same_session() {
        let owned = Arc::new(WorkflowOwnedSessions::new());
        let barrier = Arc::new(tokio::sync::Barrier::new(3));
        let spawn = |run_id: &'static str| {
            let owned = owned.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                (run_id, acquire(&owned, "s1", run_id).await)
            })
        };
        let first = spawn("run-1");
        let second = spawn("run-2");
        barrier.wait().await;
        let outcomes = [
            first.await.expect("first acquire task"),
            second.await.expect("second acquire task"),
        ];

        assert_eq!(
            outcomes
                .iter()
                .filter(|(_, result)| {
                    matches!(result, Ok(WorkflowSessionAcquisition::Acquired))
                })
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|(_, result)| {
                    matches!(result, Err(WorkflowSessionAcquireError::HeldByOther { .. }))
                })
                .count(),
            1
        );
        let owner = owned.held_run("s1").expect("one owner");
        assert!(owner == "run-1" || owner == "run-2");
    }

    #[tokio::test]
    async fn rollback_transition_serializes_concurrent_preparation() {
        let owned = Arc::new(WorkflowOwnedSessions::new());
        let rollback_transition = owned.lock_process_transition("s1").await;
        owned
            .try_acquire(&rollback_transition, "s1", "run-1")
            .unwrap();
        let (attempted_tx, attempted_rx) = tokio::sync::oneshot::channel();
        let prepare = {
            let owned = owned.clone();
            tokio::spawn(async move {
                attempted_tx.send(()).expect("signal prepare attempt");
                let transition = owned.lock_process_transition("s1").await;
                owned.try_acquire(&transition, "s1", "run-1")
            })
        };
        attempted_rx.await.expect("prepare attempted");

        // Rollback performs revoke/quiesce/restore before this conditional
        // unmark while retaining the transition. The competing preparation
        // cannot observe or alter the session in the middle.
        owned
            .unmark_prepared(&rollback_transition, "s1", "run-1")
            .unwrap();
        drop(rollback_transition);
        assert_eq!(
            prepare.await.expect("prepare task"),
            Ok(WorkflowSessionAcquisition::Acquired)
        );
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

    #[tokio::test]
    async fn workflow_owned_session_is_auto_approved_without_consulting_inner() {
        let owned = Arc::new(WorkflowOwnedSessions::new());
        acquire(&owned, "wf-sess", "run-1").await.unwrap();
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
