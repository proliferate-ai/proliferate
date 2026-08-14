//! Envelope rendering: the one path that turns a node's prompt into the
//! stored, re-creatable prompt unit `{instruction_blocks, first_message,
//! system_prompt_append}`. Fail-and-redo, resume, and ad hoc re-running all
//! reuse this function, so what the model was told is always reconstructable
//! from the row.
//!
//! Delivery contract (the RULED wrapped-prompt channel): `instruction_blocks`
//! are raw instruction strings. The live engine sends them as hidden
//! system-instruction blocks prepended to the first message, where the
//! sessions prompt renderer applies the house wrapper ("System instruction
//! from AnyHarness, not user content:") — the merged-subagents pattern.
//! `system_prompt_append` is set additively where harnesses honor it;
//! correctness never rides on it.

use std::path::Path;

use super::definition::{resolve_references, PromptReference};
use super::model::{RenderedEnvelope, WorkflowNodeType, WorkflowRunDocRecord};

/// Workspace-relative home of a run's context docs.
pub const CONTEXT_DIR_RELATIVE: &str = ".proliferate/context";

#[derive(Debug, Clone)]
pub struct RenderInputs<'a> {
    pub node_type: WorkflowNodeType,
    /// The node's prompt text (definition prompt, edited redo prompt, or the
    /// ad hoc user prompt).
    pub prompt: &'a str,
    /// The frozen invocation arguments.
    pub arguments: &'a serde_json::Map<String, serde_json::Value>,
    /// The run's doc registry rows — resolution reads rows, never the
    /// definition, so run-local registrations stay authoritative.
    pub docs: &'a [WorkflowRunDocRecord],
    /// Absolute path of the run workspace's context dir
    /// (`<workspace>/.proliferate/context`).
    pub context_dir: &'a Path,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RenderEnvelopeError {
    #[error("prompt references undeclared input @input:{0}")]
    UnknownInput(String),
    #[error("prompt references unknown doc @doc:{0}")]
    UnknownDoc(String),
}

/// Render one node's envelope. Pure: no IO, no clock.
pub fn render_envelope(inputs: &RenderInputs<'_>) -> Result<RenderedEnvelope, RenderEnvelopeError> {
    let first_message = resolve_references(inputs.prompt, |reference| match reference {
        PromptReference::Input(name) => inputs.arguments.get(name).map(argument_text),
        PromptReference::Doc(slug) => inputs
            .docs
            .iter()
            .find(|doc| &doc.slug == slug)
            .map(|doc| inputs.context_dir.join(&doc.filename).display().to_string()),
    })
    .map_err(|reference| match reference {
        PromptReference::Input(name) => RenderEnvelopeError::UnknownInput(name),
        PromptReference::Doc(slug) => RenderEnvelopeError::UnknownDoc(slug),
    })?;

    let preamble = preamble(inputs.node_type, inputs.context_dir, inputs.docs);
    Ok(RenderedEnvelope {
        instruction_blocks: vec![preamble.clone()],
        first_message,
        system_prompt_append: vec![preamble],
    })
}

/// Interpolated argument text: strings verbatim, everything else compact JSON.
fn argument_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// The fixed context-doc preamble, varied only by node type (advance
/// semantics differ). Logged per node via the stored envelope; keep changes
/// deliberate — this text is what every workflow agent is told.
fn preamble(node_type: WorkflowNodeType, context_dir: &Path, docs: &[WorkflowRunDocRecord]) -> String {
    let mut text = String::new();
    text.push_str(
        "You are one node in a multi-step workflow. Shared context documents for this \
         run live in one flat folder:\n",
    );
    text.push_str(&format!("  {}\n", context_dir.display()));
    text.push_str(
        "Files are named NN-slug.md, where NN is the position of the workflow step that \
         produces the document. Read them freely for context and write to the ones your \
         step produces. Keep documents legible plain markdown: someone who has never seen \
         this workflow should understand what happened from the documents alone. Prefer \
         evidence over prose. Do not add frontmatter or machine metadata.\n",
    );
    if !docs.is_empty() {
        text.push_str("This run's documents:\n");
        for doc in docs {
            text.push_str(&format!("  - {}\n", context_dir.join(&doc.filename).display()));
        }
    }
    match node_type {
        WorkflowNodeType::Agent => text.push_str(
            "Your step completes when this turn ends. Finish the job in this turn; never \
             stop to ask questions. Do only this step's work — do not proceed into later \
             steps' work.",
        ),
        WorkflowNodeType::HumanInLoop => text.push_str(
            "A human reviews your work before the workflow advances. Ending with open \
             questions or partial work is fine — surface what the reviewer should look at.",
        ),
    }
    text
}
