//! Turn-start capture: snapshot the workspace's git state, write and verify the
//! three checkpoint refs, then insert the metadata row.
//!
//! ADR H 3.2: a checkpoint must NEVER stop live work, so this path has no
//! quiesce and no kill-debris repair. `snapshot_workspace` runs its own
//! read-only probe/guard and captures against a temp index, never touching the
//! live worktree or the runtime's processes.
//!
//! Ordering is refs-before-row (ADR 3.2, the fail-safe direction): the bytes are
//! made durable and VERIFIED before the metadata row exists. A crash after the
//! ref write but before the row insert leaves orphaned refs with no row, which
//! the retention duty's orphan reap removes by row-absence. The inverse order
//! would let a row promise bytes that a racing gc pruned before anyone verified
//! them.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;

use crate::adapters::git::service::GitService;
use crate::adapters::git::types::{SnapshotError, SnapshotNotice};

use super::refs;
use super::{now, CheckpointOrigin, CheckpointRecord, WorkspaceCheckpointService};

/// The typed refusals and failures capture can produce. Internal variants retain
/// the exact `SnapshotError` shape for local handling; the prompt hook maps only
/// its bounded class to telemetry and the public error surface.
#[derive(Debug, thiserror::Error)]
pub enum CheckpointCaptureError {
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("the workspace checkout directory is missing at {path}")]
    CheckoutMissing { path: String },
    #[error("the workspace directory is not the root of its own git repository")]
    HollowCheckout { path: String },
    #[error("a git {operation} is in progress")]
    GitOperationInProgress { operation: String },
    #[error("the branch has no commits yet")]
    UnbornHead,
    #[error("git is locked by {file}")]
    GitLocked { file: String },
    #[error("checkpoint refs failed verification: {0}")]
    RefsVerifyFailed(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// Privacy-safe public classification of capture failures. Repository paths,
/// Git stderr, and internal causes stay inside the capture boundary; the wire
/// still distinguishes each retry/business refusal honestly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointCaptureFailure {
    WorkspaceNotFound,
    CheckoutMissing,
    HollowCheckout,
    GitOperationInProgress,
    UnbornHead,
    GitLocked,
    RefsVerifyFailed,
    Internal,
}

impl CheckpointCaptureFailure {
    pub fn code(self) -> &'static str {
        match self {
            Self::WorkspaceNotFound => "WORKSPACE_NOT_FOUND",
            Self::CheckoutMissing => "WORKSPACE_DIRECTORY_MISSING",
            Self::HollowCheckout => "WORKSPACE_HOLLOW_CHECKOUT",
            Self::GitOperationInProgress => "WORKSPACE_GIT_OPERATION_IN_PROGRESS",
            Self::UnbornHead => "WORKSPACE_UNBORN_HEAD",
            Self::GitLocked => "WORKSPACE_GIT_LOCKED",
            Self::RefsVerifyFailed | Self::Internal => "CHECKPOINT_CAPTURE_FAILED",
        }
    }

    pub fn detail(self) -> &'static str {
        match self {
            Self::WorkspaceNotFound => "Workspace not found.",
            Self::CheckoutMissing => "Workspace directory is missing.",
            Self::HollowCheckout => {
                "The workspace directory is not the root of its Git repository."
            }
            Self::GitOperationInProgress => "A Git operation is in progress.",
            Self::UnbornHead => "The branch has no commits yet.",
            Self::GitLocked => "Git is locked by index.lock.",
            Self::RefsVerifyFailed | Self::Internal => {
                "Could not capture a checkpoint before the turn."
            }
        }
    }
}

