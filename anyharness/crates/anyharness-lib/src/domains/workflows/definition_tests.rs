//! DSL v2 validation tests: linearity, uniqueness, reference resolution, and
//! invocation-snapshot revalidation, with a negative control per rule.

use super::definition::{
    parse_references, DefinitionEdge, DefinitionInput, DefinitionNode, DocTemplate,
    InvocationPlacement, InvocationSnapshot, PlacementMode, PromptReference, WorkflowDefinition,
    DEFINITION_SCHEMA_VERSION,
};
use super::model::WorkflowNodeType;

fn node(id: &str, prompt: &str) -> DefinitionNode {
    DefinitionNode {
        id: id.into(),
        node_type: WorkflowNodeType::Agent,
        title: format!("Node {id}"),
        prompt: prompt.into(),
        model: None,
    }
}

fn edge(from: &str, to: &str) -> DefinitionEdge {
    DefinitionEdge {
        from: from.into(),
        to: to.into(),
    }
}

fn three_node_definition() -> WorkflowDefinition {
    WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![node("plan", "plan it"), node("build", "build it"), node("ship", "ship it")],
        edges: vec![edge("plan", "build"), edge("build", "ship")],
        inputs: vec![],
        doc_templates: vec![],
    }
}

#[test]
fn valid_definition_returns_chain_order() {
    let mut definition = three_node_definition();
    // Declaration order is not chain order; edges are.
    definition.nodes.reverse();
    assert_eq!(
        definition.validate().unwrap(),
        vec!["plan".to_string(), "build".into(), "ship".into()]
    );
}

#[test]
fn single_node_definition_is_valid() {
    let definition = WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![node("solo", "do everything")],
        edges: vec![],
        inputs: vec![],
        doc_templates: vec![],
    };
    assert_eq!(definition.validate().unwrap(), vec!["solo".to_string()]);
}

#[test]
fn wrong_schema_version_is_rejected() {
    let mut definition = three_node_definition();
    definition.schema_version = 1;
    assert!(definition.validate().is_err());
}

#[test]
fn duplicate_node_ids_are_rejected() {
    let mut definition = three_node_definition();
    definition.nodes[2].id = "plan".into();
    definition.edges = vec![edge("plan", "build")];
    assert!(definition.validate().is_err());
}

#[test]
fn branching_edges_are_rejected() {
    let mut definition = three_node_definition();
    definition.edges = vec![edge("plan", "build"), edge("plan", "ship")];
    assert!(definition.validate().is_err());
}

#[test]
fn merging_edges_are_rejected() {
    let mut definition = three_node_definition();
    definition.edges = vec![edge("plan", "ship"), edge("build", "ship")];
    assert!(definition.validate().is_err());
}

#[test]
fn detached_cycle_beside_the_chain_is_rejected() {
    // Four nodes, three edges — the count and uniqueness checks pass, but the
    // walk from the single head covers only plan→build: ship and extra sit in
    // a detached two-node cycle.
    let mut definition = three_node_definition();
    definition.nodes.push(node("extra", "cycles"));
    definition.edges = vec![edge("plan", "build"), edge("ship", "extra"), edge("extra", "ship")];
    assert!(definition.validate().is_err());
}

#[test]
fn island_node_without_edges_is_rejected() {
    let mut definition = three_node_definition();
    definition.nodes.push(node("island", "unreachable"));
    assert!(definition.validate().is_err());
}

#[test]
fn edge_to_unknown_node_is_rejected() {
    let mut definition = three_node_definition();
    definition.edges[1] = edge("build", "ghost");
    assert!(definition.validate().is_err());
}

#[test]
fn undeclared_input_reference_is_rejected() {
    let mut definition = three_node_definition();
    definition.nodes[0].prompt = "plan the work for @input:ticket".into();
    assert!(definition.validate().is_err());
    definition.inputs.push(DefinitionInput {
        name: "ticket".into(),
        description: None,
        required: true,
    });
    assert!(definition.validate().is_ok());
}

#[test]
fn unknown_doc_reference_is_rejected() {
    let mut definition = three_node_definition();
    definition.nodes[1].prompt = "build per @doc:plan-doc".into();
    assert!(definition.validate().is_err());
    definition.doc_templates.push(DocTemplate {
        slug: "plan-doc".into(),
        producing_node_id: Some("plan".into()),
        body: "# Plan\n".into(),
    });
    assert!(definition.validate().is_ok());
}

