//! Session mutation admission (spec 2b "Workflow Session Mutation Admission"):
//! one transient keyed async gate per session id serializing
//! execution-affecting mutations, plus a pluggable controller policy that
//! decides whether a mutation source is admitted while a controller owns the
//! session.
//!
//! Ownership boundaries (frozen): Sessions owns the gate/permit mechanics and
//! the policy trait; the Workflows domain implements the durable controller
//! lookup; `app/` injects it. Session core never imports the Workflows domain.
//!
//! Locking contract (frozen): the canonical combined order is always
//! `workflow run gate -> session mutation permit`; no caller acquires them in
//! reverse. The permit is NOT reentrant — nested session use cases must use
//! crate-private permit-aware helpers instead of re-acquiring.
//!
//! Operation-gate ordering (PR1227-LOCK-01): the frozen spec fixes only the
//! run-gate/permit pair and is SILENT on the permit vs. the per-workspace
//! `WorkspaceOperationGate` RwLock (`acquire_shared` = read, `acquire_exclusive`
//! and the exclusive session lease = write). Because fork/plan/review/retire/
//! purge/mobility handlers hold BOTH the permit and an operation lease at once,
//! a single documented order is mandatory to avoid an ABBA deadlock: the
//! session mutation permit is ALWAYS acquired BEFORE any workspace operation
//! lease (shared or exclusive), never in reverse. The full canonical order is
//! therefore `workflow run gate -> session mutation permit -> workspace
//! operation lease`; every handler holding both must take the permit outermost.
//!
//! Workspace-destruction fence (PR1227-WORKSPACE-FENCE-01): the workspace-wide
//! destructive paths (`purge_workspace`, `retire_workspace`) admit the CURRENT
//! session set up front, but a controller-owned creator holding only the SHARED
//! `SessionStart` lease can create and bind a fresh preselected session whose
//! brand-new UUID is absent from the destructive path's snapshot, so its keyed
//! permit is never acquired. To keep
//! the fail-closed contract, each destructive path RE-ENUMERATES the workspace
//! session set AFTER it holds the EXCLUSIVE workspace lease and conflicts (409)
//! if any session is controlled by a nonterminal workflow
//! ([`SessionMutationAdmission::find_workflow_controlled_session`]). The
//! exclusive lease is mutually exclusive with the shared `SessionStart` lease,
//! so no new controlled session can materialize while the re-check runs. The
//! re-check is a PURE read-only controller-policy lookup — it acquires neither a
//! permit nor a workspace lease — so it adds no edge to the lock order above and
//! cannot introduce an ABBA cycle. (The executor's `SessionStart -> fresh
//! permit` order is not the reverse of canonical in any deadlock-relevant sense:
//! the fresh preselected id is structurally uncontended, so no party ever holds
//! a workspace lease while waiting on that permit.)
//!
//! Admitted-set fail-closed (PR1227-WORKSPACE-FENCE-02): the nonterminal-only
//! re-check above ([`SessionMutationAdmission::find_workflow_controlled_session`]) is NOT sufficient on
//! its own. Consider the bind->terminalize race: the workflow executor binds a
//! FRESH session (absent from the up-front admission snapshot, so no permit is
//! held for it) AFTER the snapshot, and its controlling run then TERMINALIZES
//! before the destructive path takes the exclusive lease. At re-check time that
//! session has no NONTERMINAL controller — `controlling_run_id` returns `None`
//! for it because the run's status is now terminal (`find_active_controller_run`
//! filters `status NOT IN (completed, failed, cancelled, interrupted)`) — so
//! FENCE-01 lets it through, yet the destructive path never admitted it (never
//! held its permit). To close this, each destructive admission path (purge,
//! retire) ALSO carries the SET of session ids it originally admitted (the ids
//! `admit_all_workspace_sessions` snapshotted and holds permits for) into the
//! under-lease re-check and FAILS CLOSED (the same stable 409) if ANY session
//! id re-enumerated under the exclusive lease is NOT in that admitted set —
//! EVEN IF its workflow already terminalized. FENCE-01 is still kept in
//! ADDITION: it catches control ACQUIRED post-snapshot on an EXISTING admitted
//! session (the retire race), which the set-membership check alone would miss
//! because that session IS in the admitted set. The set-membership check is a
//! PURE in-memory comparison over ids enumerated under the ALREADY-HELD
//! exclusive lease: it acquires no permit and no lease, so it adds no edge to
//! the canonical `run gate -> permit -> operation lease` order.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, Weak};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// Who is asking to mutate a session's execution state.
///
/// The trusted workflow source is constructible only by crate code
/// ([`SessionMutationSource::workflow_run`] is `pub(crate)`): it is never
/// parsed from a request body, header, query, origin/provenance field, or any
/// caller metadata.
#[derive(Debug, Clone)]
pub struct SessionMutationSource(SourceInner);

#[derive(Debug, Clone)]
enum SourceInner {
    External,
    /// No production producer since gen-1 workflows was superseded; the
    /// admission conflict mechanics stay proven by test-installed policies.
    #[allow(dead_code)]
    WorkflowRun { run_id: String },
}

