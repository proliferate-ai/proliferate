//! DSL v2 validation tests: linearity, uniqueness, reference resolution, and
//! invocation-snapshot revalidation, with a negative control per rule.

use super::definition::{
    parse_references, DefinitionEdge, DefinitionInput, DefinitionLeg, DefinitionNode, DocTemplate,
    InvocationPlacement, InvocationSnapshot, PlacementMode, PromptReference, WorkflowDefinition,
    DEFINITION_SCHEMA_VERSION, MAX_NODE_LEGS,
};
use super::model::WorkflowNodeType;

fn node(id: &str, prompt: &str) -> DefinitionNode {
    DefinitionNode {
        id: id.into(),
        node_type: WorkflowNodeType::Agent,
        title: format!("Node {id}"),
        prompt: prompt.into(),
        model: None,
        legs: None,
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
        nodes: vec![
            node("plan", "plan it"),
            node("build", "build it"),
            node("ship", "ship it"),
        ],
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
    definition.edges = vec![
        edge("plan", "build"),
        edge("ship", "extra"),
        edge("extra", "ship"),
    ];
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
        producing_node_id: "plan".into(),
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
            producing_node_id: "plan".into(),
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
        producing_node_id: "ghost".into(),
        body: String::new(),
    });
    assert!(definition.validate().is_err());
}

#[test]
fn invalid_doc_slug_is_rejected() {
    for bad in ["Plan-Doc", "api_notes", "-plan", "plan-", "plan--doc", ""] {
        let mut definition = three_node_definition();
        definition.doc_templates.push(DocTemplate {
            slug: bad.into(),
            producing_node_id: "plan".into(),
            body: String::new(),
        });
        assert!(
            definition.validate().is_err(),
            "doc slug '{bad}' must be rejected"
        );
    }
    // Negative control: the same shape with a lawful slug passes.
    let mut definition = three_node_definition();
    definition.doc_templates.push(DocTemplate {
        slug: "plan-doc-2".into(),
        producing_node_id: "plan".into(),
        body: String::new(),
    });
    assert!(definition.validate().is_ok());
}

#[test]
fn invalid_input_name_is_rejected() {
    for bad in ["9ticket", "tick-et", "_ticket", ""] {
        let mut definition = three_node_definition();
        definition.inputs.push(DefinitionInput {
            name: bad.into(),
            description: None,
            required: false,
        });
        assert!(
            definition.validate().is_err(),
            "input name '{bad}' must be rejected"
        );
    }
    // Negative control: underscores after the leading letter are lawful.
    let mut definition = three_node_definition();
    definition.inputs.push(DefinitionInput {
        name: "api_notes".into(),
        description: None,
        required: false,
    });
    assert!(definition.validate().is_ok());
}

#[test]
fn invalid_node_id_is_rejected() {
    for bad in ["9plan", "-plan", "plan doc", ""] {
        let mut definition = three_node_definition();
        definition.nodes[0].id = bad.into();
        definition.edges[0] = edge(bad, "build");
        assert!(
            definition.validate().is_err(),
            "node id '{bad}' must be rejected"
        );
    }
}

#[test]
fn parse_references_finds_inputs_and_docs() {
    let references = parse_references(
        "Read @doc:plan-doc and @doc:api-notes, then apply @input:ticket. \
         Ignore emails like a@b.com and bare @ signs, and @input: without a name.",
    )
    .expect("lawful references");
    assert_eq!(
        references,
        vec![
            PromptReference::Doc("plan-doc".into()),
            PromptReference::Doc("api-notes".into()),
            PromptReference::Input("ticket".into()),
        ]
    );
}

// Ruling C.1: a captured token that fails its grammar is a hard error, never
// a silent prefix match — `@doc:plan.md` must NOT resolve to `plan`.
#[test]
fn parse_references_rejects_prefix_matchable_tokens() {
    let error = parse_references("see @doc:plan.md").expect_err("md suffix must not prefix-match");
    assert!(
        error.detail.contains("malformed reference @doc:plan.md"),
        "unexpected detail: {}",
        error.detail
    );
}

