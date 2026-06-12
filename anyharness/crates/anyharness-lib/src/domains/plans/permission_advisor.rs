//! Plan-aware [`PermissionAdvisor`] — the domains/plans answer to the inbound
//! door's "an agent is asking for permission, what do I do with it?" question.
//!
//! This absorbs the plan-specific logic that previously lived inline in
//! `live/sessions/driver/inbound/permission.rs`:
//!
//! 1. plan lookup by `tool_call_id` ([`PlanService::find_by_session_tool_call`]),
//! 2. registering the interaction link with the computed option mappings
//!    ([`PlanService::register_interaction_link`]),
//! 3. the predecided check (the user already approved/rejected the proposed
//!    plan in-product before the native permission request arrived), and
//! 4. on a predecided plan, persisting the native-resolution transition via
//!    [`PlanService::update_native_resolution_with_context`] and returning the
//!    committed envelopes to the caller.
//!
//! # Contracts
//!
//! - **Sink lock / threading**: [`PermissionAdvisor::advise`] runs
//!   synchronously on the inbound-door task with the sink lock HELD by the
//!   caller. The [`SessionObserverContext`] carries the locked `next_seq`
//!   counter; every event row this advisor persists is stamped from that
//!   counter. The advisor never touches the sink itself — it returns the
//!   committed envelopes inside [`PermissionAdvice::Predecided`] and the DOOR
//!   publishes them (broadcast + counter advance) while still holding the lock.
//! - **Partial failure**: each persistence step here either fails WITHOUT
//!   committing event rows, or commits and returns EVERY committed envelope.
//!   `update_native_resolution_with_context` persists plan row + event row in
//!   a single transaction and returns the envelopes; on error nothing was
//!   committed, we log and return no envelopes, so the sink never advances
//!   past rows it did not see. A committed-but-unreturned envelope would
//!   collide loudly on the next insert — that invariant is upheld by doing all
//!   event writes through the plan service tx helpers.
//! - All event-emitting code here is synchronous under the sink lock, on the
//!   per-session thread. No async, no side-channel publishing.

use anyharness_contract::v1::{
    ProposedPlanDecisionState, ProposedPlanNativeResolutionState, SessionEventEnvelope,
};

use crate::acp::permission_payload::{permission_option_mappings, permission_options};
use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::{PlanEventContext, PlanService};
use crate::live::sessions::model::{
    PendingInteractionLink, PermissionAdvice, PermissionAdvisor, PermissionQuestionView,
    SessionObserverContext,
};

use std::sync::Arc;

/// Advises the inbound permission door based on proposed-plan state.
///
/// Behavior matrix (exactly the pre-refactor inline behavior, including the
/// PR-0 reject fix):
///
/// | plan state            | mapping present | advice                                              |
/// |-----------------------|-----------------|-----------------------------------------------------|
/// | none linked           | n/a             | `Park { pending_interaction: None }`                |
/// | `Pending`/`Superseded`| n/a             | `Park { Some(link{ linked_plan_id }) }`             |
/// | `Approved`            | yes (`approve`) | `Predecided { Some(option_id) }`, native `Finalized`|
/// | `Approved`            | no              | `Predecided { None }` (Cancelled), native `Failed`, "Approved plan could not map to a native approval option." |
/// | `Rejected`            | yes (`reject`)  | `Predecided { Some(option_id) }`, native `Finalized`|
/// | `Rejected`            | no              | `Predecided { None }` (Cancelled), native `Failed`, "Rejected plan could not map to a native rejection option." |
pub struct PlanPermissionAdvisor {
    plan_service: Arc<PlanService>,
}

impl PlanPermissionAdvisor {
    pub fn new(plan_service: Arc<PlanService>) -> Self {
        Self { plan_service }
    }
}

