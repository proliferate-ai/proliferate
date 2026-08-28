//! How a launch-options read decides what the probe scheduler is doing.
//!
//! Two sources disagree by construction: the DURABLE row, which is all a
//! read-only runtime has, and the OWNER's in-memory slot, which is the only thing
//! that knows an attempt was abandoned. This module is where they are reconciled,
//! and every rule here exists because one of them can lie in a specific way.

use std::sync::atomic::Ordering;

use chrono::{DateTime, Utc};

use super::config::ProbeEngineConfig;
use super::LaunchProbeService;

/// The probe engine's live phase for one harness — the slot vocabulary the
/// launch-options read surface refines against the durable row. (Lived in the
/// deleted `auth_state.rs` while the evidence model consumed it; the engine
/// is its only producer, so it lives here now.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbePhase {
    Idle,
    Queued,
    Running,
    Backoff,
}

/// A reading of the scheduler's slot, stamped with WHEN it was taken so the
/// slot-before-row ordering can be checked rather than merely documented, and
/// with WHICH harness it is a reading of.
///
/// The harness travels with the reading rather than being passed again alongside
/// it because the refinement rules are not harness-agnostic: whether a startup
/// pass is owed at all depends on the probe-eligibility policy for this specific
/// harness, and a caller that named one harness for the slot and another for the
/// refinement would silently apply cursor's law to opencode, or the reverse.
#[derive(Debug, Clone)]
pub struct LivePhaseReading {
    harness_kind: String,
    phase: Option<ProbePhase>,
    taken_at: DateTime<Utc>,
}

impl LivePhaseReading {
    /// The phase itself, for a caller that only wants to look.
    pub fn phase(&self) -> Option<ProbePhase> {
        self.phase
    }
}

impl LaunchProbeService {
    /// The probe phase for one harness, for a surface that wants the phase alone —
    /// the launch-options response, which cannot otherwise tell an active probe
    /// apart from a provisional row nothing will ever refresh.
    ///
    /// `durable_in_flight` is the STORED row's own answer (`ProbeState::Probing`,
    /// whatever basis the row carries). It is the only source a READ-ONLY runtime
    /// has — that runtime never admits an attempt, so every slot it could read is
    /// one it never wrote — and it is what keeps `state` and the phase from
    /// disagreeing there: a `detecting` response carrying `idle` or no phase at all
    /// is one a client reads as terminal and stops polling on.
    ///
    /// The OWNER's slot outranks the row in one direction, and only because
    /// admission now precedes `begin_probe`: for an owner, a row that is `probing`
    /// while its slot is `idle` is an ORPHAN — a durable start whose attempt is
    /// gone, which is reachable without any crash, since dropping the `refresh_now`
    /// future (an ordinary client disconnect) releases the guard and leaves no
    /// compensating write. Reporting the row there would poll a client forever
    /// against an attempt that no longer exists.
    ///
    /// `None` only when nothing is in flight durably AND this runtime does not own
    /// the engine, so no source can answer at all.
    pub fn probe_phase(
        &self,
        harness_kind: &str,
        now: DateTime<Utc>,
        in_flight_since: Option<DateTime<Utc>>,
    ) -> Option<ProbePhase> {
        let live = self.live_probe_phase(harness_kind, now);
        self.refine_row_claim(live, now, in_flight_since, now)
    }

    /// The scheduler's own answer, read WITHOUT consulting any row.
    ///
    /// Split out so a caller that also reads the row can read THIS FIRST. A caller
    /// that reads the row first and the slot second can catch an attempt
    /// committing between the two: the row still says `probing` and the slot
    /// already says `idle`, which is indistinguishable from an orphan and would
    /// retire a live attempt's result unseen. Slot-first cannot produce that pair
    /// — it can only produce a slot that is livelier than the row, which merely
    /// keeps a client polling one extra tick.
    pub fn live_probe_phase(&self, harness_kind: &str, now: DateTime<Utc>) -> LivePhaseReading {
        LivePhaseReading {
            harness_kind: harness_kind.to_string(),
            phase: self
                .is_owner()
                .then(|| self.live_phase(harness_kind, now).0),
            taken_at: now,
        }
    }

