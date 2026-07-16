//! Merge-gated domain tests over real AnyHarness SQLite (`Db::open_in_memory`
//! and file-backed `Db::open`). No mock executor: these cover validation,
//! rendering, canonical replay/conflict, guarded transitions, completion races,
//! and restart fencing.

use std::collections::BTreeMap;
use std::sync::{Arc, Barrier};

use serde_json::{json, Value};

use super::model::{
    workflow_prompt_id, PutWorkflowRunInput, WorkflowDefinition, WorkflowHarnessConfig,
    WorkflowInput, WorkflowInputType, WorkflowInterruptionCode, WorkflowPromptStep,
    WorkflowRunFailureCode, WorkflowRunStatus, WorkflowStage, WorkflowStepStatus,
    WorkflowTurnOutcome,
};
use super::service::{
    AcceptOutcome, WorkflowAcceptError, WorkflowExecutionPlan, WorkflowRunService,
    WorkflowRunValidationError, WorkflowRunView,
};
use super::store::{FinishTurnStoreOutcome, WorkflowRunStore};
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

fn ticket_input() -> WorkflowInput {
    WorkflowInput {
        name: "ticket".to_string(),
        input_type: WorkflowInputType::String,
        required: true,
    }
}

fn valid_input() -> PutWorkflowRunInput {
    let mut arguments = BTreeMap::new();
    arguments.insert("ticket".to_string(), json!("PROL-123"));
    PutWorkflowRunInput {
        schema_version: 1,
        workspace_id: WORKSPACE.to_string(),
        definition: WorkflowDefinition {
            inputs: vec![ticket_input()],
            stages: vec![WorkflowStage {
                harness_config: WorkflowHarnessConfig {
                    agent_kind: "claude".to_string(),
                    model_id: Some("claude-sonnet-4-5".to_string()),
                    mode_id: Some("bypassPermissions".to_string()),
                },
                steps: vec![WorkflowPromptStep {
                    kind: "agent.prompt".to_string(),
                    prompt: "Investigate {{inputs.ticket}}".to_string(),
                }],
            }],
        },
        arguments,
    }
}

fn expect_invalid(run_id: &str, input: PutWorkflowRunInput) -> WorkflowRunValidationError {
    match service().accept(run_id, input) {
        Err(WorkflowAcceptError::Invalid(error)) => error,
        other => panic!("expected validation error, got {other:?}"),
    }
}

fn created_plan(outcome: AcceptOutcome) -> WorkflowExecutionPlan {
    match outcome {
        AcceptOutcome::Created { plan, .. } => plan,
        other => panic!("expected Created, got {other:?}"),
    }
}

fn created_view(outcome: AcceptOutcome) -> WorkflowRunView {
    match outcome {
        AcceptOutcome::Created { view, .. } => view,
        other => panic!("expected Created, got {other:?}"),
    }
}

// ---- Acceptance basics ----------------------------------------------------

#[test]
fn valid_invocation_is_accepted_with_pending_step() {
    let run_id = new_run_id();
    let outcome = service().accept(&run_id, valid_input()).expect("accept");
    let view = created_view(outcome);
    assert_eq!(view.run.status, WorkflowRunStatus::Accepted);
    assert_eq!(view.run.schema_version, 1);
    assert_eq!(view.steps.len(), 1);
    assert_eq!(view.steps[0].stage_index, 0);
    assert_eq!(view.steps[0].step_index, 0);
    assert_eq!(view.steps[0].status, WorkflowStepStatus::Pending);
    assert_eq!(view.steps[0].prompt_id, workflow_prompt_id(&run_id));
    assert!(view.steps[0].turn_id.is_none());
}

#[test]
fn prompt_id_is_deterministic_and_step_identity_fixed() {
    let run_id = new_run_id();
    let plan = created_plan(service().accept(&run_id, valid_input()).expect("accept"));
    assert_eq!(plan.prompt_id, format!("workflow:{run_id}:0:0"));
    assert_eq!(plan.rendered_prompt, "Investigate PROL-123");
}

// ---- Validation matrix ----------------------------------------------------

#[test]
fn rejects_non_canonical_run_id() {
    // Uppercase, simple (unhyphenated), and non-UUID all rejected.
    for bad in [
        "20000000-0000-4000-8000-00000000000X",
        "20000000000040008000000000000002",
        "not-a-uuid",
        "2ABCDEF0-0000-4000-8000-000000000002",
    ] {
        let error = expect_invalid(bad, valid_input());
        assert!(
            matches!(error, WorkflowRunValidationError::InvalidRunId),
            "{bad}"
        );
    }
}

#[test]
fn rejects_wrong_schema_version() {
    let mut input = valid_input();
    input.schema_version = 2;
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::UnsupportedSchemaVersion(2)
    ));
}

#[test]
fn rejects_blank_workspace_id() {
    let mut input = valid_input();
    input.workspace_id = "   ".to_string();
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::BlankWorkspaceId
    ));
}

#[test]
fn rejects_zero_or_two_stages() {
    let mut zero = valid_input();
    zero.definition.stages.clear();
    assert!(matches!(
        expect_invalid(&new_run_id(), zero),
        WorkflowRunValidationError::StageCount(0)
    ));

    let mut two = valid_input();
    let extra = two.definition.stages[0].clone();
    two.definition.stages.push(extra);
    assert!(matches!(
        expect_invalid(&new_run_id(), two),
        WorkflowRunValidationError::StageCount(2)
    ));
}

