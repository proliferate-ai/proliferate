//! Shared repo-root seeding for tests in other domains.
//!
//! Workspaces rows are FK-bound to a repo root, so most workspace-domain tests
//! need one seeded first. This goes through `RepoRootStore::insert` rather than
//! hand-written SQL so the fixture cannot drift from the real column list.

use super::model::RepoRootRecord;
use super::store::RepoRootStore;
use crate::persistence::Db;

/// The conventional single repo root (`repo-root-1`) the workspace-domain tests
/// attach their workspaces to.
pub(crate) fn seed_repo_root_1(db: &Db) {
    seed_repo_root(db, "repo-root-1", "/tmp/repo-root-1");
}

pub(crate) fn seed_repo_root(db: &Db, id: &str, path: &str) {
    RepoRootStore::new(db.clone())
        .insert(&RepoRootRecord {
            id: id.to_string(),
            kind: "external".to_string(),
            path: path.to_string(),
            display_name: None,
            default_branch: Some("main".to_string()),
            remote_provider: None,
            remote_owner: None,
            remote_repo_name: None,
            remote_url: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        })
        .expect("seed repo root");
}
