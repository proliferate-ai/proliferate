//! The step-engine seam: the [`WorkflowStepExecutor`] trait (implemented by the
//! live layer, faked in tests), the typed step outcome/decision vocabulary, and
//! the pure on-fail decision function. The async driver that persists the cursor
//! and applies decisions lives on [`super::service::WorkflowService`]; keeping
//! the decision logic pure here is what lets the on-fail matrix be unit-tested
//! without any live execution.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyharness_contract::v1::WorkflowRunStatus;

use super::plan::{OnFail, OnFailKind, PlanStep};

/// A cooperative cancellation flag shared between the run's manager and the
/// engine. Checked at step boundaries; a live turn in flight is cancelled by the
/// manager tearing down the session, not by this flag alone.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Context handed to the executor for one step execution.
#[derive(Debug, Clone)]
pub struct StepExecContext {
    pub run_id: String,
    pub workspace_id: String,
    pub step_index: usize,
    /// 1-based attempt number for this step (bumped on each retry).
    pub attempt: i64,
    /// True when this execution follows an approve of a step that was parked on
    /// a durable approval (an `agent.goal` pause-for-approval block). The
    /// executor should re-arm/continue rather than start fresh.
    pub resumed_after_approval: bool,
    /// True when this execution RE-ENTERS a step that was left `running` by a
    /// crash (WS5b, spec §6.5): the previous attempt persisted its step as
    /// `running` but never applied a decision, so an externally meaningful
    /// effect may have started. The executor consults the effect ledger for the
    /// crashed attempt (`attempt - 1`) and applies the recovery matrix BEFORE
    /// re-running anything. A fresh first run and an `on_fail: retry` re-run both
    /// leave this `false` (a retry decision persists the step as `pending`).
    pub crash_resumed: bool,
}

/// The result of executing one step.
#[derive(Debug)]
pub enum StepOutcome {
    /// The step succeeded; `output` is the typed step output (also the source
    /// for `{{steps[N].output.*}}` late-binding by later steps).
    Completed { output: serde_json::Value },
    /// The step failed with a typed code; the per-step `on_fail` policy decides
    /// what happens to the run. `output` is preserved for template late-binding
    /// even when the run continues past the failure.
    Failed {
        code: String,
        message: Option<String>,
        output: Option<serde_json::Value>,
    },
    /// The step needs a human decision; the run parks on a durable approval.
    /// `descriptor` is persisted as the waiting step's output (message, kind,
    /// deadline) so the wait survives a restart.
    AwaitApproval { descriptor: serde_json::Value },
    /// The step succeeded AND requested the run end here (a `branch` step whose
    /// taken case is `end`, C11/E5): the step is recorded completed with
    /// `output`, the run goes terminal `completed`, and every later step is
    /// marked `skipped`. Not subject to the on_fail matrix — `end` is a success.
    EndRun { output: serde_json::Value },
    /// A crash left an externally meaningful effect's outcome unprovable
    /// (WS5b, spec §6.5 / plan §7.3). Uncertainty is TERMINAL for the attempt:
    /// `on_fail` never retries or continues past it — the run fails with a typed
    /// error naming the effect, and the completed-or-not external effect stays
    /// durable and auditable. `effect` is the effect kind slug (agent_turn /
    /// shell / scm / action / gateway); `detail` is an optional non-secret note.
    OutcomeUncertain {
        effect: String,
        detail: Option<String>,
    },
}

/// The decision the pure on-fail logic reaches for a completed executor call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepDecision {
    Complete {
        output: serde_json::Value,
    },
    /// Re-run the same step (attempt++), cursor unchanged.
    Retry,
    /// Fail the run with the step's error.
    FailRun {
        code: String,
        message: Option<String>,
        output: Option<serde_json::Value>,
    },
    /// Mark the step failed but advance past it.
    Continue {
        code: String,
        message: Option<String>,
        output: Option<serde_json::Value>,
    },
    /// Park the run on a durable approval.
    Suspend {
        descriptor: serde_json::Value,
    },
    /// Complete this step and end the run early, marking every later step
    /// `skipped` (branch `end`, C11/E5).
    EndRun {
        output: serde_json::Value,
    },
}

