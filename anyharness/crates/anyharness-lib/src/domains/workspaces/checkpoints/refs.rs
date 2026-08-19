//! The ONLY code in the repository that writes or deletes
//! `refs/proliferate/checkpoints/*`. This mirrors the archive-refs carve-out
//! (`archive/refs.rs`): `adapters/git` keeps every worktree, index, and content
//! verb, but this private per-workspace checkpoint namespace is owned and
//! shelled directly here. `scripts/check_anyharness_boundaries.py` says nothing
//! about `std::process::Command`, so this passes the checker; the sole-writer
//! rule is a design invariant enforced by review, not a script.
//!
//! Unlike archive (one generation per workspace, flat `<family>/<id>` names),
//! a workspace holds MANY checkpoints at once, so every ref name is
//! `checkpoints/<workspace_id>/<checkpoint_id>/{head,worktree,index}` —
//! slash-separated, full names always. The shelling helpers
//! (`update_ref`/`show_ref_verify`/`rev_parse_verify`/`delete_ref_if_present`)
//! are duplicated here rather than made public on `archive/refs.rs`: those are
//! private there on purpose, and widening them to share would erode the
//! sole-writer boundary between the two namespaces.

use std::path::Path;
use std::process::Command;

use crate::adapters::git::operations::snapshot::WorkspaceSnapshot;

pub const CHECKPOINT_REFS_PREFIX: &str = "refs/proliferate/checkpoints/";

/// A single enumerated checkpoint ref: which checkpoint it belongs to, which
/// family (`head`/`worktree`/`index`), and the raw ref-target OID.
#[derive(Debug, Clone)]
pub struct CheckpointRefEntry {
    pub checkpoint_id: String,
    pub family: String,
    pub oid: String,
}

/// Write all three checkpoint refs for `(workspace_id, checkpoint_id)`,
/// wholesale, at the snapshot's raw ref-target OIDs (the anchor commit when the
/// capture contained LFS pointers, the bare tree otherwise). A given
/// `checkpoint_id` is written exactly once.
pub fn write_checkpoint_refs(
    repo_root: &Path,
    workspace_id: &str,
    checkpoint_id: &str,
    snap: &WorkspaceSnapshot,
) -> anyhow::Result<()> {
    update_ref(
        repo_root,
        &head_ref(workspace_id, checkpoint_id),
        &snap.head_sha,
    )?;
    update_ref(
        repo_root,
        &work_tree_ref(workspace_id, checkpoint_id),
        snap.work_tree_ref_oid(),
    )?;
    update_ref(
        repo_root,
        &index_ref(workspace_id, checkpoint_id),
        snap.index_tree_ref_oid(),
    )?;
    Ok(())
}

/// OID identity ×3 plus a per-family object-existence peel: `head` always
/// `^{commit}`, `index` always `^{tree}` (shape-agnostic), and `worktree`
/// follows the heads-family (`^{commit}`) when anchored, `^{tree}` otherwise —
/// the shape is known from `snap` itself. Called back-to-back with
/// [`write_checkpoint_refs`] so a racing gc that pruned a just-written object
/// fails capture loudly instead of silently persisting a dangling checkpoint.
pub fn verify_checkpoint_refs(
    repo_root: &Path,
    workspace_id: &str,
    checkpoint_id: &str,
    snap: &WorkspaceSnapshot,
) -> anyhow::Result<()> {
    verify_one(
        repo_root,
        &head_ref(workspace_id, checkpoint_id),
        &snap.head_sha,
        "commit",
    )?;
    let work_tree_peel = if snap.work_tree_anchor.is_some() {
        "commit"
    } else {
        "tree"
    };
    verify_one(
        repo_root,
        &work_tree_ref(workspace_id, checkpoint_id),
        snap.work_tree_ref_oid(),
        work_tree_peel,
    )?;
    verify_one(
        repo_root,
        &index_ref(workspace_id, checkpoint_id),
        snap.index_tree_ref_oid(),
        "tree",
    )?;
    Ok(())
}

/// Remove exactly `(workspace_id, checkpoint_id)`'s three refs. Leaves every
/// sibling checkpoint of the same workspace untouched.
pub fn delete_for(repo_root: &Path, workspace_id: &str, checkpoint_id: &str) -> anyhow::Result<()> {
    for ref_name in [
        head_ref(workspace_id, checkpoint_id),
        work_tree_ref(workspace_id, checkpoint_id),
        index_ref(workspace_id, checkpoint_id),
    ] {
        delete_ref_if_present(repo_root, &ref_name)?;
    }
    Ok(())
}

/// Purge companion: clears every checkpoint ref under `workspace_id`, across
/// every checkpoint id it holds. The one caller is workspace purge, for whom
/// "the rows are gone forever" also means "there is nothing left to keep".
pub fn delete_all_for(repo_root: &Path, workspace_id: &str) -> anyhow::Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for entry in list_for_workspace(repo_root, workspace_id)? {
        seen.insert(entry.checkpoint_id);
    }
    for checkpoint_id in seen {
        delete_for(repo_root, workspace_id, &checkpoint_id)?;
    }
    Ok(())
}

