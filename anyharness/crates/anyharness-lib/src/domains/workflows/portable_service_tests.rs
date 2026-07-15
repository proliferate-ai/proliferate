//! Schema-v2 portable source, plan, and concurrency tests.

use std::collections::BTreeMap;
use std::sync::{Arc, Barrier};

use serde_json::{json, Value};

use super::model::{
    workflow_prompt_id, PutWorkflowRunInputV2, WorkflowDefinitionV2, WorkflowHarnessConfigV2,
    WorkflowInput, WorkflowInputType, WorkflowModelSelection, WorkflowPermissionPolicy,
    WorkflowPromptStep, WorkflowResolvedEffortConfig, WorkflowResolvedPlanV2, WorkflowStageV2,
};
use super::service::{
    AcceptV2Outcome, InspectV2Outcome, VersionedWorkflowRunView, WorkflowRunService,
    WorkflowRunValidationError,
};
use super::store::WorkflowRunStore;
use crate::persistence::Db;

const WORKSPACE: &str = "20000000-0000-4000-8000-000000000002";

fn service() -> WorkflowRunService {
    WorkflowRunService::new(WorkflowRunStore::new(
        Db::open_in_memory().expect("in-memory db"),
    ))
}

fn new_run_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn valid_input(number: Value) -> PutWorkflowRunInputV2 {
    PutWorkflowRunInputV2 {
        schema_version: 2,
        workspace_id: WORKSPACE.to_string(),
        definition: WorkflowDefinitionV2 {
            inputs: vec![
                WorkflowInput {
                    name: "ticket".to_string(),
                    input_type: WorkflowInputType::String,
                    required: true,
                },
                WorkflowInput {
                    name: "attempt".to_string(),
                    input_type: WorkflowInputType::Number,
                    required: true,
                },
            ],
            stages: vec![WorkflowStageV2 {
                harness_config: WorkflowHarnessConfigV2 {
                    agent_kind: "claude".to_string(),
                    model_selection: WorkflowModelSelection::Exact {
                        model_id: "claude-sonnet-4-5".to_string(),
                    },
                    effort: Some("high".to_string()),
                    permission_policy: WorkflowPermissionPolicy::WorkflowDefault,
                },
                steps: vec![WorkflowPromptStep {
                    kind: "agent.prompt".to_string(),
                    prompt: "Investigate {{inputs.ticket}} attempt {{inputs.attempt}}".to_string(),
                }],
            }],
        },
        arguments: BTreeMap::from([
            ("ticket".to_string(), json!("PROL-123")),
            ("attempt".to_string(), number),
        ]),
    }
}

fn resolved_plan(run_id: &str, rendered_prompt: &str) -> WorkflowResolvedPlanV2 {
    WorkflowResolvedPlanV2 {
        workspace_id: WORKSPACE.to_string(),
        agent_kind: "claude".to_string(),
        model_id: "claude-sonnet-4-5".to_string(),
        mode_id: "bypassPermissions".to_string(),
        effort_config: Some(WorkflowResolvedEffortConfig {
            config_id: "effort".to_string(),
            value: "high".to_string(),
        }),
        rendered_prompt: rendered_prompt.to_string(),
        prompt_id: workflow_prompt_id(run_id),
    }
}

#[test]
fn portable_fixture_numbers_follow_rfc8785_and_safe_integer_rules() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../../../fixtures/contracts/workflow-portable-execution/v1.json"
    ))
    .expect("portable workflow fixture");
    for case in fixture["canonicalNumberCases"]
        .as_array()
        .expect("canonical cases")
    {
        let source = case["source"].as_str().expect("source");
        let number: Value = serde_json::from_str(source).expect("number source");
        assert_eq!(
            serde_jcs::to_string(&number).expect("RFC8785 canonical number"),
            case["canonical"].as_str().expect("canonical"),
            "source {source}"
        );
        let result = service().prepare_v2(&new_run_id(), valid_input(number));
        if case["portable"] == true {
            assert!(result.is_ok(), "portable source rejected: {source}");
        } else {
            assert!(matches!(
                result,
                Err(WorkflowRunValidationError::NonPortableNumber)
            ));
        }
    }
}