#[test]
fn rejects_zero_or_two_steps() {
    let mut zero = valid_input();
    zero.definition.stages[0].steps.clear();
    assert!(matches!(
        expect_invalid(&new_run_id(), zero),
        WorkflowRunValidationError::StepCount(0)
    ));

    let mut two = valid_input();
    let extra = two.definition.stages[0].steps[0].clone();
    two.definition.stages[0].steps.push(extra);
    assert!(matches!(
        expect_invalid(&new_run_id(), two),
        WorkflowRunValidationError::StepCount(2)
    ));
}

#[test]
fn rejects_wrong_step_kind() {
    let mut input = valid_input();
    input.definition.stages[0].steps[0].kind = "agent.review".to_string();
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::UnsupportedStepKind(_)
    ));
}

#[test]
fn rejects_bad_input_names() {
    let mut blank = valid_input();
    blank.definition.inputs[0].name = "  ".to_string();
    assert!(matches!(
        expect_invalid(&new_run_id(), blank),
        WorkflowRunValidationError::BlankInputName
    ));

    let mut invalid = valid_input();
    invalid.definition.inputs[0].name = "1ticket".to_string();
    // The argument key must follow the (now invalid) declared name to reach the
    // identifier check rather than the undeclared-argument check.
    let mut args = BTreeMap::new();
    args.insert("1ticket".to_string(), json!("x"));
    invalid.arguments = args;
    assert!(matches!(
        expect_invalid(&new_run_id(), invalid),
        WorkflowRunValidationError::InvalidInputName(_)
    ));

    let mut duplicate = valid_input();
    duplicate.definition.inputs.push(ticket_input());
    assert!(matches!(
        expect_invalid(&new_run_id(), duplicate),
        WorkflowRunValidationError::DuplicateInputName(_)
    ));
}

#[test]
fn rejects_undeclared_argument() {
    let mut input = valid_input();
    input.arguments.insert("surprise".to_string(), json!("x"));
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::UndeclaredArgument(_)
    ));
}

#[test]
fn rejects_missing_required_argument() {
    let mut input = valid_input();
    input.arguments.clear();
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::MissingRequiredArgument(_)
    ));
}

#[test]
fn rejects_type_mismatched_arguments_including_null_array_object() {
    for bad in [
        json!(7),
        json!(true),
        Value::Null,
        json!([1, 2]),
        json!({"a": 1}),
    ] {
        let mut input = valid_input();
        input.arguments.insert("ticket".to_string(), bad.clone());
        assert!(
            matches!(
                expect_invalid(&new_run_id(), input),
                WorkflowRunValidationError::ArgumentTypeMismatch { .. }
            ),
            "value {bad:?} should mismatch a string input"
        );
    }
}

#[test]
fn accepts_unreferenced_optional_omitted() {
    let mut input = valid_input();
    input.definition.inputs.push(WorkflowInput {
        name: "note".to_string(),
        input_type: WorkflowInputType::String,
        required: false,
    });
    // `note` is optional and unreferenced by the prompt; omitting it is fine.
    let outcome = service().accept(&new_run_id(), input).expect("accept");
    assert!(matches!(outcome, AcceptOutcome::Created { .. }));
}

#[test]
fn rejects_referenced_input_without_argument() {
    let mut input = valid_input();
    input.definition.inputs.push(WorkflowInput {
        name: "note".to_string(),
        input_type: WorkflowInputType::String,
        required: false,
    });
    input.definition.stages[0].steps[0].prompt =
        "Investigate {{inputs.ticket}} and {{inputs.note}}".to_string();
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::MissingReferencedArgument(_)
    ));
}

#[test]
fn rejects_malformed_templates() {
    let unmatched = {
        let mut input = valid_input();
        input.definition.stages[0].steps[0].prompt = "Investigate {{inputs.ticket".to_string();
        expect_invalid(&new_run_id(), input)
    };
    assert!(matches!(
        unmatched,
        WorkflowRunValidationError::MalformedTemplate
    ));

    for bad_ref in ["{{inputs.}}", "{{other.x}}", "{{inputs.unknown}}"] {
        let mut input = valid_input();
        input.definition.stages[0].steps[0].prompt = format!("do {bad_ref}");
        assert!(
            matches!(
                expect_invalid(&new_run_id(), input),
                WorkflowRunValidationError::UnknownTemplateReference(_)
            ),
            "{bad_ref}"
        );
    }
}

#[test]
fn rejects_blank_rendered_prompt() {
    let mut input = valid_input();
    input.definition.inputs = Vec::new();
    input.arguments.clear();
    input.definition.stages[0].steps[0].prompt = "   ".to_string();
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::BlankRenderedPrompt
    ));
}

#[test]
fn rejects_oversized_rendered_prompt() {
    let mut input = valid_input();
    let big = "x".repeat(16_400);
    input.arguments.insert("ticket".to_string(), json!(big));
    assert!(matches!(
        expect_invalid(&new_run_id(), input),
        WorkflowRunValidationError::RenderedPromptTooLarge(_)
    ));
}

#[test]
fn rejects_bad_agent_kind_and_blank_model_mode() {
    let mut blank = valid_input();
    blank.definition.stages[0].harness_config.agent_kind = String::new();
    assert!(matches!(
        expect_invalid(&new_run_id(), blank),
        WorkflowRunValidationError::BlankAgentKind
    ));

    let mut padded = valid_input();
    padded.definition.stages[0].harness_config.agent_kind = " claude ".to_string();
    assert!(matches!(
        expect_invalid(&new_run_id(), padded),
        WorkflowRunValidationError::AgentKindSurroundingWhitespace
    ));

    let mut blank_model = valid_input();
    blank_model.definition.stages[0].harness_config.model_id = Some("  ".to_string());
    assert!(matches!(
        expect_invalid(&new_run_id(), blank_model),
        WorkflowRunValidationError::BlankModelId
    ));

    let mut blank_mode = valid_input();
    blank_mode.definition.stages[0].harness_config.mode_id = Some(String::new());
    assert!(matches!(
        expect_invalid(&new_run_id(), blank_mode),
        WorkflowRunValidationError::BlankModeId
    ));
}