impl From<SnapshotError> for CheckpointCaptureError {
    fn from(error: SnapshotError) -> Self {
        match error {
            SnapshotError::HollowCheckout { path } => {
                CheckpointCaptureError::HollowCheckout { path }
            }
            SnapshotError::GitOperationInProgress { operation } => {
                CheckpointCaptureError::GitOperationInProgress { operation }
            }
            SnapshotError::UnbornHead => CheckpointCaptureError::UnbornHead,
            SnapshotError::GitLocked { file } => CheckpointCaptureError::GitLocked { file },
            SnapshotError::Internal(error) => CheckpointCaptureError::Internal(error),
        }
    }
}

impl CheckpointCaptureError {
    /// A bounded diagnostic class safe for traces and user-independent error
    /// handling. The underlying error can contain repository paths or raw git
    /// output and must never be copied into telemetry or a wire detail.
    pub fn failure_class(&self) -> &'static str {
        match self {
            Self::WorkspaceNotFound(_) => "workspace_not_found",
            Self::CheckoutMissing { .. } => "checkout_missing",
            Self::HollowCheckout { .. } => "hollow_checkout",
            Self::GitOperationInProgress { .. } => "git_operation_in_progress",
            Self::UnbornHead => "unborn_head",
            Self::GitLocked { .. } => "git_locked",
            Self::RefsVerifyFailed(_) => "refs_verify_failed",
            Self::Internal(_) => "internal",
        }
    }

    pub fn public_failure(&self) -> CheckpointCaptureFailure {
        match self {
            Self::WorkspaceNotFound(_) => CheckpointCaptureFailure::WorkspaceNotFound,
            Self::CheckoutMissing { .. } => CheckpointCaptureFailure::CheckoutMissing,
            Self::HollowCheckout { .. } => CheckpointCaptureFailure::HollowCheckout,
            Self::GitOperationInProgress { .. } => CheckpointCaptureFailure::GitOperationInProgress,
            Self::UnbornHead => CheckpointCaptureFailure::UnbornHead,
            Self::GitLocked { .. } => CheckpointCaptureFailure::GitLocked,
            Self::RefsVerifyFailed(_) => CheckpointCaptureFailure::RefsVerifyFailed,
            Self::Internal(_) => CheckpointCaptureFailure::Internal,
        }
    }
}

