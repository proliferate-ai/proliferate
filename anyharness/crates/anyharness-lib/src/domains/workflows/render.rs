//! Envelope rendering: the one path that turns a node's prompt into the
//! stored, re-creatable prompt unit `{instruction_blocks, first_message,
//! system_prompt_append}`. Fail-and-redo, resume, and ad hoc re-running all
//! reuse this function, so what the model was told is always reconstructable
//! from the row.
//!
//! Delivery contract (Ruling D): each `instruction_blocks` string is stored
//! ALREADY wrapped with the exact house sentinel ("System instruction from
//! AnyHarness, not user content:"), baked in here at render time. The live
//! engine delivers the blocks in-band, prepended to the first message
//! payload, identically for every harness. The preamble never rides
//! `system_prompt_append`; that field stays empty, reserved for DSL-authored
//! appends.
//!
//! Forgery note (forward-looking): argument values are interpolated verbatim
//! into `first_message`, so an argument containing the sentinel text lands in
//! user content looking like an instruction block. Today arguments are typed
//! by the triggering user; when untrusted trigger payloads (webhooks, cron)
//! arrive, interpolation must neutralize the sentinel.

use std::path::Path;

use super::definition::{resolve_references, PromptReference, ResolveError, ResolveMode};
use super::model::{RenderedEnvelope, WorkflowNodeType, WorkflowRunDocRecord};
use crate::domains::sessions::model::SESSION_TITLE_MAX_CHARS;
use crate::domains::sessions::prompt::render::SYSTEM_INSTRUCTION_WRAPPER;

/// Workspace-relative parent of every run's context docs. Each run gets its
/// own subfolder ([`run_context_dir_relative`]); nothing writes into this
/// directory directly.
pub const CONTEXT_DIR_RELATIVE: &str = ".proliferate/context";

/// The node-session title law: `NN Title`, NN = the node's chain position,
/// one-based and two digits. Deliberately the mark the run graph's card
/// already wears (the client's `nodeIndexLabel`), so a session tab in the
/// workspace reads straight against the card the user is looking at — that
/// join is the whole point, and a second numbering for one chain would undo
/// it.
///
/// It is NOT the doc-filename law (`store::doc_filename`), which numbers the
/// same chain from zero: filenames sort artifacts on disk, this names a step
/// to a person, and the two have never had to agree.
///
/// A row with no chain position (contractually impossible for a defined node,
/// and an adhoc row inherits its anchor's) keeps the bare title rather than
/// inventing a number. Clipped to the sessions cap so the title is always
/// writable — a node title has no length limit of its own.
pub fn node_session_title(chain_index: Option<i64>, node_title: &str) -> String {
    let trimmed = node_title.trim();
    let composed = match chain_index {
        Some(index) if index >= 0 => format!("{:02} {trimmed}", index + 1),
        _ => trimmed.to_string(),
    };
    if composed.chars().count() <= SESSION_TITLE_MAX_CHARS {
        return composed;
    }
    let mut clipped: String = composed
        .chars()
        .take(SESSION_TITLE_MAX_CHARS - 1)
        .collect::<String>()
        .trim_end()
        .to_string();
    clipped.push('…');
    clipped
}

/// Workspace-relative home of ONE run's context docs
/// (`.proliferate/context/<run_id>/`). Run-scoping keeps concurrent runs
/// sharing a workspace from colliding on `NN-slug.md` names, which are only
/// unique within a run's chain.
pub fn run_context_dir_relative(run_id: &str) -> std::path::PathBuf {
    Path::new(CONTEXT_DIR_RELATIVE).join(run_id)
}