impl PermissionAdvisor for PlanPermissionAdvisor {
    fn advise(
        &self,
        ctx: &SessionObserverContext,
        q: &PermissionQuestionView<'_>,
    ) -> PermissionAdvice {
        // Lookup failures are deliberately swallowed (matches the previous
        // inline `.ok().flatten()`): a broken plan store must never block a
        // native permission request from being parked for the user.
        let linked_plan = match q.tool_call_id {
            Some(tool_call_id) => self
                .plan_service
                .find_by_session_tool_call(q.session_id, tool_call_id)
                .ok()
                .flatten(),
            None => None,
        };

        let (Some(plan), Some(tool_call_id)) = (linked_plan, q.tool_call_id) else {
            return PermissionAdvice::Park {
                pending_interaction: None,
            };
        };

        let options = permission_options(q.options);
        let option_mappings = permission_option_mappings(&options);

        // Link registration is best-effort, exactly as before (`let _ =`):
        // it only powers later product-driven native resolution.
        let _ = self.plan_service.register_interaction_link(
            &plan,
            q.request_id,
            tool_call_id,
            option_mappings.clone(),
        );

        match predecided_plan_permission(&plan, &option_mappings) {
            Some(predecided) => {
                let persisted_events = self.persist_native_resolution(
                    ctx,
                    &plan.id,
                    predecided.native_state,
                    predecided.error_message,
                );
                PermissionAdvice::Predecided {
                    selected_option_id: predecided.selected_option_id,
                    persisted_events,
                }
            }
            None => PermissionAdvice::Park {
                pending_interaction: Some(PendingInteractionLink {
                    linked_plan_id: Some(plan.id),
                }),
            },
        }
    }
}

impl PlanPermissionAdvisor {
    /// Persists the predecided native-resolution transition in the plan
    /// service's own transaction and returns every committed envelope.
    ///
    /// Runs under the sink lock (held by the door). On error nothing was
    /// committed; we log and return no envelopes — the door publishes nothing
    /// and the sink counter is untouched (same observable behavior as the old
    /// `publish_plan_native_resolution`).
    fn persist_native_resolution(
        &self,
        ctx: &SessionObserverContext,
        plan_id: &str,
        native_state: ProposedPlanNativeResolutionState,
        error_message: Option<String>,
    ) -> Vec<SessionEventEnvelope> {
        let context = PlanEventContext {
            session_id: ctx.session_id.clone(),
            source_agent_kind: ctx.agent_kind.clone(),
            turn_id: ctx.turn_id.clone(),
            next_seq: ctx.next_seq,
        };
        match self.plan_service.update_native_resolution_with_context(
            plan_id,
            native_state,
            context,
            error_message,
        ) {
            Ok((_plan, envelopes)) => envelopes,
            Err(error) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    plan_id = %plan_id,
                    error = ?error,
                    "failed to update predecided native plan resolution"
                );
                Vec::new()
            }
        }
    }
}

/// A plan decision that pre-answers the native permission request.
///
/// `selected_option_id: None` means the door must answer the agent with
/// `RequestPermissionOutcome::Cancelled`.
struct PredecidedPlanPermission {
    selected_option_id: Option<String>,
    native_state: ProposedPlanNativeResolutionState,
    error_message: Option<String>,
}

fn predecided_plan_permission(
    plan: &PlanRecord,
    option_mappings: &serde_json::Value,
) -> Option<PredecidedPlanPermission> {
    match &plan.decision_state {
        ProposedPlanDecisionState::Approved => Some(predecided_selected_or_failed(
            option_mappings,
            "approve",
            "Approved plan could not map to a native approval option.",
        )),
        // PR-0 semantics: a rejected plan that cannot map to a native
        // rejection option is a FAILED native resolution (cancelled answer +
        // error surfaced), matching the actor-side resolution path.
        ProposedPlanDecisionState::Rejected => Some(predecided_selected_or_failed(
            option_mappings,
            "reject",
            "Rejected plan could not map to a native rejection option.",
        )),
        ProposedPlanDecisionState::Pending | ProposedPlanDecisionState::Superseded => None,
    }
}

fn predecided_selected_or_failed(
    option_mappings: &serde_json::Value,
    key: &str,
    error_message: &str,
) -> PredecidedPlanPermission {
    match mapped_option_id(option_mappings, key) {
        Some(option_id) => PredecidedPlanPermission {
            selected_option_id: Some(option_id.to_string()),
            native_state: ProposedPlanNativeResolutionState::Finalized,
            error_message: None,
        },
        None => PredecidedPlanPermission {
            selected_option_id: None,
            native_state: ProposedPlanNativeResolutionState::Failed,
            error_message: Some(error_message.to_string()),
        },
    }
}

