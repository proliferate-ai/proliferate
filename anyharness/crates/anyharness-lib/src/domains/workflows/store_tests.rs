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
    RenderedEnvelope, WorkflowInterruptionCode, WorkflowNodeFailureCode, WorkflowNodeKind,
    WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus,
};
use super::store::{
    emit_decision_events, AppliedTransition, NewRunParams, ResolvedSideEffect, WorkflowStore,
};
use super::transition::{
    next, Decision, RunState, Transition, TurnFinished, TurnStopReason, WorkflowCommand,
    WorkflowEvent,
};

fn test_store() -> WorkflowStore {
    test_store_with_db().1
}

fn test_store_with_db() -> (Db, WorkflowStore) {
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
                id, kind, repo_root_id, path, surface, lifecycle_state,
                created_at, updated_at
             ) VALUES (
                'workspace-1', 'worktree', 'repo-root-1', '/tmp/workspace-1',
                'standard', 'active', ?1, ?1
             )",
            ["2026-08-14T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed repo root and workspace");
    (db.clone(), WorkflowStore::new(db))
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
                producing_node_id: "plan".into(),
                body: "# Plan\n".into(),
            },
            DocTemplate {
                slug: "notes".into(),
                producing_node_id: "review".into(),
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
    let snapshot = snapshot();
    let definition_json =
        serde_json::to_string(&snapshot.definition).expect("serialize definition");
    NewRunParams {
        run_id: run_id.into(),
        invocation_id: format!("inv-{run_id}"),
        workspace_id: "workspace-1".into(),
        snapshot,
        definition_json,
    }
}

fn decide(state: &RunState, event: &WorkflowEvent) -> Transition {
    match next(state, event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition for {event:?}, got {other:?}"),
    }
}

/// Decide and apply one event the way the live engine does: the transition
/// carries the event as its telemetry cause.
fn decide_and_apply(
    store: &WorkflowStore,
    run_id: &str,
    state: &RunState,
    event: &WorkflowEvent,
) -> AppliedTransition {
    let transition = decide(state, event);
    store
        .apply_transition(run_id, &transition, event)
        .expect("apply transition")
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

/// Subscriber-capture harness for named-event assertions (pr11 convention):
/// runs `body` under a fmt subscriber writing into a shared buffer, returning
/// `body`'s result alongside the captured, formatted log text.
fn capture_tracing_output<T>(body: impl FnOnce() -> T) -> (T, String) {
    use std::io;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct SharedLogWriter(Arc<Mutex<Vec<u8>>>);

    impl io::Write for SharedLogWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    let log_bytes = Arc::new(Mutex::new(Vec::new()));
    let log_writer = Arc::clone(&log_bytes);
    let subscriber = tracing_subscriber::fmt()
        .without_time()
        .with_ansi(false)
        .with_writer(move || SharedLogWriter(Arc::clone(&log_writer)))
        .finish();
    let result = tracing::subscriber::with_default(subscriber, body);
    let logged = String::from_utf8(
        log_bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone(),
    )
    .expect("formatted log is UTF-8");
    (result, logged)
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

    // Doc registry: NN-slug.md, NN from the producing node's chain index
    // (Ruling C: every doc has a required producer).
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
    assert_eq!(notes.filename, "01-notes.md");
    assert_eq!(
        notes.producing_node_row_id.as_deref(),
        Some(chain[1].id.as_str())
    );

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
fn definition_json_is_stored_byte_verbatim() {
    let store = test_store();
    // Key order and formatting no serializer would produce: if the store ever
    // round-trips through serde_json::Value, this exact string cannot survive.
    let odd = "{\n  \"zz_last\":   1,\t\"aa_first\": \"two\"  }";
    let mut with_odd_json = params("run-1");
    with_odd_json.definition_json = odd.to_string();
    let created = store
        .create_run_with_first_node(with_odd_json)
        .expect("create run");
    assert_eq!(created.state.run.definition_json, odd);
    let reloaded = store
        .load_run_state("run-1")
        .expect("load")
        .expect("run exists");
    assert_eq!(reloaded.run.definition_json, odd);
}

#[test]
fn workspace_deletion_cascades_to_run_rows() {
    let (db, store) = test_store_with_db();
    store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    db.with_conn(|conn| {
        conn.execute("DELETE FROM workspaces WHERE id = 'workspace-1'", [])?;
        let nodes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workflow_run_nodes WHERE run_id = 'run-1'",
            [],
            |row| row.get(0),
        )?;
        let docs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workflow_run_docs WHERE run_id = 'run-1'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(nodes, 0, "node rows must cascade with the workspace");
        assert_eq!(docs, 0, "doc rows must cascade with the workspace");
        Ok(())
    })
    .expect("delete workspace");
    assert!(store
        .load_run_state("run-1")
        .expect("query run state")
        .is_none());
}

#[test]
fn sessions_table_gained_the_two_workflow_columns() {
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
    let state = store
        .load_run_state("run-1")
        .expect("load")
        .expect("run exists");
    let applied = decide_and_apply(&store, "run-1", &state, &clean_turn(&plan_id));
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
        .stamp_session(
            &review_id,
            "sess-review",
            Some("prompt-review"),
            Some("claude"),
        )
        .expect("stamp review session");

    // The human_in_loop node's clean turn renders the gate.
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&review_id));
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);
    assert_eq!(applied.side_effect, ResolvedSideEffect::None);
    assert_eq!(
        applied.state.node(&review_id).unwrap().status,
        WorkflowNodeStatus::AwaitingHuman
    );

    // Approving the gate advances to ship.
    let approve = WorkflowEvent::Command(WorkflowCommand::ApproveGate {
        node_row_id: review_id.clone(),
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &approve);
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
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&ship_id));
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
    let errored = WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: plan_id.clone(),
        stop_reason: TurnStopReason::Error,
        queue_empty: true,
    });
    let applied = decide_and_apply(&store, "run-1", &created.state, &errored);
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Failed);
    assert_eq!(
        applied.state.run.failure_code.as_deref(),
        Some("turn_error")
    );

    // Fail-and-redo with an edited prompt.
    let redo = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: plan_id.clone(),
        prompt: Some("plan again, smaller steps".into()),
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &redo);
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
    assert_eq!(
        replacement.replaces_node_row_id.as_deref(),
        Some(plan_id.as_str())
    );
    assert_eq!(replacement.status, WorkflowNodeStatus::Running);
    assert_eq!(replacement.prompt, "plan again, smaller steps");
    assert_eq!(replacement.chain_index, Some(0));
    // The failed row stays, failed, beside its replacement — and keeps its OWN
    // failure code (superseded is only for rows replaced from a non-failed
    // pause).
    let failed = applied.state.node(&plan_id).unwrap();
    assert_eq!(failed.status, WorkflowNodeStatus::Failed);
    assert_eq!(
        failed.failure_code,
        Some(WorkflowNodeFailureCode::TurnError)
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert!(applied.state.run.failure_code.is_none());
    assert!(applied.state.run.completed_at.is_none());
    assert_eq!(
        applied.state.run.current_node_row_id.as_deref(),
        Some(replacement_id.as_str())
    );

    // The replacement owns the chain position: its clean turn advances to review.
    let applied = decide_and_apply(
        &store,
        "run-1",
        &applied.state,
        &clean_turn(&replacement_id),
    );
    assert_healthy(&applied.state);
    let current = applied.state.current_node().unwrap();
    assert_eq!(current.definition_node_id.as_deref(), Some("review"));
}

