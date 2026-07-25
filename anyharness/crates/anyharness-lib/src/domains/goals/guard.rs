//! `GoalGuardExtension` — the runtime loop guard (spec §2.4).
//!
//! Native goal loops can run away. Every goal carries caps (`max_turns`,
//! `max_wall_secs`); this [`SessionExtension`] decrements turn/time budgets
//! on every finished turn and, when exceeded, force-fails the mirror
//! (`reason: budget_exhausted`) and clears the native goal through the
//! sidecar GoalPort. This is also the phase-C seam where emulated goals for
//! gemini/opencode plug in.

use std::any::Any;
use std::sync::Arc;

use super::model::GoalRecord;
use super::runtime::GOAL_CLEAR_EXT_METHOD;
use super::service::{GoalEventContext, GoalService, GOAL_FAIL_REASON_BUDGET_EXHAUSTED};
use crate::domains::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};
use crate::live::sessions::model::{SessionDomainOp, SessionOpEmitter, SessionOpStep};
use crate::live::sessions::LiveSessionManager;

pub struct GoalGuardExtension {
    goal_service: Arc<GoalService>,
    acp_manager: LiveSessionManager,
}

impl GoalGuardExtension {
    pub fn new(goal_service: Arc<GoalService>, acp_manager: LiveSessionManager) -> Self {
        Self {
            goal_service,
            acp_manager,
        }
    }
}

impl SessionExtension for GoalGuardExtension {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let goal_service = self.goal_service.clone();
        let acp_manager = self.acp_manager.clone();
        tokio::spawn(async move {
            if let Err(error) = enforce_goal_budget(goal_service, acp_manager, ctx).await {
                tracing::warn!(error = %error, "goal guard budget enforcement failed");
            }
        });
    }
}

async fn enforce_goal_budget(
    goal_service: Arc<GoalService>,
    acp_manager: LiveSessionManager,
    ctx: SessionTurnFinishedContext,
) -> anyhow::Result<()> {
    let Some(goal) = goal_service.store().increment_turns_used(&ctx.session_id)? else {
        return Ok(());
    };
    if !budget_exhausted(&goal, chrono::Utc::now()) {
        return Ok(());
    }
    tracing::info!(
        session_id = %ctx.session_id,
        goal_id = %goal.id,
        turns_used = goal.turns_used,
        max_turns = ?goal.max_turns,
        max_wall_secs = ?goal.max_wall_secs,
        "goal budget exhausted; force-clearing"
    );

    match acp_manager.get_handle(&ctx.session_id).await {
        Some(handle) => {
            let op = Box::new(GoalFailOp {
                goal_service: goal_service.clone(),
                reason: GOAL_FAIL_REASON_BUDGET_EXHAUSTED.to_string(),
            });
            let reply = handle
                .run_domain_op(op)
                .await
                .map_err(|error| anyhow::anyhow!("goal fail op: {error:?}"))?;
            let output = reply
                .downcast::<GoalFailOpOutput>()
                .map_err(|_| anyhow::anyhow!("goal fail op returned unexpected reply type"))?;
            output.result?;
            // Best-effort native clear; the resulting goal_cleared
            // notification is a no-op on the (already failed) mirror.
            if let Err(error) = handle
                .call_agent_ext_method(GOAL_CLEAR_EXT_METHOD, serde_json::json!({}))
                .await
            {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = ?error,
                    "failed to clear native goal after budget exhaustion"
                );
            }
        }
        None => {
            goal_service.fail_non_terminal_offline(
                &ctx.session_id,
                &ctx.workspace.id,
                GOAL_FAIL_REASON_BUDGET_EXHAUSTED,
            )?;
        }
    }
    Ok(())
}

fn budget_exhausted(goal: &GoalRecord, now: chrono::DateTime<chrono::Utc>) -> bool {
    if goal
        .max_turns
        .is_some_and(|max_turns| goal.turns_used >= max_turns)
    {
        return true;
    }
    let Some(max_wall_secs) = goal.max_wall_secs else {
        return false;
    };
    let Ok(created_at) = chrono::DateTime::parse_from_rfc3339(&goal.created_at) else {
        return false;
    };
    (now - created_at.with_timezone(&chrono::Utc)).num_seconds() >= max_wall_secs
}

/// The budget-exhausted fail transition as a serialized [`SessionDomainOp`]:
/// runs under the sink lock, persists the transition + event rows in one tx,
/// and publishes every committed envelope.
struct GoalFailOp {
    goal_service: Arc<GoalService>,
    reason: String,
}

struct GoalFailOpOutput {
    result: anyhow::Result<()>,
}

impl SessionDomainOp for GoalFailOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let ctx = emitter.event_ctx();
        let context = GoalEventContext {
            session_id: ctx.session_id,
            workspace_id: ctx.workspace_id,
            turn_id: ctx.turn_id,
            next_seq: ctx.next_seq,
        };
        let result = match self
            .goal_service
            .fail_non_terminal_with_context(&context, &self.reason)
        {
            Ok(envelopes) => {
                emitter.publish(envelopes);
                Ok(())
            }
            Err(error) => Err(error),
        };
        SessionOpStep::Done(Box::new(GoalFailOpOutput { result }) as Box<dyn Any + Send>)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::GoalStatus;

    fn goal(max_turns: Option<i64>, max_wall_secs: Option<i64>, turns_used: i64) -> GoalRecord {
        GoalRecord {
            id: "goal-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            session_id: "session-1".to_string(),
            objective: "objective".to_string(),
            status: GoalStatus::Active,
            source_kind: "user".to_string(),
            source_run_id: None,
            token_budget: None,
            max_turns,
            max_wall_secs,
            tokens_used: None,
            time_used_secs: None,
            turns_used,
            met_reason: None,
            native_state_json: String::new(),
            revision: 1,
            created_at: "2026-07-02T00:00:00Z".to_string(),
            updated_at: "2026-07-02T00:00:00Z".to_string(),
            met_at: None,
        }
    }

    #[test]
    fn budget_exhausted_when_max_turns_reached() {
        let now = chrono::Utc::now();
        assert!(!budget_exhausted(&goal(Some(3), None, 2), now));
        assert!(budget_exhausted(&goal(Some(3), None, 3), now));
        assert!(budget_exhausted(&goal(Some(3), None, 4), now));
    }

    #[test]
    fn budget_exhausted_when_wall_clock_elapsed() {
        let created = chrono::Utc::now() - chrono::Duration::seconds(120);
        let mut record = goal(None, Some(60), 0);
        record.created_at = created.to_rfc3339();
        assert!(budget_exhausted(&record, chrono::Utc::now()));

        let mut fresh = goal(None, Some(600), 0);
        fresh.created_at = chrono::Utc::now().to_rfc3339();
        assert!(!budget_exhausted(&fresh, chrono::Utc::now()));
    }

    #[test]
    fn no_caps_never_exhausts() {
        assert!(!budget_exhausted(&goal(None, None, 1000), chrono::Utc::now()));
    }
}
