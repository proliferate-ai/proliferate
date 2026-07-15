use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde_json::json;

use super::*;
use anyharness_contract::v1::ConfigApplyState;

use crate::domains::sessions::runtime::{SendPromptError, TextPromptDispatchError};
use crate::domains::workflows::control::WorkflowRunGates;
use crate::domains::workflows::dispatch::{
    apply_prompt_dispatch_outcome, guarded_fail, ExecutionAbort,
};
use crate::domains::workflows::execution::effort_apply_allows_step;
use crate::domains::workflows::model::{
    workflow_prompt_id, PutWorkflowRunInput, PutWorkflowRunInputV2, WorkflowDefinition,
    WorkflowDefinitionV2, WorkflowHarnessConfig, WorkflowHarnessConfigV2, WorkflowInput,
    WorkflowInputType, WorkflowModelSelection, WorkflowPermissionPolicy, WorkflowPromptStep,
    WorkflowStage, WorkflowStageV2,
};
use crate::domains::workflows::model::{
    WorkflowInterruptionCode, WorkflowRunStatus, WorkflowStepStatus, WorkflowTurnOutcome,
};
use crate::domains::workflows::store::{FinishTurnStoreOutcome, WorkflowRunStore};
use crate::persistence::Db;

fn portable_input(workspace_id: &str) -> PutWorkflowRunInputV2 {
    PutWorkflowRunInputV2 {
        schema_version: 2,
        workspace_id: workspace_id.to_string(),
        definition: WorkflowDefinitionV2 {
            inputs: vec![WorkflowInput {
                name: "ticket".to_string(),
                input_type: WorkflowInputType::String,
                required: true,
            }],
            stages: vec![WorkflowStageV2 {
                harness_config: WorkflowHarnessConfigV2 {
                    agent_kind: "claude".to_string(),
                    model_selection: WorkflowModelSelection::Exact {
                        model_id: "sonnet".to_string(),
                    },
                    effort: None,
                    permission_policy: WorkflowPermissionPolicy::WorkflowDefault,
                },
                steps: vec![WorkflowPromptStep {
                    kind: "agent.prompt".to_string(),
                    prompt: "Investigate {{inputs.ticket}}".to_string(),
                }],
            }],
        },
        arguments: BTreeMap::from([("ticket".to_string(), json!("PROL-123"))]),
    }
}

#[test]
fn only_applied_effort_allows_the_workflow_step() {
    assert!(effort_apply_allows_step(Some(&ConfigApplyState::Applied)));
    assert!(!effort_apply_allows_step(Some(&ConfigApplyState::Queued)));
    assert!(!effort_apply_allows_step(None));
}

fn v1_input(workspace_id: &str) -> PutWorkflowRunInput {
    PutWorkflowRunInput {
        schema_version: 1,
        workspace_id: workspace_id.to_string(),
        definition: WorkflowDefinition {
            inputs: vec![WorkflowInput {
                name: "ticket".to_string(),
                input_type: WorkflowInputType::String,
                required: true,
            }],
            stages: vec![WorkflowStage {
                harness_config: WorkflowHarnessConfig {
                    agent_kind: "claude".to_string(),
                    model_id: Some("sonnet".to_string()),
                    mode_id: Some("bypassPermissions".to_string()),
                },
                steps: vec![WorkflowPromptStep {
                    kind: "agent.prompt".to_string(),
                    prompt: "Investigate {{inputs.ticket}}".to_string(),
                }],
            }],
        },
        arguments: BTreeMap::from([("ticket".to_string(), json!("PROL-123"))]),
    }
}