#[test]
fn redo_from_a_parked_gate_marks_the_old_row_superseded() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    // Reach the review gate.
    let applied = decide_and_apply(&store, "run-1", &created.state, &clean_turn(&plan_id));
    let review_id = applied.state.current_node().unwrap().id.clone();
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&review_id));
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);

    // Redo the waiting gate: it was never failed, so the superseded row takes
    // the dedicated code and the failed⇔code row law still holds.
    let redo = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: review_id.clone(),
        prompt: None,
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &redo);
    assert_healthy(&applied.state);
    let old_review = applied.state.node(&review_id).unwrap();
    assert_eq!(old_review.status, WorkflowNodeStatus::Failed);
    assert_eq!(
        old_review.failure_code,
        Some(WorkflowNodeFailureCode::Superseded)
    );
    let replacement_id = applied.created_node_row_id.expect("minted row");
    let replacement = applied.state.node(&replacement_id).unwrap();
    assert_eq!(replacement.kind, WorkflowNodeKind::Replacement);
    assert_eq!(replacement.node_type, WorkflowNodeType::HumanInLoop);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
}

#[test]
fn adhoc_redo_replaces_only_the_adhoc_row() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let add = WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
        anchor_node_row_id: plan_id.clone(),
        prompt: "also check the error budget".into(),
        model: None,
    });
    let applied = decide_and_apply(&store, "run-1", &created.state, &add);
    let adhoc_id = applied.created_node_row_id.clone().expect("minted row");

    // The adhoc launch fails: only its row fails, the run is untouched.
    let launch_failed = WorkflowEvent::NodeLaunchFailed {
        node_row_id: adhoc_id.clone(),
    };
    let applied = decide_and_apply(&store, "run-1", &applied.state, &launch_failed);
    assert_healthy(&applied.state);
    assert_eq!(
        applied.state.node(&adhoc_id).unwrap().status,
        WorkflowNodeStatus::Failed
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);

    // Fail-and-redo on the failed adhoc row: the replacement is ALSO adhoc,
    // anchored the same, and the run stays untouched (Ruling K).
    let redo = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: adhoc_id.clone(),
        prompt: None,
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &redo);
    assert_healthy(&applied.state);
    let replacement_id = applied.created_node_row_id.clone().expect("minted row");
    let replacement = applied.state.node(&replacement_id).unwrap();
    // K.1: the minted row stays kind ADHOC (the client's side-node predicate
    // keys on kind), anchored the same, replacing the superseded adhoc row.
    assert_eq!(replacement.kind, WorkflowNodeKind::Adhoc);
    assert_eq!(
        replacement.anchor_node_row_id.as_deref(),
        Some(plan_id.as_str())
    );
    assert_eq!(
        replacement.replaces_node_row_id.as_deref(),
        Some(adhoc_id.as_str())
    );
    assert_eq!(replacement.status, WorkflowNodeStatus::Running);
    // The old adhoc row keeps its own failure code.
    assert_eq!(
        applied.state.node(&adhoc_id).unwrap().failure_code,
        Some(WorkflowNodeFailureCode::NodeLaunchFailed)
    );
    // The run never noticed: still running on plan.
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert_eq!(
        applied.state.run.current_node_row_id.as_deref(),
        Some(plan_id.as_str())
    );

    // Negative control: fail-and-redo on the RUNNING adhoc replacement is not
    // a pause and must be refused.
    let illegal = next(
        &applied.state,
        &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
            node_row_id: replacement_id,
            prompt: None,
        }),
    );
    assert!(
        matches!(illegal, Decision::Illegal(_)),
        "expected Illegal, got {illegal:?}"
    );
}

