//! Context materialization: the run's doc folder, its seeded templates, and
//! the shared git exclude entry, all on disk BEFORE the first node's session
//! is created. Harnesses walk the workspace once at session start and never
//! re-walk, so this ordering is a law, not an optimization (the live engine's
//! PUT path calls this before StartNode).
//!
//! Template bodies are STATIC seeds: they are written to disk byte-for-byte
//! verbatim, never scanned for references and never interpolated. Only node
//! prompts participate in `@input:`/`@doc:` resolution.

use std::path::{Path, PathBuf};

use super::definition::{DocTemplate, InvocationSnapshot};
use super::model::WorkflowRunDocRecord;
use super::render::run_context_dir_relative;
use super::store::doc_filename;
use crate::domains::workspaces::exclude::{ensure_proliferate_excluded, ExcludeOutcome};

/// A doc's disk identity, computable BEFORE any row exists: the PUT path
/// materializes from the plan so a disk failure leaves zero rows, and the
/// store later mints rows with the same filenames from the same law.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedContextDoc {
    pub slug: String,
    pub filename: String,
}

/// Plan the context docs for a validated snapshot: one per template, filename
/// from the one `NN-slug.md` law over the chain order `validate()` returned.
pub fn plan_context_docs(snapshot: &InvocationSnapshot, chain: &[String]) -> Vec<PlannedContextDoc> {
    snapshot
        .definition
        .doc_templates
        .iter()
        .map(|template| {
            let producing_position = chain
                .iter()
                .position(|definition_node_id| definition_node_id == &template.producing_node_id)
                .expect("validate() checked every producing node id is on the chain");
            PlannedContextDoc {
                slug: template.slug.clone(),
                filename: doc_filename(&template.slug, producing_position as i64),
            }
        })
        .collect()
}

/// Materialize the context folder for one run from its registry rows: create
/// `<workspace>/.proliferate/context/<run_id>/`, seed each row's file from
/// its template body, and ensure the clone's shared `/.proliferate/` exclude
/// entry. Idempotent, and run-local edits win: an existing file is never
/// overwritten.
pub fn materialize_context(
    workspace_root: &Path,
    run_id: &str,
    docs: &[WorkflowRunDocRecord],
    templates: &[DocTemplate],
) -> anyhow::Result<PathBuf> {
    let planned: Vec<PlannedContextDoc> = docs
        .iter()
        .map(|doc| PlannedContextDoc {
            slug: doc.slug.clone(),
            filename: doc.filename.clone(),
        })
        .collect();
    materialize_planned_context(workspace_root, run_id, &planned, templates)
}

/// The record-free half of [`materialize_context`], for the PUT path's
/// disk-before-rows ordering.
pub fn materialize_planned_context(
    workspace_root: &Path,
    run_id: &str,
    docs: &[PlannedContextDoc],
    templates: &[DocTemplate],
) -> anyhow::Result<PathBuf> {
    let context_dir = workspace_root.join(run_context_dir_relative(run_id));
    std::fs::create_dir_all(&context_dir)
        .map_err(|error| anyhow::anyhow!("create {}: {error}", context_dir.display()))?;

    for doc in docs {
        let path = context_dir.join(&doc.filename);
        if path.exists() {
            continue;
        }
        let body = templates
            .iter()
            .find(|template| template.slug == doc.slug)
            .map(|template| template.body.as_str())
            .unwrap_or("");
        std::fs::write(&path, body)
            .map_err(|error| anyhow::anyhow!("seed {}: {error}", path.display()))?;
    }

    match ensure_proliferate_excluded(workspace_root)? {
        ExcludeOutcome::Written | ExcludeOutcome::AlreadyPresent => {}
        ExcludeOutcome::NotAGitRepo => {
            // Nothing to exclude from; context docs still work.
            tracing::debug!(
                workspace_root = %workspace_root.display(),
                "workflow context materialized outside a git repository; no exclude entry"
            );
        }
    }
    Ok(context_dir)
}
