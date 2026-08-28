//! The seat tier-1 trial's engine surface: run one trial, then FOLD its
//! verdict onto the harness's status document (founder ruling 2026-08-27).
//!
//! The ledger itself lives in `route_auth::seat_trial` — it owns the HTTP
//! call, the classification, and the applied-seat scope guard. What lives here
//! is the engine half: this service already holds the runtime home the guard
//! reads and the status handle the verdict lands on, so the fold belongs
//! beside them and nowhere else.
//!
//! Split out of `launch_probe/mod.rs` by the slice-3 forward merge, which is
//! also where the CONSUMER moved: the verdict used to ride
//! `AuthRuntimeInputs.trial` into the client-side derivation, and that
//! derivation (`domains/agents/auth_state.rs`) is deleted. A trial IS a
//! credentialed observation of this harness's auth, so it lands where every
//! other observation lands.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use super::LaunchProbeService;
use crate::domains::agents::route_auth::{self, SeatTrialVerdict};

impl LaunchProbeService {
    /// Test seam: replace the seat-trial ledger, so a test can point the
    /// trial at a local server instead of the real API.
    #[cfg(test)]
    pub(crate) fn with_seat_trials(
        mut self,
        seat_trials: Arc<route_auth::SeatTrialLedger>,
    ) -> Self {
        self.seat_trials = seat_trials;
        self
    }

    /// One trial, then the fold.
    ///
    /// The producer half is unchanged — one credential-scoped `/v1/messages`
    /// call at mint completion, 2xx → verified, 401/403 → rejected, anything
    /// else records nothing. [`route_auth::SeatTrialLedger::verdict_for_applied_seat`]
    /// gates the fold, so the founder's scope rule survives verbatim: a seat
    /// verdict can never color a gateway, BYOK, or native state, and an
    /// inconclusive trial leaves the document exactly as it was.
    pub async fn run_seat_trial(&self, harness_kind: &str, token: String) {
        self.seat_trials.run_trial(harness_kind, token).await;
        self.fold_seat_trial_verdict(harness_kind, Utc::now());
    }

    /// The fold itself, split out so a test can drive it at a chosen instant.
    fn fold_seat_trial_verdict(&self, harness_kind: &str, now: DateTime<Utc>) {
        let Some(status) = self.agent_status.as_ref() else {
            return;
        };
        let Some((verdict, age_seconds)) =
            self.seat_trials
                .verdict_for_applied_seat(&self.runtime_home, harness_kind, now)
        else {
            return;
        };
        let at = now - chrono::Duration::seconds(age_seconds);
        match verdict {
            SeatTrialVerdict::Verified => status.probe_verified(harness_kind, at),
            // A dead seat token dims the light; it never deletes the seat
            // (spec flow 2: a failed verification never removes the row).
            SeatTrialVerdict::Rejected => status.probe_failed(harness_kind, at),
        }
    }

    /// The ledger handle for the mint-claim trigger (the ONE producer site).
    pub fn seat_trials(&self) -> Arc<route_auth::SeatTrialLedger> {
        self.seat_trials.clone()
    }
}
