//! The ONLY code in the repository that writes or deletes
//! `refs/proliferate/archive-*`. This is the ADR's one stated carve-out from
//! "adapters/git owns every git verb": `adapters/git` keeps every worktree,
//! index, and content verb, but the private archive-refs namespace is owned
//! and shelled directly here. `scripts/check_anyharness_boundaries.py` says
//! nothing about `std::process::Command`, so this passes the checker; the
//! sole-writer rule is a design invariant enforced by review, not a script
//! (`scripts/anyharness_boundaries_allowlist.txt:6.6`).

use std::path::Path;
use std::process::Command;

use crate::adapters::git::operations::snapshot::WorkspaceSnapshot;

pub const ARCHIVE_REFS_PREFIX: &str = "refs/proliferate/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveRefShape {
    Tree,
    AnchorCommit,
}

#[derive(Debug, Clone)]
pub struct ArchiveRefSet {
    /// `archive-heads/<id>`, peeled `^{commit}`.
    pub head_sha: String,
    /// `archive-worktrees/<id>`, peeled `^{tree}` (resolves both shapes).
    pub work_tree: String,
    /// The raw ref target: the anchor commit OID or the bare tree OID.
    pub work_tree_ref_oid: String,
    pub work_tree_shape: ArchiveRefShape,
    /// `archive-indexes/<id>`, peeled `^{tree}` (shape-agnostic; R2-4).
    pub index_tree: String,
}

#[derive(Debug, Clone)]
pub struct ArchiveRefEntry {
    pub workspace_id: String,
    pub family: String,
    pub oid: String,
}

/// Write all three archive refs for `workspace_id`, wholesale. A re-archive
/// overwrites them, so exactly one generation ever exists per workspace.
pub fn write_archive_refs(
    repo_root: &Path,
    workspace_id: &str,
    snap: &WorkspaceSnapshot,
) -> anyhow::Result<()> {
    update_ref(repo_root, &head_ref(workspace_id), &snap.head_sha)?;
    update_ref(
        repo_root,
        &work_tree_ref(workspace_id),
        snap.work_tree_ref_oid(),
    )?;
    update_ref(
        repo_root,
        &index_ref(workspace_id),
        snap.index_tree_ref_oid(),
    )?;
    Ok(())
}

/// OID identity ×3 (a stale ref from a prior generation fails) plus a
/// per-family object-existence peel: `archive-heads` always `^{commit}`,
/// `archive-indexes` always `^{tree}` (shape-agnostic per R2-4), and
/// `archive-worktrees` follows the heads family (`^{commit}`) when anchored,
/// `^{tree}` otherwise — the shape is known from `snap` itself.
pub fn verify_archive_refs(
    repo_root: &Path,
    workspace_id: &str,
    snap: &WorkspaceSnapshot,
) -> anyhow::Result<()> {
    verify_one(repo_root, &head_ref(workspace_id), &snap.head_sha, "commit")?;
    let work_tree_peel = if snap.work_tree_anchor.is_some() {
        "commit"
    } else {
        "tree"
    };
    verify_one(
        repo_root,
        &work_tree_ref(workspace_id),
        snap.work_tree_ref_oid(),
        work_tree_peel,
    )?;
    verify_one(
        repo_root,
        &index_ref(workspace_id),
        snap.index_tree_ref_oid(),
        "tree",
    )?;
    Ok(())
}

/// `None` when no archive refs exist for `workspace_id`. The shape of
/// `archive-worktrees` is discovered from the object itself: a bare tree has
/// no `^{commit}` peel, an anchor commit does.
pub fn resolve_archive_refs(
    repo_root: &Path,
    workspace_id: &str,
) -> anyhow::Result<Option<ArchiveRefSet>> {
    let Some(head_raw) = show_ref_verify(repo_root, &head_ref(workspace_id)) else {
        return Ok(None);
    };
    let Some(work_raw) = show_ref_verify(repo_root, &work_tree_ref(workspace_id)) else {
        return Ok(None);
    };
    let Some(index_raw) = show_ref_verify(repo_root, &index_ref(workspace_id)) else {
        return Ok(None);
    };

    let head_sha = rev_parse_verify(repo_root, &format!("{head_raw}^{{commit}}"))?;
    let (index_tree, _) = peeled_tree(repo_root, &index_raw)?;
    let (work_tree, work_tree_shape) = peeled_tree(repo_root, &work_raw)?;

    Ok(Some(ArchiveRefSet {
        head_sha,
        work_tree,
        work_tree_ref_oid: work_raw,
        work_tree_shape,
        index_tree,
    }))
}