    /// Refine a row's durable claim with a slot reading taken BEFORE the row.
    pub fn refine_row_claim(
        &self,
        live: LivePhaseReading,
        row_read_at: DateTime<Utc>,
        in_flight_since: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Option<ProbePhase> {
        // The ordering rule, as a checked precondition rather than a comment. A
        // caller that reads the row first and the slot second catches an attempt
        // committing between the two as a `probing` row beside an `idle` slot —
        // the orphan pair — and retires a live result unseen. Nothing in the type
        // system stops that call order, so it is asserted here, where the two
        // readings finally meet.
        debug_assert!(
            live.taken_at <= row_read_at,
            "the probe slot must be read BEFORE the launch-options row"
        );
        // An owner that has not yet dispatched its startup pass has an empty slot
        // map because nothing has run yet. Believing it would serve a terminal
        // phase seconds before the startup probe lands, and the client that stopped
        // polling would never see the result. Computed BEFORE the phase is unpacked
        // because it is the harness, not the phase, that decides whether a pass is
        // owed.
        let startup_pending = self.startup_probe_pending(&live.harness_kind, now);
        let live = live.phase;
        // The row claims nothing, so only the slot can answer, and for a read-only
        // runtime that is nothing at all.
        let Some(started_at) = in_flight_since else {
            return live;
        };
        if self.attempt_is_abandoned(started_at, now) && !startup_pending {
            return live;
        }
        match live {
            Some(ProbePhase::Running) => Some(ProbePhase::Running),
            // The owner admits BEFORE `begin_probe`, so a probing row over a slot
            // that is idle (or serving out a backoff) is an orphan no attempt
            // backs: report the slot, not the row.
            Some(phase @ (ProbePhase::Idle | ProbePhase::Backoff)) if !startup_pending => {
                Some(phase)
            }
            // Either the owner's slot is `queued`, or there is no slot to read
            // because this runtime does not own the engine. Both mean the row's
            // in-flight attempt is the best answer available.
            _ => Some(ProbePhase::Queued),
        }
    }

    /// Does this owner still owe THIS HARNESS the startup probe pass its slot is
    /// waiting for?
    ///
    /// Per-harness, not merely per-runtime. `poke_all(Startup)` funnels through
    /// `poke_harness`, which refuses any harness in `AUTO_PROBE_EXCLUDED_HARNESSES`
    /// — cursor today — so for those the startup pass is dispatched and dispatches
    /// NOTHING. A runtime-wide grace therefore reported `queued` on a stranded
    /// cursor row for the whole grace window, against an attempt that was never
    /// coming: `detecting` + `queued` is exactly the pair the client polls on, so
    /// it polled every 1.5s for the bound's full length and then gave up on an
    /// answer no automatic probe could ever have produced. An excused empty slot is
    /// only honest where a poke is genuinely owed.
    ///
    /// Bounded by wall clock as well as by the pass itself: the pass runs behind
    /// seed hydration and a reconcile, either of which can stall, and an unbounded
    /// "a probe is coming" is the same forever-poll this module already bounds
    /// everywhere else.
    fn startup_probe_pending(&self, harness_kind: &str, now: DateTime<Utc>) -> bool {
        self.is_owner()
            && self.targets.allows_automatic_probe(harness_kind)
            && !self.startup_pass_dispatched.load(Ordering::Relaxed)
            && now.signed_duration_since(self.started_at) <= self.abandoned_attempt_after
    }

    /// Is this harness one an UNATTENDED poke may touch at all? Exposed because
    /// the startup grace turns on it, and a test of the grace that asserted the
    /// grace's own conclusion would be circular.
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(crate) fn targets_allow_automatic_probe(&self, harness_kind: &str) -> bool {
        self.targets.allows_automatic_probe(harness_kind)
    }

    /// Called once the startup pass has actually dispatched its pokes, so reads
    /// stop making excuses for an empty slot map.
    pub fn mark_startup_pass_dispatched(&self) {
        self.startup_pass_dispatched.store(true, Ordering::Relaxed);
    }

    /// Has a durable `probing` row outlived any attempt that could still be behind
    /// it? Nothing releases the row when an attempt's future is dropped, and a
    /// READ-ONLY runtime has no slot to notice that with — it may not even have an
    /// owner to wait for, since the engine lock is taken once at construction and
    /// a sealed-container home has no owner at all. Without this bound such a row
    /// polls a client every 1.5s for the life of the process.
    fn attempt_is_abandoned(&self, started_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
        now.signed_duration_since(started_at) > self.abandoned_attempt_after
    }
}

/// How long a durable `probing` row may be believed.
///
/// It MUST exceed `K x per_probe_timeout`. An attempt is written to the row by
/// `begin_probe` BEFORE it waits on the machine-wide semaphore, so a whole-machine
/// pass legitimately leaves the last harness's row `probing` behind every probe
/// queued ahead of it. `sweep_age_multiplier` (3 timeouts) is the tempting reuse
/// and is TOO TIGHT from K = 4 harnesses upward: it would report a genuinely
/// queued probe as settled, which is the stall this whole field exists to avoid,
/// arriving by the other door. K is the registry's size — every harness that can
/// be queued — plus one timeout of headroom for the attempt that is running.
pub(super) fn abandoned_attempt_after(config: &ProbeEngineConfig) -> chrono::Duration {
    let queue_depth = u32::try_from(crate::domains::agents::registry::built_in_registry().len())
        .unwrap_or(u32::MAX)
        .saturating_add(1);
    chrono::Duration::from_std(config.per_probe_timeout.saturating_mul(queue_depth))
        .unwrap_or_else(|_| chrono::Duration::hours(1))
}

#[cfg(test)]
mod tests {
    use super::abandoned_attempt_after;
    use crate::domains::agents::launch_probe::config::ProbeEngineConfig;
    use crate::domains::agents::registry::built_in_registry;