/// How far the engine got on a single `run_next_step` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineProgress {
    /// The cursor moved (advanced or a retry was re-queued); keep driving.
    Advanced,
    /// A bounded sequential segment (L30) ran its last step and the cursor now
    /// sits at the next segment's start (a parallel group). The run is NOT
    /// terminal; the actor advances to drive the next segment. Never produced by
    /// an unbounded (flat) run — its only boundary is the plan end, which yields
    /// `Finished`.
    SegmentComplete,
    /// The run parked on a durable approval; stop driving until it resolves.
    SuspendedForApproval,
    /// The run reached a terminal state.
    Finished(WorkflowRunStatus),
}

/// Pure on-fail decision: given the step's failure policy, the attempt just run,
/// and the executor outcome, decide what the engine should persist next.
pub fn decide_after_step(on_fail: OnFail, attempt: i64, outcome: StepOutcome) -> StepDecision {
    match outcome {
        StepOutcome::Completed { output } => StepDecision::Complete { output },
        StepOutcome::AwaitApproval { descriptor } => StepDecision::Suspend { descriptor },
        // `end` is a deliberate success route, never a failure — the on_fail
        // matrix does not apply.
        StepOutcome::EndRun { output } => StepDecision::EndRun { output },
        // An uncertain external effect is TERMINAL for the attempt (spec §6.5 /
        // plan §7.3): `on_fail` NEVER retries or continues past it — you cannot
        // safely re-run or skip an effect whose outcome you don't know. It fails
        // the run with a typed `outcome_uncertain` code naming the effect,
        // regardless of the step's `on_fail` policy.
        StepOutcome::OutcomeUncertain { effect, detail } => StepDecision::FailRun {
            code: "outcome_uncertain".to_string(),
            message: Some(match detail {
                Some(detail) => format!("{effect} effect outcome is uncertain: {detail}"),
                None => format!("{effect} effect outcome is uncertain"),
            }),
            output: Some(serde_json::json!({
                "outcome_uncertain": true,
                "effect": effect,
            })),
        },
        StepOutcome::Failed {
            code,
            message,
            output,
        } => match on_fail.kind {
            OnFailKind::Stop => StepDecision::FailRun {
                code,
                message,
                output,
            },
            OnFailKind::Continue => StepDecision::Continue {
                code,
                message,
                output,
            },
            OnFailKind::Retry => {
                // `n` retries after the first failure: attempt 1 with n=1 retries
                // once (attempt 2); attempt 2 with n=1 is exhausted → fail.
                if attempt <= i64::from(on_fail.n) {
                    StepDecision::Retry
                } else {
                    StepDecision::FailRun {
                        code,
                        message,
                        output,
                    }
                }
            }
        },
    }
}

/// The executor seam: the live layer implements this to actually drive sessions,
/// goals, shells, PRs, and notifications; tests fake it.
#[async_trait::async_trait]
pub trait WorkflowStepExecutor: Send + Sync {
    /// Execute one already-template-resolved step. Idempotent re-entry is the
    /// executor's concern: agent steps re-send a prompt as a NEW turn (unless a
    /// recorded turn already landed), and goal re-arm is allowed.
    async fn execute_step(&self, step: &PlanStep, ctx: &StepExecContext) -> StepOutcome;

    /// Called by the driver after every step transition is applied (§3.7/L16).
    /// The live executor fires the per-run completion ping here; the default is
    /// a no-op so scripted test executors need not implement it. Must be
    /// fire-and-forget: a slow or failing side effect here may never stall or
    /// fail the run (the cursor has already moved).
    fn on_step_transition(&self) {}