/// Remove exactly `workspace_id`'s three archive refs. Leaves a sibling id's
/// set, and any `rescue/` names, untouched.
pub fn delete_for(repo_root: &Path, workspace_id: &str) -> anyhow::Result<()> {
    for ref_name in [
        head_ref(workspace_id),
        work_tree_ref(workspace_id),
        index_ref(workspace_id),
    ] {
        delete_ref_if_present(repo_root, &ref_name)?;
    }
    Ok(())
}

/// Purge-only companion to [`delete_for`]: clears `workspace_id`'s three named
/// archive refs AND every `rescue/<workspace_id>-<sha>/` name it holds, across
/// every generation it ever rescued. `delete_for` is R2's frozen, pinned
/// 2-arg verb — it deliberately leaves `rescue/` alone for the
/// archived-row lifecycle (that's the whole point of a rescue name: forensic
/// evidence a still-archived row's failed post-restore verify can be
/// inspected against). Purge is the one caller for whom "the row is gone
/// forever" also means "there is nothing left to rescue", so this is a NEW
/// verb rather than a change to `delete_for`'s contract.
pub fn delete_all_for(repo_root: &Path, workspace_id: &str) -> anyhow::Result<()> {
    delete_for(repo_root, workspace_id)?;
    for ref_name in rescue_ref_names_for(repo_root, workspace_id)? {
        delete_ref_if_present(repo_root, &ref_name)?;
    }
    Ok(())
}

/// Every full `rescue/<workspace_id>-<sha>/archive-{heads,worktrees,indexes}`
/// ref name currently held for `workspace_id`. Shares the same
/// last-hyphen-splits-the-sha parsing as [`rescue_ids_for_repo`] (workspace
/// ids contain hyphens themselves, so the sha suffix — not the id — is the
/// fixed-shape half of the directory component).
fn rescue_ref_names_for(repo_root: &Path, workspace_id: &str) -> anyhow::Result<Vec<String>> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args([
            "for-each-ref",
            "--format=%(refname)",
            &format!("{ARCHIVE_REFS_PREFIX}rescue/"),
        ])
        .output()
        .map_err(|error| anyhow::anyhow!("git for-each-ref failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let prefix = format!("{ARCHIVE_REFS_PREFIX}rescue/");
    let mut names = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(rest) = line.strip_prefix(&prefix) else {
            continue;
        };
        let Some((directory, _leaf)) = rest.split_once('/') else {
            continue;
        };
        let Some((id, _sha)) = directory.rsplit_once('-') else {
            continue;
        };
        if id == workspace_id {
            names.push(line.to_string());
        }
    }
    Ok(names)
}

/// Copy `workspace_id`'s current archive refs, verbatim (same raw OIDs, same
/// shapes), into the `rescue/<id>-<head_sha>/` family — R4's failed
/// post-restore verify's only writer. Exempt from every sweep duty; dies
/// only with purge. Idempotent at the same sha.
pub fn copy_to_rescue(repo_root: &Path, workspace_id: &str, head_sha: &str) -> anyhow::Result<()> {
    let head_raw = show_ref_verify(repo_root, &head_ref(workspace_id))
        .ok_or_else(|| anyhow::anyhow!("no archive-heads ref for workspace {workspace_id}"))?;
    let work_raw = show_ref_verify(repo_root, &work_tree_ref(workspace_id))
        .ok_or_else(|| anyhow::anyhow!("no archive-worktrees ref for workspace {workspace_id}"))?;
    let index_raw = show_ref_verify(repo_root, &index_ref(workspace_id))
        .ok_or_else(|| anyhow::anyhow!("no archive-indexes ref for workspace {workspace_id}"))?;

    let prefix = format!("{ARCHIVE_REFS_PREFIX}rescue/{workspace_id}-{head_sha}");
    update_ref(repo_root, &format!("{prefix}/archive-heads"), &head_raw)?;
    update_ref(repo_root, &format!("{prefix}/archive-worktrees"), &work_raw)?;
    update_ref(repo_root, &format!("{prefix}/archive-indexes"), &index_raw)?;
    Ok(())
}