    /// The bound must stay DERIVED. Written down as a constant it silently stops
    /// tracking the two things it is made of, and the failure it then permits is
    /// the invisible one: a genuinely queued probe reported settled, a client that
    /// stops polling, and an observation that lands unseen.
    #[test]
    fn the_abandoned_bound_is_derived_from_the_timeout_and_the_queue_it_must_clear() {
        let config = ProbeEngineConfig::default();
        let timeout =
            chrono::Duration::from_std(config.per_probe_timeout).expect("a timeout that fits");
        let harnesses = i32::try_from(built_in_registry().len()).expect("a small registry");
        assert_eq!(
            abandoned_attempt_after(&config),
            timeout * (harnesses + 1),
            "every harness that can be queued, plus one timeout for the one running"
        );
    }

    /// The same bound in the concrete, so a SIXTH harness in the registry breaks a
    /// test rather than quietly narrowing the headroom. If this fails because the
    /// registry grew, re-do the arithmetic before touching the number: the worst
    /// legitimate wait grows with it.
    #[test]
    fn the_abandoned_bound_is_270_seconds_against_todays_five_harnesses() {
        assert_eq!(
            built_in_registry().len(),
            5,
            "the queue arithmetic below is sized for five harnesses"
        );
        assert_eq!(
            abandoned_attempt_after(&ProbeEngineConfig::default()),
            chrono::Duration::seconds(270)
        );
    }

    /// `sweep_age_multiplier` is the tempting reuse and the trap: it is 3 timeouts,
    /// which a five-harness pass exceeds. Pinning the inequality means the trap
    /// cannot be walked back into by "reusing what is already there".
    #[test]
    fn the_abandoned_bound_clears_the_sweep_multiplier_it_must_not_reuse() {
        let config = ProbeEngineConfig::default();
        let sweep =
            chrono::Duration::from_std(config.per_probe_timeout * config.sweep_age_multiplier)
                .expect("a sweep age that fits");
        assert!(
            abandoned_attempt_after(&config) > sweep,
            "the orphan-scratch sweep age is not a safe probe-claim bound"
        );
    }
}
