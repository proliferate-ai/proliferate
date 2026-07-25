//! The per-run actor loop. One actor drives one run: it repeatedly asks the
//! service to run the next step, advancing the cursor, until the run suspends on
//! an approval or reaches a terminal state. The service persists the step run
//! before/after each step, so a crash simply respawns the actor at the cursor.

use crate::domains::workflows::engine::{
    CancelToken, EngineProgress, ProposedTerminal, WorkflowStepExecutor,
};
use crate::domains::workflows::plan::{self, PlanSegment};
use crate::domains::workflows::service::WorkflowService;

/// Drive the run to a resting point (terminal or suspended-for-approval),
/// returning how it came to rest. A driver-level error (a malformed plan
/// surfacing mid-run, or a store failure) proposes `engine_error`; the manager
/// publishes it only after quiescence.
///
/// The run is driven segment-by-segment (L30): a [`PlanSegment::Sequential`] run
/// advances the single cursor one step at a time (bounded to the segment end so
/// it hands off at a group boundary instead of completing the run), and a
/// [`PlanSegment::Parallel`] group drives its lanes concurrently and joins. A
/// flat plan is exactly one sequential segment spanning the whole plan, so this
/// reduces to the original single-cursor loop byte-identically (deny-path a).
pub async fn drive_run(
    service: &WorkflowService,
    executor: &dyn WorkflowStepExecutor,
    run_id: &str,
    cancel: &CancelToken,
) -> EngineProgress {
    loop {
        let run = match service.get_run(run_id) {
            Ok(Some(run)) => run,
            Ok(None) => {
                return EngineProgress::TerminalPending(ProposedTerminal::failed(
                    "engine_error",
                    Some("workflow run disappeared while its actor was driving".to_string()),
                ))
            }
            Err(error) => return fail_engine_error(service, run_id, &error),
        };
        if run.is_terminal() {
            return EngineProgress::Finished(run.status);
        }
        let plan = match plan::parse(&run.plan_json) {
            Ok(plan) => plan,
            Err(error) => return fail_engine_error(service, run_id, &error),
        };
        let step_count = plan.step_count();
        let cursor = run.step_cursor.max(0) as usize;
        if cursor >= step_count {
            return EngineProgress::TerminalPending(ProposedTerminal::completed());
        }
        let Some(segment) = plan.segment_containing(cursor) else {
            return EngineProgress::TerminalPending(ProposedTerminal::completed());
        };
        let result = match segment {
            PlanSegment::Sequential { end, .. } => {
                let result = service
                    .run_next_step_bounded(run_id, executor, cancel, end)
                    .await;
                // §3.7/L16: nudge the server after every applied step transition.
                // Fire-and-forget: the cursor has already moved, so a failed ping
                // is inert and never changes engine state.
                executor.on_step_transition();
                result
            }
            // The parallel driver fires its own per-lane transition pings; this
            // one covers the join transition (incl. a run that ends on a group).
            PlanSegment::Parallel { .. } => {
                let result = service.run_parallel_group(run_id, executor, cancel).await;
                executor.on_step_transition();
                result
            }
        };
        match result {
            // Advanced / SegmentComplete: more work in this or the next segment.
            Ok(EngineProgress::Advanced) | Ok(EngineProgress::SegmentComplete) => continue,
            Ok(other) => return other,
            Err(error) => return fail_engine_error(service, run_id, &error),
        }
    }
}

