//! The process-local in-flight map: which repo roots and which target paths an
//! archive or unarchive is touching RIGHT NOW.
//!
//! Three consumers, all of which need "is someone working here?" answered
//! without consulting the filesystem:
//!
//! - **The deferred gc** must not run while a sibling workspace's capture is
//!   writing objects into the same repo root. A guard fed only by unarchives
//!   would let a gc race an ARCHIVE's capture.
//! - **The sweep's staging-sibling duty** must not delete a live restore's
//!   staging directory. Liveness cannot be inferred from mtimes here: a staging
//!   parent's mtime freezes at creation, so an hour-old-looking directory can
//!   belong to a restore that started thirty seconds ago.
//! - **Two unarchives claiming one path** must serialize. Both would otherwise
//!   pass the "no directory at the path" check and race to create a worktree at
//!   the same place; the loser could be raced into oblivion under the rule that
//!   a workspace's path is stable for its lifetime.
//!
//! Target-path claims are exclusive ACROSS workspaces and re-entrant WITHIN one:
//! the workspace's own gate lease already serializes its own flows, and a
//! same-workspace refusal would turn "phase 2 is still winding down" into a
//! spurious conflict for the Undo that just cancelled it.
//!
//! The map dies with the process, which is correct: a crashed flow leaves no
//! claim to clear, and what it DID leave on disk is exactly what the sweep
//! converges.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::domains::workspaces::path_identity::resolve_for_comparison;

#[derive(Default)]
struct InFlightState {
    /// Repo root → number of live flows touching it.
    repo_roots: HashMap<PathBuf, usize>,
    /// Target path → (owning workspace id, number of live flows).
    paths: HashMap<PathBuf, (String, usize)>,
}

#[derive(Clone, Default)]
pub struct InFlightPaths {
    state: Arc<Mutex<InFlightState>>,
}

/// Drop-guarded registration. Every early return, every `?`, and every panic
/// releases it, which is the only reason a flow that fails halfway does not
/// wedge its repo root against the gc forever.
pub struct InFlightGuard {
    state: Arc<Mutex<InFlightState>>,
    repo_root: PathBuf,
    target_path: PathBuf,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        let mut state = self.state.lock().expect("in-flight map poisoned");
        if let Some(count) = state.repo_roots.get_mut(&self.repo_root) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                state.repo_roots.remove(&self.repo_root);
            }
        }
        if let Some((_, count)) = state.paths.get_mut(&self.target_path) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                state.paths.remove(&self.target_path);
            }
        }
    }
}

impl InFlightPaths {
    /// Claim `repo_root` and `target_path` for `workspace_id`, or refuse
    /// because another workspace holds the target path.
    pub fn try_claim(
        &self,
        workspace_id: &str,
        repo_root: &Path,
        target_path: &Path,
    ) -> Option<InFlightGuard> {
        let repo_root = key(repo_root);
        let target_path = key(target_path);
        let mut state = self.state.lock().expect("in-flight map poisoned");
        match state.paths.get_mut(&target_path) {
            Some((owner, count)) if owner == workspace_id => *count += 1,
            Some(_) => return None,
            None => {
                state
                    .paths
                    .insert(target_path.clone(), (workspace_id.to_string(), 1));
            }
        }
        *state.repo_roots.entry(repo_root.clone()).or_insert(0) += 1;
        Some(InFlightGuard {
            state: self.state.clone(),
            repo_root,
            target_path,
        })
    }

    /// Is any archive or unarchive touching this repo root? The gc deferral's
    /// question.
    pub fn repo_root_busy(&self, repo_root: &Path) -> bool {
        let repo_root = key(repo_root);
        self.state
            .lock()
            .expect("in-flight map poisoned")
            .repo_roots
            .contains_key(&repo_root)
    }

    /// Is any flow working at or under this path? The staging-sibling duty's
    /// question: it holds a staging PARENT directory and must protect it while
    /// the restore whose target sits inside it is running.
    pub fn path_busy(&self, path: &Path) -> bool {
        let path = key(path);
        self.state
            .lock()
            .expect("in-flight map poisoned")
            .paths
            .keys()
            .any(|claimed| claimed == &path || claimed.starts_with(&path))
    }
}

/// Resolve before keying, for the same reason the claim gate resolves before
/// comparing: `/tmp` and `/private/tmp` spellings of one directory must land on
/// one map entry, or the exclusion the map exists to provide silently does not
/// apply.
fn key(path: &Path) -> PathBuf {
    resolve_for_comparison(path).unwrap_or_else(|| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::InFlightPaths;
    use std::path::Path;

    #[test]
    fn a_second_workspace_cannot_claim_a_held_target_path() {
        let map = InFlightPaths::default();
        let first = map
            .try_claim("workspace-1", Path::new("/repo"), Path::new("/wt/one"))
            .expect("first claim");

        assert!(
            map.try_claim("workspace-2", Path::new("/repo"), Path::new("/wt/one"))
                .is_none(),
            "two workspaces must serialize on one target path"
        );

        drop(first);
        assert!(
            map.try_claim("workspace-2", Path::new("/repo"), Path::new("/wt/one"))
                .is_some(),
            "the path frees when the winner finishes"
        );
    }

    #[test]
    fn the_same_workspace_may_reclaim_its_own_target_path() {
        let map = InFlightPaths::default();
        let _outer = map
            .try_claim("workspace-1", Path::new("/repo"), Path::new("/wt/one"))
            .expect("outer claim");

        assert!(
            map.try_claim("workspace-1", Path::new("/repo"), Path::new("/wt/one"))
                .is_some(),
            "a workspace's own winding-down flow must not conflict with its Undo"
        );
    }

    #[test]
    fn a_repo_root_reads_busy_only_while_a_flow_holds_it() {
        let map = InFlightPaths::default();
        assert!(!map.repo_root_busy(Path::new("/repo")));

        let guard = map
            .try_claim("workspace-1", Path::new("/repo"), Path::new("/wt/one"))
            .expect("claim");
        assert!(map.repo_root_busy(Path::new("/repo")));

        drop(guard);
        assert!(!map.repo_root_busy(Path::new("/repo")));
    }

    /// The staging duty's question: a claim on the restored worktree protects
    /// the staging PARENT that holds it.
    #[test]
    fn a_parent_directory_reads_busy_while_a_child_target_is_claimed() {
        let map = InFlightPaths::default();
        let _guard = map
            .try_claim(
                "workspace-1",
                Path::new("/repo"),
                Path::new("/wt/.proliferate-worktree-restore-abc/one"),
            )
            .expect("claim");

        assert!(map.path_busy(Path::new("/wt/.proliferate-worktree-restore-abc")));
        assert!(!map.path_busy(Path::new("/wt/.proliferate-worktree-restore-zzz")));
    }
}