/// Enumerate every checkpoint ref for `workspace_id` with `for-each-ref`, never
/// `show-ref`: `show-ref` tail-matches path components and bare `show-ref`
/// hard-fails the whole enumeration if any ref anywhere in the repo dangles.
/// Returns `(checkpoint_id, family, oid)` per ref.
pub fn list_for_workspace(
    repo_root: &Path,
    workspace_id: &str,
) -> anyhow::Result<Vec<CheckpointRefEntry>> {
    let prefix = format!("{CHECKPOINT_REFS_PREFIX}{workspace_id}/");
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["for-each-ref", "--format=%(objectname) %(refname)", &prefix])
        .output()
        .map_err(|error| anyhow::anyhow!("git for-each-ref failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((oid, refname)) = line.split_once(' ') else {
            continue;
        };
        let Some(rest) = refname.strip_prefix(&prefix) else {
            continue;
        };
        // `rest` is `<checkpoint_id>/<family>`. checkpoint ids are uuids (no
        // slash), so the first component is the id and the last is the family.
        let Some((checkpoint_id, family)) = rest.split_once('/') else {
            continue;
        };
        entries.push(CheckpointRefEntry {
            checkpoint_id: checkpoint_id.to_string(),
            family: family.to_string(),
            oid: oid.to_string(),
        });
    }
    Ok(entries)
}

/// Enumerate workspace ids that own any checkpoint ref in this repository.
/// This is the retention candidate backstop for a capture that crashed after
/// refs were verified but before its first metadata row was inserted.
pub fn list_workspace_ids_for_repo(
    repo_root: &Path,
) -> anyhow::Result<std::collections::BTreeSet<String>> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args([
            "for-each-ref",
            "--format=%(refname)",
            CHECKPOINT_REFS_PREFIX,
        ])
        .output()
        .map_err(|error| anyhow::anyhow!("git for-each-ref failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let mut workspace_ids = std::collections::BTreeSet::new();
    for refname in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(rest) = refname.strip_prefix(CHECKPOINT_REFS_PREFIX) else {
            continue;
        };
        let mut components = rest.split('/');
        let (Some(workspace_id), Some(checkpoint_id), Some(family), None) = (
            components.next(),
            components.next(),
            components.next(),
            components.next(),
        ) else {
            continue;
        };
        if !workspace_id.is_empty()
            && !checkpoint_id.is_empty()
            && matches!(family, "head" | "worktree" | "index")
        {
            workspace_ids.insert(workspace_id.to_string());
        }
    }
    Ok(workspace_ids)
}

fn head_ref(workspace_id: &str, checkpoint_id: &str) -> String {
    format!("{CHECKPOINT_REFS_PREFIX}{workspace_id}/{checkpoint_id}/head")
}

fn work_tree_ref(workspace_id: &str, checkpoint_id: &str) -> String {
    format!("{CHECKPOINT_REFS_PREFIX}{workspace_id}/{checkpoint_id}/worktree")
}

fn index_ref(workspace_id: &str, checkpoint_id: &str) -> String {
    format!("{CHECKPOINT_REFS_PREFIX}{workspace_id}/{checkpoint_id}/index")
}

fn update_ref(repo_root: &Path, ref_name: &str, oid: &str) -> anyhow::Result<()> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["update-ref", ref_name, oid])
        .output()
        .map_err(|error| anyhow::anyhow!("git update-ref failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git update-ref {ref_name} {oid} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn delete_ref_if_present(repo_root: &Path, ref_name: &str) -> anyhow::Result<()> {
    // `git update-ref -d` is idempotent when the ref is absent. Running it
    // unconditionally preserves the distinction between true absence and a
    // spawn/repository failure; a lossy preflight would report cleanup success
    // when git could not even inspect the repository.
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["update-ref", "-d", ref_name])
        .output()
        .map_err(|error| anyhow::anyhow!("git update-ref -d failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git update-ref -d {ref_name} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

/// Per-ref lookup with the FULL ref name (never a bare tail component, which
/// would conflate the three families).
fn show_ref_verify(repo_root: &Path, ref_name: &str) -> anyhow::Result<Option<String>> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["show-ref", "--verify", ref_name])
        .output()
        .map_err(|error| anyhow::anyhow!("git show-ref failed to run: {error}"))?;
    if !output.status.success() {
        if output.status.code() == Some(1) {
            return Ok(None);
        }
        anyhow::bail!(
            "git show-ref --verify {ref_name} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text
        .lines()
        .next()
        .ok_or_else(|| anyhow::anyhow!("git show-ref returned no record for {ref_name}"))?;
    let (oid, _refname) = line.split_once(' ').ok_or_else(|| {
        anyhow::anyhow!("git show-ref returned a malformed record for {ref_name}")
    })?;
    Ok(Some(oid.to_string()))
}

fn rev_parse_verify(repo_root: &Path, expr: &str) -> anyhow::Result<String> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["rev-parse", "--verify", expr])
        .output()
        .map_err(|error| anyhow::anyhow!("git rev-parse failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git rev-parse --verify {expr} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn verify_one(
    repo_root: &Path,
    ref_name: &str,
    expected_oid: &str,
    peel: &str,
) -> anyhow::Result<()> {
    let resolved = show_ref_verify(repo_root, ref_name)?
        .ok_or_else(|| anyhow::anyhow!("checkpoint ref {ref_name} does not exist"))?;
    if resolved != expected_oid {
        anyhow::bail!("checkpoint ref {ref_name} points at {resolved}, expected {expected_oid}");
    }
    rev_parse_verify(repo_root, &format!("{resolved}^{{{peel}}}"))
        .map(|_| ())
        .map_err(|_| {
            anyhow::anyhow!(
                "checkpoint ref {ref_name}'s object {resolved} does not exist ({peel} peel failed)"
            )
        })
}