fn mapped_option_id<'a>(mappings: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    mappings
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|option_id| !option_id.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_with_decision(decision_state: ProposedPlanDecisionState) -> PlanRecord {
        PlanRecord {
            id: "plan-1".to_string(),
            workspace_id: "ws-1".to_string(),
            session_id: "sess-1".to_string(),
            item_id: "item-1".to_string(),
            title: "Test plan".to_string(),
            body_markdown: "do the thing".to_string(),
            snapshot_hash: "hash".to_string(),
            decision_state,
            native_resolution_state: ProposedPlanNativeResolutionState::PendingLink,
            decision_version: 1,
            source_agent_kind: "claude".to_string(),
            source_kind: "plan_exit".to_string(),
            source_session_id: "sess-1".to_string(),
            source_turn_id: None,
            source_item_id: None,
            source_tool_call_id: Some("tc-1".to_string()),
            superseded_by_plan_id: None,
            created_at: "2026-06-10T00:00:00Z".to_string(),
            updated_at: "2026-06-10T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn approved_plan_with_mapping_selects_approve_option() {
        let plan = plan_with_decision(ProposedPlanDecisionState::Approved);
        let mappings = serde_json::json!({ "approve": "opt-yes", "reject": "opt-no" });

        let predecided = predecided_plan_permission(&plan, &mappings).expect("predecided");
        assert_eq!(predecided.selected_option_id.as_deref(), Some("opt-yes"));
        assert_eq!(
            predecided.native_state,
            ProposedPlanNativeResolutionState::Finalized
        );
        assert_eq!(predecided.error_message, None);
    }

    #[test]
    fn approved_plan_without_mapping_cancels_and_fails() {
        let plan = plan_with_decision(ProposedPlanDecisionState::Approved);
        let mappings = serde_json::json!({ "approve": null, "reject": "opt-no" });

        let predecided = predecided_plan_permission(&plan, &mappings).expect("predecided");
        assert_eq!(predecided.selected_option_id, None);
        assert_eq!(
            predecided.native_state,
            ProposedPlanNativeResolutionState::Failed
        );
        assert_eq!(
            predecided.error_message.as_deref(),
            Some("Approved plan could not map to a native approval option.")
        );
    }

    #[test]
    fn rejected_plan_with_mapping_selects_reject_option() {
        let plan = plan_with_decision(ProposedPlanDecisionState::Rejected);
        let mappings = serde_json::json!({ "approve": "opt-yes", "reject": "opt-no" });

        let predecided = predecided_plan_permission(&plan, &mappings).expect("predecided");
        assert_eq!(predecided.selected_option_id.as_deref(), Some("opt-no"));
        assert_eq!(
            predecided.native_state,
            ProposedPlanNativeResolutionState::Finalized
        );
        assert_eq!(predecided.error_message, None);
    }

    /// PR-0 behavior: rejected without a native rejection mapping must answer
    /// Cancelled AND mark the native resolution Failed with the rejection
    /// error message (not silently Finalized).
    #[test]
    fn rejected_plan_without_mapping_cancels_and_fails() {
        let plan = plan_with_decision(ProposedPlanDecisionState::Rejected);
        let mappings = serde_json::json!({ "approve": "opt-yes", "reject": "" });

        let predecided = predecided_plan_permission(&plan, &mappings).expect("predecided");
        assert_eq!(predecided.selected_option_id, None);
        assert_eq!(
            predecided.native_state,
            ProposedPlanNativeResolutionState::Failed
        );
        assert_eq!(
            predecided.error_message.as_deref(),
            Some("Rejected plan could not map to a native rejection option.")
        );
    }

    #[test]
    fn pending_and_superseded_plans_are_not_predecided() {
        let mappings = serde_json::json!({ "approve": "opt-yes", "reject": "opt-no" });
        for state in [
            ProposedPlanDecisionState::Pending,
            ProposedPlanDecisionState::Superseded,
        ] {
            let plan = plan_with_decision(state);
            assert!(predecided_plan_permission(&plan, &mappings).is_none());
        }
    }

    #[test]
    fn mapped_option_id_trims_and_rejects_empty() {
        let mappings = serde_json::json!({ "approve": "  opt-yes  ", "reject": "   " });
        assert_eq!(mapped_option_id(&mappings, "approve"), Some("opt-yes"));
        assert_eq!(mapped_option_id(&mappings, "reject"), None);
        assert_eq!(mapped_option_id(&mappings, "missing"), None);
    }
}
