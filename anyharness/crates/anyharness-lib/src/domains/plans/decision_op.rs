//! `PlanDecisionOp`: the plan approve/reject decision as a serialized
//! [`SessionDomainOp`], replacing the bespoke
//! `SessionCommand::ApplyPlanDecision` actor arm
//! (`live/sessions/actor/interactions/plan_decisions.rs`).
//!
//! # Execution contract
//!
//! All event-emitting code in this op is synchronous and runs under the
//! session sink lock, on the per-session thread: the actor locks the sink,
//! builds a [`SessionOpEmitter`], and calls [`SessionDomainOp::begin`]. If the
//! op requests a native interaction resolution, the actor DROPS the sink lock,
//! performs the resolution (which takes the lock internally and touches the
//! rendezvous and the handle snapshot), then re-locks the sink and calls
//! [`SessionOpFinish::finish`]. No event row is committed outside those two
//! locked phases.
//!
//! # Partial-failure contract
//!
//! Each phase either fails WITHOUT committing event rows, or commits and
//! publishes EVERY committed envelope through the emitter. This holds because
//! both phases delegate persistence to `PlanService` methods
//! (`update_decision_with_context`, `update_native_resolution_with_context`)
//! that write the plan row and its event rows in a single transaction and
//! return all envelopes they inserted; the op publishes that exact set via
//! [`SessionOpEmitter::publish`]. The sink advances `next_seq` only by the
//! returned envelopes; a committed-but-unreturned row would collide loudly on
//! the next insert.

use std::any::Any;
use std::sync::Arc;

use anyharness_contract::v1::{
    PendingInteractionPayloadSummary, PendingInteractionSummary, ProposedPlanDecisionState,
    ProposedPlanNativeResolutionState,
};

use super::model::PlanRecord;
use super::service::{PlanDecisionError, PlanEventContext, PlanService};
use crate::acp::permission_payload::permission_option_mappings;
// NOTE: `Resolution` and `ResolveInteractionCommandError` live in
// `live/sessions/actor/command.rs`, but `actor` is a private module of
// `live::sessions`; this file uses the public root re-exports.
use crate::live::sessions::model::{
    SessionDomainOp, SessionObserverContext, SessionOpEmitter, SessionOpFinish, SessionOpStep,
};
use crate::live::sessions::{Resolution, ResolveInteractionCommandError};

/// The `Box<dyn Any + Send>` produced by [`PlanDecisionOp`] (from
/// `SessionOpStep::Done` or `SessionOpFinish::finish`) downcasts to this.
pub struct PlanDecisionOpOutput {
    pub result: Result<PlanRecord, PlanDecisionError>,
    /// The pending permission the op (re)linked during phase 1, if any.
    /// `PlanRuntime` mirrors this into the handle's pending-interaction
    /// snapshot (`link_pending_interaction_to_plan`) after the op returns —
    /// the op itself must not touch the handle. A no-op if the interaction
    /// was already resolved and removed.
    pub linked_request_id: Option<String>,
}

/// A pending native permission, snapshotted by `PlanRuntime` from
/// `LiveSessionHandle::execution_snapshot().pending_interactions` BEFORE the
/// op is sent to the actor. The op must not touch the handle, so the relink
/// step (formerly `link_plan_to_pending_permission`) consumes this plain data
/// instead. The matching `linked_plan_id` snapshot update stays on the handle
/// and is performed by `PlanRuntime` after the op returns.
#[derive(Debug, Clone)]
pub struct PendingPermissionCandidate {
    pub request_id: String,
    pub tool_call_id: Option<String>,
    /// `permission_option_mappings(options)` of the pending permission.
    pub option_mappings: serde_json::Value,
}

impl PendingPermissionCandidate {
    /// Projects an execution-snapshot pending-interaction list into relink
    /// candidates (permission interactions only), preserving order.
    pub fn from_pending_interactions(
        pending: &[PendingInteractionSummary],
    ) -> Vec<PendingPermissionCandidate> {
        pending
            .iter()
            .filter_map(|interaction| {
                let PendingInteractionPayloadSummary::Permission { options, .. } =
                    &interaction.payload
                else {
                    return None;
                };
                Some(PendingPermissionCandidate {
                    request_id: interaction.request_id.clone(),
                    tool_call_id: interaction.source.tool_call_id.clone(),
                    option_mappings: permission_option_mappings(options),
                })
            })
            .collect()
    }
}

