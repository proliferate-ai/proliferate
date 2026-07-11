//! `agent.goal` waiting: arm/clear the goal, await its terminal state off the
//! session's broadcast stream (mirroring live progress via
//! [`super::observation`]), and drive the optional verify-shell retry loop.
//! Split out of [`super::agent_turn`] for line budget (same session/turn
//! cluster). Moved verbatim out of `executor.rs` (WS0B-R).

use std::time::{Duration, Instant};

use anyharness_contract::v1::{
    Goal, GoalArmState, GoalSourceKind, GoalStatus, SessionEvent, SessionEventEnvelope,
    SetSessionGoalRequest,
};
use serde_json::json;
use tokio::sync::broadcast;

use crate::domains::goals::runtime::GoalOpError;
use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{AgentPromptStep, GoalSpec, OnBlocked};

use super::turn::InjectionMeta;
use super::executor::{failed, failed_msg, WorkflowStepExecutorImpl};
use super::observation::{goal_progress_changed, GoalSnapshot};

/// Grace added to `max_wall_secs` for the actor-side goal backstop (the goal cap
/// guard fires on turn boundaries; this catches a hung in-flight turn).
const GOAL_BACKSTOP_GRACE: Duration = Duration::from_secs(60);
const VERIFY_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_VERIFY_ATTEMPTS: u32 = 3;

impl WorkflowStepExecutorImpl {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn run_goal(
        &self,
        slot: &str,
        agent: &AgentPromptStep,
        goal: &GoalSpec,
        step_index: usize,
        meta: &InjectionMeta,
        scope: &str,
    ) -> StepOutcome {
        let session_id = match self.ensure_session(slot, scope).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        let deadline =
            Instant::now() + Duration::from_secs(goal.max_wall_secs) + GOAL_BACKSTOP_GRACE;
        let mut prompt = agent.prompt.clone();
        let mut verify_attempts = 0u32;
        // Live progress: while awaiting the goal's terminal state, mirror each
        // changed GoalUpdated into the RUNNING step's output_json under `goal`
        // so the run timeline can render honest iteration/token counters.
        let mut last_snapshot: Option<GoalSnapshot> = None;
        let mut on_progress = |g: &Goal| {
            let snapshot = GoalSnapshot::from_goal(g);
            if goal_progress_changed(last_snapshot.as_ref(), &snapshot) {
                let _ = self.deps.workflow_service.record_step_goal_progress(
                    &self.run_id,
                    step_index as i64,
                    snapshot.to_output_json(&session_id),
                );
                last_snapshot = Some(snapshot);
            }
        };

        loop {
            if let Err(outcome) = self.arm_goal(&session_id, goal).await {
                return outcome;
            }
            let mut events = match self.subscribe(&session_id).await {
                Ok(events) => events,
                Err(outcome) => return outcome,
            };
            if let Err(outcome) = self.send_prompt(&session_id, &prompt, meta).await {
                return outcome;
            }
            match await_goal_terminal(&mut events, deadline, goal.on_blocked, &mut on_progress).await {
                GoalWait::Met { met_reason } => match &goal.verify {
                    None => {
                        return StepOutcome::Completed {
                            output: json!({ "session_id": session_id, "met_reason": met_reason }),
                        }
                    }
                    Some(verify) => {
                        let (workspace_path, env) = match self.workspace_ctx(scope).await {
                            Ok(ctx) => ctx,
                            Err(outcome) => return outcome,
                        };
                        let (exit, tail) = super::commands::run_verify_shell(
                            &workspace_path,
                            &env,
                            &verify.shell,
                            VERIFY_TIMEOUT,
                        )
                        .await;
                        if exit == Some(verify.expect_exit) {
                            return StepOutcome::Completed {
                                output: json!({
                                    "session_id": session_id,
                                    "met_reason": met_reason,
                                    "verified": true,
                                    "verify_attempts": verify_attempts,
                                }),
                            };
                        }
                        verify_attempts += 1;
                        if verify_attempts >= MAX_VERIFY_ATTEMPTS {
                            self.clear_goal(&session_id).await;
                            return StepOutcome::Failed {
                                code: "verify_exhausted".to_string(),
                                message: Some(format!("verification failed {verify_attempts} times")),
                                output: Some(json!({
                                    "session_id": session_id,
                                    "verify_attempts": verify_attempts,
                                    "output_tail": tail,
                                })),
                            };
                        }
                        // Re-arm + feedback prompt, still counting against caps.
                        prompt = format!(
                            "goal claimed met but verification failed:\n{}",
                            verify_feedback_tail(&tail)
                        );
                    }
                },
                GoalWait::Failed { reason } => {
                    return StepOutcome::Failed {
                        code: reason,
                        message: None,
                        output: Some(json!({ "session_id": session_id })),
                    }
                }
                GoalWait::Blocked => match goal.on_blocked {
                    OnBlocked::Fail => return failed("goal_blocked"),
                    OnBlocked::PauseForApproval => {
                        return StepOutcome::AwaitApproval {
                            descriptor: json!({
                                "kind": "goal_block",
                                "session_id": session_id,
                                "message": "goal is blocked; approve to continue",
                            }),
                        }
                    }
                    // Notify never surfaces Blocked here (the wait keeps going).
                    OnBlocked::Notify => {}
                },
                GoalWait::Timeout => {
                    self.clear_goal(&session_id).await;
                    return StepOutcome::Failed {
                        code: "goal_timeout".to_string(),
                        message: Some("goal did not reach a terminal state in time".to_string()),
                        output: Some(json!({ "session_id": session_id })),
                    };
                }
            }
        }
    }