// Ruling C.1: trailing prose punctuation peels off before grammar validation,
// so sentences can end directly after a reference.
#[test]
fn parse_references_peels_trailing_prose_punctuation() {
    assert_eq!(
        parse_references("read @doc:research-findings. Then (see @input:ticket).").unwrap(),
        vec![
            PromptReference::Doc("research-findings".into()),
            PromptReference::Input("ticket".into()),
        ]
    );
}

// Ruling C.1: sigil detection is case-insensitive so a wrong-case sigil is a
// loud validation error, never silent literal text.
#[test]
fn parse_references_rejects_wrong_case_sigils() {
    let error = parse_references("apply @INPUT:ticket").expect_err("wrong-case sigil");
    assert!(
        error.detail.contains("reference sigils are lowercase"),
        "unexpected detail: {}",
        error.detail
    );
    assert!(parse_references("read @Doc:plan-doc").is_err());
}

// Ruling C.1: the token capture stops at `@`, so back-to-back references both
// resolve.
#[test]
fn parse_references_handles_back_to_back_references() {
    assert_eq!(
        parse_references("@doc:a@doc:b").unwrap(),
        vec![
            PromptReference::Doc("a".into()),
            PromptReference::Doc("b".into()),
        ]
    );
}

// The scan errors surface through definition validation with the node named.
#[test]
fn malformed_reference_fails_definition_validation() {
    let mut definition = three_node_definition();
    definition.doc_templates.push(DocTemplate {
        slug: "plan-doc".into(),
        producing_node_id: "plan".into(),
        body: String::new(),
    });
    definition.nodes[1].prompt = "build per @doc:plan.md".into();
    let error = definition.validate().expect_err("malformed reference");
    assert!(
        error.detail.contains("node 'build'"),
        "unexpected detail: {}",
        error.detail
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
            workspace_id: None,
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
    assert_eq!(
        definition.validate().unwrap(),
        vec!["plan".to_string(), "gate".into()]
    );
    // Unknown fields are rejected: the two planes stay in lockstep.
    let mut with_unknown = json;
    with_unknown["surprise"] = serde_json::Value::Bool(true);
    assert!(serde_json::from_value::<WorkflowDefinition>(with_unknown).is_err());
}

/// F-A1: workspaceId travels iff the mode adopts one — required under
/// existing_workspace, rejected under every other mode.
#[test]
fn snapshot_pins_the_workspace_id_to_the_existing_workspace_mode() {
    let mut valid = snapshot(three_node_definition());
    valid.placement.mode = PlacementMode::ExistingWorkspace;
    valid.placement.workspace_id = Some("ws-1".into());
    valid.validate().expect("existing_workspace with a workspaceId is valid");

    let mut missing = snapshot(three_node_definition());
    missing.placement.mode = PlacementMode::ExistingWorkspace;
    let error = missing.validate().expect_err("workspaceId is required");
    assert!(error.detail.contains("requires a workspaceId"), "{}", error.detail);

    let mut empty = snapshot(three_node_definition());
    empty.placement.mode = PlacementMode::ExistingWorkspace;
    empty.placement.workspace_id = Some(String::new());
    empty.validate().expect_err("an empty workspaceId is missing");

    for mode in [PlacementMode::Worktree, PlacementMode::RepoRoot] {
        let mut stray = snapshot(three_node_definition());
        stray.placement.mode = mode;
        stray.placement.workspace_id = Some("ws-1".into());
        let error = stray.validate().expect_err("stray workspaceId is malformed");
        assert!(
            error.detail.contains("only valid with mode existing_workspace"),
            "{}",
            error.detail
        );
    }
}

// --- Ruling F5: parallel-node leg prompts ---

/// A single Agent node carrying `prompts` as its leg list; `prompt` (leg 0)
/// mirrors `prompts[0]` so the representative invariant holds by construction.
fn legged(prompts: &[&str]) -> WorkflowDefinition {
    WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![DefinitionNode {
            id: "panel".into(),
            node_type: WorkflowNodeType::Agent,
            title: "Panel".into(),
            prompt: prompts[0].into(),
            model: None,
            legs: Some(prompts.iter().map(|p| DefinitionLeg { prompt: (*p).into() }).collect()),
        }],
        edges: vec![],
        inputs: vec![],
        doc_templates: vec![],
    }
}

