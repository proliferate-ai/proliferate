//! Blocking clone-or-adopt repo-root acquisition mechanics.
//!
//! Split out of `service.rs` (per the domain guide's "split on next growth"
//! note): these are the synchronous filesystem/git primitives the async
//! `MaterializationService::acquire_repo_root` use case drives on a blocking
//! task. Ledger admission and orchestration stay in `service.rs`.

use std::path::Path;

use super::identity::{canonicalize_destination, parse_remote_identity, RemoteIdentity};
use super::model::{AcquireOutcome, AcquireRepoRootResult, MaterializationError};
use super::service::{internal, map_resolve_repo_root_error, Result};
use super::store::MaterializationOperationStore;
use crate::adapters::git::service::CloneError;
use crate::adapters::git::GitService;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::workspaces::runtime::WorkspaceRuntime;

/// Blocking clone-or-adopt + identity verification + registration. Runs off the
/// async runtime.
#[allow(clippy::too_many_arguments)]
pub(crate) fn acquire_blocking(
    workspace_runtime: &WorkspaceRuntime,
    repo_root_service: &RepoRootService,
    store: &MaterializationOperationStore,
    operation_id: &str,
    expected: &RemoteIdentity,
    clone_url: &str,
    destination_path: &str,
    recovered_intended_kind: Option<&str>,
) -> Result<AcquireRepoRootResult> {
    let raw_destination = Path::new(destination_path);
    if !raw_destination.is_absolute() {
        return Err(MaterializationError::DestinationOutsideAllowedRoot(
            "destination path must be absolute".into(),
        ));
    }

    // Symlink-escape protection: canonicalize the destination's existing
    // ancestors so all downstream checks use real paths.
    let canonical = canonicalize_destination(raw_destination)
        .map_err(|error| MaterializationError::DestinationOutsideAllowedRoot(error.to_string()))?;
    let canonical_string = canonical.to_string_lossy().to_string();

    // Already-registered by path? (idempotent reuse of a prior acquisition.)
    if let Some(existing) = repo_root_service
        .find_by_path(&canonical_string)
        .map_err(internal)?
    {
        verify_remote_identity(&existing.path, expected)?;
        return Ok(AcquireRepoRootResult {
            repo_root: existing,
            outcome: AcquireOutcome::Reused,
        });
    }

    if canonical.exists() {
        // Crash-after-clone recovery: if a prior attempt recorded that it chose
        // the *clone* path (intended_kind == "managed"), the on-disk checkout is
        // one WE created, not a user's external checkout. Re-register it as
        // managed/cloned so recovery does not silently downgrade the root.
        if recovered_intended_kind.as_deref() == Some("managed") {
            return recover_cloned_checkout(workspace_runtime, &canonical_string, expected);
        }
        // The frozen contract accepts a "non-existent OR empty" destination for
        // a clone. Only an existing *git checkout* is adopted; an existing empty
        // dir falls through to the clone path (PR3-EMPTY-02); an existing
        // non-empty non-repo is rejected as DESTINATION_NOT_EMPTY below.
        if is_git_checkout(&canonical) {
            return adopt_existing_checkout(workspace_runtime, &canonical_string, expected);
        }
    }

    // Clone path: destination must be non-existent or empty and owned by this
    // operation. `ensure_empty_clone_destination` creates a missing dir (and
    // reports it as created for cleanup), accepts an existing empty one, and
    // rejects a non-empty one with DESTINATION_NOT_EMPTY. Persist the clone
    // intent BEFORE the clone runs so a crash between clone and registration
    // recovers as managed (Finding 2).
    let created_dir = ensure_empty_clone_destination(&canonical)?;
    store
        .set_intended_kind(operation_id, "managed")
        .map_err(internal)?;

    match GitService::clone_repository(clone_url, &canonical_string) {
        Ok(()) => {}
        Err(CloneError::AuthRequired(detail)) => {
            // Path ownership (PR3-PATH-OWNERSHIP-02): remove the whole dir only if
            // we created it; for a user-selected pre-existing (proved-empty) dir,
            // remove just the clone-produced contents and keep the dir.
            crate::adapters::git::operations::clone::cleanup_failed_clone_best_effort(
                &canonical,
                created_dir,
            );
            return Err(MaterializationError::RepositoryAuthRequired(detail));
        }
        Err(CloneError::Failed(detail)) => {
            crate::adapters::git::operations::clone::cleanup_failed_clone_best_effort(
                &canonical,
                created_dir,
            );
            return Err(MaterializationError::Failed(detail));
        }
    }

    // Post-clone identity verification. Reject a mismatch even though the clone
    // succeeded. Path ownership (PR3-PATH-OWNERSHIP-02): if THIS operation
    // created the destination directory, remove the whole tree; if the user
    // selected a pre-existing directory (which we proved empty before cloning),
    // delete only the entries this clone produced and leave the user's directory
    // itself in place — never `remove_dir_all` a path we did not create.
    if let Err(error) = verify_remote_identity(&canonical_string, expected) {
        crate::adapters::git::operations::clone::cleanup_failed_clone_best_effort(
            &canonical,
            created_dir,
        );
        return Err(error);
    }

    let (_ctx, record) = workspace_runtime
        .register_acquired_repo_root(&canonical_string, "managed")
        .map_err(map_resolve_repo_root_error)?;
    Ok(AcquireRepoRootResult {
        repo_root: record,
        outcome: AcquireOutcome::Cloned,
    })
}