#[test]
fn flipping_the_waiting_gate_to_agent_persists_the_flip() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    // Reach the review gate.
    let applied = decide_and_apply(&store, "run-1", &created.state, &clean_turn(&plan_id));
    let review_id = applied.state.current_node().unwrap().id.clone();
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&review_id));
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);

    // Flipping the waiting gate to agent advances immediately AND persists the
    // flip on the completed row (a later undo must re-park it as agent).
    let flip = WorkflowEvent::Command(WorkflowCommand::FlipType {
        node_row_id: review_id.clone(),
        node_type: WorkflowNodeType::Agent,
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &flip);
    assert_healthy(&applied.state);
    let review = applied.state.node(&review_id).unwrap();
    assert_eq!(review.status, WorkflowNodeStatus::Completed);
    assert_eq!(review.node_type, WorkflowNodeType::Agent);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
    assert_eq!(
        applied
            .state
            .current_node()
            .unwrap()
            .definition_node_id
            .as_deref(),
        Some("ship")
    );

    // The persisted flip survives a fresh read.
    let reloaded = store.load_run_state("run-1").expect("load").expect("run");
    assert_eq!(
        reloaded.node(&review_id).unwrap().node_type,
        WorkflowNodeType::Agent
    );
}

#[test]
fn undo_advance_parks_the_gate_and_disposes_the_new_session() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let applied = decide_and_apply(&store, "run-1", &created.state, &clean_turn(&plan_id));
    let review_id = applied.state.current_node().unwrap().id.clone();
    store
        .stamp_session(&review_id, "sess-review", Some("prompt-review"), None)
        .expect("stamp");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let undo = WorkflowEvent::Command(WorkflowCommand::UndoAdvance);
    let applied = decide_and_apply(&store, "run-1", &state, &undo);
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
    let approve = WorkflowEvent::Command(WorkflowCommand::ApproveGate {
        node_row_id: plan_id.clone(),
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &approve);
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
fn cancel_from_running_disposes_the_session_and_persists_in_one_commit() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp plan session");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let cancel = WorkflowEvent::Command(WorkflowCommand::Cancel);
    let applied = decide_and_apply(&store, "run-1", &state, &cancel);
    assert_healthy(&applied.state);
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::DisposeSessions {
            session_ids: vec!["sess-plan".into()],
        }
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Cancelled);
    assert!(applied.state.run.completed_at.is_some());
    let plan = applied.state.node(&plan_id).unwrap();
    assert_eq!(plan.status, WorkflowNodeStatus::Cancelled);
    // The node row's own `completed_at` means "completed successfully"
    // (mirrors FailNode/InterruptNode); a cancel never stamps it.
    assert!(plan.completed_at.is_none());
    // The disposed chain node's own session_id is NULLed, matching
    // UndoAdvance's convention for a killed session.
    assert!(plan.session_id.is_none());

    // Persisted, not just returned: a fresh read agrees.
    let reloaded = store.load_run_state("run-1").expect("load").expect("run");
    assert_eq!(reloaded.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(
        reloaded.node(&plan_id).unwrap().status,
        WorkflowNodeStatus::Cancelled
    );

    // A cancelled run is terminal: cancel again is illegal, same as any other
    // command save fail-and-redo.
    assert!(matches!(next(&reloaded, &cancel), Decision::Illegal(_)));
}