/// Applies a product decision (approve/reject/...) to a proposed plan and, for
/// natively-linked plans, asks the actor to resolve the linked permission
/// between the two phases. Mirrors the PR-0 behavior of
/// `handle_apply_plan_decision` exactly.
pub struct PlanDecisionOp {
    pub plan_service: Arc<PlanService>,
    pub plan_id: String,
    pub expected_version: i64,
    pub decision: ProposedPlanDecisionState,
    /// See [`PendingPermissionCandidate`]; captured before the op was sent.
    pub pending_permissions: Vec<PendingPermissionCandidate>,
}

impl SessionDomainOp for PlanDecisionOp {
    /// Phase 1, under the sink lock: persist the decision (plan row + event
    /// rows in one `PlanService` tx), publish every returned envelope, attempt
    /// the relink to a pending native permission, and either finish or request
    /// a native interaction resolution from the actor.
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let PlanDecisionOp {
            plan_service,
            plan_id,
            expected_version,
            decision,
            pending_permissions,
        } = *self;

        let context = plan_event_context(&emitter.event_ctx());
        let (plan, envelopes) = match plan_service.update_decision_with_context(
            &plan_id,
            expected_version,
            decision.clone(),
            context,
        ) {
            Ok(result) => result,
            Err(error) => return done(Err(error), None),
        };
        emitter.publish(envelopes);

        let mut native_resolution =
            plan_decision_native_resolution(&plan_service, &plan.id, &decision);

        let mut linked_request_id = None;
        if matches!(
            decision,
            ProposedPlanDecisionState::Approved | ProposedPlanDecisionState::Rejected
        ) {
            linked_request_id =
                relink_to_pending_permission(&plan_service, &plan, &pending_permissions);
            if linked_request_id.is_some() || native_resolution.is_none() {
                native_resolution =
                    plan_decision_native_resolution(&plan_service, &plan.id, &decision);
            }
        }

        let Some(native_resolution) = native_resolution else {
            return done(Ok(plan), linked_request_id);
        };

        let (request_id, resolution, mode) = match native_resolution {
            PlanNativeResolution::Resolve {
                request_id,
                resolution,
            } => (request_id, resolution, PlanFinishMode::Native),
            PlanNativeResolution::FailAfterResolve {
                request_id,
                resolution,
                error_message,
            } => (
                request_id,
                resolution,
                PlanFinishMode::FailAfter { error_message },
            ),
        };

        SessionOpStep::ResolveInteraction {
            request_id: request_id.clone(),
            resolution,
            then: Box::new(PlanDecisionFinish {
                plan_service,
                plan,
                request_id,
                mode,
                linked_request_id,
            }),
        }
    }
}

/// How phase 2 interprets the actor's resolution outcome.
enum PlanFinishMode {
    /// A mapped native option was selected: success finalizes, failure marks
    /// the native resolution failed with a derived message.
    Native,
    /// No native option could be mapped; the interaction was cancelled to
    /// unblock the agent and the native resolution is failed with this
    /// message regardless of the cancellation outcome.
    FailAfter { error_message: String },
}

struct PlanDecisionFinish {
    plan_service: Arc<PlanService>,
    plan: PlanRecord,
    request_id: String,
    mode: PlanFinishMode,
    linked_request_id: Option<String>,
}

impl SessionOpFinish for PlanDecisionFinish {
    /// Phase 2, under the sink lock again, after the actor performed the
    /// native resolution: persist the native-resolution state transition in
    /// its own `PlanService` tx and publish every returned envelope.
    fn finish(
        self: Box<Self>,
        emitter: &mut SessionOpEmitter<'_>,
        outcome: Result<(), ResolveInteractionCommandError>,
    ) -> Box<dyn Any + Send> {
        let PlanDecisionFinish {
            plan_service,
            plan,
            request_id,
            mode,
            linked_request_id,
        } = *self;
        let ctx = emitter.event_ctx();

        let (next_native_state, error_message) = match mode {
            PlanFinishMode::Native => match &outcome {
                Ok(()) => (ProposedPlanNativeResolutionState::Finalized, None),
                Err(error) => {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        request_id = %request_id,
                        error = ?error,
                        "failed to resolve native interaction for proposed plan decision"
                    );
                    (
                        ProposedPlanNativeResolutionState::Failed,
                        Some(format!(
                            "Failed to resolve native interaction: {error:?}"
                        )),
                    )
                }
            },
            PlanFinishMode::FailAfter { error_message } => {
                if let Err(error) = &outcome {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        request_id = %request_id,
                        error = ?error,
                        "failed to clear native interaction after proposed plan decision failed"
                    );
                }
                (
                    ProposedPlanNativeResolutionState::Failed,
                    Some(error_message),
                )
            }
        };

        let context = plan_event_context(&ctx);
        let result = match plan_service.update_native_resolution_with_context(
            &plan.id,
            next_native_state,
            context,
            error_message,
        ) {
            Ok((updated, envelopes)) => {
                emitter.publish(envelopes);
                Ok(updated)
            }
            Err(error) => Err(error),
        };
        Box::new(PlanDecisionOpOutput {
            result,
            linked_request_id,
        })
    }
}