#[derive(Debug, Clone)]
pub struct RenderInputs<'a> {
    pub node_type: WorkflowNodeType,
    /// The node's prompt text (definition prompt, edited redo prompt, or the
    /// ad hoc user prompt).
    pub prompt: &'a str,
    /// Strict for definition prompts (validation precedes); lenient for
    /// redo-edited and ad hoc prompts (Ruling E — unresolvable references
    /// pass through as the literal text the user typed).
    pub mode: ResolveMode,
    /// The frozen invocation arguments.
    pub arguments: &'a serde_json::Map<String, serde_json::Value>,
    /// The run's doc registry rows — resolution reads rows, never the
    /// definition, so run-local registrations stay authoritative.
    pub docs: &'a [WorkflowRunDocRecord],
    /// Absolute path of this run's context dir
    /// (`<workspace>/.proliferate/context/<run_id>`).
    pub context_dir: &'a Path,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RenderEnvelopeError {
    #[error("prompt references undeclared input @input:{0}")]
    UnknownInput(String),
    #[error("prompt references unknown doc @doc:{0}")]
    UnknownDoc(String),
    #[error("malformed prompt reference: {0}")]
    Malformed(String),
}

impl From<ResolveError> for RenderEnvelopeError {
    fn from(error: ResolveError) -> Self {
        match error {
            ResolveError::Malformed(error) => Self::Malformed(error.detail),
            ResolveError::Unresolved(PromptReference::Input(name)) => Self::UnknownInput(name),
            ResolveError::Unresolved(PromptReference::Doc(slug)) => Self::UnknownDoc(slug),
        }
    }
}

/// Render one node's envelope. Pure: no IO, no clock.
pub fn render_envelope(inputs: &RenderInputs<'_>) -> Result<RenderedEnvelope, RenderEnvelopeError> {
    let first_message = resolve_references(inputs.prompt, inputs.mode, |reference| {
        match reference {
            PromptReference::Input(name) => inputs.arguments.get(name).map(argument_text),
            PromptReference::Doc(slug) => inputs
                .docs
                .iter()
                .find(|doc| &doc.slug == slug)
                .map(|doc| inputs.context_dir.join(&doc.filename).display().to_string()),
        }
    })?;

    let preamble = preamble(inputs.node_type, inputs.context_dir, inputs.docs);
    Ok(RenderedEnvelope {
        // Ruling D: the wrapper is baked into the stored block, so delivery
        // is a dumb prepend — no harness-side wrapping to forget.
        instruction_blocks: vec![format!("{SYSTEM_INSTRUCTION_WRAPPER}{preamble}")],
        first_message,
        // Reserved for DSL-authored appends; the preamble never rides here.
        system_prompt_append: Vec::new(),
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
/// deliberate — this text is what every workflow agent is told. It is
/// markdown on purpose: the transcript renders it, so structure the agent
/// parses is the same structure the human reads (single newlines would
/// collapse into one run-on paragraph).
fn preamble(node_type: WorkflowNodeType, context_dir: &Path, docs: &[WorkflowRunDocRecord]) -> String {
    let mut text = format!(
        "You are one node in a multi-step workflow.\n\
         \n\
         ## Shared context documents\n\
         \n\
         Shared documents for this run live in one flat folder:\n\
         \n\
         {}\n\
         \n\
         - Files are named NN-slug.md, where NN is the position of the workflow step \
         that produces the document.\n\
         - Read them freely for context and write to the ones your step produces.\n\
         - Keep documents legible plain markdown: someone who has never seen this \
         workflow should understand what happened from the documents alone.\n\
         - Prefer evidence over prose. Do not add frontmatter or machine metadata.\n",
        context_dir.display()
    );
    if !docs.is_empty() {
        text.push_str("\nThis run's documents:\n\n");
        for doc in docs {
            text.push_str(&format!("- {}\n", context_dir.join(&doc.filename).display()));
        }
    }
    text.push_str("\n## Your step\n\n");
    text.push_str(match node_type {
        WorkflowNodeType::Agent => {
            "Your step completes when this turn ends. Finish the job in this turn; never \
             stop to ask questions. Do only this step's work — do not proceed into later \
             steps' work."
        }
        WorkflowNodeType::HumanInLoop => {
            "A human reviews your work before the workflow advances. Ending with open \
             questions or partial work is fine — surface what the reviewer should look at."
        }
    });
    text
}