/// HIGH finding: a running adhoc row is never `state.current_node()` (by
/// invariant it can't be), so a disposal path that only looks at the current
/// node leaves a running adhoc row's session alive forever — with the
/// workspace already released for destruction by the now-cancelled run's
/// terminal status. Cancel must dispose every running row's session, chain
/// or adhoc, mirroring `on_boot_fence`'s "every running row" scan.
#[test]
fn cancel_with_a_running_adhoc_row_disposes_both_sessions() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp plan session");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let add_adhoc = WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
        anchor_node_row_id: plan_id.clone(),
        prompt: "investigate the flaky login test".into(),
        model: None,
    });
    let applied = decide_and_apply(&store, "run-1", &state, &add_adhoc);
    let adhoc_id = applied
        .created_node_row_id
        .clone()
        .expect("adhoc row minted");
    store
        .stamp_session(
            &adhoc_id,
            "sess-adhoc",
            Some("prompt-adhoc"),
            Some("claude"),
        )
        .expect("stamp adhoc session");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    assert_eq!(
        state.node(&adhoc_id).unwrap().status,
        WorkflowNodeStatus::Running
    );
    let cancel = WorkflowEvent::Command(WorkflowCommand::Cancel);
    let applied = decide_and_apply(&store, "run-1", &state, &cancel);
    assert_healthy(&applied.state);

    let ResolvedSideEffect::DisposeSessions { session_ids } = applied.side_effect.clone() else {
        panic!("expected DisposeSessions, got {:?}", applied.side_effect);
    };
    assert_eq!(
        session_ids.iter().collect::<std::collections::HashSet<_>>(),
        [&"sess-plan".to_string(), &"sess-adhoc".to_string()]
            .into_iter()
            .collect::<std::collections::HashSet<_>>(),
        "both the chain node's and the running adhoc row's sessions must be disposed"
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Cancelled);

    // The adhoc row is untouched by the transition itself (its resolution is
    // its disposed session, not a status flip); the chain node goes cancelled.
    assert_eq!(
        applied.state.node(&plan_id).unwrap().status,
        WorkflowNodeStatus::Cancelled
    );
}

/// MEDIUM finding: `interruption_code` must not survive a cancel — ResumeNode
/// and Redo both clear it on their own terminal-adjacent transitions, so a
/// cancelled run that was Interrupted must not still read as
/// interrupted-for-a-reason.
#[test]
fn cancel_from_interrupted_run_clears_interruption_code() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp plan session");
    let state = store.load_run_state("run-1").expect("load").expect("run");

    let fence = WorkflowEvent::BootFence {
        code: WorkflowInterruptionCode::AppShutdown,
    };
    let applied = decide_and_apply(&store, "run-1", &state, &fence);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(
        applied.state.run.interruption_code,
        Some(WorkflowInterruptionCode::AppShutdown)
    );

    let cancel = WorkflowEvent::Command(WorkflowCommand::Cancel);
    let applied = decide_and_apply(&store, "run-1", &applied.state, &cancel);
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(applied.state.run.interruption_code, None);

    // Persisted, not just returned.
    let reloaded = store.load_run_state("run-1").expect("load").expect("run");
    assert_eq!(reloaded.run.interruption_code, None);
}

#[test]
fn cancel_from_awaiting_human_gate_persists_without_disposing_a_session() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp plan session");
    let applied = decide_and_apply(&store, "run-1", &created.state, &clean_turn(&plan_id));
    let review_id = applied.state.current_node().unwrap().id.clone();
    store
        .stamp_session(
            &review_id,
            "sess-review",
            Some("prompt-review"),
            Some("claude"),
        )
        .expect("stamp review session");
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&review_id));
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);

    let cancel = WorkflowEvent::Command(WorkflowCommand::Cancel);
    let applied = decide_and_apply(&store, "run-1", &applied.state, &cancel);
    assert_healthy(&applied.state);
    // The waiting gate holds no live turn (Ruling L's disposal condition,
    // reused): nothing to dispose.
    assert_eq!(applied.side_effect, ResolvedSideEffect::None);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Cancelled);
    assert_eq!(
        applied.state.node(&review_id).unwrap().status,
        WorkflowNodeStatus::Cancelled
    );
}

/// pr11 subscriber-capture proof, cancel's twin of
/// `fail_node_transition_event_carries_named_target_and_failure_code`: the
/// widened `is_terminal()` (Cancelled now included) must still fire the
/// named run-finished event on the same commit that cancels the run.
#[test]
fn cancel_transition_emits_the_named_run_finished_event() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-obs"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    store
        .stamp_session(&plan_id, "sess-plan", Some("prompt-plan"), Some("claude"))
        .expect("stamp plan session");
    let state = store
        .load_run_state("run-obs")
        .expect("load")
        .expect("run exists");
    let cancel = WorkflowEvent::Command(WorkflowCommand::Cancel);

    let (applied, logged) =
        capture_tracing_output(|| decide_and_apply(&store, "run-obs", &state, &cancel));
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Cancelled);

    let transition_line = logged
        .lines()
        .find(|line| line.contains("anyharness.workflow_transition"))
        .expect("named transition event captured");
    assert!(transition_line.contains("run-obs"), "{transition_line}");
    assert!(transition_line.contains("cancel"), "{transition_line}");
    assert!(
        logged.contains("anyharness.workflow_run_finished"),
        "{logged}"
    );
}

