//! Review-side session observer: records freshly persisted proposed plans as
//! review candidates.
//!
//! This replaces the direct `review_service.record_candidate_plan(&batch.plan)`
//! call that lived inside `live::sessions::actor::notifications::plans::ingest_completed_plan`.
//! Instead of the actor knowing about reviews, the reviews domain listens to the
//! ledger: when a `ProposedPlan` transcript item completes, the plan it carries
//! becomes a candidate for any active review run on the session that is waiting
//! for a revision.
//!
//! # Dispatch contract
//!
//! Observers run in a single ordered pass in registration order. An observer's
//! returned envelopes are published immediately and observed only by observers
//! registered *after* it, as `SessionObservation::Event(..)`; they are never
//! re-fed backward, and the pass is bounded by the observer list.
//!
//! `ReviewSessionObserver` MUST be registered **after** `PlanSessionObserver`:
//! the plan observer is what persists and emits the `ItemCompleted` envelope
//! carrying the `ProposedPlan` item, and this observer relies on feed-forward
//! delivery of that envelope within the same dispatch pass.
//!
//! # Partial failure
//!
//! This observer emits no events (`ObserverEffects::default()`), so it has no
//! event-row commit surface: it can never leave committed-but-unreturned rows
//! behind. Candidate-recording failures are logged by `ReviewService` /
//! locally and swallowed; dispatch logs failures and continues.
//!
//! # Threading
//!
//! `observe` is synchronous and runs under the sink lock on the per-session
//! thread. The candidate write is a plain SQLite write through `ReviewService`;
//! no async handoff is needed.

use std::sync::Arc;

use anyharness_contract::v1::{
    ContentPart, SessionEvent, SessionEventEnvelope, TranscriptItemKind, TranscriptItemPayload,
};

use crate::domains::plans::service::PlanService;
use crate::domains::reviews::service::ReviewService;
use crate::live::sessions::model::{
    ObserverEffects, SessionEventObserver, SessionObservation, SessionObserverContext,
};

/// Observes the persisted event ledger and records new proposed plans as
/// candidates for active review runs.
pub struct ReviewSessionObserver {
    reviews: Arc<ReviewService>,
    plans: Arc<PlanService>,
}

impl ReviewSessionObserver {
    pub fn new(reviews: Arc<ReviewService>, plans: Arc<PlanService>) -> Self {
        Self { reviews, plans }
    }
}

impl SessionEventObserver for ReviewSessionObserver {
    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects {
        let SessionObservation::Event(envelope) = obs else {
            return ObserverEffects::default();
        };
        let Some(plan_id) = completed_proposed_plan_id(envelope) else {
            return ObserverEffects::default();
        };

        // Reload the canonical PlanRecord. The envelope carries a full snapshot
        // (ContentPart::ProposedPlan), but record_candidate_plan wants the
        // store-backed record; PlanService::get is the canonical lookup
        // (ReviewService::get_plan is a thin delegation to the same method).
        match self.plans.get(&plan_id) {
            Ok(Some(plan)) => {
                // Infallible by signature: checks for an active run in
                // ParentRevising / WaitingForRevision and logs store errors
                // internally.
                self.reviews.record_candidate_plan(&plan);
            }
            Ok(None) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    plan_id = %plan_id,
                    "proposed plan item completed but plan record not found; skipping review candidate"
                );
            }
            Err(error) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    plan_id = %plan_id,
                    error = %error,
                    "failed to load plan for review candidate recording"
                );
            }
        }
        ObserverEffects::default()
    }
}

/// Returns the plan id if `envelope` is the `ItemCompleted` event for a
/// `ProposedPlan` transcript item.
///
/// `PlanService::create_completed_plan` emits `ItemStarted` and
/// `ItemCompleted` back-to-back with identical payloads for every new plan.
/// We match only `ItemCompleted` so each plan is recorded exactly once, and
/// because "completed" is the canonical signal that the item is final.
/// Superseded-plan `ItemDelta` envelopes (decision content parts) emitted in
/// the same batch deliberately do not match.
fn completed_proposed_plan_id(envelope: &SessionEventEnvelope) -> Option<String> {
    let SessionEvent::ItemCompleted(event) = &envelope.event else {
        return None;
    };
    let item = &event.item;
    if !matches!(item.kind, TranscriptItemKind::ProposedPlan) {
        return None;
    }
    plan_id_from_item(item)
}

/// Extracts the plan id from a `ProposedPlan` transcript item payload.
///
/// Primary source: the typed `ContentPart::ProposedPlan { plan_id, .. }`
/// snapshot part that `plan_item_payload` always includes. Fallback: the
/// `raw_output` JSON (`{"planId": ..., "snapshotHash": ...}`) the same helper
/// attaches, in case a future payload shape drops the snapshot part.
fn plan_id_from_item(item: &TranscriptItemPayload) -> Option<String> {
    for part in &item.content_parts {
        if let ContentPart::ProposedPlan { plan_id, .. } = part {
            return Some(plan_id.clone());
        }
    }
    item.raw_output
        .as_ref()?
        .get("planId")?
        .as_str()
        .map(ToOwned::to_owned)
}