#[test]
fn duplicate_doc_slugs_are_rejected() {
    let mut definition = three_node_definition();
    for _ in 0..2 {
        definition.doc_templates.push(DocTemplate {
            slug: "notes".into(),
            producing_node_id: None,
            body: String::new(),
        });
    }
    assert!(definition.validate().is_err());
}

#[test]
fn doc_template_with_unknown_producer_is_rejected() {
    let mut definition = three_node_definition();
    definition.doc_templates.push(DocTemplate {
        slug: "notes".into(),
        producing_node_id: Some("ghost".into()),
        body: String::new(),
    });
    assert!(definition.validate().is_err());
}

#[test]
fn parse_references_finds_inputs_and_docs() {
    let references = parse_references(
        "Read @doc:plan-doc and @doc:api_notes, then apply @input:ticket. \
         Ignore emails like a@b.com and bare @ signs, and @input: without a name.",
    );
    assert_eq!(
        references,
        vec![
            PromptReference::Doc("plan-doc".into()),
            PromptReference::Doc("api_notes".into()),
            PromptReference::Input("ticket".into()),
        ]
    );
}

#[test]
fn parse_references_stops_at_non_slug_characters() {
    assert_eq!(
        parse_references("see @doc:plan.md"),
        vec![PromptReference::Doc("plan".into())]
    );
}

fn snapshot(definition: WorkflowDefinition) -> InvocationSnapshot {
    InvocationSnapshot {
        schema_version: DEFINITION_SCHEMA_VERSION,
        workflow_definition_id: "wd-1".into(),
        definition,
        arguments: serde_json::Map::new(),
        placement: InvocationPlacement {
            repo_config_id: "rc-1".into(),
            mode: PlacementMode::Worktree,
        },
    }
}

#[test]
fn snapshot_requires_arguments_for_required_inputs() {
    let mut definition = three_node_definition();
    definition.inputs.push(DefinitionInput {
        name: "ticket".into(),
        description: None,
        required: true,
    });
    let mut snapshot = snapshot(definition);
    assert!(snapshot.validate().is_err());
    snapshot
        .arguments
        .insert("ticket".into(), serde_json::Value::String("PRO-1".into()));
    assert!(snapshot.validate().is_ok());
}

#[test]
fn snapshot_rejects_undeclared_arguments() {
    let mut snapshot = snapshot(three_node_definition());
    snapshot
        .arguments
        .insert("surprise".into(), serde_json::Value::Bool(true));
    assert!(snapshot.validate().is_err());
}

#[test]
fn optional_inputs_need_no_argument() {
    let mut definition = three_node_definition();
    definition.inputs.push(DefinitionInput {
        name: "context".into(),
        description: Some("extra context".into()),
        required: false,
    });
    assert!(snapshot(definition).validate().is_ok());
}

#[test]
fn definition_json_round_trips_the_wire_shape() {
    let json = serde_json::json!({
        "schemaVersion": 2,
        "nodes": [
            {"id": "plan", "type": "agent", "title": "Plan", "prompt": "plan @input:ticket"},
            {"id": "gate", "type": "human_in_loop", "title": "Review", "prompt": "review",
             "model": {"agentKind": "claude", "modelId": "claude-sonnet-5"}}
        ],
        "edges": [{"from": "plan", "to": "gate"}],
        "inputs": [{"name": "ticket", "required": true}],
        "docTemplates": [{"slug": "plan-doc", "producingNodeId": "plan", "body": "# Plan"}]
    });
    let definition: WorkflowDefinition = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(definition.nodes[1].node_type, WorkflowNodeType::HumanInLoop);
    assert_eq!(
        definition.nodes[1].model.as_ref().unwrap().agent_kind,
        "claude"
    );
    assert_eq!(definition.validate().unwrap(), vec!["plan".to_string(), "gate".into()]);
    // Unknown fields are rejected: the two planes stay in lockstep.
    let mut with_unknown = json;
    with_unknown["surprise"] = serde_json::Value::Bool(true);
    assert!(serde_json::from_value::<WorkflowDefinition>(with_unknown).is_err());
}
