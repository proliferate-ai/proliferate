//! Store tests against the real migration ladder (`Db::open_in_memory`), so
//! every test doubles as a fresh-DB replay proof for migration 0069. Lifecycle
//! flows drive the pure transition function and apply its decisions — the
//! same path the live engine takes — with the invariant sweep asserted after
//! every commit.

use crate::persistence::Db;

use super::definition::{
    DefinitionEdge, DefinitionInput, DefinitionNode, DocTemplate, InvocationPlacement,
    InvocationSnapshot, PlacementMode, WorkflowDefinition, DEFINITION_SCHEMA_VERSION,
};
use super::invariants;
use super::model::{
    RenderedEnvelope, WorkflowInterruptionCode, WorkflowNodeKind, WorkflowNodeStatus,
    WorkflowNodeType, WorkflowRunStatus,
};
use super::store::{NewRunParams, ResolvedSideEffect, WorkflowStore};
use super::transition::{
    next, Decision, RunState, Transition, TurnFinished, TurnStopReason, WorkflowCommand,
    WorkflowEvent,
};

fn test_store() -> WorkflowStore {
    let db = Db::open_in_memory().expect("in-memory db with full migrations");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (
                'repo-root-1', 'external', '/tmp/repo-root-1', NULL, 'main', NULL, NULL,
                NULL, NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'
             )",
            [],
        )?;
        conn.execute(
            "INSERT INTO workspaces (
                id, kind, repo_root_id, path, surface, lifecycle_state, cleanup_state,
                created_at, updated_at
             ) VALUES (
                'workspace-1', 'worktree', 'repo-root-1', '/tmp/workspace-1',
                'standard', 'active', 'none', ?1, ?1
             )",
            ["2026-08-14T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed repo root and workspace");
    WorkflowStore::new(db)
}

fn snapshot() -> InvocationSnapshot {
    let definition = WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![
            DefinitionNode {
                id: "plan".into(),
                node_type: WorkflowNodeType::Agent,
                title: "Plan".into(),
                prompt: "Plan the work for @input:ticket, write @doc:plan-doc".into(),
                model: None,
            },
            DefinitionNode {
                id: "review".into(),
                node_type: WorkflowNodeType::HumanInLoop,
                title: "Review".into(),
                prompt: "Summarize @doc:plan-doc for review".into(),
                model: None,
            },
            DefinitionNode {
                id: "ship".into(),
                node_type: WorkflowNodeType::Agent,
                title: "Ship".into(),
                prompt: "Implement per @doc:plan-doc".into(),
                model: None,
            },
        ],
        edges: vec![
            DefinitionEdge {
                from: "plan".into(),
                to: "review".into(),
            },
            DefinitionEdge {
                from: "review".into(),
                to: "ship".into(),
            },
        ],
        inputs: vec![DefinitionInput {
            name: "ticket".into(),
            description: None,
            required: true,
        }],
        doc_templates: vec![
            DocTemplate {
                slug: "plan-doc".into(),
                producing_node_id: Some("plan".into()),
                body: "# Plan\n".into(),
            },
            DocTemplate {
                slug: "notes".into(),
                producing_node_id: None,
                body: String::new(),
            },
        ],
    };
    let mut arguments = serde_json::Map::new();
    arguments.insert("ticket".into(), serde_json::Value::String("PRO-9".into()));
    InvocationSnapshot {
        schema_version: DEFINITION_SCHEMA_VERSION,
        workflow_definition_id: "wd-1".into(),
        definition,
        arguments,
        placement: InvocationPlacement {
            repo_config_id: "rc-1".into(),
            mode: PlacementMode::Worktree,
        },
    }
}

fn params(run_id: &str) -> NewRunParams {
    NewRunParams {
        run_id: run_id.into(),
        invocation_id: format!("inv-{run_id}"),
        workspace_id: "workspace-1".into(),
        snapshot: snapshot(),
    }
}

fn decide(state: &RunState, event: &WorkflowEvent) -> Transition {
    match next(state, event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition for {event:?}, got {other:?}"),
    }
}

fn clean_turn(node_row_id: &str) -> WorkflowEvent {
    WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: node_row_id.into(),
        stop_reason: TurnStopReason::CleanEndTurn,
        queue_empty: true,
    })
}