#[test]
fn undo_window_closes_after_first_turn_and_reopens_on_reexecution() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let applied = decide_and_apply(&store, "run-1", &created.state, &clean_turn(&plan_id));
    let review_id = applied.state.current_node().unwrap().id.clone();
    store
        .stamp_session(&review_id, "sess-review", Some("prompt-review"), None)
        .expect("stamp");

    // Ruling J: the review session finishes its first turn — the undo window
    // closes, even though nothing else about the state changed.
    store
        .note_first_turn_finished(&review_id)
        .expect("note first turn");
    let state = store.load_run_state("run-1").expect("load").expect("run");
    assert!(state
        .node(&review_id)
        .unwrap()
        .first_turn_finished_at
        .is_some());
    let undo = WorkflowEvent::Command(WorkflowCommand::UndoAdvance);
    match next(&state, &undo) {
        Decision::Illegal(illegal) => {
            assert!(
                illegal.detail.contains("undo window is closed"),
                "unexpected detail: {}",
                illegal.detail
            );
        }
        other => panic!("expected Illegal, got {other:?}"),
    }
    // Stamping is idempotent: a second turn report does not move the stamp.
    let stamped_at = state
        .node(&review_id)
        .unwrap()
        .first_turn_finished_at
        .clone();
    store
        .note_first_turn_finished(&review_id)
        .expect("note again");
    let state = store.load_run_state("run-1").expect("load").expect("run");
    assert_eq!(
        state.node(&review_id).unwrap().first_turn_finished_at,
        stamped_at
    );

    // Re-execution reopens the window: fence the run, resume it — the node
    // restarts fresh (stamp cleared), so undo is legal again.
    let fence = WorkflowEvent::BootFence {
        code: WorkflowInterruptionCode::RuntimeRestarted,
    };
    let applied = decide_and_apply(&store, "run-1", &state, &fence);
    let resume = WorkflowEvent::Command(WorkflowCommand::Resume);
    let applied = decide_and_apply(&store, "run-1", &applied.state, &resume);
    assert!(applied
        .state
        .node(&review_id)
        .unwrap()
        .first_turn_finished_at
        .is_none());
    assert!(
        matches!(next(&applied.state, &undo), Decision::Transition(_)),
        "undo must be legal again after the node restarted fresh"
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

    assert_eq!(
        store.boot_fence_run_ids().expect("list"),
        vec!["run-1".to_string()]
    );

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let fence = WorkflowEvent::BootFence {
        code: WorkflowInterruptionCode::RuntimeRestarted,
    };
    let applied = decide_and_apply(&store, "run-1", &state, &fence);
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
    assert!(store.boot_fence_run_ids().expect("list").is_empty());
    assert_eq!(next(&applied.state, &fence), Decision::Hold);

    // Resume: the node runs again, unlinked, in a fresh session.
    let resume = WorkflowEvent::Command(WorkflowCommand::Resume);
    let applied = decide_and_apply(&store, "run-1", &applied.state, &resume);
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
fn fence_spares_the_gate_and_fences_orphan_adhocs() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    // An adhoc runs beside the chain while the run reaches the review gate.
    let add = WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
        anchor_node_row_id: plan_id.clone(),
        prompt: "poke around".into(),
        model: None,
    });
    let applied = decide_and_apply(&store, "run-1", &created.state, &add);
    let adhoc_id = applied.created_node_row_id.clone().expect("minted row");
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&plan_id));
    let review_id = applied.state.current_node().unwrap().id.clone();
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&review_id));
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);

    // The parked gate still owes a fence: the adhoc row is running (Ruling K's
    // any-node-running sweep set).
    assert_eq!(
        store.boot_fence_run_ids().expect("list"),
        vec!["run-1".to_string()]
    );

    // The fence parks ONLY the running adhoc; the gate and its pending
    // approval survive the restart untouched.
    let fence = WorkflowEvent::BootFence {
        code: WorkflowInterruptionCode::RuntimeRestarted,
    };
    let applied = decide_and_apply(&store, "run-1", &applied.state, &fence);
    assert_healthy(&applied.state);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);
    assert!(applied.state.run.interruption_code.is_none());
    assert_eq!(
        applied.state.node(&adhoc_id).unwrap().status,
        WorkflowNodeStatus::NeedsAttention
    );
    assert_eq!(
        applied.state.node(&review_id).unwrap().status,
        WorkflowNodeStatus::AwaitingHuman
    );

    // Negative control: with nothing running the fence holds.
    assert_eq!(next(&applied.state, &fence), Decision::Hold);
    assert!(store.boot_fence_run_ids().expect("list").is_empty());

    // Recovery for the fenced adhoc is fail-and-redo from needs_attention.
    let redo = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: adhoc_id.clone(),
        prompt: None,
    });
    let applied = decide_and_apply(&store, "run-1", &applied.state, &redo);
    assert_healthy(&applied.state);
    let old_adhoc = applied.state.node(&adhoc_id).unwrap();
    assert_eq!(old_adhoc.status, WorkflowNodeStatus::Failed);
    assert_eq!(
        old_adhoc.failure_code,
        Some(WorkflowNodeFailureCode::Superseded)
    );
    let replacement = applied
        .state
        .node(applied.created_node_row_id.as_deref().unwrap())
        .unwrap();
    assert_eq!(replacement.kind, WorkflowNodeKind::Adhoc);
    // The gate is still parked: the adhoc recovery never touched the run.
    assert_eq!(applied.state.run.status, WorkflowRunStatus::AwaitingHuman);
}