#[tracing::instrument(skip_all, fields(workspace_id = %workspace_id, origin = origin.as_str()))]
pub async fn capture(
    service: &Arc<WorkspaceCheckpointService>,
    workspace_id: &str,
    origin: CheckpointOrigin,
    session_id: Option<String>,
    prompt_id: Option<String>,
) -> Result<CheckpointRecord, CheckpointCaptureError> {
    let workspace = service
        .store
        .find_workspace(workspace_id)
        .map_err(CheckpointCaptureError::Internal)?
        .ok_or_else(|| CheckpointCaptureError::WorkspaceNotFound(workspace_id.to_string()))?;
    if workspace.checkout_directory_missing() {
        return Err(CheckpointCaptureError::CheckoutMissing {
            path: workspace.path.clone(),
        });
    }
    let workspace_path = PathBuf::from(&workspace.path);
    let repo_root = service
        .repo_root_path(&workspace)
        .map_err(CheckpointCaptureError::Internal)?;

    let started = Instant::now();
    let odb_before = count_objects_size(repo_root.clone()).await;

    // The snapshot runs its own probe/guard and captures against a temp index;
    // it never touches the live worktree, so it is safe to run mid-turn.
    let probe_path = workspace_path.clone();
    let snap = tokio::task::spawn_blocking(move || GitService::snapshot_workspace(&probe_path))
        .await
        .map_err(|error| {
            CheckpointCaptureError::Internal(anyhow::anyhow!("snapshot task failed: {error}"))
        })??;

    let checkpoint_id = uuid::Uuid::new_v4().to_string();

    // Write then verify the three refs back-to-back in one blocking hop: a
    // racing gc that pruned a just-written object must fail verification
    // loudly (never a silent dangling checkpoint). On verify failure, delete
    // whatever refs were written and return the error — no row is inserted, so
    // there is nothing for the orphan reap to chase either.
    let write_root = repo_root.clone();
    let write_ws = workspace_id.to_string();
    let write_id = checkpoint_id.clone();
    let snap_for_refs = snap.clone();
    tokio::task::spawn_blocking(move || {
        refs::write_checkpoint_refs(&write_root, &write_ws, &write_id, &snap_for_refs)?;
        if let Err(verify_error) =
            refs::verify_checkpoint_refs(&write_root, &write_ws, &write_id, &snap_for_refs)
        {
            let _ = refs::delete_for(&write_root, &write_ws, &write_id);
            return Err(verify_error);
        }
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|error| {
        CheckpointCaptureError::Internal(anyhow::anyhow!("checkpoint ref task failed: {error}"))
    })?
    .map_err(|error| CheckpointCaptureError::RefsVerifyFailed(error.to_string()))?;

    let created_at = now();
    let record = CheckpointRecord {
        id: checkpoint_id.clone(),
        workspace_id: workspace_id.to_string(),
        origin,
        session_id,
        turn_id: None,
        prompt_id,
        fork_operation_id: None,
        revert_operation_id: None,
        head_sha: snap.head_sha.clone(),
        work_tree_oid: snap.work_tree.clone(),
        index_tree_oid: snap.index_tree.clone(),
        work_tree_anchored: snap.work_tree_anchor.is_some(),
        index_tree_anchored: snap.index_tree_anchor.is_some(),
        notices_json: serialize_notices(&snap.notices),
        created_at: created_at.clone(),
        updated_at: created_at,
        expired_at: None,
    };
    service
        .store
        .insert_checkpoint(&record)
        .map_err(CheckpointCaptureError::Internal)?;

    // Cost observation (ADR 3.3): one log line with capture wall time, notice
    // count, and the object-database growth the capture caused, measured via
    // `git count-objects -v` (size + size-pack) before and after.
    let odb_after = count_objects_size(repo_root).await;
    let odb_growth_kib = match (odb_before, odb_after) {
        (Some(before), Some(after)) => Some(after.saturating_sub(before)),
        _ => None,
    };
    tracing::info!(
        checkpoint_id = %checkpoint_id,
        workspace_id = %workspace_id,
        origin = origin.as_str(),
        wall_ms = started.elapsed().as_millis(),
        notice_count = snap.notices.len(),
        odb_growth_kib = odb_growth_kib.unwrap_or_default(),
        odb_measurement_available = odb_growth_kib.is_some(),
        "checkpoint.capture"
    );

    Ok(record)
}

/// Serialize the FULL snapshot notice set into a JSON array of
/// `{"kind": "...", "paths": [...]}` (or `{"kind": "...", "operation": "..."}`).
/// The simplest faithful representation: `WorkspaceSnapshot::partial_capture_json`
/// only folds the two partial-capture families, but a checkpoint records every
/// notice the capture raised (embedded repos, dirty submodules, aborted
/// operations) so the row is a complete account of what the capture skipped or
/// wrapped. `None` when there were no notices.
fn serialize_notices(notices: &[SnapshotNotice]) -> Option<String> {
    if notices.is_empty() {
        return None;
    }
    let entries: Vec<serde_json::Value> = notices
        .iter()
        .map(|notice| match notice {
            SnapshotNotice::DirtySubmodule { paths } => {
                serde_json::json!({ "kind": "dirty_submodule", "paths": paths })
            }
            SnapshotNotice::EmbeddedRepo { paths } => {
                serde_json::json!({ "kind": "embedded_repo", "paths": paths })
            }
            SnapshotNotice::PartialCaptureUntracked { paths } => {
                serde_json::json!({ "kind": "partial_capture_untracked", "paths": paths })
            }
            SnapshotNotice::PartialCaptureTracked { paths } => {
                serde_json::json!({ "kind": "partial_capture_tracked", "paths": paths })
            }
            SnapshotNotice::AbortedGitOperation { operation } => {
                serde_json::json!({ "kind": "aborted_git_operation", "operation": operation })
            }
        })
        .collect();
    Some(serde_json::Value::Array(entries).to_string())
}

/// The loose + packed object-database size in KiB, parsed from
/// `git count-objects -v` (`size` and `size-pack` are reported in KiB). Best
/// effort: an unreadable count returns `None` so a failed pre-measurement can
/// never make the whole object database look like capture growth. Git runs on
/// the blocking pool; capture's async executor never waits in `Command::output`.
async fn count_objects_size(repo_root: PathBuf) -> Option<u64> {
    tokio::task::spawn_blocking(move || count_objects_size_blocking(&repo_root))
        .await
        .ok()
        .flatten()
}

fn count_objects_size_blocking(repo_root: &std::path::Path) -> Option<u64> {
    let Ok(output) = Command::new("git")
        .current_dir(repo_root)
        .args(["count-objects", "-v"])
        .output()
    else {
        return None;
    };
    if !output.status.success() {
        return None;
    }
    let mut total = 0;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(value) = line
            .strip_prefix("size: ")
            .or_else(|| line.strip_prefix("size-pack: "))
        {
            total += value.trim().parse::<u64>().ok()?;
        }
    }
    Some(total)
}