#[tokio::test]
async fn v2_run_gate_allows_one_lookup_and_schedule_then_replays_stored_plan() {
    const WORKSPACE_ID: &str = "20000000-0000-4000-8000-000000000002";
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
        Db::open_in_memory().expect("in-memory db"),
    )));
    let gates = Arc::new(WorkflowRunGates::new());
    let lookup_available = Arc::new(AtomicBool::new(true));
    let lookup_count = Arc::new(AtomicUsize::new(0));
    let schedule_count = Arc::new(AtomicUsize::new(0));
    let run_id = uuid::Uuid::new_v4().to_string();

    let mut tasks = Vec::new();
    for _ in 0..8 {
        let service = service.clone();
        let gates = gates.clone();
        let lookup_available = lookup_available.clone();
        let lookup_count = lookup_count.clone();
        let schedule_count = schedule_count.clone();
        let run_id = run_id.clone();
        tasks.push(tokio::spawn(async move {
            let prepared = service
                .prepare_v2(&run_id, portable_input(WORKSPACE_ID))
                .expect("prepare");
            let gate = gates.slot(&run_id).expect("gate");
            let _guard = gate.lock_owned().await;
            match service.inspect_v2(prepared.clone()).expect("inspect") {
                InspectV2Outcome::ExactReplay(view) => {
                    assert_eq!(view.resolved_plan.model_id, "sonnet");
                    false
                }
                InspectV2Outcome::Conflict => panic!("identical source conflicted"),
                InspectV2Outcome::Missing(_) => {
                    lookup_count.fetch_add(1, Ordering::SeqCst);
                    assert!(
                        lookup_available.swap(false, Ordering::SeqCst),
                        "a replay performed target lookup after the winner"
                    );
                    let rendered_prompt = service.render_v2(&prepared).expect("render");
                    let resolved = WorkflowResolvedPlanV2 {
                        workspace_id: WORKSPACE_ID.to_string(),
                        agent_kind: "claude".to_string(),
                        model_id: "sonnet".to_string(),
                        mode_id: "bypassPermissions".to_string(),
                        effort_config: None,
                        rendered_prompt,
                        prompt_id: workflow_prompt_id(&run_id),
                    };
                    match service.accept_v2(prepared, resolved).expect("accept") {
                        AcceptV2Outcome::Created { .. } => {
                            schedule_count.fetch_add(1, Ordering::SeqCst);
                            true
                        }
                        other => panic!("gate winner was not created: {other:?}"),
                    }
                }
            }
        }));
    }

    let mut created = 0;
    for task in tasks {
        created += usize::from(task.await.expect("join"));
    }
    assert_eq!(created, 1);
    assert_eq!(lookup_count.load(Ordering::SeqCst), 1);
    assert_eq!(schedule_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn shared_run_gate_makes_v1_winner_conflict_v2_without_lookup() {
    const WORKSPACE_ID: &str = "20000000-0000-4000-8000-000000000002";
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
        Db::open_in_memory().expect("in-memory db"),
    )));
    let gates = Arc::new(WorkflowRunGates::new());
    let lookup_count = Arc::new(AtomicUsize::new(0));
    let schedule_count = Arc::new(AtomicUsize::new(0));
    let run_id = uuid::Uuid::new_v4().to_string();
    let (v1_locked_tx, v1_locked_rx) = tokio::sync::oneshot::channel();
    let release_v1 = Arc::new(tokio::sync::Notify::new());

    let v1_task = {
        let service = service.clone();
        let gates = gates.clone();
        let schedule_count = schedule_count.clone();
        let run_id = run_id.clone();
        let release_v1 = release_v1.clone();
        tokio::spawn(async move {
            let gate = gates.slot(&run_id).expect("v1 gate");
            let _guard = gate.lock_owned().await;
            v1_locked_tx.send(()).expect("signal v1 lock");
            release_v1.notified().await;
            match service
                .accept(&run_id, v1_input(WORKSPACE_ID))
                .expect("accept v1")
            {
                AcceptOutcome::Created { .. } => {
                    schedule_count.fetch_add(1, Ordering::SeqCst);
                    true
                }
                other => panic!("v1 winner was not created: {other:?}"),
            }
        })
    };

    v1_locked_rx.await.expect("v1 acquired gate");
    let v2_task = {
        let service = service.clone();
        let gates = gates.clone();
        let lookup_count = lookup_count.clone();
        let run_id = run_id.clone();
        tokio::spawn(async move {
            let prepared = service
                .prepare_v2(&run_id, portable_input(WORKSPACE_ID))
                .expect("prepare v2");
            let gate = gates.slot(&run_id).expect("v2 gate");
            let _guard = gate.lock_owned().await;
            match service.inspect_v2(prepared).expect("inspect v2") {
                InspectV2Outcome::Conflict => true,
                InspectV2Outcome::Missing(_) => {
                    lookup_count.fetch_add(1, Ordering::SeqCst);
                    false
                }
                InspectV2Outcome::ExactReplay(_) => false,
            }
        })
    };

    release_v1.notify_one();
    assert!(v1_task.await.expect("join v1"));
    assert!(v2_task.await.expect("join v2"));
    assert_eq!(schedule_count.load(Ordering::SeqCst), 1);
    assert_eq!(lookup_count.load(Ordering::SeqCst), 0);
}

/// Drive a run through the exact service transitions `run_execution` performs
/// before step-8 dispatch (accept -> begin_run -> bind_session -> begin_step),
/// so the dispatch-decision tests below exercise the production path rather
/// than a fabricated row. Returns (run_id, session_id, prompt_id).
fn run_at_dispatch_boundary(service: &Arc<WorkflowRunService>) -> (String, String, String) {
    const WORKSPACE_ID: &str = "20000000-0000-4000-8000-000000000002";
    let run_id = uuid::Uuid::new_v4().to_string();
    let session_id = format!("session-{run_id}");
    let plan = match service
        .accept(&run_id, v1_input(WORKSPACE_ID))
        .expect("accept")
    {
        AcceptOutcome::Created { plan, .. } => plan,
        other => panic!("fresh run was not created: {other:?}"),
    };
    assert!(service.begin_run(&run_id).expect("begin_run"));
    assert!(service
        .bind_session(&run_id, &session_id)
        .expect("bind_session"));
    assert!(service.begin_step(&run_id).expect("begin_step"));
    (run_id, session_id, plan.prompt_id)
}

