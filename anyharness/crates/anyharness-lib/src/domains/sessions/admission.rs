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
//! session set up front, but the workflow executor holds only the SHARED
//! `SessionStart` lease when it creates and binds a fresh preselected session
//! (`execution.rs`: `acquire_shared(SessionStart) -> reserve_new_session ->
//! bind_session`). That session id is a brand-new UUID absent from the
//! destructive path's snapshot, so its keyed permit is never acquired. To keep
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
    WorkspaceRetire,
    Mobility,
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
            Self::WorkspaceRetire => "workspace_retire",
            Self::Mobility => "mobility",
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

/// A policy admitting everything — the app default until workflow wiring
/// installs the real controller lookup, and the fixture for ordinary-session
/// tests.
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
}

impl SessionMutationAdmission {
    pub fn new(policy: Arc<dyn SessionControllerPolicy>) -> Self {
        Self {
            slots: StdMutex::new(HashMap::new()),
            policy,
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
        let lookup_session_id = session_id.to_string();
        let controlling =
            tokio::task::spawn_blocking(move || policy.controlling_run_id(&lookup_session_id))
                .await
                .map_err(|error| SessionMutationConflict::Internal(error.into()))?
                .map_err(SessionMutationConflict::Internal)?;

        match controlling {
            None => Ok(SessionMutationPermit { _guard: guard }),
            Some(run_id) => {
                if source.run_id() == Some(run_id.as_str()) {
                    return Ok(SessionMutationPermit { _guard: guard });
                }
                tracing::info!(
                    session_id = %session_id,
                    mutation_kind = kind.as_str(),
                    controlling_run_id = %run_id,
                    "session mutation rejected: session is controlled by a workflow"
                );
                Err(SessionMutationConflict::ControlledByWorkflow { run_id })
            }
        }
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

    /// Reserve a NEW session id's gate before its row becomes visible
    /// (ruling 1). No policy lookup: there is no durable row yet, and the
    /// caller is by construction the creator. The returned permit is held
    /// through durable creation and controller binding; foreign callers
    /// arriving meanwhile wait on this same gate and then observe the
    /// controller.
    ///
    /// PR1227-ADMISSION-01: this bypasses the controller-policy lookup, which
    /// is sound ONLY for a fresh preselected id whose owner is the workflow
    /// executor. Both the visibility (`pub(crate)`) and the source guard lock
    /// the fresh-id contract at the type boundary — the sole caller is the
    /// workflow executor (the Workflows domain's `execution` module), and an
    /// External source here is a programming error, never a runtime-reachable
    /// state.
    pub(crate) async fn reserve_new_session(
        &self,
        session_id: &str,
        source: &SessionMutationSource,
    ) -> Result<SessionMutationPermit, SessionMutationConflict> {
        debug_assert!(
            matches!(source.0, SourceInner::WorkflowRun { .. }),
            "reserve_new_session bypasses controller policy and is only sound \
             for the workflow executor's preselected id; source must be a \
             trusted WorkflowRun, never External"
        );
        let gate = self
            .slot(session_id)
            .map_err(SessionMutationConflict::Internal)?;
        let guard = gate.lock_owned().await;
        Ok(SessionMutationPermit { _guard: guard })
    }
}