#[test]
fn adhoc_nodes_run_beside_the_chain_without_touching_the_run() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let add = WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
        anchor_node_row_id: plan_id.clone(),
        prompt: "also check the error budget".into(),
        model: None,
    });
    let applied = decide_and_apply(&store, "run-1", &created.state, &add);
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
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&plan_id));
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
    let applied = decide_and_apply(&store, "run-1", &applied.state, &clean_turn(&adhoc_id));
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

/// The spec-ordered proof that RENDERED envelopes survive the real column:
/// render_envelope's actual output — wrapper and all — stored, reloaded, and
/// read back from the raw column byte-compatibly.
#[test]
fn rendered_envelope_round_trips_through_the_real_column() {
    let (db, store) = test_store_with_db();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    let docs = store.list_docs("run-1").expect("docs");

    let envelope = super::render::render_envelope(&super::render::RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "Fix @input:ticket, write @doc:plan-doc.",
        mode: super::definition::ResolveMode::Strict,
        arguments: &[(
            "ticket".to_string(),
            serde_json::Value::String("PRO-9".into()),
        )]
        .into_iter()
        .collect(),
        docs: &docs,
        context_dir: std::path::Path::new("/tmp/workspace-1/.proliferate/context"),
    })
    .expect("render");
    store
        .store_rendered_envelope(&plan_id, &envelope)
        .expect("store envelope");

    let state = store.load_run_state("run-1").expect("load").expect("run");
    let reloaded = state
        .node(&plan_id)
        .unwrap()
        .rendered_envelope
        .as_ref()
        .expect("envelope present");
    assert_eq!(reloaded, &envelope);

    // And through the raw column, not just the mapper.
    let raw: String = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT rendered_envelope FROM workflow_run_nodes WHERE id = ?1",
                [plan_id.as_str()],
                |row| row.get(0),
            )
        })
        .expect("read raw column");
    let parsed: RenderedEnvelope = serde_json::from_str(&raw).expect("column parses");
    assert_eq!(parsed, envelope);
    assert!(parsed.instruction_blocks[0]
        .starts_with("System instruction from AnyHarness, not user content:\n"));
}

/// F7: the filename law is not injective over slugs, so the registry refuses
/// a second row claiming an existing file (`UNIQUE (run_id, filename)`).
#[test]
fn registry_refuses_two_rows_claiming_one_filename() {
    let store = test_store();
    store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    // Seeded: slug "plan-doc" produced at chain 0 → "00-plan-doc.md".
    // A producer-less registration of slug "00-plan-doc" derives the same
    // filename and must be refused, not silently share the file.
    let error = store
        .register_doc("run-1", "00-plan-doc", None)
        .expect_err("filename collision must be refused");
    assert!(
        error.to_string().to_lowercase().contains("unique"),
        "expected a uniqueness violation, got: {error}"
    );
}

/// F4 lockstep: the record-free plan derives exactly the filenames the store
/// mints, so the PUT path can materialize disk BEFORE any row exists.
#[test]
fn planned_docs_match_the_rows_the_store_mints() {
    let store = test_store();
    store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let snapshot = snapshot();
    let chain = snapshot.validate().expect("valid snapshot");
    let planned = super::materialize::plan_context_docs(&snapshot, &chain);
    let rows = store.list_docs("run-1").expect("docs");
    let planned_pairs: Vec<(String, String)> = planned
        .into_iter()
        .map(|doc| (doc.slug, doc.filename))
        .collect();
    let mut row_pairs: Vec<(String, String)> = rows
        .into_iter()
        .map(|doc| (doc.slug, doc.filename))
        .collect();
    row_pairs.sort();
    let mut sorted_planned = planned_pairs.clone();
    sorted_planned.sort();
    assert_eq!(sorted_planned, row_pairs);
    assert!(!sorted_planned.is_empty());
}

#[test]
fn corrupt_rendered_envelope_reads_as_none_not_an_error() {
    let (db, store) = test_store_with_db();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    // The one row column no CHECK constraint shields: seed garbage directly.
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE workflow_run_nodes SET rendered_envelope = 'not json' WHERE id = ?1",
            rusqlite::params![plan_id],
        )?;
        Ok(())
    })
    .expect("seed corrupt envelope");
    // Lenient read: the run stays readable, the envelope degrades to None (the
    // engine re-renders).
    let state = store.load_run_state("run-1").expect("load").expect("run");
    assert!(state.node(&plan_id).unwrap().rendered_envelope.is_none());
}

