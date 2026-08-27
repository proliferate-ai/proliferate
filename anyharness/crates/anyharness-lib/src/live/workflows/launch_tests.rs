//! Tests for how a node's session is started: the launch config precedence
//! `launch_model` resolves, and the name the launch gives that session.
//!
//! Split from `actor.rs` (which sits at its line ratchet) along the launch
//! seam, and from `lifecycle_tests.rs` because these are the launch's own
//! proofs rather than another pass over the run lifecycle. The end-to-end
//! test reuses that suite's scripted-agent fixture — real actor, real
//! sessions, no mocks of our machinery.

use super::actor::{launch_model, DEFAULT_WORKFLOW_AGENT_KIND};
use super::lifecycle_tests::{agent_node, chain, fixture, node_by_def};
use crate::domains::workflows::definition::{
    DefinitionNode, NodeModel, WorkflowDefinition, DEFINITION_SCHEMA_VERSION,
};
use crate::domains::workflows::model::{
    WorkflowNodeKind, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunNodeRecord,
    WorkflowRunStatus,
};

fn node(model: Option<NodeModel>, definition_node_id: Option<&str>) -> WorkflowRunNodeRecord {
    WorkflowRunNodeRecord {
        id: "row-1".into(),
        run_id: "run-1".into(),
        definition_node_id: definition_node_id.map(str::to_string),
        kind: if model.is_some() {
            WorkflowNodeKind::Adhoc
        } else {
            WorkflowNodeKind::Defined
        },
        node_type: WorkflowNodeType::Agent,
        replaces_node_row_id: None,
        anchor_node_row_id: None,
        chain_index: Some(0),
        title: "t".into(),
        prompt: "p".into(),
        status: WorkflowNodeStatus::Running,
        session_id: None,
        prompt_id: None,
        model,
        rendered_envelope: None,
        failure_code: None,
        first_turn_finished_at: None,
        created_at: "now".into(),
        started_at: None,
        completed_at: None,
    }
}

fn definition_with_model(model: Option<NodeModel>) -> WorkflowDefinition {
    WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![DefinitionNode {
            id: "plan".into(),
            node_type: WorkflowNodeType::Agent,
            title: "Plan".into(),
            prompt: "plan".into(),
            model,
        }],
        edges: Vec::new(),
        inputs: Vec::new(),
        doc_templates: Vec::new(),
    }
}

#[test]
fn the_node_rows_own_pick_beats_the_definition() {
    let definition = definition_with_model(Some(NodeModel {
        agent_kind: "codex".into(),
        model_id: Some("definition-model".into()),
        control_values: Default::default(),
    }));
    let node = node(
        Some(NodeModel {
            agent_kind: "claude".into(),
            model_id: Some("row-model".into()),
            control_values: [("mode".to_string(), "row-mode".to_string())].into(),
        }),
        Some("plan"),
    );
    assert_eq!(
        launch_model(&node, &definition),
        (
            "claude".to_string(),
            Some("row-model".to_string()),
            [("mode".to_string(), "row-mode".to_string())].into()
        )
    );
}

#[test]
fn a_defined_row_resolves_through_the_frozen_definition() {
    let definition = definition_with_model(Some(NodeModel {
        agent_kind: "codex".into(),
        model_id: None,
        control_values: Default::default(),
    }));
    assert_eq!(
        launch_model(&node(None, Some("plan")), &definition),
        ("codex".to_string(), None, Default::default())
    );
}

#[test]
fn no_pick_anywhere_falls_back_to_the_app_default() {
    assert_eq!(
        launch_model(&node(None, None), &definition_with_model(None)),
        (
            DEFAULT_WORKFLOW_AGENT_KIND.to_string(),
            None,
            Default::default()
        )
    );
    assert_eq!(
        launch_model(&node(None, Some("plan")), &definition_with_model(None)),
        (
            DEFAULT_WORKFLOW_AGENT_KIND.to_string(),
            None,
            Default::default()
        )
    );
}

/// End to end, through the real actor: every node names its own session with
/// the chain mark its card wears, so a workspace holding a run's sessions
/// tells them apart by the step each one is running.
///
/// The name is written before the stamp that first makes the session findable
/// from the projection, and it survives the turn: the harness's own title
/// (which echoes the first message — preamble and all) and the prompt-derived
/// fallback are both if-absent writers.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_node_names_its_session_with_the_chain_mark() {
    let fixture = fixture("wf-node-title").await;
    fixture.start(
        "run-title",
        chain(vec![
            agent_node("draft", "Draft it"),
            agent_node("answer", "Answer it"),
        ]),
    );

    let state = fixture
        .wait_for("run-title", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;

    let session_store = fixture.state.session_service.store();
    let title_of = |node_id: &str| {
        let session_id = node_by_def(&state, node_id)
            .session_id
            .clone()
            .expect("node session");
        session_store
            .find_by_id(&session_id)
            .expect("session row")
            .expect("session exists")
            .title
    };
    assert_eq!(title_of("draft").as_deref(), Some("01 Node draft"));
    assert_eq!(title_of("answer").as_deref(), Some("02 Node answer"));
}