impl SessionMutationSource {
    /// Any caller outside the owning workflow: HTTP routes, product surfaces,
    /// maintenance paths.
    pub fn external() -> Self {
        Self(SourceInner::External)
    }

    /// The owning workflow's own mutation authority (ruling 3: includes the
    /// crate-private exact-active-turn live cancel).
    #[cfg(test)]
    pub(crate) fn workflow_run(run_id: &str) -> Self {
        Self(SourceInner::WorkflowRun {
            run_id: run_id.to_string(),
        })
    }

    fn run_id(&self) -> Option<&str> {
        match &self.0 {
            SourceInner::External => None,
            SourceInner::WorkflowRun { run_id } => Some(run_id),
        }
    }
}

/// The execution-affecting mutation categories from the frozen inventory.
/// Every admission call names one so the static ratchet can enumerate hooks
/// and conflict logs stay classified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMutationKind {
    Prompt,
    PendingPromptQueue,
    Config,
    Cancel,
    Close,
    Dismiss,
    Restore,
    Resume,
    Fork,
    InteractionResolution,
    Goal,
    Loop,
    Plan,
    Review,
    SubagentWake,
    ReplayAdvance,
    WorkspacePurge,
    /// Read-consistency fence for a mobility archive snapshot.
    MobilitySnapshot,
    /// Destructive source teardown after a mobility handoff.
    MobilityTeardown,
    /// Reversible relationship close; allowed to repeat while already Closed.
    SubagentClose,
    /// The sole ordinary mutation admitted while a subagent is Closed.
    SubagentOpen,
    /// Relationship deletion/promotion; Closed targets are rejected.
    SubagentPromote,
    /// Creation of a child relationship; admitted on the parent session so a
    /// terminal parent transition cannot race the atomic child+link insert.
    SubagentCreate,
    /// The owning workflow's terminal run+step CAS (completion, failure,
    /// cancellation) — always a trusted source; named so conflict logs and
    /// the ratchet classify it.
    WorkflowTerminal,
}

impl SessionMutationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::PendingPromptQueue => "pending_prompt_queue",
            Self::Config => "config",
            Self::Cancel => "cancel",
            Self::Close => "close",
            Self::Dismiss => "dismiss",
            Self::Restore => "restore",
            Self::Resume => "resume",
            Self::Fork => "fork",
            Self::InteractionResolution => "interaction_resolution",
            Self::Goal => "goal",
            Self::Loop => "loop",
            Self::Plan => "plan",
            Self::Review => "review",
            Self::SubagentWake => "subagent_wake",
            Self::ReplayAdvance => "replay_advance",
            Self::WorkspacePurge => "workspace_purge",
            Self::MobilitySnapshot => "mobility_snapshot",
            Self::MobilityTeardown => "mobility_teardown",
            Self::SubagentClose => "subagent_close",
            Self::SubagentOpen => "subagent_open",
            Self::SubagentPromote => "subagent_promote",
            Self::SubagentCreate => "subagent_create",
            Self::WorkflowTerminal => "workflow_terminal",
        }
    }
}

/// Durable controller lookup, implemented by the Workflows domain and
/// injected by `app/`. Synchronous SQLite work: admission runs it on the
/// blocking pool.
pub trait SessionControllerPolicy: Send + Sync {
    /// The run id of the NONTERMINAL workflow controlling `session_id`, if
    /// any. `None` means ordinary session behavior applies.
    fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>>;
}

/// Dynamic relationship-state lookup for the same keyed mutation gate. The
/// implementation is injected by composition so admission does not import a
/// relationship store.
pub trait SessionOperabilityPolicy: Send + Sync {
    fn is_reversibly_closed_subagent(&self, session_id: &str) -> anyhow::Result<bool>;
}

/// Test-only fixture. Production construction must inject a real durable
/// operability lookup; there is deliberately no permissive app default.
#[cfg(test)]
pub struct AllSessionsOperable;

#[cfg(test)]
impl SessionOperabilityPolicy for AllSessionsOperable {
    fn is_reversibly_closed_subagent(&self, _session_id: &str) -> anyhow::Result<bool> {
        Ok(false)
    }
}

/// A policy admitting everything for controller ownership. Production app
/// wiring replaces it with the workflows-owned durable lookup.
pub struct NoControllerPolicy;

impl SessionControllerPolicy for NoControllerPolicy {
    fn controlling_run_id(&self, _session_id: &str) -> anyhow::Result<Option<String>> {
        Ok(None)
    }
}

/// Why an admission request did not yield a permit.
#[derive(Debug)]
pub enum SessionMutationConflict {
    /// A nonterminal workflow controls this session; carries its run id for
    /// logging (never for the wire body).
    ControlledByWorkflow { run_id: String },
    /// The target is a current subagent whose reversible operability marker is
    /// Closed. Only Open, repeated subagent Close, and workspace teardown may
    /// cross this gate.
    SubagentOpenRequired,
    /// Policy lookup infrastructure failed; callers surface their generic
    /// storage error, never a fabricated admission.
    Internal(anyhow::Error),
}