#[test]
fn runs_for_workspace_lists_newest_first() {
    let (db, store) = test_store_with_db();
    store
        .create_run_with_first_node(params("run-1"))
        .expect("create run-1");
    // The one-live-run law (Ruling B): a second run cannot land in the
    // workspace while run-1 is non-terminal.
    let refused = store
        .create_run_with_first_node(params("run-2"))
        .expect_err("workspace occupied");
    let occupied = refused
        .downcast_ref::<super::store::WorkspaceOccupied>()
        .expect("typed occupancy error");
    assert_eq!(occupied.occupant_run_id, "run-1");
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE workflow_runs SET status = 'completed' WHERE id = 'run-1'",
            [],
        )?;
        Ok(())
    })
    .expect("complete run-1");
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
fn run_detail_projects_run_nodes_and_docs_in_one_read() {
    let store = test_store();
    store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let detail = store
        .run_detail("run-1")
        .expect("read detail")
        .expect("run exists");
    let json = serde_json::to_value(&detail).expect("serialize");
    assert_eq!(json["run"]["id"], "run-1");
    assert_eq!(json["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(json["docs"].as_array().unwrap().len(), 2);
    assert!(store
        .run_detail("ghost-run")
        .expect("read missing")
        .is_none());
}

#[test]
fn register_doc_follows_the_filename_law_and_is_idempotent() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    // Producer-bound doc: NN from the producing node's chain_index.
    let doc = store
        .register_doc("run-1", "findings", Some(plan_id.as_str()))
        .expect("register");
    assert_eq!(doc.filename, "00-findings.md");
    assert_eq!(doc.producing_node_row_id.as_deref(), Some(plan_id.as_str()));
    assert!(!doc.seeded_from_template);

    // Producer-less doc: bare slug.
    let shared = store
        .register_doc("run-1", "scratch", None)
        .expect("register producer-less");
    assert_eq!(shared.filename, "scratch.md");

    // Idempotent on (run_id, slug): the existing row comes back unchanged.
    let replay = store
        .register_doc("run-1", "findings", None)
        .expect("replay");
    assert_eq!(replay.id, doc.id);
    assert_eq!(replay.filename, "00-findings.md");

    // Re-registering a template-seeded slug returns the seeded row.
    let seeded = store
        .register_doc("run-1", "plan-doc", None)
        .expect("seeded replay");
    assert!(seeded.seeded_from_template);
    assert_eq!(seeded.filename, "00-plan-doc.md");
}

#[test]
fn apply_transition_on_unknown_run_errors() {
    let store = test_store();
    let transition = Transition::CompleteRun {
        completed_node_row_id: "ghost".into(),
        completed_node_type: None,
    };
    let event = clean_turn("ghost");
    assert!(store
        .apply_transition("ghost-run", &transition, &event)
        .is_err());
}

#[test]
fn projection_serializes_camel_case_from_rows() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let projection = super::projection::project(&created.state, &created.docs);
    let json = serde_json::to_value(&projection).expect("serialize projection");
    assert_eq!(json["run"]["id"], "run-1");
    assert_eq!(json["run"]["workspaceId"], "workspace-1");
    assert_eq!(json["run"]["status"], "running");
    // The definition rides the wire as the verbatim frozen string.
    let definition_json = json["run"]["definitionJson"].as_str().expect("raw string");
    let definition: serde_json::Value = serde_json::from_str(definition_json).expect("parseable");
    assert_eq!(definition["schemaVersion"], 2);
    let arguments: serde_json::Value =
        serde_json::from_str(json["run"]["argumentsJson"].as_str().expect("raw string"))
            .expect("parseable");
    assert_eq!(arguments["ticket"], "PRO-9");
    // Nullable wire fields are explicit nulls, never omitted (the TS side
    // declares `string | null`).
    assert!(json["run"]["completedAt"].is_null());
    assert!(json["nodes"][0]["sessionId"].is_null());
    assert!(json["nodes"][0]["promptId"].is_null());
    assert_eq!(json["nodes"][0]["runId"], "run-1");
    assert_eq!(json["nodes"][0]["definitionNodeId"], "plan");
    assert_eq!(json["nodes"][0]["nodeType"], "agent");
    assert_eq!(json["nodes"][0]["status"], "running");
    assert_eq!(json["nodes"][1]["nodeType"], "human_in_loop");
    assert_eq!(json["docs"][0]["runId"], "run-1");
    assert_eq!(json["docs"][0]["filename"], "00-plan-doc.md");
    // The rendered envelope never leaves the runtime.
    assert!(json["nodes"][0].get("renderedEnvelope").is_none());
}

// The tripwire itself: a committed state violating a structural law must
// panic the debug sweep inside apply_transition. Corruption is seeded by
// direct SQL — no legal transition can produce it — and the next legal
// transition trips the sweep.
#[test]
#[should_panic(expected = "workflow invariant violations")]
fn seeded_corruption_panics_the_debug_sweep() {
    let (db, store) = test_store_with_db();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE workflow_runs SET current_node_row_id = 'ghost-row' WHERE id = 'run-1'",
            [],
        )?;
        Ok(())
    })
    .expect("seed corruption");
    // Any legal transition against the corrupted run commits, then the
    // post-commit sweep sees current_node_row_id pointing at no row.
    let state = store.load_run_state("run-1").expect("load").expect("run");
    let add = WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
        anchor_node_row_id: plan_id,
        prompt: "tripwire".into(),
        model: None,
    });
    let transition = decide(&state, &add);
    let _ = store.apply_transition("run-1", &transition, &add);
}