// ---- Rendering ------------------------------------------------------------

fn render_with(input_type: WorkflowInputType, arg: Value) -> String {
    let mut input = valid_input();
    input.definition.inputs = vec![WorkflowInput {
        name: "value".to_string(),
        input_type,
        required: true,
    }];
    input.definition.stages[0].steps[0].prompt = "v={{inputs.value}}".to_string();
    let mut args = BTreeMap::new();
    args.insert("value".to_string(), arg);
    input.arguments = args;
    created_plan(service().accept(&new_run_id(), input).expect("accept")).rendered_prompt
}

#[test]
fn renders_scalars_verbatim() {
    assert_eq!(
        render_with(WorkflowInputType::String, json!("hello world")),
        "v=hello world"
    );
    assert_eq!(render_with(WorkflowInputType::Number, json!(3)), "v=3");
    assert_eq!(render_with(WorkflowInputType::Number, json!(3.5)), "v=3.5");
    assert_eq!(
        render_with(WorkflowInputType::Boolean, json!(true)),
        "v=true"
    );
    assert_eq!(
        render_with(WorkflowInputType::Boolean, json!(false)),
        "v=false"
    );
}

// ---- Replay / conflict ----------------------------------------------------

#[test]
fn identical_reaccept_is_exact_replay_regardless_of_arg_insert_order() {
    let svc = service();
    let run_id = new_run_id();
    assert!(matches!(
        svc.accept(&run_id, valid_input()).expect("accept"),
        AcceptOutcome::Created { .. }
    ));

    // A second input with the same values but built in a different argument
    // insertion order canonicalizes identically.
    let mut reordered = valid_input();
    let mut args = BTreeMap::new();
    args.insert("ticket".to_string(), json!("PROL-123"));
    reordered.arguments = args;
    assert!(matches!(
        svc.accept(&run_id, reordered).expect("replay"),
        AcceptOutcome::ExactReplay(_)
    ));
}

#[test]
fn changed_invocation_conflicts() {
    let svc = service();
    let run_id = new_run_id();
    svc.accept(&run_id, valid_input()).expect("accept");

    for mutate in [
        // Different workspace id.
        Box::new(|input: &mut PutWorkflowRunInput| {
            input.workspace_id = "30000000-0000-4000-8000-000000000003".to_string();
        }) as Box<dyn Fn(&mut PutWorkflowRunInput)>,
        // Different argument value.
        Box::new(|input: &mut PutWorkflowRunInput| {
            input.arguments.insert("ticket".to_string(), json!("OTHER"));
        }),
        // Different prompt text.
        Box::new(|input: &mut PutWorkflowRunInput| {
            input.definition.stages[0].steps[0].prompt = "Do {{inputs.ticket}}".to_string();
        }),
    ] {
        let mut input = valid_input();
        mutate(&mut input);
        assert!(matches!(
            svc.accept(&run_id, input).expect("conflict"),
            AcceptOutcome::Conflict
        ));
    }
}