fn adopt_existing_checkout(
    workspace_runtime: &WorkspaceRuntime,
    destination: &str,
    expected: &RemoteIdentity,
) -> Result<AcquireRepoRootResult> {
    verify_remote_identity(destination, expected)?;
    let (_ctx, record) = workspace_runtime
        .register_acquired_repo_root(destination, "external")
        .map_err(map_resolve_repo_root_error)?;
    Ok(AcquireRepoRootResult {
        repo_root: record,
        outcome: AcquireOutcome::Adopted,
    })
}

/// Crash-after-clone recovery: the destination already exists because a prior
/// attempt of THIS operation cloned it (intent recorded as `managed`). Verify
/// identity and re-register as a managed root with a truthful `Cloned` outcome
/// rather than downgrading it to `external` adoption.
fn recover_cloned_checkout(
    workspace_runtime: &WorkspaceRuntime,
    destination: &str,
    expected: &RemoteIdentity,
) -> Result<AcquireRepoRootResult> {
    verify_remote_identity(destination, expected)?;
    let (_ctx, record) = workspace_runtime
        .register_acquired_repo_root(destination, "managed")
        .map_err(map_resolve_repo_root_error)?;
    Ok(AcquireRepoRootResult {
        repo_root: record,
        outcome: AcquireOutcome::Cloned,
    })
}

/// Whether an existing path looks like a git checkout (has a `.git` entry, dir
/// or gitfile). Used to decide adopt-vs-clone for an existing destination: only
/// a real checkout is adopted; an empty or non-repo dir falls through to clone.
fn is_git_checkout(path: &Path) -> bool {
    path.join(".git").exists()
}

/// Ensure a clone destination is non-existent or empty and create it if
/// missing. Returns true if this call created the directory (so cleanup may
/// remove it). Never deletes/overwrites an unexpected existing directory.
pub(crate) fn ensure_empty_clone_destination(canonical: &Path) -> Result<bool> {
    if canonical.exists() {
        // Only an empty directory is acceptable and owned by this op.
        let mut entries = std::fs::read_dir(canonical)
            .map_err(|error| MaterializationError::Failed(error.to_string()))?;
        if entries.next().is_some() {
            return Err(MaterializationError::DestinationNotEmpty(
                "destination directory is not empty".into(),
            ));
        }
        return Ok(false);
    }
    std::fs::create_dir_all(canonical)
        .map_err(|error| MaterializationError::Failed(error.to_string()))?;
    Ok(true)
}

/// Resolve the canonical origin remote of a checkout and require case-folded
/// provider/owner/repo equality with the expected identity.
pub(crate) fn verify_remote_identity(checkout_path: &str, expected: &RemoteIdentity) -> Result<()> {
    let ctx = crate::domains::workspaces::resolver::resolve_git_context(checkout_path)
        .map_err(|error| MaterializationError::Failed(error.to_string()))?;
    if ctx.is_worktree {
        return Err(MaterializationError::RepoRootWorktreeUnsupported(
            "adoption requires a main checkout, not a linked worktree".into(),
        ));
    }
    let remote_url = ctx.remote_url.as_deref().ok_or_else(|| {
        MaterializationError::RepositoryRemoteMismatch("checkout has no origin remote".into())
    })?;
    let actual = parse_remote_identity(remote_url).ok_or_else(|| {
        MaterializationError::RepositoryRemoteMismatch(
            "could not parse the checkout's origin remote".into(),
        )
    })?;
    if &actual != expected {
        return Err(MaterializationError::RepositoryRemoteMismatch(format!(
            "expected {}/{}/{}, found {}/{}/{}",
            expected.provider,
            expected.owner,
            expected.repo,
            actual.provider,
            actual.owner,
            actual.repo
        )));
    }
    Ok(())
}