/// A held admission permit. Holding it serializes every other
/// execution-affecting mutation on the same session id; dropping it releases
/// the gate. There is no policy state to release — the permit is purely the
/// keyed lock plus the proof that policy admitted this source while it was
/// held.
pub struct SessionMutationPermit {
    _guard: OwnedMutexGuard<()>,
}

/// The keyed admission gate. Slots are transient (weak): a session id with no
/// holder costs nothing durable, exactly like the workflow run gates.
pub struct SessionMutationAdmission {
    slots: StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    policy: Arc<dyn SessionControllerPolicy>,
    operability_policy: Arc<dyn SessionOperabilityPolicy>,
}

impl SessionMutationAdmission {
    pub fn new(
        policy: Arc<dyn SessionControllerPolicy>,
        operability_policy: Arc<dyn SessionOperabilityPolicy>,
    ) -> Self {
        Self {
            slots: StdMutex::new(HashMap::new()),
            policy,
            operability_policy,
        }
    }

    fn slot(&self, session_id: &str) -> anyhow::Result<Arc<AsyncMutex<()>>> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| anyhow::anyhow!("session admission gate lock poisoned"))?;
        slots.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = slots.get(session_id).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        let gate = Arc::new(AsyncMutex::new(()));
        slots.insert(session_id.to_string(), Arc::downgrade(&gate));
        Ok(gate)
    }

    /// Wait for the session's gate, then decide under the held gate: no
    /// controller or a matching workflow source is admitted (permit returned,
    /// still held); a foreign source under an active controller conflicts
    /// before any side effect. Callers hold the permit across their mutation's
    /// side effects.
    pub async fn acquire(
        &self,
        session_id: &str,
        kind: SessionMutationKind,
        source: &SessionMutationSource,
    ) -> Result<SessionMutationPermit, SessionMutationConflict> {
        let gate = self
            .slot(session_id)
            .map_err(SessionMutationConflict::Internal)?;
        let guard = gate.lock_owned().await;

        let policy = self.policy.clone();
        let operability_policy = self.operability_policy.clone();
        let lookup_session_id = session_id.to_string();
        let (controlling, reversibly_closed) = tokio::task::spawn_blocking(move || {
            Ok::<_, anyhow::Error>((
                policy.controlling_run_id(&lookup_session_id)?,
                operability_policy.is_reversibly_closed_subagent(&lookup_session_id)?,
            ))
        })
        .await
        .map_err(|error| SessionMutationConflict::Internal(error.into()))?
        .map_err(SessionMutationConflict::Internal)?;

        match controlling {
            None => {}
            Some(run_id) => {
                if source.run_id() == Some(run_id.as_str()) {
                    // Continue to the independent relationship operability
                    // policy; controller ownership does not open a subagent.
                } else {
                    tracing::info!(
                        session_id = %session_id,
                        mutation_kind = kind.as_str(),
                        controlling_run_id = %run_id,
                        "session mutation rejected: session is controlled by a workflow"
                    );
                    return Err(SessionMutationConflict::ControlledByWorkflow { run_id });
                }
            }
        }

        if reversibly_closed
            && !matches!(
                kind,
                SessionMutationKind::SubagentOpen
                    | SessionMutationKind::SubagentClose
                    | SessionMutationKind::WorkspacePurge
                    | SessionMutationKind::MobilitySnapshot
                    | SessionMutationKind::MobilityTeardown
            )
        {
            tracing::info!(
                session_id = %session_id,
                mutation_kind = kind.as_str(),
                "session mutation rejected: subagent must be opened"
            );
            return Err(SessionMutationConflict::SubagentOpenRequired);
        }

        Ok(SessionMutationPermit { _guard: guard })
    }

    /// PR1227-WORKSPACE-FENCE-01: the workspace-destruction re-check. Given the
    /// session ids enumerated UNDER the exclusive workspace lease, return the
    /// first that a nonterminal workflow controls (with the controlling run id
    /// for logging), or `None` if every session is free of an active workflow
    /// controller.
    ///
    /// This performs ONLY the read-only controller-policy lookup — it acquires
    /// neither a keyed permit nor any workspace lease — so it introduces no edge
    /// to the canonical `run gate -> permit -> operation lease` order and cannot
    /// deadlock. Correctness against the creation race depends entirely on the
    /// caller already holding the EXCLUSIVE workspace lease (which excludes the
    /// shared `SessionStart` lease every workflow session creation must hold):
    /// no new controlled session can bind while this runs.
    pub async fn find_workflow_controlled_session(
        &self,
        session_ids: Vec<String>,
    ) -> anyhow::Result<Option<(String, String)>> {
        let policy = self.policy.clone();
        tokio::task::spawn_blocking(move || {
            for session_id in session_ids {
                if let Some(run_id) = policy.controlling_run_id(&session_id)? {
                    return Ok(Some((session_id, run_id)));
                }
            }
            Ok(None)
        })
        .await
        .map_err(|error| anyhow::anyhow!("controlled-session re-check task failed: {error}"))?
    }

}