    async fn arm_goal(&self, session_id: &str, goal: &GoalSpec) -> Result<(), StepOutcome> {
        let request = SetSessionGoalRequest {
            objective: Some(goal.objective.clone()),
            status: Some(GoalArmState::Active),
            token_budget: goal.token_budget,
            max_turns: Some(goal.max_turns),
            max_wall_secs: Some(goal.max_wall_secs),
            source_kind: Some(GoalSourceKind::Workflow),
            source_run_id: Some(self.run_id.clone()),
        };
        match self.deps.goal_runtime.set_goal(session_id, request).await {
            Ok(_) => Ok(()),
            Err(GoalOpError::Unsupported) => Err(failed("goals_unsupported")),
            Err(error) => Err(failed_msg("goal_arm_failed", error.to_string())),
        }
    }

    async fn clear_goal(&self, session_id: &str) {
        let _ = self.deps.goal_runtime.clear_goal(session_id).await;
    }
}

#[derive(Debug)]
enum GoalWait {
    Met { met_reason: Option<String> },
    Failed { reason: String },
    Blocked,
    Timeout,
}

/// Await a terminal goal state. A cap breach arrives as `GoalUpdated(failed)`
/// carrying `failedReason`. On `blocked`, `notify` keeps waiting (the goal may
/// unblock); `fail`/`pause_for_approval` return `Blocked` for the caller.
async fn await_goal_terminal(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    deadline: Instant,
    on_blocked: OnBlocked,
    on_progress: &mut (dyn FnMut(&Goal) + Send),
) -> GoalWait {
    let deadline = tokio::time::Instant::from_std(deadline);
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => match &envelope.event {
                SessionEvent::GoalMet(payload) => {
                    return GoalWait::Met {
                        met_reason: payload.goal.met_reason.clone(),
                    }
                }
                SessionEvent::GoalUpdated(payload) => {
                    // Mirror every observed goal update as a live progress
                    // snapshot (the callback throttles unchanged values).
                    on_progress(&payload.goal);
                    match payload.goal.status {
                    GoalStatus::Failed => {
                        return GoalWait::Failed {
                            reason: payload
                                .goal
                                .failed_reason
                                .clone()
                                .unwrap_or_else(|| "goal_failed".to_string()),
                        }
                    }
                    GoalStatus::Met => {
                        return GoalWait::Met {
                            met_reason: payload.goal.met_reason.clone(),
                        }
                    }
                    GoalStatus::Blocked => match on_blocked {
                        OnBlocked::Notify => continue,
                        _ => return GoalWait::Blocked,
                    },
                    _ => {}
                    }
                }
                SessionEvent::GoalCleared(_) => {
                    return GoalWait::Failed {
                        reason: "goal_cleared".to_string(),
                    }
                }
                SessionEvent::SessionEnded(_) => {
                    return GoalWait::Failed {
                        reason: "session_closed".to_string(),
                    }
                }
                // A turn that errors out (API/model failure, connection loss)
                // is fatal to the goal: the agent can no longer make progress,
                // so fail the step immediately rather than waiting out the
                // wall-clock backstop. Note we deliberately do NOT treat
                // `TurnEnded` as terminal — goal iteration ends turns
                // repeatedly, and only an actual error stops progress.
                SessionEvent::Error(payload) => {
                    return GoalWait::Failed {
                        reason: format!("turn_error: {}", payload.message),
                    }
                }
                _ => {}
            },
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => {
                return GoalWait::Failed {
                    reason: "session_closed".to_string(),
                }
            }
            Err(_) => return GoalWait::Timeout,
        }
    }
}

fn verify_feedback_tail(tail: &str) -> String {
    const MAX: usize = 2000;
    if tail.len() <= MAX {
        return tail.to_string();
    }
    let mut start = tail.len() - MAX;
    while start < tail.len() && !tail.is_char_boundary(start) {
        start += 1;
    }
    tail[start..].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(event: SessionEvent) -> SessionEventEnvelope {
        SessionEventEnvelope {
            session_id: "sess_1".to_string(),
            seq: 1,
            timestamp: "2026-07-05T00:00:00Z".to_string(),
            turn_id: None,
            item_id: None,
            event,
        }
    }

    // Regression: a turn that errors out (bad model, API failure) must fail the
    // goal step immediately, not hang until the wall-clock backstop. Before the
    // `SessionEvent::Error` arm, this waited out `deadline` and returned Timeout.
    #[tokio::test]
    async fn goal_await_fails_fast_on_turn_error() {
        let (tx, mut rx) = broadcast::channel(16);
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        tx.send(envelope(SessionEvent::Error(
            anyharness_contract::v1::ErrorEvent {
                message: "API Error (claude-fable-5): 400 invalid model".to_string(),
                code: None,
                details: None,
            },
        )))
        .unwrap();
        let mut noop = |_: &Goal| {};
        let result = await_goal_terminal(&mut rx, deadline, OnBlocked::Fail, &mut noop).await;
        match result {
            GoalWait::Failed { reason } => {
                assert!(reason.starts_with("turn_error:"), "reason was {reason}");
                assert!(reason.contains("invalid model"));
            }
            other => panic!("expected Failed on turn error, got {other:?}"),
        }
    }
}