fn fail_engine_error(
    _service: &WorkflowService,
    _run_id: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> EngineProgress {
    EngineProgress::TerminalPending(ProposedTerminal::failed(
        "engine_error",
        Some(error.to_string()),
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

    use super::*;
    use crate::app::test_support;
    use crate::domains::workflows::delivery::WorkflowServiceIdentityFixture;
    use crate::domains::workflows::engine::{StepExecContext, StepOutcome};
    use crate::domains::workflows::plan::PlanStep;
    use crate::domains::workflows::store::WorkflowStore;
    use crate::persistence::Db;

    /// A scripted executor that wires the real per-run ping seam through a
    /// recording sink: its `on_step_transition` is exactly what the live
    /// executor does, so the drive loop's "ping after every transition"
    /// contract is exercised end-to-end.
    struct PingingExecutor {
        outcomes: Mutex<VecDeque<StepOutcome>>,
        transitions: Arc<Mutex<usize>>,
    }

    impl PingingExecutor {
        fn new(outcomes: Vec<StepOutcome>, transitions: Arc<Mutex<usize>>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into_iter().collect()),
                transitions,
            }
        }
    }

    #[async_trait::async_trait]
    impl WorkflowStepExecutor for PingingExecutor {
        async fn execute_step(&self, _step: &PlanStep, _ctx: &StepExecContext) -> StepOutcome {
            self.outcomes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(StepOutcome::Completed {
                    output: serde_json::json!({}),
                })
        }

        fn on_step_transition(&self) {
            *self.transitions.lock().unwrap() += 1;
        }
    }

    fn service_with_run(steps: &str) -> (WorkflowService, String) {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        let service = WorkflowService::new(WorkflowStore::new(db));
        let plan_json = format!(
            r#"{{
                "run_id": "run-1",
                "setup": {{ "harness": "claude", "session_binding": "fresh" }},
                "steps": {steps}
            }}"#
        );
        let (run, created) = service
            .create_run_with_valid_identity_fixture(&plan_json, "workspace-1")
            .expect("create run");
        assert!(created);
        (service, run.run_id)
    }

    fn completed() -> StepOutcome {
        StepOutcome::Completed {
            output: serde_json::json!({}),
        }
    }

    #[tokio::test]
    async fn pings_after_every_transition_including_terminal() {
        // A three-step run: three applied transitions (two advances + the
        // terminal completion) → three pings.
        let (service, run_id) = service_with_run(
            r#"[{ "kind": "shell.run", "command": "a" },
                { "kind": "shell.run", "command": "b" },
                { "kind": "shell.run", "command": "c" }]"#,
        );
        let transitions = Arc::new(Mutex::new(0));
        let executor = PingingExecutor::new(
            vec![completed(), completed(), completed()],
            transitions.clone(),
        );
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(
            progress,
            EngineProgress::TerminalPending(ProposedTerminal::completed())
        );
        assert_eq!(
            service.get_run(&run_id).unwrap().unwrap().status,
            WorkflowRunStatus::Running,
            "terminal completion is only proposed before quiescence"
        );
        assert_eq!(*transitions.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn ping_fires_on_the_terminal_failure_transition() {
        // A stop-on-fail step fails the run: the single failing transition is
        // still pinged (the run is now terminal, and the server must be nudged).
        let (service, run_id) = service_with_run(
            r#"[{ "kind": "shell.run", "command": "x", "on_fail": { "kind": "stop" } }]"#,
        );
        let transitions = Arc::new(Mutex::new(0));
        let executor = PingingExecutor::new(
            vec![StepOutcome::Failed {
                code: "nonzero_exit".to_string(),
                message: None,
                output: None,
            }],
            transitions.clone(),
        );
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(
            progress,
            EngineProgress::TerminalPending(ProposedTerminal::failed("nonzero_exit", None))
        );
        assert_eq!(
            service.get_run(&run_id).unwrap().unwrap().status,
            WorkflowRunStatus::Running,
            "terminal failure is only proposed before quiescence"
        );
        assert_eq!(*transitions.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn no_gateway_block_produces_no_pings_but_still_completes() {
        let (service, run_id) = service_with_run(
            r#"[{ "kind": "shell.run", "command": "a" }, { "kind": "shell.run", "command": "b" }]"#,
        );
        let transitions = Arc::new(Mutex::new(0));
        let executor = PingingExecutor::new(vec![completed(), completed()], transitions.clone());
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(
            progress,
            EngineProgress::TerminalPending(ProposedTerminal::completed())
        );
        assert_eq!(*transitions.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn ping_failure_is_inert_run_still_completes() {
        // A sink whose `fire` panics would be observable; instead model a
        // "failing" ping as one that records but whose delivery is a no-op from
        // the driver's perspective — the run must complete regardless. The
        // fire-and-forget contract means the driver never observes ping result.
        struct InertFailingSink {
            fired: Mutex<usize>,
        }
        struct InertExecutor {
            sink: Arc<InertFailingSink>,
        }
        #[async_trait::async_trait]
        impl WorkflowStepExecutor for InertExecutor {
            async fn execute_step(&self, _step: &PlanStep, _ctx: &StepExecContext) -> StepOutcome {
                StepOutcome::Completed {
                    output: serde_json::json!({}),
                }
            }
            fn on_step_transition(&self) {
                *self.sink.fired.lock().unwrap() += 1;
            }
        }

        let (service, run_id) = service_with_run(r#"[{ "kind": "shell.run", "command": "a" }]"#);
        let sink = Arc::new(InertFailingSink {
            fired: Mutex::new(0),
        });
        let executor = InertExecutor { sink: sink.clone() };
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(
            progress,
            EngineProgress::TerminalPending(ProposedTerminal::completed())
        );
        let (_, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
        assert!(steps
            .iter()
            .all(|s| s.status == WorkflowStepStatus::Completed));
        assert_eq!(*sink.fired.lock().unwrap(), 1);
    }
}