fn done(result: Result<PlanRecord, PlanDecisionError>, linked_request_id: Option<String>) -> SessionOpStep {
    SessionOpStep::Done(Box::new(PlanDecisionOpOutput {
        result,
        linked_request_id,
    }))
}

/// `SessionObserverContext` maps 1:1 onto `PlanEventContext`
/// (`workspace_id` is the extra field).
fn plan_event_context(ctx: &SessionObserverContext) -> PlanEventContext {
    PlanEventContext {
        session_id: ctx.session_id.clone(),
        source_agent_kind: ctx.agent_kind.clone(),
        turn_id: ctx.turn_id.clone(),
        next_seq: ctx.next_seq,
    }
}

/// In-op replacement for `link_plan_to_pending_permission`: re-registers the
/// interaction link against the latest pending permission that shares the
/// plan's source tool call, using the candidates snapshotted by `PlanRuntime`.
/// Returns whether a link was (re)registered.
fn relink_to_pending_permission(
    plan_service: &PlanService,
    plan: &PlanRecord,
    pending_permissions: &[PendingPermissionCandidate],
) -> Option<String> {
    let tool_call_id = plan.source_tool_call_id.as_deref()?;
    let candidate = pending_permissions
        .iter()
        .rev()
        .find(|candidate| candidate.tool_call_id.as_deref() == Some(tool_call_id))?;

    match plan_service.register_interaction_link(
        plan,
        &candidate.request_id,
        tool_call_id,
        candidate.option_mappings.clone(),
    ) {
        Ok(()) => Some(candidate.request_id.clone()),
        Err(error) => {
            tracing::warn!(
                plan_id = %plan.id,
                session_id = %plan.session_id,
                request_id = %candidate.request_id,
                tool_call_id = %tool_call_id,
                error = %error,
                "failed to link proposed plan to pending native permission"
            );
            None
        }
    }
}

#[derive(Debug, PartialEq)]
enum PlanNativeResolution {
    Resolve {
        request_id: String,
        resolution: Resolution,
    },
    FailAfterResolve {
        request_id: String,
        resolution: Resolution,
        error_message: String,
    },
}

/// Maps a terminal product decision onto the native interaction resolution
/// recorded in the plan's interaction link, if any. Moved verbatim from
/// `live/sessions/actor/interactions/plan_decisions.rs`.
fn plan_decision_native_resolution(
    plan_service: &PlanService,
    plan_id: &str,
    decision: &ProposedPlanDecisionState,
) -> Option<PlanNativeResolution> {
    let link = plan_service
        .store()
        .find_link_by_plan(plan_id)
        .ok()
        .flatten()?;
    let mappings: Option<serde_json::Value> = serde_json::from_str(&link.option_mappings_json).ok();

    match decision {
        // For native plan-exit interactions, product approval means the user
        // accepted the plan and wants the same agent to leave plan mode.
        ProposedPlanDecisionState::Approved => {
            let option_id = mappings
                .as_ref()
                .and_then(|mappings| option_mapping(mappings, "approve"));
            match option_id {
                Some(option_id) => Some(PlanNativeResolution::Resolve {
                    request_id: link.request_id,
                    resolution: Resolution::Selected {
                        option_id: option_id.to_string(),
                    },
                }),
                None => Some(PlanNativeResolution::FailAfterResolve {
                    request_id: link.request_id,
                    resolution: Resolution::Cancelled,
                    error_message: "Approved plan could not map to a native approval option."
                        .to_string(),
                }),
            }
        }
        ProposedPlanDecisionState::Rejected => {
            let option_id = mappings
                .as_ref()
                .and_then(|mappings| option_mapping(mappings, "reject"));
            match option_id {
                Some(option_id) => Some(PlanNativeResolution::Resolve {
                    request_id: link.request_id,
                    resolution: Resolution::Selected {
                        option_id: option_id.to_string(),
                    },
                }),
                None => Some(PlanNativeResolution::FailAfterResolve {
                    request_id: link.request_id,
                    resolution: Resolution::Cancelled,
                    error_message: "Rejected plan could not map to a native rejection option."
                        .to_string(),
                }),
            }
        }
        _ => None,
    }
}