fn assert_healthy(state: &RunState) {
    let violations = invariants::sweep(state);
    assert!(violations.is_empty(), "invariants violated: {violations:?}");
}

#[test]
fn create_run_materializes_run_nodes_and_docs() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    assert!(created.created);

    let state = &created.state;
    assert_eq!(state.run.status, WorkflowRunStatus::Running);
    assert_eq!(
        state.run.current_node_row_id.as_deref(),
        Some(created.first_node_row_id.as_str())
    );
    assert_eq!(state.nodes.len(), 3);

    let chain = state.effective_chain();
    assert_eq!(
        chain
            .iter()
            .map(|node| node.definition_node_id.as_deref().unwrap())
            .collect::<Vec<_>>(),
        vec!["plan", "review", "ship"]
    );
    assert_eq!(chain[0].status, WorkflowNodeStatus::Running);
    assert!(chain[0].started_at.is_some());
    assert_eq!(chain[0].kind, WorkflowNodeKind::Defined);
    assert_eq!(chain[1].status, WorkflowNodeStatus::Pending);
    assert_eq!(chain[1].node_type, WorkflowNodeType::HumanInLoop);
    assert_eq!(chain[2].status, WorkflowNodeStatus::Pending);
    assert_eq!(chain[0].chain_index, Some(0));
    assert_eq!(chain[2].chain_index, Some(2));

    // Doc registry: NN from the producing node's chain index; producer-less
    // seeds keep a bare slug filename.
    let docs = &created.docs;
    assert_eq!(docs.len(), 2);
    let plan_doc = docs.iter().find(|doc| doc.slug == "plan-doc").unwrap();
    assert_eq!(plan_doc.filename, "00-plan-doc.md");
    assert_eq!(
        plan_doc.producing_node_row_id.as_deref(),
        Some(chain[0].id.as_str())
    );
    assert!(plan_doc.seeded_from_template);
    let notes = docs.iter().find(|doc| doc.slug == "notes").unwrap();
    assert_eq!(notes.filename, "notes.md");
    assert!(notes.producing_node_row_id.is_none());

    assert_healthy(state);
}

#[test]
fn create_run_is_idempotent_on_run_id() {
    let store = test_store();
    let first = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let replay = store
        .create_run_with_first_node(params("run-1"))
        .expect("replay the PUT");
    assert!(!replay.created);
    assert_eq!(replay.first_node_row_id, first.first_node_row_id);
    assert_eq!(
        replay
            .state
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>(),
        first
            .state
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>()
    );
    assert_eq!(replay.docs.len(), first.docs.len());
}

#[test]
fn create_run_rejects_invalid_snapshots_without_partial_rows() {
    let store = test_store();
    let mut invalid = params("run-bad");
    invalid.snapshot.arguments.clear(); // required input 'ticket' now missing
    assert!(store.create_run_with_first_node(invalid).is_err());
    assert!(store
        .load_run_state("run-bad")
        .expect("query run state")
        .is_none());
}

#[test]
fn create_run_enforces_the_workspace_foreign_key() {
    let store = test_store();
    let mut orphan = params("run-orphan");
    orphan.workspace_id = "ghost-workspace".into();
    assert!(store.create_run_with_first_node(orphan).is_err());
    assert!(store
        .load_run_state("run-orphan")
        .expect("query run state")
        .is_none());
}

#[test]
fn sessions_table_gained_the_two_workflow_columns() {
    let store = test_store();
    // Reach the raw connection through a run-independent query.
    let _ = store; // schema is shared; open a fresh db for the pragma
    let db = Db::open_in_memory().expect("in-memory db");
    let columns: Vec<String> = db
        .with_conn(|conn| {
            let mut statement = conn.prepare("PRAGMA table_info(sessions)")?;
            let names = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(names)
        })
        .expect("pragma table_info");
    assert!(columns.iter().any(|name| name == "workflow_run_id"));
    assert!(columns.iter().any(|name| name == "workflow_node_row_id"));
}

