//! The read half of `ModelSnapshotService`: the document and the polled status
//! surface.
//!
//! A second `impl` block in its own file, because reads are available in READ-ONLY
//! mode too — serving is not probing — and keeping them beside the reconciler
//! invited the assumption that they share its ownership gate. They do not.

use chrono::{DateTime, Utc};

use super::document::{self, read_document, ModelSnapshotDocument};
use super::trial::Tier1TrialResult;
use super::{status, ModelSnapshotService};
use crate::domains::agents::auth_state::{AuthRuntimeInputs, ProbeLifecycle, ProbePhase};

impl ModelSnapshotService {
    // -----------------------------------------------------------------------
    // Reads. Available in read-only mode too — serving is not probing.
    // -----------------------------------------------------------------------

    pub fn document(&self, harness_kind: &str) -> Option<ModelSnapshotDocument> {
        read_document(&self.runtime_home, harness_kind)
    }

    /// The polled status surface for one harness (model-catalog.md, "Runtime
    /// routes"). `state` and the engine mode are live in-memory facts; everything
    /// else is read off the document, so a restart shows correct history with
    /// `state: "idle"`.
    pub fn status(&self, harness_kind: &str, now: DateTime<Utc>) -> status::ModelSnapshotStatus {
        let (live_state, next_attempt_at) = self.live_state(harness_kind, now);
        status::project_status(status::StatusInputs {
            agent: harness_kind.to_string(),
            schema_version: document::MODEL_SNAPSHOT_SCHEMA_VERSION,
            probe_engine: self.mode(),
            document: self.document(harness_kind),
            now,
            live_state,
            next_attempt_at,
        })
    }

    /// Project the same live status into the canonical agent-auth
    /// [`ProbeLifecycle`] fact (ADR FR-2, item 3), so `derive_agent_auth_state`
    /// sees the engine's real phase, last-success age, last-failure detail, and
    /// `next_attempt_at` instead of the rung-2 `Idle` placeholder. Pure over one
    /// status read; available in read-only mode.
    pub fn auth_probe_lifecycle(&self, harness_kind: &str, now: DateTime<Utc>) -> ProbeLifecycle {
        let status = self.status(harness_kind, now);
        let phase = match status.state {
            status::LiveState::Idle => ProbePhase::Idle,
            status::LiveState::Queued => ProbePhase::Queued,
            status::LiveState::Running => ProbePhase::Running,
            status::LiveState::Backoff => ProbePhase::Backoff,
        };
        ProbeLifecycle {
            phase,
            // `snapshot_age_seconds` is the age of `probedAt`, which is the last
            // SUCCESSFUL observation by construction (a failed attempt updates
            // `lastAttempt` only, never `probedAt`).
            last_success_age_seconds: status.snapshot_age_seconds,
            last_failure_detail: status.last_error.clone(),
            next_attempt_at: status.next_attempt_at.clone(),
            observation_nonempty: status.model_count > 0,
        }
    }

    /// The last recorded tier-1 trial verdict for a harness, if any.
    pub fn tier1_trial(&self, harness_kind: &str) -> Option<Tier1TrialResult> {
        self.trial.result(harness_kind)
    }

    /// Both live runtime inputs the agents projection folds onto the static facts
    /// (ADR FR-2): the real probe lifecycle and the tier-1 trial verdict as a
    /// dependency-free fact. One call per harness at render time.
    pub fn auth_runtime_inputs(&self, harness_kind: &str, now: DateTime<Utc>) -> AuthRuntimeInputs {
        AuthRuntimeInputs {
            probe: self.auth_probe_lifecycle(harness_kind, now),
            trial: self
                .tier1_trial(harness_kind)
                .map(|result| result.to_fact(now)),
        }
    }

    /// A slot the engine has never touched reports idle, which is honest: nothing
    /// is running and nothing is scheduled.
    ///
    /// An in-flight state (`Queued` or `Running`) outranks a backoff window: the
    /// engine really is working on this harness right now, and reporting "retry
    /// pending" while a probe is mid-flight would make a polling UI hide its own
    /// spinner.
    fn live_state(
        &self,
        harness_kind: &str,
        now: DateTime<Utc>,
    ) -> (status::LiveState, Option<DateTime<Utc>>) {
        let slots = self.slots.lock().expect("model snapshot slots poisoned");
        let Some(slot) = slots.get(harness_kind) else {
            return (status::LiveState::Idle, None);
        };
        let state = slot.state.lock().expect("model snapshot slot poisoned");
        if matches!(
            state.live,
            status::LiveState::Queued | status::LiveState::Running
        ) {
            return (state.live, None);
        }
        match state.next_attempt_at {
            Some(next) if next > now => (status::LiveState::Backoff, Some(next)),
            _ => (status::LiveState::Idle, None),
        }
    }
}
