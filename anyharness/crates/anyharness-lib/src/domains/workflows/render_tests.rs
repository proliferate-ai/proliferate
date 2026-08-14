//! Envelope rendering tests: reference resolution against rows, the two
//! preamble variants, and the negative controls (unknown references fail the
//! render rather than leaking `@doc:`/`@input:` literals to the model).

use std::path::Path;

use super::definition::{resolve_references, PromptReference};
use super::model::{WorkflowNodeType, WorkflowRunDocRecord};
use super::render::{render_envelope, RenderEnvelopeError, RenderInputs};

const T0: &str = "2026-08-14T00:00:00+00:00";

fn doc(slug: &str, filename: &str) -> WorkflowRunDocRecord {
    WorkflowRunDocRecord {
        id: format!("doc-{slug}"),
        run_id: "run-1".into(),
        slug: slug.into(),
        filename: filename.into(),
        producing_node_row_id: None,
        seeded_from_template: true,
        created_at: T0.into(),
        updated_at: T0.into(),
    }
}

fn arguments(pairs: &[(&str, serde_json::Value)]) -> serde_json::Map<String, serde_json::Value> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.clone()))
        .collect()
}

#[test]
fn renders_inputs_and_doc_paths_into_the_first_message() {
    let docs = vec![doc("plan-doc", "00-plan-doc.md")];
    let args = arguments(&[
        ("ticket", serde_json::Value::String("PRO-9".into())),
        ("retries", serde_json::json!(3)),
    ]);
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "Fix @input:ticket with @input:retries retries, then update @doc:plan-doc.",
        arguments: &args,
        docs: &docs,
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("render");
    assert_eq!(
        envelope.first_message,
        "Fix PRO-9 with 3 retries, then update /ws/.proliferate/context/00-plan-doc.md."
    );
}

#[test]
fn agent_preamble_teaches_conventions_and_the_completion_contract() {
    let docs = vec![doc("plan-doc", "00-plan-doc.md"), doc("notes", "notes.md")];
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "do the work",
        arguments: &arguments(&[]),
        docs: &docs,
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("render");
    assert_eq!(envelope.instruction_blocks.len(), 1);
    let preamble = &envelope.instruction_blocks[0];
    assert!(preamble.contains("/ws/.proliferate/context"));
    assert!(preamble.contains("NN-slug.md"));
    assert!(preamble.contains("/ws/.proliferate/context/00-plan-doc.md"));
    assert!(preamble.contains("/ws/.proliferate/context/notes.md"));
    assert!(preamble.contains("never stop to ask questions"));
    assert!(preamble.contains("do not proceed into later steps' work"));
    // The append channel mirrors the preamble; correctness never rides on it.
    assert_eq!(envelope.system_prompt_append, envelope.instruction_blocks);
}

#[test]
fn human_in_loop_preamble_allows_questions_for_the_reviewer() {
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::HumanInLoop,
        prompt: "summarize for review",
        arguments: &arguments(&[]),
        docs: &[],
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("render");
    let preamble = &envelope.instruction_blocks[0];
    assert!(preamble.contains("A human reviews your work"));
    assert!(preamble.contains("partial work is fine"));
    assert!(!preamble.contains("never stop to ask questions"));
}

#[test]
fn unknown_references_fail_the_render() {
    let inputs = RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "read @doc:ghost",
        arguments: &arguments(&[]),
        docs: &[],
        context_dir: Path::new("/ws/.proliferate/context"),
    };
    assert_eq!(
        render_envelope(&inputs),
        Err(RenderEnvelopeError::UnknownDoc("ghost".into()))
    );
    let inputs = RenderInputs {
        prompt: "use @input:ghost",
        ..inputs
    };
    assert_eq!(
        render_envelope(&inputs),
        Err(RenderEnvelopeError::UnknownInput("ghost".into()))
    );
}

#[test]
fn resolution_ignores_non_reference_at_signs_and_stops_at_non_slug_chars() {
    let docs = vec![doc("plan", "00-plan.md")];
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "email a@b.com about @doc:plan.md and bare @ and @input: nothing",
        arguments: &arguments(&[]),
        docs: &docs,
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("render");
    assert_eq!(
        envelope.first_message,
        "email a@b.com about /ws/.proliferate/context/00-plan.md.md and bare @ and @input: nothing"
    );
}

#[test]
fn resolve_references_round_trips_text_without_references() {
    let text = "no references here, not even one @ that parses";
    let resolved = resolve_references(text, |_| None).expect("nothing to resolve");
    assert_eq!(resolved, text);
}

#[test]
fn resolve_references_reports_the_offending_reference() {
    let error = resolve_references("@input:a @doc:b", |reference| match reference {
        PromptReference::Input(name) => Some(format!("[{name}]")),
        PromptReference::Doc(_) => None,
    })
    .expect_err("doc must fail");
    assert_eq!(error, PromptReference::Doc("b".into()));
}