fn view(
    service: &Arc<WorkflowRunService>,
    run_id: &str,
) -> crate::domains::workflows::service::WorkflowRunView {
    service.get(run_id).expect("get").expect("run exists")
}

#[tokio::test]
async fn lost_acknowledgement_keeps_step_running_and_exact_completion_terminalizes() {
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
        Db::open_in_memory().expect("in-memory db"),
    )));
    let (run_id, session_id, prompt_id) = run_at_dispatch_boundary(&service);

    let decision = apply_prompt_dispatch_outcome(
        &service,
        &run_id,
        &session_id,
        Err(TextPromptDispatchError::AcknowledgementLost),
    )
    .await;
    assert!(decision.is_ok(), "lost acknowledgement must not abort");

    let ambiguous = view(&service, &run_id);
    assert_eq!(ambiguous.run.status, WorkflowRunStatus::Running);
    assert_eq!(ambiguous.run.failure_code, None);
    assert_eq!(ambiguous.steps[0].status, WorkflowStepStatus::Running);
    assert_eq!(ambiguous.steps[0].turn_id, None);
    assert_eq!(ambiguous.steps[0].failure_code, None);

    // The turn was in fact running: its exact completion (matched by session
    // and prompt id) terminalizes the run through the production extension
    // seam.
    let finished = service
        .finish_turn(
            &session_id,
            &prompt_id,
            Some("turn-after-lost-ack"),
            WorkflowTurnOutcome::Completed,
        )
        .expect("finish_turn");
    assert!(matches!(finished, FinishTurnStoreOutcome::Terminalized));
    let completed = view(&service, &run_id);
    assert_eq!(completed.run.status, WorkflowRunStatus::Completed);
    assert_eq!(completed.run.failure_code, None);
    assert_eq!(completed.steps[0].status, WorkflowStepStatus::Completed);
}

#[tokio::test]
async fn lost_acknowledgement_without_completion_is_fenced_as_runtime_restarted() {
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
        Db::open_in_memory().expect("in-memory db"),
    )));
    let (run_id, session_id, _prompt_id) = run_at_dispatch_boundary(&service);

    apply_prompt_dispatch_outcome(
        &service,
        &run_id,
        &session_id,
        Err(TextPromptDispatchError::AcknowledgementLost),
    )
    .await
    .expect("lost acknowledgement must not abort");

    // No completion ever arrived: the startup fence owns the ambiguous row,
    // and under run control it resolves to interrupted/runtime_restarted
    // (spec run-control §7) rather than a failure claim.
    service
        .fence_nonterminal_after_restart()
        .expect("fence after restart");
    let fenced = view(&service, &run_id);
    assert_eq!(fenced.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(fenced.run.failure_code, None);
    assert_eq!(
        fenced.run.interruption_code,
        Some(WorkflowInterruptionCode::RuntimeRestarted)
    );
    assert_eq!(fenced.steps[0].status, WorkflowStepStatus::Interrupted);
}

#[tokio::test]
async fn verifiable_dispatch_failure_still_terminalizes_prompt_dispatch_failed() {
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
        Db::open_in_memory().expect("in-memory db"),
    )));
    let (run_id, session_id, _prompt_id) = run_at_dispatch_boundary(&service);

    let decision = apply_prompt_dispatch_outcome(
        &service,
        &run_id,
        &session_id,
        Err(TextPromptDispatchError::Dispatch(
            SendPromptError::Internal(anyhow::anyhow!(
                "actor rejected the prompt before acceptance"
            )),
        )),
    )
    .await;
    let code = match decision {
        Err(ExecutionAbort::Fail(code)) => code,
        other => panic!("definite dispatch failure must abort with a failure code: {other:?}"),
    };
    assert_eq!(code, WorkflowRunFailureCode::PromptDispatchFailed);

    // The production boundary (`execute`) converts that abort into the one
    // guarded durable failure write.
    guarded_fail(&service, &run_id, code).await;
    let failed = view(&service, &run_id);
    assert_eq!(failed.run.status, WorkflowRunStatus::Failed);
    assert_eq!(
        failed.run.failure_code,
        Some(WorkflowRunFailureCode::PromptDispatchFailed)
    );
    assert_eq!(failed.steps[0].status, WorkflowStepStatus::Failed);
    assert_eq!(
        failed.steps[0].failure_code,
        Some(WorkflowRunFailureCode::PromptDispatchFailed)
    );
}