#[test]
fn a_valid_two_leg_node_passes_and_exposes_both_prompts() {
    let definition = legged(&["correctness review", "security review"]);
    assert_eq!(definition.validate().unwrap(), vec!["panel".to_string()]);
    assert_eq!(
        definition.nodes[0].leg_prompts(),
        vec!["correctness review", "security review"]
    );
}

#[test]
fn legs_cap_at_max_node_legs() {
    let prompts: Vec<String> = (0..MAX_NODE_LEGS).map(|i| format!("leg {i}")).collect();
    let refs: Vec<&str> = prompts.iter().map(String::as_str).collect();
    assert!(legged(&refs).validate().is_ok(), "8 legs is the cap and valid");

    let too_many: Vec<String> = (0..MAX_NODE_LEGS + 1).map(|i| format!("leg {i}")).collect();
    let refs: Vec<&str> = too_many.iter().map(String::as_str).collect();
    assert!(legged(&refs).validate().is_err(), "9 legs exceeds the cap");
}

#[test]
fn a_single_leg_list_is_rejected() {
    // A one-leg node is expressed the old way (no `legs`); a length-1 list is
    // a validation error, not today's behavior.
    assert!(legged(&["only one"]).validate().is_err());
}

#[test]
fn an_empty_leg_list_is_rejected() {
    let mut definition = legged(&["a", "b"]);
    definition.nodes[0].legs = Some(vec![]);
    assert!(definition.validate().is_err());
}

#[test]
fn a_blank_leg_prompt_is_rejected() {
    let mut definition = legged(&["real prompt", "   "]);
    let error = definition.validate().unwrap_err();
    assert!(error.detail.contains("leg 1"), "{}", error.detail);
    // And leg 0 blank when it equals a blank node prompt:
    definition.nodes[0].prompt = "   ".into();
    definition.nodes[0].legs = Some(vec![
        DefinitionLeg { prompt: "   ".into() },
        DefinitionLeg { prompt: "real".into() },
    ]);
    assert!(definition.validate().is_err());
}

#[test]
fn node_prompt_must_equal_leg_zero() {
    let mut definition = legged(&["representative", "sibling"]);
    definition.nodes[0].prompt = "drifted from leg 0".into();
    let error = definition.validate().unwrap_err();
    assert!(error.detail.contains("legs[0]"), "{}", error.detail);
}

#[test]
fn a_reference_error_inside_a_leg_names_the_leg() {
    // Leg 1 references an undeclared input; the error must carry the leg index
    // (the prompt-to-leg cardinal sin surfaces at authoring, per F5).
    let mut definition = legged(&["fine", "look at @input:missing"]);
    definition.inputs = vec![];
    let error = definition.validate().unwrap_err();
    assert!(error.detail.contains("leg 1"), "{}", error.detail);
    assert!(error.detail.contains("missing"), "{}", error.detail);
}

#[test]
fn a_valid_leg_reference_resolves_against_declared_inputs_and_docs() {
    let mut definition = legged(&["plan @input:ticket", "review @doc:plan-doc"]);
    definition.inputs = vec![DefinitionInput {
        name: "ticket".into(),
        description: None,
        required: false,
    }];
    definition.doc_templates = vec![DocTemplate {
        slug: "plan-doc".into(),
        producing_node_id: "panel".into(),
        body: String::new(),
    }];
    assert!(definition.validate().is_ok());
}

#[test]
fn an_unknown_field_inside_a_leg_is_rejected() {
    // deny_unknown_fields on DefinitionLeg: a stray key fails deserialization.
    let json = r#"{"prompt":"do it","weight":3}"#;
    assert!(serde_json::from_str::<DefinitionLeg>(json).is_err());
}