    /// Merge every finished lane's work back into the run-level worktree, in the
    /// given lane order (L30 / M2). Called by the driver at a CLEAN parallel-group
    /// join (every lane completed), BEFORE the cursor advances past the group, so
    /// post-group steps + `scm.open_pr` see the merged result. A merge conflict
    /// must surface as `Err(StepOutcome::Failed { code: "lane_merge_conflict", .. })`
    /// naming the lane — conflicting parallel work is a legitimate, honest failure,
    /// never silently dropped. Idempotent: a lane already merged (crash-resume
    /// mid-merge) is skipped. The default is a no-op so scripted test executors and
    /// the workspace-isolation path (everything shares the pinned checkout) need do
    /// nothing.
    async fn merge_lanes_into_run_worktree(&self, _lanes: &[String]) -> Result<(), StepOutcome> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on_fail(kind: OnFailKind, n: u32) -> OnFail {
        OnFail { kind, n }
    }

    fn failed() -> StepOutcome {
        StepOutcome::Failed {
            code: "boom".to_string(),
            message: None,
            output: None,
        }
    }

    #[test]
    fn completed_always_completes_regardless_of_policy() {
        let decision = decide_after_step(
            on_fail(OnFailKind::Stop, 0),
            1,
            StepOutcome::Completed {
                output: serde_json::json!({ "ok": true }),
            },
        );
        assert!(matches!(decision, StepDecision::Complete { .. }));
    }

    #[test]
    fn stop_fails_the_run() {
        let decision = decide_after_step(on_fail(OnFailKind::Stop, 0), 1, failed());
        assert!(matches!(decision, StepDecision::FailRun { .. }));
    }

    #[test]
    fn continue_advances_past_failure() {
        let decision = decide_after_step(on_fail(OnFailKind::Continue, 0), 1, failed());
        assert!(matches!(decision, StepDecision::Continue { .. }));
    }

    #[test]
    fn retry_reruns_until_exhausted_then_fails() {
        // n = 1 → attempt 1 retries, attempt 2 fails.
        assert_eq!(
            decide_after_step(on_fail(OnFailKind::Retry, 1), 1, failed()),
            StepDecision::Retry
        );
        assert!(matches!(
            decide_after_step(on_fail(OnFailKind::Retry, 1), 2, failed()),
            StepDecision::FailRun { .. }
        ));
    }

    fn uncertain() -> StepOutcome {
        StepOutcome::OutcomeUncertain {
            effect: "shell".to_string(),
            detail: Some("process group lost".to_string()),
        }
    }

    #[test]
    fn outcome_uncertain_fails_the_run_naming_the_effect() {
        let decision = decide_after_step(on_fail(OnFailKind::Stop, 0), 1, uncertain());
        match decision {
            StepDecision::FailRun { code, message, output } => {
                assert_eq!(code, "outcome_uncertain");
                assert!(message.unwrap().contains("shell"));
                let output = output.unwrap();
                assert_eq!(output["outcome_uncertain"], true);
                assert_eq!(output["effect"], "shell");
            }
            other => panic!("expected FailRun(outcome_uncertain), got {other:?}"),
        }
    }

    #[test]
    fn outcome_uncertain_never_retries_even_with_budget_remaining() {
        // on_fail: retry with budget left would retry an ORDINARY failure — but an
        // uncertain effect is terminal for the attempt and must NOT retry.
        assert!(matches!(
            decide_after_step(on_fail(OnFailKind::Retry, 5), 1, uncertain()),
            StepDecision::FailRun { .. }
        ));
    }

    #[test]
    fn outcome_uncertain_never_continues_past_the_effect() {
        // on_fail: continue would advance past an ORDINARY failure — but an
        // uncertain effect must fail the run, never be skipped.
        assert!(matches!(
            decide_after_step(on_fail(OnFailKind::Continue, 0), 1, uncertain()),
            StepDecision::FailRun { .. }
        ));
    }

    #[test]
    fn await_approval_suspends() {
        let decision = decide_after_step(
            on_fail(OnFailKind::Stop, 0),
            1,
            StepOutcome::AwaitApproval {
                descriptor: serde_json::json!({ "message": "ok?" }),
            },
        );
        assert!(matches!(decision, StepDecision::Suspend { .. }));
    }

    #[test]
    fn cancel_token_flips() {
        let token = CancelToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }
}