fn option_mapping<'a>(mappings: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    mappings
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|option_id| !option_id.is_empty())
}

#[cfg(test)]
mod tests {
    //! Pure decision-mapping tests, moved from
    //! `live/sessions/actor/interactions/plan_decisions.rs` — they exercise
    //! only `PlanService` + the link table, no live harness. The
    //! harness-dependent test
    //! (`approved_native_plan_failure_cancels_pending_permission`) moves to
    //! the live side as an integration test of the actor's `run_domain_op`
    //! helper; see decision_op_notes.md.

    use serde_json::json;

    use super::*;
    use crate::app::test_support;
    use crate::domains::plans::model::{NewPlan, PlanCreateOutcome};
    use crate::domains::plans::store::PlanStore;
    use crate::persistence::Db;

    fn plan_service_with_link(option_mappings: serde_json::Value) -> (PlanService, String) {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES ('session-1', 'workspace-1', 'claude', 'idle', 'now', 'now')",
                [],
            )?;
            Ok(())
        })
        .expect("seed db");
        let service = PlanService::new(PlanStore::new(db));
        let created = service
            .create_completed_plan(
                NewPlan {
                    workspace_id: "workspace-1".to_string(),
                    session_id: "session-1".to_string(),
                    title: "Plan".to_string(),
                    body_markdown: "Do it.".to_string(),
                    source_agent_kind: "claude".to_string(),
                    source_kind: "claude_exit_plan_mode".to_string(),
                    source_turn_id: Some("turn-1".to_string()),
                    source_item_id: Some("tool-1".to_string()),
                    source_tool_call_id: Some("tool-1".to_string()),
                },
                PlanEventContext {
                    session_id: "session-1".to_string(),
                    source_agent_kind: "claude".to_string(),
                    turn_id: Some("turn-1".to_string()),
                    next_seq: 1,
                },
            )
            .expect("create plan");
        assert_eq!(created.outcome, PlanCreateOutcome::Created);
        service
            .register_interaction_link(&created.plan, "request-1", "tool-1", option_mappings)
            .expect("register link");
        (service, created.plan.id)
    }

    #[test]
    fn approved_native_plan_selects_approve_option() {
        let (service, plan_id) = plan_service_with_link(json!({
            "approve": "allow-once",
            "reject": "reject-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Approved,
            ),
            Some(PlanNativeResolution::Resolve {
                request_id: "request-1".to_string(),
                resolution: Resolution::Selected {
                    option_id: "allow-once".to_string(),
                },
            }),
        );
    }

    #[test]
    fn rejected_native_plan_selects_reject_option() {
        let (service, plan_id) = plan_service_with_link(json!({
            "approve": "allow-once",
            "reject": "reject-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Rejected,
            ),
            Some(PlanNativeResolution::Resolve {
                request_id: "request-1".to_string(),
                resolution: Resolution::Selected {
                    option_id: "reject-once".to_string(),
                },
            }),
        );
    }

    #[test]
    fn rejected_native_plan_fails_when_no_reject_mapping_exists() {
        let (service, plan_id) = plan_service_with_link(json!({
            "approve": "allow-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Rejected,
            ),
            Some(PlanNativeResolution::FailAfterResolve {
                request_id: "request-1".to_string(),
                resolution: Resolution::Cancelled,
                error_message: "Rejected plan could not map to a native rejection option."
                    .to_string(),
            }),
        );
    }

    #[test]
    fn approved_native_plan_fails_when_no_approve_mapping_exists() {
        let (service, plan_id) = plan_service_with_link(json!({
            "reject": "reject-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Approved,
            ),
            Some(PlanNativeResolution::FailAfterResolve {
                request_id: "request-1".to_string(),
                resolution: Resolution::Cancelled,
                error_message: "Approved plan could not map to a native approval option."
                    .to_string(),
            }),
        );
    }
}