#[test]
fn concurrent_identical_acceptance_yields_one_created() {
    let db = Db::open_in_memory().expect("db");
    let run_id = new_run_id();
    let threads = 8;
    let barrier = Arc::new(Barrier::new(threads));
    let created = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let replay = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let handles: Vec<_> = (0..threads)
        .map(|_| {
            let db = db.clone();
            let run_id = run_id.clone();
            let barrier = barrier.clone();
            let created = created.clone();
            let replay = replay.clone();
            std::thread::spawn(move || {
                let svc = WorkflowRunService::new(WorkflowRunStore::new(db));
                barrier.wait();
                match svc.accept(&run_id, valid_input()).expect("accept") {
                    AcceptOutcome::Created { .. } => {
                        created.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                    AcceptOutcome::ExactReplay(_) => {
                        replay.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                    AcceptOutcome::Conflict => panic!("unexpected conflict"),
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("thread");
    }
    assert_eq!(created.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        replay.load(std::sync::atomic::Ordering::SeqCst),
        threads - 1
    );
}

#[test]
fn concurrent_different_acceptance_yields_one_winner_rest_conflict() {
    let db = Db::open_in_memory().expect("db");
    let run_id = new_run_id();
    let threads = 8;
    let barrier = Arc::new(Barrier::new(threads));
    let created = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let conflict = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let handles: Vec<_> = (0..threads)
        .map(|i| {
            let db = db.clone();
            let run_id = run_id.clone();
            let barrier = barrier.clone();
            let created = created.clone();
            let conflict = conflict.clone();
            std::thread::spawn(move || {
                let svc = WorkflowRunService::new(WorkflowRunStore::new(db));
                let mut input = valid_input();
                input
                    .arguments
                    .insert("ticket".to_string(), json!(format!("PROL-{i}")));
                barrier.wait();
                match svc.accept(&run_id, input).expect("accept") {
                    AcceptOutcome::Created { .. } => {
                        created.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                    AcceptOutcome::Conflict => {
                        conflict.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                    AcceptOutcome::ExactReplay(_) => {}
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("thread");
    }
    assert_eq!(created.load(std::sync::atomic::Ordering::SeqCst), 1);
    // Every non-winning thread with a different invocation conflicts.
    assert_eq!(
        conflict.load(std::sync::atomic::Ordering::SeqCst),
        threads - 1
    );
}

// ---- Transitions ----------------------------------------------------------

/// Accept and drive a run up to a running step bound to `session_id`.
fn running_run(svc: &WorkflowRunService, session_id: &str) -> String {
    let run_id = new_run_id();
    svc.accept(&run_id, valid_input()).expect("accept");
    assert!(svc.begin_run(&run_id).expect("begin_run"));
    assert!(svc.bind_session(&run_id, session_id).expect("bind"));
    assert!(svc.begin_step(&run_id).expect("begin_step"));
    run_id
}

fn view(svc: &WorkflowRunService, run_id: &str) -> WorkflowRunView {
    svc.get(run_id).expect("get").expect("present")
}

#[test]
fn transition_guards_are_compare_and_set() {
    let svc = service();
    let run_id = new_run_id();
    svc.accept(&run_id, valid_input()).expect("accept");

    // begin_run only from accepted.
    assert!(svc.begin_run(&run_id).expect("begin_run"));
    assert!(!svc.begin_run(&run_id).expect("begin_run again"));

    // bind_session only while running + unbound.
    assert!(svc.bind_session(&run_id, "sess-1").expect("bind"));
    assert!(!svc.bind_session(&run_id, "sess-2").expect("rebind"));
    assert_eq!(
        view(&svc, &run_id).run.session_id.as_deref(),
        Some("sess-1")
    );

    // begin_step only from pending.
    assert!(svc.begin_step(&run_id).expect("begin_step"));
    assert!(!svc.begin_step(&run_id).expect("begin_step again"));
}

#[test]
fn completion_terminalizes_run_and_step_with_finished_at() {
    let svc = service();
    let session_id = "sess-complete";
    let run_id = running_run(&svc, session_id);
    let prompt_id = workflow_prompt_id(&run_id);

    let outcome = svc
        .finish_turn(
            session_id,
            &prompt_id,
            Some("turn-1"),
            WorkflowTurnOutcome::Completed,
        )
        .expect("finish");
    assert_eq!(outcome, FinishTurnStoreOutcome::Terminalized);

    let view = view(&svc, &run_id);
    assert_eq!(view.run.status, WorkflowRunStatus::Completed);
    assert_eq!(view.steps[0].status, WorkflowStepStatus::Completed);
    assert!(view.run.finished_at.is_some());
    assert!(view.steps[0].finished_at.is_some());
    assert!(view.run.failure_code.is_none());
    assert!(view.steps[0].failure_code.is_none());
    assert_eq!(view.steps[0].turn_id.as_deref(), Some("turn-1"));
}

#[test]
fn failed_and_cancelled_turns_carry_failure_codes() {
    let svc = service();
    let failed_run = running_run(&svc, "sess-failed");
    svc.finish_turn(
        "sess-failed",
        &workflow_prompt_id(&failed_run),
        Some("t"),
        WorkflowTurnOutcome::Failed,
    )
    .expect("finish failed");
    let failed = view(&svc, &failed_run);
    assert_eq!(failed.run.status, WorkflowRunStatus::Failed);
    assert_eq!(
        failed.run.failure_code,
        Some(WorkflowRunFailureCode::SessionTurnFailed)
    );

    let cancelled_run = running_run(&svc, "sess-cancelled");
    svc.finish_turn(
        "sess-cancelled",
        &workflow_prompt_id(&cancelled_run),
        Some("t"),
        WorkflowTurnOutcome::Cancelled,
    )
    .expect("finish cancelled");
    // A correlated cancelled turn is truthful `cancelled`, not a failure
    // (spec workflow-run-control §4).
    let cancelled = view(&svc, &cancelled_run);
    assert_eq!(cancelled.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(cancelled.steps[0].status, WorkflowStepStatus::Cancelled);
    assert!(cancelled.run.failure_code.is_none());
    assert!(cancelled.steps[0].failure_code.is_none());
}

#[test]
fn duplicate_and_late_completions_are_no_ops() {
    let svc = service();
    let session_id = "sess-dup";
    let run_id = running_run(&svc, session_id);
    let prompt_id = workflow_prompt_id(&run_id);

    svc.finish_turn(
        session_id,
        &prompt_id,
        Some("turn-1"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("finish");
    // Same turn again -> idempotent duplicate.
    assert_eq!(
        svc.finish_turn(
            session_id,
            &prompt_id,
            Some("turn-1"),
            WorkflowTurnOutcome::Completed
        )
        .expect("dup"),
        FinishTurnStoreOutcome::Duplicate
    );
    // A different (late) turn on the terminal row -> mismatch, no change.
    assert_eq!(
        svc.finish_turn(
            session_id,
            &prompt_id,
            Some("turn-2"),
            WorkflowTurnOutcome::Failed
        )
        .expect("late"),
        FinishTurnStoreOutcome::Mismatch
    );
    let view = view(&svc, &run_id);
    assert_eq!(view.run.status, WorkflowRunStatus::Completed);
    assert_eq!(view.steps[0].turn_id.as_deref(), Some("turn-1"));
}

#[test]
fn late_finish_after_fail_is_no_op() {
    let svc = service();
    let session_id = "sess-failed-then-finish";
    let run_id = running_run(&svc, session_id);
    svc.fail_nonterminal(&run_id, WorkflowRunFailureCode::SessionStartFailed)
        .expect("fail");
    // A completion callback arriving after a durable failure changes nothing.
    assert_eq!(
        svc.finish_turn(
            session_id,
            &workflow_prompt_id(&run_id),
            Some("turn-late"),
            WorkflowTurnOutcome::Completed,
        )
        .expect("late finish"),
        FinishTurnStoreOutcome::Mismatch
    );
    let view = view(&svc, &run_id);
    assert_eq!(view.run.status, WorkflowRunStatus::Failed);
    assert_eq!(
        view.run.failure_code,
        Some(WorkflowRunFailureCode::SessionStartFailed)
    );
}

#[test]
fn completion_before_turn_id_race_keeps_hook_turn_id() {
    let svc = service();
    let session_id = "sess-race";
    let run_id = running_run(&svc, session_id);
    let prompt_id = workflow_prompt_id(&run_id);

    // Completion arrives first, filling the null turn id with the hook's turn.
    svc.finish_turn(
        session_id,
        &prompt_id,
        Some("turn-hook"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("finish");
    // The post-send record with the SAME turn is idempotent and does not move a
    // terminal row.
    assert!(!svc.record_turn(&run_id, "turn-hook").expect("record same"));
    // A post-send record with a DIFFERENT turn is also a no-op on the terminal row.
    assert!(!svc
        .record_turn(&run_id, "turn-other")
        .expect("record other"));
    assert_eq!(
        view(&svc, &run_id).steps[0].turn_id.as_deref(),
        Some("turn-hook")
    );
}

#[test]
fn wrong_prompt_or_session_or_conflicting_turn_mutate_nothing() {
    let svc = service();
    let session_id = "sess-guard";
    let run_id = running_run(&svc, session_id);
    let prompt_id = workflow_prompt_id(&run_id);

    // First record a turn id post-send so the running step has a turn.
    assert!(svc.record_turn(&run_id, "turn-a").expect("record"));

    // Wrong prompt id -> not found.
    assert_eq!(
        svc.finish_turn(
            session_id,
            "workflow:nope:0:0",
            Some("turn-a"),
            WorkflowTurnOutcome::Completed
        )
        .expect("wrong prompt"),
        FinishTurnStoreOutcome::NotFound
    );
    // Wrong session id -> mismatch.
    assert_eq!(
        svc.finish_turn(
            "other-session",
            &prompt_id,
            Some("turn-a"),
            WorkflowTurnOutcome::Completed
        )
        .expect("wrong session"),
        FinishTurnStoreOutcome::Mismatch
    );
    // Conflicting turn id on a running step -> mismatch.
    assert_eq!(
        svc.finish_turn(
            session_id,
            &prompt_id,
            Some("turn-b"),
            WorkflowTurnOutcome::Completed
        )
        .expect("conflicting turn"),
        FinishTurnStoreOutcome::Mismatch
    );
    let view = view(&svc, &run_id);
    assert_eq!(view.run.status, WorkflowRunStatus::Running);
    assert_eq!(view.steps[0].status, WorkflowStepStatus::Running);
}

#[test]
fn fail_nonterminal_stamps_both_rows_with_same_code() {
    let svc = service();
    let run_id = running_run(&svc, "sess-x");
    svc.fail_nonterminal(&run_id, WorkflowRunFailureCode::PromptDispatchFailed)
        .expect("fail");
    let view = view(&svc, &run_id);
    assert_eq!(view.run.status, WorkflowRunStatus::Failed);
    assert_eq!(view.steps[0].status, WorkflowStepStatus::Failed);
    assert_eq!(
        view.run.failure_code,
        Some(WorkflowRunFailureCode::PromptDispatchFailed)
    );
    assert_eq!(
        view.steps[0].failure_code,
        Some(WorkflowRunFailureCode::PromptDispatchFailed)
    );
    assert!(view.run.finished_at.is_some());
    assert!(view.steps[0].finished_at.is_some());
}

#[test]
fn fail_nonterminal_leaves_terminal_rows_untouched() {
    let svc = service();
    let session_id = "sess-terminal";
    let run_id = running_run(&svc, session_id);
    svc.finish_turn(
        session_id,
        &workflow_prompt_id(&run_id),
        Some("t"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("complete");
    // A subsequent failure attempt must not overwrite the completed rows.
    svc.fail_nonterminal(&run_id, WorkflowRunFailureCode::RuntimeRestarted)
        .expect("fail");
    let view = view(&svc, &run_id);
    assert_eq!(view.run.status, WorkflowRunStatus::Completed);
    assert!(view.run.failure_code.is_none());
}

#[test]
fn later_run_may_reuse_a_historical_session_id() {
    // Spec 2b (0063 partial uniqueness): at most one NONTERMINAL run may bind
    // one session; a TERMINAL run's session id may be reused by a later run.
    let svc = service();
    let first = new_run_id();
    let second = new_run_id();
    svc.accept(&first, valid_input()).expect("accept a");
    svc.accept(&second, valid_input()).expect("accept b");
    assert!(svc.begin_run(&first).expect("begin a"));
    assert!(svc.begin_run(&second).expect("begin b"));
    assert!(svc.bind_session(&first, "shared-session").expect("bind a"));

    // Concurrent nonterminal reuse is rejected by the partial unique index.
    assert!(
        svc.bind_session(&second, "shared-session").is_err(),
        "a second nonterminal run must not bind the controlled session"
    );

    // Terminalize the first run: historical reuse becomes legal again.
    svc.fail_nonterminal(&first, WorkflowRunFailureCode::SessionStartFailed)
        .expect("terminalize a");
    assert!(svc
        .bind_session(&second, "shared-session")
        .expect("bind b after terminal"));
}

#[test]
fn get_returns_none_for_unknown_run() {
    assert!(service().get(&new_run_id()).expect("get").is_none());
}

// ---- Restart fencing (file-backed reopen) --------------------------------

struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("anyharness-workflow-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn fence_resolves_a_lost_acknowledgement_step() {
    // The lost-ack shape: run running, step running, turn_id null (dispatch
    // acknowledgement never arrived). If no completion ever comes from the
    // extension, the startup fence is the resolver: both rows become
    // failed(runtime_restarted). (The other resolution path — the extension
    // completing the running null-turn step — is covered by
    // completion_terminalizes_run_and_step_with_finished_at.)
    let svc = service();
    let run_id = running_run(&svc, "sess-lost-ack");
    assert!(view(&svc, &run_id).steps[0].turn_id.is_none());

    svc.fence_nonterminal_after_restart().expect("fence");

    let fenced = view(&svc, &run_id);
    assert_eq!(fenced.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(fenced.steps[0].status, WorkflowStepStatus::Interrupted);
    assert!(fenced.run.failure_code.is_none());
    assert!(fenced.steps[0].failure_code.is_none());
    assert_eq!(
        fenced.run.interruption_code,
        Some(WorkflowInterruptionCode::RuntimeRestarted)
    );
}

#[test]
fn restart_fencing_fails_nonterminal_rows_across_reopen() {
    let dir = TempDir::new();
    let interrupted;
    let completed;

    {
        let svc =
            WorkflowRunService::new(WorkflowRunStore::new(Db::open(&dir.path).expect("open db")));
        // One interrupted run (accepted + pending step).
        interrupted = new_run_id();
        svc.accept(&interrupted, valid_input())
            .expect("accept interrupted");

        // One already-completed run: must survive fencing unchanged.
        completed = new_run_id();
        svc.accept(&completed, valid_input())
            .expect("accept completed");
        svc.begin_run(&completed).expect("begin");
        svc.bind_session(&completed, "sess-done").expect("bind");
        svc.begin_step(&completed).expect("begin step");
        svc.finish_turn(
            "sess-done",
            &workflow_prompt_id(&completed),
            Some("t"),
            WorkflowTurnOutcome::Completed,
        )
        .expect("complete");
    }

    // Reopen a fresh handle on the same file and fence.
    let svc = WorkflowRunService::new(WorkflowRunStore::new(
        Db::open(&dir.path).expect("reopen db"),
    ));
    svc.fence_nonterminal_after_restart().expect("fence");

    let interrupted_view = view(&svc, &interrupted);
    assert_eq!(interrupted_view.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(
        interrupted_view.steps[0].status,
        WorkflowStepStatus::Interrupted
    );
    assert!(interrupted_view.run.failure_code.is_none());
    assert!(interrupted_view.steps[0].failure_code.is_none());
    assert_eq!(
        interrupted_view.run.interruption_code,
        Some(WorkflowInterruptionCode::RuntimeRestarted)
    );

    let completed_view = view(&svc, &completed);
    assert_eq!(completed_view.run.status, WorkflowRunStatus::Completed);
    assert!(completed_view.run.failure_code.is_none());
}

// ---------------------------------------------------------------------------
// Run-control tests (spec workflow-run-control §4/§5/§8, proof §11.2):
// stateVersion progression, the four-outcome cancel intent at every durable
// boundary, first-terminal-wins, and interrupted fencing — real SQLite.
// ---------------------------------------------------------------------------

use super::service::WorkflowCancelOutcome;

fn run_view(view: &super::service::VersionedWorkflowRunView) -> &super::service::WorkflowRunView {
    match view {
        super::service::VersionedWorkflowRunView::V1(view) => view,
        super::service::VersionedWorkflowRunView::V2(_) => panic!("expected a v1 view"),
    }
}

#[test]
fn state_version_progression_is_exact_and_no_ops_do_not_increment() {
    let svc = service();
    let run_id = new_run_id();

    // Accept starts at 1.
    svc.accept(&run_id, valid_input()).expect("accept");
    assert_eq!(view(&svc, &run_id).run.state_version, 1);

    // Exact replay does not increment.
    svc.accept(&run_id, valid_input()).expect("replay");
    assert_eq!(view(&svc, &run_id).run.state_version, 1);

    // begin_run -> 2; guarded repeat is a no-op.
    assert!(svc.begin_run(&run_id).expect("begin_run"));
    assert_eq!(view(&svc, &run_id).run.state_version, 2);
    assert!(!svc.begin_run(&run_id).expect("begin_run repeat"));
    assert_eq!(view(&svc, &run_id).run.state_version, 2);

    // bind_session -> 3; guarded repeat no-op.
    assert!(svc.bind_session(&run_id, "sess-v").expect("bind"));
    assert_eq!(view(&svc, &run_id).run.state_version, 3);
    assert!(!svc.bind_session(&run_id, "sess-other").expect("rebind"));
    assert_eq!(view(&svc, &run_id).run.state_version, 3);

    // begin_step (coupled run+step change) -> 4, exactly once.
    assert!(svc.begin_step(&run_id).expect("begin_step"));
    assert_eq!(view(&svc, &run_id).run.state_version, 4);
    assert!(!svc.begin_step(&run_id).expect("begin_step repeat"));
    assert_eq!(view(&svc, &run_id).run.state_version, 4);

    // record_turn -> 5; a duplicate same-turn record is a no-op.
    assert!(svc.record_turn(&run_id, "turn-v").expect("record"));
    assert_eq!(view(&svc, &run_id).run.state_version, 5);
    assert!(!svc.record_turn(&run_id, "turn-v").expect("record repeat"));
    assert_eq!(view(&svc, &run_id).run.state_version, 5);

    // Terminal completion (coupled) -> 6; duplicate/late callbacks no-op.
    svc.finish_turn(
        "sess-v",
        &workflow_prompt_id(&run_id),
        Some("turn-v"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("finish");
    let terminal = view(&svc, &run_id);
    assert_eq!(terminal.run.state_version, 6);
    assert_eq!(terminal.run.status, WorkflowRunStatus::Completed);
    svc.finish_turn(
        "sess-v",
        &workflow_prompt_id(&run_id),
        Some("turn-v"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("duplicate finish");
    svc.finish_turn(
        "sess-v",
        &workflow_prompt_id(&run_id),
        Some("turn-late"),
        WorkflowTurnOutcome::Failed,
    )
    .expect("late finish");
    let after = view(&svc, &run_id);
    assert_eq!(after.run.state_version, 6);
    assert_eq!(after.run.updated_at, terminal.run.updated_at);
}

#[test]
fn cancel_before_executor_terminalizes_run_and_step_atomically() {
    let svc = service();
    let run_id = new_run_id();
    svc.accept(&run_id, valid_input()).expect("accept");

    let outcome = svc.cancel_intent(&run_id).expect("cancel");
    let WorkflowCancelOutcome::CancelledBeforeDispatch(snapshot) = outcome else {
        panic!("expected CancelledBeforeDispatch, got {outcome:?}");
    };
    let snapshot = run_view(&snapshot);
    assert_eq!(snapshot.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(snapshot.steps[0].status, WorkflowStepStatus::Cancelled);
    assert!(snapshot.run.cancel_requested_at.is_some());
    assert!(snapshot.run.failure_code.is_none());
    assert!(snapshot.steps[0].failure_code.is_none());
    assert!(snapshot.run.interruption_code.is_none());
    assert!(snapshot.run.finished_at.is_some());
    assert!(snapshot.steps[0].finished_at.is_some());
    // One coupled increment: accept(1) + cancel(2).
    assert_eq!(snapshot.run.state_version, 2);

    // Repeat on the terminal run: Terminal, byte-stable version/timestamp.
    let repeat = svc.cancel_intent(&run_id).expect("repeat cancel");
    let WorkflowCancelOutcome::Terminal(repeat_view) = repeat else {
        panic!(
            "expected Terminal, got {repeat_view:?}",
            repeat_view = repeat
        );
    };
    let repeat_view = run_view(&repeat_view);
    assert_eq!(repeat_view.run.state_version, 2);
    assert_eq!(
        repeat_view.run.cancel_requested_at,
        snapshot.run.cancel_requested_at
    );
    assert_eq!(repeat_view.run.updated_at, snapshot.run.updated_at);
}

#[test]
fn cancel_at_every_pre_dispatch_boundary_terminalizes_without_a_session_effect() {
    let svc = service();

    // Running run, still-pending step (post-begin_run boundary).
    let run_a = new_run_id();
    svc.accept(&run_a, valid_input()).expect("accept");
    assert!(svc.begin_run(&run_a).expect("begin_run"));
    let outcome = svc.cancel_intent(&run_a).expect("cancel");
    assert!(matches!(
        outcome,
        WorkflowCancelOutcome::CancelledBeforeDispatch(_)
    ));
    let cancelled = view(&svc, &run_a);
    assert_eq!(cancelled.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(cancelled.run.state_version, 3);

    // Bound session, still-pending step (post-bind boundary): the created
    // session is retained as correlation evidence.
    let run_b = new_run_id();
    svc.accept(&run_b, valid_input()).expect("accept");
    assert!(svc.begin_run(&run_b).expect("begin_run"));
    assert!(svc.bind_session(&run_b, "sess-kept").expect("bind"));
    let outcome = svc.cancel_intent(&run_b).expect("cancel");
    assert!(matches!(
        outcome,
        WorkflowCancelOutcome::CancelledBeforeDispatch(_)
    ));
    let cancelled = view(&svc, &run_b);
    assert_eq!(cancelled.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(cancelled.run.session_id.as_deref(), Some("sess-kept"));

    // Execution rechecks observe the terminal state: no step begins after.
    assert!(!svc.run_in_flight(&run_b).expect("recheck"));
    assert!(!svc.begin_step(&run_b).expect("begin_step after cancel"));
}

#[test]
fn cancel_of_a_running_turn_records_intent_and_waits_for_correlated_evidence() {
    let svc = service();
    let session_id = "sess-pending-cancel";
    let run_id = running_run(&svc, session_id);
    assert!(svc.record_turn(&run_id, "turn-live").expect("record"));
    let versions_before = view(&svc, &run_id).run.state_version;

    // First intent: +1, pending outcome carrying exact correlation.
    let outcome = svc.cancel_intent(&run_id).expect("cancel");
    let WorkflowCancelOutcome::CancellationPending {
        view: snapshot,
        session_id: pending_session,
        turn_id: pending_turn,
    } = outcome
    else {
        panic!("expected CancellationPending, got {outcome:?}");
    };
    assert_eq!(pending_session.as_deref(), Some(session_id));
    assert_eq!(pending_turn.as_deref(), Some("turn-live"));
    let snapshot = run_view(&snapshot);
    assert_eq!(snapshot.run.status, WorkflowRunStatus::Running);
    assert_eq!(snapshot.steps[0].status, WorkflowStepStatus::Running);
    let requested_at = snapshot.run.cancel_requested_at.clone().expect("intent");
    assert_eq!(snapshot.run.state_version, versions_before + 1);

    // Repeated intent: same timestamp and version.
    let repeat = svc.cancel_intent(&run_id).expect("repeat");
    let WorkflowCancelOutcome::CancellationPending {
        view: repeat_view, ..
    } = repeat
    else {
        panic!("expected pending on repeat");
    };
    let repeat_view = run_view(&repeat_view);
    assert_eq!(
        repeat_view.run.cancel_requested_at.as_deref(),
        Some(requested_at.as_str())
    );
    assert_eq!(repeat_view.run.state_version, versions_before + 1);

    // The correlated cancelled turn terminalizes truthfully; intent retained.
    svc.finish_turn(
        session_id,
        &workflow_prompt_id(&run_id),
        Some("turn-live"),
        WorkflowTurnOutcome::Cancelled,
    )
    .expect("correlated cancellation");
    let terminal = view(&svc, &run_id);
    assert_eq!(terminal.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(
        terminal.run.cancel_requested_at.as_deref(),
        Some(requested_at.as_str())
    );
}

#[test]
fn truthful_terminal_outcomes_win_after_cancel_intent() {
    let svc = service();

    // Completion wins after intent: completed retains cancelRequestedAt.
    let run_a = new_run_id();
    let session_a = "sess-complete-wins";
    let run_a = {
        let _ = run_a;
        running_run(&svc, session_a)
    };
    assert!(svc.record_turn(&run_a, "turn-a").expect("record"));
    svc.cancel_intent(&run_a).expect("intent");
    svc.finish_turn(
        session_a,
        &workflow_prompt_id(&run_a),
        Some("turn-a"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("completion wins");
    let completed = view(&svc, &run_a);
    assert_eq!(completed.run.status, WorkflowRunStatus::Completed);
    assert!(completed.run.cancel_requested_at.is_some());
    assert!(completed.run.failure_code.is_none());

    // Failure wins after intent: failed retains cancelRequestedAt + code.
    let session_b = "sess-failed-wins";
    let run_b = running_run(&svc, session_b);
    assert!(svc.record_turn(&run_b, "turn-b").expect("record"));
    svc.cancel_intent(&run_b).expect("intent");
    svc.finish_turn(
        session_b,
        &workflow_prompt_id(&run_b),
        Some("turn-b"),
        WorkflowTurnOutcome::Failed,
    )
    .expect("failure wins");
    let failed = view(&svc, &run_b);
    assert_eq!(failed.run.status, WorkflowRunStatus::Failed);
    assert_eq!(
        failed.run.failure_code,
        Some(WorkflowRunFailureCode::SessionTurnFailed)
    );
    assert!(failed.run.cancel_requested_at.is_some());
}

#[test]
fn queued_or_lost_ack_step_cancel_is_intent_only_and_fence_resolves_it() {
    // A running step with a null stored turn (queued, or lost
    // acknowledgement): cancellation records intent only — there is no exact
    // turn to target — and startup fencing resolves the run.
    let svc = service();
    let run_id = running_run(&svc, "sess-null-turn");

    let outcome = svc.cancel_intent(&run_id).expect("cancel");
    let WorkflowCancelOutcome::CancellationPending { turn_id, .. } = outcome else {
        panic!("expected pending, got {outcome:?}");
    };
    assert!(turn_id.is_none(), "no stored turn to target");
    let pending = view(&svc, &run_id);
    assert_eq!(pending.run.status, WorkflowRunStatus::Running);
    assert!(pending.run.cancel_requested_at.is_some());
    let version_after_intent = pending.run.state_version;

    svc.fence_nonterminal_after_restart().expect("fence");
    let fenced = view(&svc, &run_id);
    assert_eq!(fenced.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(
        fenced.run.interruption_code,
        Some(WorkflowInterruptionCode::RuntimeRestarted)
    );
    assert!(fenced.run.cancel_requested_at.is_some(), "intent retained");
    // Fencing increments each run exactly once.
    assert_eq!(fenced.run.state_version, version_after_intent + 1);
}

#[test]
fn cancel_intent_outcomes_for_missing_and_terminal_runs() {
    let svc = service();
    assert!(matches!(
        svc.cancel_intent(&new_run_id()).expect("missing"),
        WorkflowCancelOutcome::Missing
    ));

    // A completed run returns Terminal unchanged and never gains intent.
    let session_id = "sess-done-first";
    let run_id = running_run(&svc, session_id);
    svc.finish_turn(
        session_id,
        &workflow_prompt_id(&run_id),
        Some("t"),
        WorkflowTurnOutcome::Completed,
    )
    .expect("complete");
    let before = view(&svc, &run_id);
    let outcome = svc.cancel_intent(&run_id).expect("terminal cancel");
    let WorkflowCancelOutcome::Terminal(snapshot) = outcome else {
        panic!("expected Terminal, got {outcome:?}");
    };
    let snapshot = run_view(&snapshot);
    assert_eq!(snapshot.run.status, WorkflowRunStatus::Completed);
    assert!(snapshot.run.cancel_requested_at.is_none());
    assert_eq!(snapshot.run.state_version, before.run.state_version);
}

#[test]
fn intent_write_failure_performs_no_durable_change() {
    // Break the steps table so the cancel-intent transaction fails mid-way;
    // the run row must remain byte-identical (transactional no-change).
    let svc = service();
    let run_id = new_run_id();
    svc.accept(&run_id, valid_input()).expect("accept");
    let before = view(&svc, &run_id);

    svc.store_db_for_tests()
        .with_conn(|conn| {
            conn.execute(
                "ALTER TABLE workflow_run_steps RENAME TO workflow_run_steps_broken",
                [],
            )
        })
        .expect("break steps table");
    assert!(
        svc.cancel_intent(&run_id).is_err(),
        "intent write must fail"
    );
    svc.store_db_for_tests()
        .with_conn(|conn| {
            conn.execute(
                "ALTER TABLE workflow_run_steps_broken RENAME TO workflow_run_steps",
                [],
            )
        })
        .expect("restore steps table");

    let after = view(&svc, &run_id);
    assert_eq!(after.run, before.run, "no durable change on intent failure");
    assert!(after.run.cancel_requested_at.is_none());
}