#[test]
fn happy_path_lifecycle_advances_gates_and_completes() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp plan session");

    // Plan finishes cleanly: advance to the review gate node.
    let state = store.load_run_state("run-1").expect("load").expect("run exists");
    let transition = decide(&state, &clean_turn(&plan_id));
    let applied = store.apply_transition("run-1", &transition).expect("advance");
    assert_healthy(&applied.state);
    let review_id = match &applied.side_effect {
        ResolvedSideEffect::StartNode { node_row_id } => node_row_id.clone(),
        other => panic!("expected StartNode, got {other:?}"),
    };
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert_eq!(
        applied.state.node(&plan_id).unwrap().status,
        WorkflowNodeStatus::Completed
    );
    assert!(applied.state.node(&plan_id).unwrap().completed_at.is_some());
    store
        .stamp_session(&review_id, "sess-review", Some("prompt-review"), Some("claude"))
        .expect("stamp review session");

    // The human_in_loop node's clean turn renders the gate.
    let transition = decide(&applied.state, &clean_turn(&review_id));
    let applied = store.apply_transition("run-1", &transition).expect("gate");
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);
    assert_eq!(applied.side_effect, ResolvedSideEffect::None);
    assert_eq!(
        applied.state.node(&review_id).unwrap().status,
        WorkflowNodeStatus::AwaitingHuman
    );

    // Approving the gate advances to ship.
    let transition = decide(
        &applied.state,
        &WorkflowEvent::Command(WorkflowCommand::ApproveGate {
            node_row_id: review_id.clone(),
        }),
    );
    let applied = store.apply_transition("run-1", &transition).expect("approve");
    assert_healthy(&applied.state);
    let ship_id = match &applied.side_effect {
        ResolvedSideEffect::StartNode { node_row_id } => node_row_id.clone(),
        other => panic!("expected StartNode, got {other:?}"),
    };
    assert_eq!(
        applied.state.node(&review_id).unwrap().status,
        WorkflowNodeStatus::Completed
    );

    // Ship finishes: the run completes.
    let transition = decide(&applied.state, &clean_turn(&ship_id));
    let applied = store.apply_transition("run-1", &transition).expect("complete");
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Completed);
    assert!(applied.state.run.completed_at.is_some());
    assert_eq!(applied.side_effect, ResolvedSideEffect::None);

    // Negative control: the same clean turn against the completed run holds.
    assert_eq!(next(&applied.state, &clean_turn(&ship_id)), Decision::Hold);
}

#[test]
fn fail_and_redo_persists_a_running_replacement() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    // The plan turn errors: node failed, run failed.
    let transition = decide(
        &created.state,
        &WorkflowEvent::TurnFinished(TurnFinished {
            node_row_id: plan_id.clone(),
            stop_reason: TurnStopReason::Error,
            queue_empty: true,
        }),
    );
    let applied = store.apply_transition("run-1", &transition).expect("fail");
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Failed);
    assert_eq!(applied.state.run.failure_code.as_deref(), Some("turn_error"));

    // Fail-and-redo with an edited prompt.
    let transition = decide(
        &applied.state,
        &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
            node_row_id: plan_id.clone(),
            prompt: Some("plan again, smaller steps".into()),
        }),
    );
    let applied = store.apply_transition("run-1", &transition).expect("redo");
    assert_healthy(&applied.state);
    let replacement_id = applied.created_node_row_id.clone().expect("minted row");
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::StartNode {
            node_row_id: replacement_id.clone(),
        }
    );
    let replacement = applied.state.node(&replacement_id).unwrap();
    assert_eq!(replacement.kind, WorkflowNodeKind::Replacement);
    assert_eq!(replacement.replaces_node_row_id.as_deref(), Some(plan_id.as_str()));
    assert_eq!(replacement.status, WorkflowNodeStatus::Running);
    assert_eq!(replacement.prompt, "plan again, smaller steps");
    assert_eq!(replacement.chain_index, Some(0));
    // The failed row stays, failed, beside its replacement.
    assert_eq!(
        applied.state.node(&plan_id).unwrap().status,
        WorkflowNodeStatus::Failed
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert!(applied.state.run.failure_code.is_none());
    assert!(applied.state.run.completed_at.is_none());
    assert_eq!(
        applied.state.run.current_node_row_id.as_deref(),
        Some(replacement_id.as_str())
    );

    // The replacement owns the chain position: its clean turn advances to review.
    let transition = decide(&applied.state, &clean_turn(&replacement_id));
    let applied = store.apply_transition("run-1", &transition).expect("advance");
    assert_healthy(&applied.state);
    let current = applied.state.current_node().unwrap();
    assert_eq!(current.definition_node_id.as_deref(), Some("review"));
}