/// Enumerate the namespace with `for-each-ref`, never `show-ref`: `show-ref`
/// tail-matches path components (a namespace prefix matches nothing) and
/// bare `show-ref` hard-fails the whole enumeration if any ref anywhere in
/// the repo dangles. Excludes the `rescue/` family, which no sweep duty ever
/// enumerates through this call.
pub fn list_for_repo(repo_root: &Path) -> anyhow::Result<Vec<ArchiveRefEntry>> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args([
            "for-each-ref",
            "--format=%(objectname) %(refname)",
            ARCHIVE_REFS_PREFIX,
        ])
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
        let Some(rest) = refname.strip_prefix(ARCHIVE_REFS_PREFIX) else {
            continue;
        };
        if rest.starts_with("rescue/") {
            continue;
        }
        let Some((family, workspace_id)) = rest.split_once('/') else {
            continue;
        };
        entries.push(ArchiveRefEntry {
            workspace_id: workspace_id.to_string(),
            family: family.to_string(),
            oid: oid.to_string(),
        });
    }
    Ok(entries)
}

/// Which workspace ids hold `rescue/` names in this repo.
///
/// The read side of [`copy_to_rescue`], added because the sweep's orphaned-refs
/// duty must skip any id holding rescue names ENTIRELY — those refs are the
/// forensic evidence of a failed post-restore verify, and a duty that reaped
/// them would delete exactly what a user is being told to look at.
/// [`list_for_repo`] deliberately filters the rescue family out, so this is a
/// separate enumeration rather than a flag on that call.
pub fn rescue_ids_for_repo(repo_root: &Path) -> anyhow::Result<std::collections::BTreeSet<String>> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args([
            "for-each-ref",
            "--format=%(refname)",
            &format!("{ARCHIVE_REFS_PREFIX}rescue/"),
        ])
        .output()
        .map_err(|error| anyhow::anyhow!("git for-each-ref failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let mut ids = std::collections::BTreeSet::new();
    let prefix = format!("{ARCHIVE_REFS_PREFIX}rescue/");
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(rest) = line.strip_prefix(&prefix) else {
            continue;
        };
        // `<id>-<sha>/archive-{heads,worktrees,indexes}`: the sha is a fixed-shape
        // hex suffix, so the id is everything before the LAST hyphen of the
        // directory component. Workspace ids contain hyphens themselves, which is
        // why splitting on the first one would be wrong.
        let Some((directory, _)) = rest.split_once('/') else {
            continue;
        };
        let Some((workspace_id, _sha)) = directory.rsplit_once('-') else {
            continue;
        };
        ids.insert(workspace_id.to_string());
    }
    Ok(ids)
}

fn head_ref(workspace_id: &str) -> String {
    format!("{ARCHIVE_REFS_PREFIX}archive-heads/{workspace_id}")
}

fn work_tree_ref(workspace_id: &str) -> String {
    format!("{ARCHIVE_REFS_PREFIX}archive-worktrees/{workspace_id}")
}

fn index_ref(workspace_id: &str) -> String {
    format!("{ARCHIVE_REFS_PREFIX}archive-indexes/{workspace_id}")
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
    if show_ref_verify(repo_root, ref_name).is_none() {
        return Ok(());
    }
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

/// Per-ref lookup with the FULL ref name (never a bare tail component,
/// which would conflate the three families).
fn show_ref_verify(repo_root: &Path, ref_name: &str) -> Option<String> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["show-ref", "--verify", ref_name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?;
    let (oid, _refname) = line.split_once(' ')?;
    Some(oid.to_string())
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
    let resolved = show_ref_verify(repo_root, ref_name)
        .ok_or_else(|| anyhow::anyhow!("archive ref {ref_name} does not exist"))?;
    if resolved != expected_oid {
        anyhow::bail!(
            "archive ref {ref_name} points at {resolved}, expected {expected_oid} (stale generation)"
        );
    }
    rev_parse_verify(repo_root, &format!("{resolved}^{{{peel}}}"))
        .map(|_| ())
        .map_err(|_| {
            anyhow::anyhow!(
                "archive ref {ref_name}'s object {resolved} does not exist ({peel} peel failed)"
            )
        })
}

/// Discover an archive ref's shape from the object itself: a bare tree has
/// no `^{commit}` peel; an anchor commit does. Returns the resolved tree OID
/// either way (identity for a bare tree, the wrapped tree for an anchor).
fn peeled_tree(repo_root: &Path, oid: &str) -> anyhow::Result<(String, ArchiveRefShape)> {
    if rev_parse_verify(repo_root, &format!("{oid}^{{commit}}")).is_ok() {
        let tree = rev_parse_verify(repo_root, &format!("{oid}^{{tree}}"))?;
        return Ok((tree, ArchiveRefShape::AnchorCommit));
    }
    let tree = rev_parse_verify(repo_root, &format!("{oid}^{{tree}}"))?;
    Ok((tree, ArchiveRefShape::Tree))
}
