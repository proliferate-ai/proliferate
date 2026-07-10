//! The per-run actor loop. One actor drives one run: it repeatedly asks the
//! service to run the next step, advancing the cursor, until the run suspends on
//! an approval or reaches a terminal state. The service persists the step run
//! before/after each step, so a crash simply respawns the actor at the cursor.

use anyharness_contract::v1::WorkflowRunStatus;

use crate::domains::workflows::engine::{CancelToken, EngineProgress, WorkflowStepExecutor};
use crate::domains::workflows::plan::{self, PlanSegment};
use crate::domains::workflows::service::WorkflowService;

/// Drive the run to a resting point (terminal or suspended-for-approval),
/// returning how it came to rest. A driver-level error (a malformed plan
/// surfacing mid-run, or a store failure) fails the run with `engine_error`.
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
            Ok(None) => return EngineProgress::Finished(WorkflowRunStatus::Failed),
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
            let _ = service.mark_run_terminal(run_id, WorkflowRunStatus::Completed, None, None);
            return EngineProgress::Finished(WorkflowRunStatus::Completed);
        }
        let Some(segment) = plan.segment_containing(cursor) else {
            let _ = service.mark_run_terminal(run_id, WorkflowRunStatus::Completed, None, None);
            return EngineProgress::Finished(WorkflowRunStatus::Completed);
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
    service: &WorkflowService,
    run_id: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> EngineProgress {
    let _ = service.mark_run_terminal(
        run_id,
        WorkflowRunStatus::Failed,
        Some("engine_error".to_string()),
        Some(error.to_string()),
    );
    EngineProgress::Finished(WorkflowRunStatus::Failed)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use anyharness_contract::v1::WorkflowStepStatus;

    use super::*;
    use crate::app::test_support;
    use crate::domains::workflows::engine::{StepExecContext, StepOutcome};
    use crate::domains::workflows::plan::{PlanGateway, PlanStep};
    use crate::domains::workflows::store::WorkflowStore;
    use crate::live::workflows::gateway::{fire_run_ping, RunPingSink};
    use crate::persistence::Db;

    use crate::live::workflows::gateway::test_support::RecordingPingSink;

    /// A scripted executor that wires the real per-run ping seam through a
    /// recording sink: its `on_step_transition` is exactly what the live
    /// executor does, so the drive loop's "ping after every transition"
    /// contract is exercised end-to-end.
    struct PingingExecutor {
        outcomes: Mutex<VecDeque<StepOutcome>>,
        gateway: Option<PlanGateway>,
        sink: Arc<RecordingPingSink>,
    }

    impl PingingExecutor {
        fn new(
            outcomes: Vec<StepOutcome>,
            gateway: Option<PlanGateway>,
            sink: Arc<RecordingPingSink>,
        ) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into_iter().collect()),
                gateway,
                sink,
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
            fire_run_ping(self.gateway.as_ref(), self.sink.as_ref());
        }
    }

    fn gateway() -> PlanGateway {
        PlanGateway {
            url: "https://cloud.test/mcp".to_string(),
            authorization: "Bearer per-run".to_string(),
            ping_url: "https://cloud.test/runs/run-1/ping".to_string(),
            integrations: Vec::new(),
        }
    }

    fn service_with_run(steps: &str) -> (WorkflowService, String) {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        let service = WorkflowService::new(WorkflowStore::new(db));
        let plan_json = format!(
            r#"{{
                "run_id": "run-1",
                "setup": {{ "harness": "claude", "session_binding": "fresh" }},
                "steps": {steps}
            }}"#
        );
        let (run, created) = service
            .create_run_idempotent(&plan_json, "workspace-1")
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
        let sink = Arc::new(RecordingPingSink::new());
        let executor =
            PingingExecutor::new(vec![completed(), completed(), completed()], Some(gateway()), sink.clone());
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
        assert_eq!(sink.count(), 3, "one ping per applied transition");
        let calls = sink.calls.lock().unwrap();
        assert!(calls
            .iter()
            .all(|(url, auth)| url == "https://cloud.test/runs/run-1/ping"
                && auth == "Bearer per-run"));
    }

    #[tokio::test]
    async fn ping_fires_on_the_terminal_failure_transition() {
        // A stop-on-fail step fails the run: the single failing transition is
        // still pinged (the run is now terminal, and the server must be nudged).
        let (service, run_id) = service_with_run(
            r#"[{ "kind": "shell.run", "command": "x", "on_fail": { "kind": "stop" } }]"#,
        );
        let sink = Arc::new(RecordingPingSink::new());
        let executor = PingingExecutor::new(
            vec![StepOutcome::Failed {
                code: "nonzero_exit".to_string(),
                message: None,
                output: None,
            }],
            Some(gateway()),
            sink.clone(),
        );
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Failed));
        assert_eq!(sink.count(), 1);
    }

    #[tokio::test]
    async fn no_gateway_block_produces_no_pings_but_still_completes() {
        let (service, run_id) = service_with_run(
            r#"[{ "kind": "shell.run", "command": "a" }, { "kind": "shell.run", "command": "b" }]"#,
        );
        let sink = Arc::new(RecordingPingSink::new());
        let executor = PingingExecutor::new(vec![completed(), completed()], None, sink.clone());
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
        assert_eq!(sink.count(), 0);
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
        impl RunPingSink for InertFailingSink {
            fn fire(&self, _ping_url: &str, _authorization: &str) {
                // Simulate a failed POST that is swallowed (as HttpRunPingSink
                // does): record that we tried, return normally.
                *self.fired.lock().unwrap() += 1;
            }
        }
        struct InertExecutor {
            sink: Arc<InertFailingSink>,
            gateway: PlanGateway,
        }
        #[async_trait::async_trait]
        impl WorkflowStepExecutor for InertExecutor {
            async fn execute_step(&self, _step: &PlanStep, _ctx: &StepExecContext) -> StepOutcome {
                StepOutcome::Completed {
                    output: serde_json::json!({}),
                }
            }
            fn on_step_transition(&self) {
                fire_run_ping(Some(&self.gateway), self.sink.as_ref());
            }
        }

        let (service, run_id) =
            service_with_run(r#"[{ "kind": "shell.run", "command": "a" }]"#);
        let sink = Arc::new(InertFailingSink {
            fired: Mutex::new(0),
        });
        let executor = InertExecutor {
            sink: sink.clone(),
            gateway: gateway(),
        };
        let cancel = CancelToken::new();
        let progress = drive_run(&service, &executor, &run_id, &cancel).await;
        assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
        let (_, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
        assert!(steps.iter().all(|s| s.status == WorkflowStepStatus::Completed));
        assert_eq!(*sink.fired.lock().unwrap(), 1);
    }
}