#[test]
fn undo_advance_parks_the_gate_and_disposes_the_new_session() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let transition = decide(&created.state, &clean_turn(&plan_id));
    let applied = store.apply_transition("run-1", &transition).expect("advance");
    let review_id = applied.state.current_node().unwrap().id.clone();
    store
        .stamp_session(&review_id, "sess-review", Some("prompt-review"), None)
        .expect("stamp");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let transition = decide(&state, &WorkflowEvent::Command(WorkflowCommand::UndoAdvance));
    let applied = store.apply_transition("run-1", &transition).expect("undo");
    assert_healthy(&applied.state);
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::DisposeSession {
            session_id: "sess-review".into(),
        }
    );
    // The undone node returns to pending, unlinked.
    let review = applied.state.node(&review_id).unwrap();
    assert_eq!(review.status, WorkflowNodeStatus::Pending);
    assert!(review.session_id.is_none());
    assert!(review.started_at.is_none());
    // The completed node parks as a retroactive gate.
    let plan = applied.state.node(&plan_id).unwrap();
    assert_eq!(plan.status, WorkflowNodeStatus::AwaitingHuman);
    assert!(plan.completed_at.is_none());
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);
    assert_eq!(
        applied.state.run.current_node_row_id.as_deref(),
        Some(plan_id.as_str())
    );

    // Approving the retroactive gate re-advances.
    let transition = decide(
        &applied.state,
        &WorkflowEvent::Command(WorkflowCommand::ApproveGate {
            node_row_id: plan_id.clone(),
        }),
    );
    let applied = store.apply_transition("run-1", &transition).expect("re-advance");
    assert_healthy(&applied.state);
    assert_eq!(
        applied.state.current_node().unwrap().id.as_str(),
        review_id.as_str()
    );
    assert_eq!(
        applied.state.node(&review_id).unwrap().status,
        WorkflowNodeStatus::Running
    );
}

#[test]
fn boot_fence_interrupts_and_resume_restarts() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), None)
        .expect("stamp");

    assert_eq!(store.running_run_ids().expect("list"), vec!["run-1".to_string()]);

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let fence = WorkflowEvent::BootFence {
        code: WorkflowInterruptionCode::RuntimeRestarted,
    };
    let transition = decide(&state, &fence);
    let applied = store.apply_transition("run-1", &transition).expect("fence");
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(
        applied.state.run.interruption_code,
        Some(WorkflowInterruptionCode::RuntimeRestarted)
    );
    assert_eq!(
        applied.state.node(&plan_id).unwrap().status,
        WorkflowNodeStatus::NeedsAttention
    );
    // Fenced runs leave the boot sweep set, and a second fence holds.
    assert!(store.running_run_ids().expect("list").is_empty());
    assert_eq!(next(&applied.state, &fence), Decision::Hold);

    // Resume: the node runs again, unlinked, in a fresh session.
    let transition = decide(
        &applied.state,
        &WorkflowEvent::Command(WorkflowCommand::Resume),
    );
    let applied = store.apply_transition("run-1", &transition).expect("resume");
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert!(applied.state.run.interruption_code.is_none());
    let plan = applied.state.node(&plan_id).unwrap();
    assert_eq!(plan.status, WorkflowNodeStatus::Running);
    assert!(plan.session_id.is_none());
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::StartNode {
            node_row_id: plan_id.clone(),
        }
    );
}