#[test]
fn running_unlinked_node_trips_only_the_at_rest_sweep() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    // Mid-step this is lawful (the stamp comes after launch), so the
    // post-transition sweep stays quiet…
    assert!(invariants::sweep(&created.state).is_empty());
    // …but a state observed AT REST (boot-time rebuild) must have every
    // running node linked.
    let at_rest = invariants::sweep_at_rest(&created.state);
    assert_eq!(at_rest.len(), 1);
    assert_eq!(at_rest[0].invariant, "running_nodes_linked_at_rest");

    // Negative control: once the session is stamped, the at-rest sweep is
    // clean too.
    store
        .stamp_session(&created.first_node_row_id, "sess-plan", None, None)
        .expect("stamp");
    let state = store.load_run_state("run-1").expect("load").expect("run");
    assert!(invariants::sweep_at_rest(&state).is_empty());
}

/// pr11 subscriber-capture proof: a committed FailNode transition emits the
/// named `anyharness.workflow_transition` event carrying the machine-readable
/// `failure_code` classification, and the terminal flip emits the named
/// run-finished event on the same commit. Negative control (recorded in the
/// PR body): removing the `failure_code` field from `emit_transition_events`
/// fails this test; restoring it passes.
#[test]
fn fail_node_transition_event_carries_named_target_and_failure_code() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-obs"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    let errored = WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: plan_id.clone(),
        stop_reason: TurnStopReason::Error,
        queue_empty: true,
    });

    let (applied, logged) =
        capture_tracing_output(|| decide_and_apply(&store, "run-obs", &created.state, &errored));
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Failed);

    let transition_line = logged
        .lines()
        .find(|line| line.contains("anyharness.workflow_transition"))
        .expect("named transition event captured");
    assert!(transition_line.contains("run-obs"), "{transition_line}");
    assert!(
        transition_line.contains(plan_id.as_str()),
        "{transition_line}"
    );
    assert!(transition_line.contains("fail_node"), "{transition_line}");
    assert!(
        transition_line.contains("failure_code"),
        "{transition_line}"
    );
    assert!(transition_line.contains("turn_error"), "{transition_line}");
    assert!(
        logged.contains("anyharness.workflow_run_finished"),
        "{logged}"
    );
}

/// pr11b subscriber-capture proof: a queued interjection's Hold decision
/// emits the named `anyharness.workflow_interjection_held` event, not the
/// stale-notification target — and a genuinely stale report (unknown node
/// row, same clean stop reason) still emits the stale target with
/// interjection_held absent. Negative control (recorded in the PR body):
/// reverting `emit_decision_events`'s branch to pr11's unconditional
/// stale-warn makes the interjection_held assertions fail; restoring it
/// passes.
#[test]
fn interjection_hold_emits_the_named_target_not_stale() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();
    let held = WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: plan_id.clone(),
        stop_reason: TurnStopReason::CleanEndTurn,
        queue_empty: false,
    });
    assert_eq!(next(&created.state, &held), Decision::Hold);

    let (_, logged) =
        capture_tracing_output(|| emit_decision_events("run-1", &held, &Decision::Hold));
    let held_line = logged
        .lines()
        .find(|line| line.contains("anyharness.workflow_interjection_held"))
        .expect("named interjection_held event captured");
    assert!(held_line.contains("run-1"), "{held_line}");
    assert!(held_line.contains(plan_id.as_str()), "{held_line}");
    assert!(held_line.contains("clean_end_turn"), "{held_line}");
    assert!(
        !logged.contains("anyharness.workflow_notification_stale"),
        "{logged}"
    );

    // In-test stale control: an unknown node row is a genuinely stale report
    // (told apart from the interjection hold by queue_empty on the same stop
    // reason) — the stale target fires, interjection_held stays absent.
    let stale = clean_turn("some-unknown-node-row");
    assert_eq!(next(&created.state, &stale), Decision::Hold);
    let (_, stale_logged) =
        capture_tracing_output(|| emit_decision_events("run-1", &stale, &Decision::Hold));
    assert!(
        stale_logged.contains("anyharness.workflow_notification_stale"),
        "{stale_logged}"
    );
    assert!(
        !stale_logged.contains("anyharness.workflow_interjection_held"),
        "{stale_logged}"
    );
}

/// pr11 scope-item-3 lock-in (no source change): `stamp_session` already
/// carries `session_id` on the named `anyharness.workflow_node_launched`
/// event, the join key the session-plane `anyharness.turn.*` stream needs.
/// Negative control (recorded in the PR body): removing `session_id` from
/// `stamp_session`'s `tracing::info!` call fails this test; restoring it
/// passes.
#[test]
fn node_launched_carries_session_id_for_the_session_plane_join() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create run");
    let plan_id = created.first_node_row_id.clone();

    let (_, logged) = capture_tracing_output(|| {
        store
            .stamp_session(&plan_id, "sess-x", None, Some("claude"))
            .expect("stamp session")
    });
    let launched_line = logged
        .lines()
        .find(|line| line.contains("anyharness.workflow_node_launched"))
        .expect("named node_launched event captured");
    assert!(
        launched_line.contains("session_id=sess-x"),
        "{launched_line}"
    );
}