#[cfg(test)]
mod tests {
    use super::{serialize_notices, CheckpointCaptureError, SnapshotNotice};

    #[test]
    fn public_capture_failures_never_retain_private_diagnostics() {
        let cases = [
            (
                CheckpointCaptureError::CheckoutMissing {
                    path: "/private/worktree".into(),
                },
                "/private/worktree",
            ),
            (
                CheckpointCaptureError::HollowCheckout {
                    path: "/secret/hollow".into(),
                },
                "/secret/hollow",
            ),
            (
                CheckpointCaptureError::GitLocked {
                    file: "/secret/repo/.git/index.lock".into(),
                },
                "/secret/repo/.git/index.lock",
            ),
            (
                CheckpointCaptureError::RefsVerifyFailed(
                    "permission denied in /secret/repo".into(),
                ),
                "/secret/repo",
            ),
            (
                CheckpointCaptureError::Internal(anyhow::anyhow!(
                    "git stderr exposed /secret/internal"
                )),
                "/secret/internal",
            ),
        ];

        for (error, private_sentinel) in cases {
            let failure = error.public_failure();
            assert!(!failure.code().contains(private_sentinel));
            assert!(!failure.detail().contains(private_sentinel));
        }
    }

    #[test]
    fn persisted_notice_json_preserves_every_snapshot_notice_family() {
        let notices = [
            SnapshotNotice::DirtySubmodule {
                paths: vec!["vendor/dirty".into()],
            },
            SnapshotNotice::EmbeddedRepo {
                paths: vec!["nested/repo".into()],
            },
            SnapshotNotice::PartialCaptureUntracked {
                paths: vec!["unreadable-new.txt".into()],
            },
            SnapshotNotice::PartialCaptureTracked {
                paths: vec!["unreadable-known.txt".into()],
            },
            SnapshotNotice::AbortedGitOperation {
                operation: "rebase".into(),
            },
        ];

        let encoded = serialize_notices(&notices).expect("serialize notice set");
        let decoded: serde_json::Value =
            serde_json::from_str(&encoded).expect("notice JSON remains valid");
        assert_eq!(
            decoded,
            serde_json::json!([
                {"kind": "dirty_submodule", "paths": ["vendor/dirty"]},
                {"kind": "embedded_repo", "paths": ["nested/repo"]},
                {"kind": "partial_capture_untracked", "paths": ["unreadable-new.txt"]},
                {"kind": "partial_capture_tracked", "paths": ["unreadable-known.txt"]},
                {"kind": "aborted_git_operation", "operation": "rebase"}
            ])
        );
        assert_eq!(serialize_notices(&[]), None);
    }
}