#[test]
fn adhoc_nodes_run_beside_the_chain_without_touching_the_run() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let transition = decide(
        &created.state,
        &WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
            anchor_node_row_id: plan_id.clone(),
            prompt: "also check the error budget".into(),
            model: None,
        }),
    );
    let applied = store.apply_transition("run-1", &transition).expect("adhoc");
    assert_healthy(&applied.state);
    let adhoc_id = applied.created_node_row_id.clone().expect("minted row");
    let adhoc = applied.state.node(&adhoc_id).unwrap();
    assert_eq!(adhoc.kind, WorkflowNodeKind::Adhoc);
    assert_eq!(adhoc.status, WorkflowNodeStatus::Running);
    assert_eq!(adhoc.anchor_node_row_id.as_deref(), Some(plan_id.as_str()));
    // The run itself is untouched: still running on the plan node.
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert_eq!(
        applied.state.run.current_node_row_id.as_deref(),
        Some(plan_id.as_str())
    );
    // The adhoc row never joins the effective chain.
    assert_eq!(applied.state.effective_chain().len(), 3);

    // The chain still advances while the adhoc node runs.
    let transition = decide(&applied.state, &clean_turn(&plan_id));
    let applied = store.apply_transition("run-1", &transition).expect("advance");
    assert_healthy(&applied.state);
    assert_eq!(
        applied.state.node(&plan_id).unwrap().status,
        WorkflowNodeStatus::Completed
    );
    assert_eq!(
        applied.state.node(&adhoc_id).unwrap().status,
        WorkflowNodeStatus::Running
    );

    // The adhoc turn completes only its own row.
    let transition = decide(&applied.state, &clean_turn(&adhoc_id));
    let applied = store.apply_transition("run-1", &transition).expect("adhoc turn");
    assert_healthy(&applied.state);
    assert_eq!(
        applied.state.node(&adhoc_id).unwrap().status,
        WorkflowNodeStatus::Completed
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert_eq!(applied.side_effect, ResolvedSideEffect::None);
}

#[test]
fn stamp_session_and_envelope_round_trip() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp");
    let envelope = RenderedEnvelope {
        instruction_blocks: vec!["System instruction from AnyHarness".into()],
        first_message: "Plan the work for PRO-9".into(),
        system_prompt_append: vec!["workflow context".into()],
    };
    store
        .store_rendered_envelope(&plan_id, &envelope)
        .expect("store envelope");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let plan = state.node(&plan_id).unwrap();
    assert_eq!(plan.session_id.as_deref(), Some("sess-plan"));
    assert_eq!(plan.prompt_id.as_deref(), Some("prompt-plan"));
    assert_eq!(plan.rendered_envelope.as_ref(), Some(&envelope));
}

#[test]
fn runs_for_workspace_lists_newest_first() {
    let store = test_store();
    store
        .create_run_with_first_node(params("run-1"))
        .expect("create run-1");
    store
        .create_run_with_first_node(params("run-2"))
        .expect("create run-2");
    let runs = store.runs_for_workspace("workspace-1").expect("list");
    assert_eq!(runs.len(), 2);
    assert!(runs.iter().any(|run| run.id == "run-1"));
    assert!(runs.iter().any(|run| run.id == "run-2"));
    assert!(store
        .runs_for_workspace("other-workspace")
        .expect("list empty")
        .is_empty());
}

#[test]
fn apply_transition_on_unknown_run_errors() {
    let store = test_store();
    let transition = Transition::CompleteRun {
        completed_node_row_id: "ghost".into(),
    };
    assert!(store.apply_transition("ghost-run", &transition).is_err());
}

#[test]
fn projection_serializes_camel_case_from_rows() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let projection = super::projection::project(&created.state, &created.docs);
    let json = serde_json::to_value(&projection).expect("serialize projection");
    assert_eq!(json["id"], "run-1");
    assert_eq!(json["workspaceId"], "workspace-1");
    assert_eq!(json["status"], "running");
    assert_eq!(json["definition"]["schemaVersion"], 2);
    assert_eq!(json["arguments"]["ticket"], "PRO-9");
    assert_eq!(json["nodes"][0]["definitionNodeId"], "plan");
    assert_eq!(json["nodes"][0]["nodeType"], "agent");
    assert_eq!(json["nodes"][0]["status"], "running");
    assert_eq!(json["nodes"][1]["nodeType"], "human_in_loop");
    assert_eq!(json["docs"][0]["filename"], "00-plan-doc.md");
    // The rendered envelope never leaves the runtime.
    assert!(json["nodes"][0].get("renderedEnvelope").is_none());
}
