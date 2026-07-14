use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde_json::json;

use super::*;
use crate::domains::workflows::model::{
    workflow_prompt_id, PutWorkflowRunInput, PutWorkflowRunInputV2, WorkflowDefinition,
    WorkflowDefinitionV2, WorkflowHarnessConfig, WorkflowHarnessConfigV2, WorkflowInput,
    WorkflowInputType, WorkflowModelSelection, WorkflowPermissionPolicy, WorkflowPromptStep,
    WorkflowStage, WorkflowStageV2,
};
use crate::domains::workflows::store::WorkflowRunStore;
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
    let gates = Arc::new(StdMutex::new(HashMap::new()));
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
            let gate = workflow_accept_gate_slot(&gates, &run_id).expect("gate");
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
    let gates = Arc::new(StdMutex::new(HashMap::new()));
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
            let gate = workflow_accept_gate_slot(&gates, &run_id).expect("v1 gate");
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
            let gate = workflow_accept_gate_slot(&gates, &run_id).expect("v2 gate");
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