#[test]
fn source_replay_is_canonical_and_returns_the_stored_plan() {
    let service = service();
    let run_id = new_run_id();
    let prepared = service
        .prepare_v2(&run_id, valid_input(serde_json::from_str("1.0").unwrap()))
        .expect("prepare v2");
    assert!(matches!(
        service
            .inspect_v2(prepared.clone())
            .expect("inspect missing"),
        InspectV2Outcome::Missing(_)
    ));
    let rendered = service.render_v2(&prepared).expect("render v2");
    assert_eq!(rendered, "Investigate PROL-123 attempt 1");
    let stored_plan = resolved_plan(&run_id, &rendered);
    let created = match service
        .accept_v2(prepared, stored_plan.clone())
        .expect("accept v2")
    {
        AcceptV2Outcome::Created { view, .. } => view,
        other => panic!("expected Created, got {other:?}"),
    };
    let equivalent = service
        .prepare_v2(&run_id, valid_input(serde_json::from_str("1e0").unwrap()))
        .expect("prepare equivalent");
    let InspectV2Outcome::ExactReplay(replay) =
        service.inspect_v2(equivalent).expect("inspect replay")
    else {
        panic!("expected exact replay");
    };
    assert_eq!(replay.resolved_plan, stored_plan);
    assert_eq!(created.source, replay.source);
    assert_eq!(
        created.source.to_canonical_json().expect("created source"),
        replay.source.to_canonical_json().expect("replay source")
    );
    let Some(VersionedWorkflowRunView::V2(loaded)) =
        service.get_versioned(&run_id).expect("get v2")
    else {
        panic!("expected stored v2 view");
    };
    assert_eq!(loaded.source, created.source);
}

#[test]
fn replay_gate_precedes_prompt_rendering() {
    let service = service();
    let run_id = new_run_id();
    let mut input = valid_input(json!(1));
    input.definition.stages[0].steps[0].prompt = "{{inputs.missing}}".to_string();
    let prepared = service
        .prepare_v2(&run_id, input)
        .expect("source normalization does not render");
    assert!(matches!(
        service.inspect_v2(prepared.clone()).expect("inspect"),
        InspectV2Outcome::Missing(_)
    ));
    assert!(matches!(
        service.render_v2(&prepared),
        Err(WorkflowRunValidationError::UnknownPortableTemplateReference)
    ));
}

#[test]
fn input_names_must_start_with_a_letter() {
    let mut input = valid_input(json!(1));
    input.definition.inputs[0].name = "_ticket".to_string();
    input.arguments.remove("ticket");
    input.arguments.insert("_ticket".to_string(), json!("x"));
    assert!(matches!(
        service().prepare_v2(&new_run_id(), input),
        Err(WorkflowRunValidationError::InvalidInputName(_))
    ));
}

#[test]
fn concurrent_acceptance_has_one_winner_and_one_stored_plan() {
    let service = Arc::new(service());
    let run_id = new_run_id();
    let barrier = Arc::new(Barrier::new(8));
    let handles: Vec<_> = (0..8)
        .map(|index| {
            let service = service.clone();
            let run_id = run_id.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let prepared = service
                    .prepare_v2(&run_id, valid_input(json!(1)))
                    .expect("prepare");
                let rendered = service.render_v2(&prepared).expect("render");
                let mut plan = resolved_plan(&run_id, &rendered);
                plan.model_id = format!("candidate-{index}");
                barrier.wait();
                service.accept_v2(prepared, plan).expect("accept")
            })
        })
        .collect();
    let mut created = 0;
    let mut model_ids = Vec::new();
    for handle in handles {
        match handle.join().expect("join") {
            AcceptV2Outcome::Created { view, .. } => {
                created += 1;
                model_ids.push(view.resolved_plan.model_id);
            }
            AcceptV2Outcome::ExactReplay(view) => model_ids.push(view.resolved_plan.model_id),
            AcceptV2Outcome::Conflict => panic!("same canonical source must replay"),
        }
    }
    assert_eq!(created, 1);
    assert_eq!(
        model_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        1
    );
}
