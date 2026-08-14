//! Context materialization: the run's doc folder, its seeded templates, and
//! the shared git exclude entry, all on disk BEFORE the first node's session
//! is created. Harnesses walk the workspace once at session start and never
//! re-walk, so this ordering is a law, not an optimization (the live engine's
//! PUT path calls this before StartNode).

use std::path::{Path, PathBuf};

use super::definition::DocTemplate;
use super::model::WorkflowRunDocRecord;
use super::render::CONTEXT_DIR_RELATIVE;
use crate::domains::workspaces::exclude::{ensure_proliferate_excluded, ExcludeOutcome};

/// Materialize the context folder for one run: create
/// `<workspace>/.proliferate/context/`, seed each registry row's file from
/// its template body, and ensure the clone's shared `/.proliferate/` exclude
/// entry. Idempotent, and run-local edits win: an existing file is never
/// overwritten.
pub fn materialize_context(
    workspace_root: &Path,
    docs: &[WorkflowRunDocRecord],
    templates: &[DocTemplate],
) -> anyhow::Result<PathBuf> {
    let context_dir = workspace_root.join(CONTEXT_DIR_RELATIVE);
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
