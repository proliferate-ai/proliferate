//! Envelope rendering tests: reference resolution against rows, the exact
//! house wrapper on instruction blocks (Ruling D), the two preamble variants,
//! strict-vs-lenient resolution (Ruling E), and the negative controls.

use std::path::Path;

use super::definition::{
    resolve_references, PromptReference, ResolveError, ResolveMode,
};
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
        mode: ResolveMode::Strict,
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

/// Ruling D pin: every stored instruction block begins with the EXACT house
/// sentinel, byte for byte. This literal is deliberately spelled out here so
/// any drift in the shared constant trips this test.
#[test]
fn instruction_blocks_carry_the_exact_house_wrapper() {
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "do the work",
        mode: ResolveMode::Strict,
        arguments: &arguments(&[]),
        docs: &[],
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("render");
    assert_eq!(envelope.instruction_blocks.len(), 1);
    assert!(
        envelope.instruction_blocks[0]
            .starts_with("System instruction from AnyHarness, not user content:\nYou are one node"),
        "wrapper must be baked into the stored block, got:\n{}",
        envelope.instruction_blocks[0]
    );
}

#[test]
fn agent_preamble_teaches_conventions_and_the_completion_contract() {
    let docs = vec![doc("plan-doc", "00-plan-doc.md"), doc("notes", "notes.md")];
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "do the work",
        mode: ResolveMode::Strict,
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
    // Ruling D: the preamble never rides system_prompt_append — that channel
    // stays reserved for DSL-authored appends.
    assert!(envelope.system_prompt_append.is_empty());
}

#[test]
fn human_in_loop_preamble_allows_questions_for_the_reviewer() {
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::HumanInLoop,
        prompt: "summarize for review",
        mode: ResolveMode::Strict,
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
fn strict_render_fails_on_unknown_references() {
    let inputs = RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "read @doc:ghost",
        mode: ResolveMode::Strict,
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

/// Ruling C.1: `@doc:plan.md` is a malformed reference (`.md` does not peel,
/// the token fails the slug grammar) — a hard render error in strict mode,
/// never a prefix match to `plan`.
#[test]
fn strict_render_rejects_malformed_references_instead_of_prefix_matching() {
    let docs = vec![doc("plan", "00-plan.md")];
    let result = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "update @doc:plan.md please",
        mode: ResolveMode::Strict,
        arguments: &arguments(&[]),
        docs: &docs,
        context_dir: Path::new("/ws/.proliferate/context"),
    });
    match result {
        Err(RenderEnvelopeError::Malformed(detail)) => {
            assert!(detail.contains("@doc:plan.md"), "got: {detail}");
        }
        other => panic!("expected Malformed, got {other:?}"),
    }
}

/// Ruling C.1: trailing prose punctuation peels, so a reference can end a
/// sentence; non-reference `@`s and bare sigils stay literal text.
#[test]
fn resolution_peels_sentence_punctuation_and_ignores_non_references() {
    let docs = vec![doc("plan", "00-plan.md")];
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "email a@b.com about @doc:plan. Then bare @ and @input: nothing",
        mode: ResolveMode::Strict,
        arguments: &arguments(&[]),
        docs: &docs,
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("render");
    assert_eq!(
        envelope.first_message,
        "email a@b.com about /ws/.proliferate/context/00-plan.md. Then bare @ and @input: nothing"
    );
}

/// Ruling E: redo-edited and ad hoc prompts render lenient — anything the
/// resolver cannot rewrite (unknown doc, unknown input, malformed token,
/// wrong-case sigil) passes through as the literal text the user typed.
/// Never a launch refusal on a legal user action.
#[test]
fn lenient_render_passes_unresolvable_references_through_verbatim() {
    let docs = vec![doc("plan", "00-plan.md")];
    let envelope = render_envelope(&RenderInputs {
        node_type: WorkflowNodeType::Agent,
        prompt: "see @doc:plan and @doc:handoff-notes then @input:owner @doc:plan.md @INPUT:x",
        mode: ResolveMode::Lenient,
        arguments: &arguments(&[]),
        docs: &docs,
        context_dir: Path::new("/ws/.proliferate/context"),
    })
    .expect("lenient render never fails");
    assert_eq!(
        envelope.first_message,
        "see /ws/.proliferate/context/00-plan.md and @doc:handoff-notes then @input:owner @doc:plan.md @INPUT:x"
    );
}

#[test]
fn resolve_references_round_trips_text_without_references() {
    let text = "no references here, not even one @ that parses";
    let resolved =
        resolve_references(text, ResolveMode::Strict, |_| None).expect("nothing to resolve");
    assert_eq!(resolved, text);
}

#[test]
fn resolve_references_reports_the_offending_reference() {
    let error = resolve_references("@input:a @doc:b", ResolveMode::Strict, |reference| {
        match reference {
            PromptReference::Input(name) => Some(format!("[{name}]")),
            PromptReference::Doc(_) => None,
        }
    })
    .expect_err("doc must fail");
    assert_eq!(
        error,
        ResolveError::Unresolved(PromptReference::Doc("b".into()))
    );
}

/// Lockstep proof: the resolver consumes the same scan as the validator, so
/// a wrong-case sigil is a strict error here exactly as it is in validate().
#[test]
fn strict_resolve_errors_on_wrong_case_sigils() {
    let error = resolve_references("use @INPUT:ticket", ResolveMode::Strict, |_| {
        Some("resolved".into())
    })
    .expect_err("wrong-case sigil must fail strict resolution");
    match error {
        ResolveError::Malformed(error) => {
            assert!(error.detail.contains("lowercase"), "got: {}", error.detail);
        }
        other => panic!("expected Malformed, got {other:?}"),
    }
}
