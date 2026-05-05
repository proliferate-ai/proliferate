use std::time::Instant;
use uuid::Uuid;

use super::model::{CreateRepoRootInput, RepoRootRecord};
use super::store::RepoRootStore;

#[derive(Clone)]
pub struct RepoRootService {
    store: RepoRootStore,
}

impl RepoRootService {
    pub fn new(store: RepoRootStore) -> Self {
        Self { store }
    }

    pub fn get_repo_root(&self, repo_root_id: &str) -> anyhow::Result<Option<RepoRootRecord>> {
        self.store.find_by_id(repo_root_id)
    }

    pub fn find_by_path(&self, path: &str) -> anyhow::Result<Option<RepoRootRecord>> {
        self.store.find_by_path(path)
    }

    pub fn list_repo_roots(&self) -> anyhow::Result<Vec<RepoRootRecord>> {
        let started = Instant::now();
        let records = self.store.list_all()?;
        tracing::info!(
            repo_root_count = records.len(),
            elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] repo_root.service.list.store_loaded"
        );
        Ok(records)
    }

    pub fn ensure_repo_root(&self, input: CreateRepoRootInput) -> anyhow::Result<RepoRootRecord> {
        if let Some(existing) = self.store.find_by_path(&input.path)? {
            return Ok(existing);
        }

        let now = chrono::Utc::now().to_rfc3339();
        let record = RepoRootRecord {
            id: Uuid::new_v4().to_string(),
            kind: input.kind,
            path: input.path,
            display_name: input.display_name,
            default_branch: input.default_branch,
            remote_provider: input.remote_provider,
            remote_owner: input.remote_owner,
            remote_repo_name: input.remote_repo_name,
            remote_url: input.remote_url,
            created_at: now.clone(),
            updated_at: now,
        };

        match self.store.insert(&record) {
            Ok(()) => Ok(record),
            Err(error) if is_unique_violation(&error) => {
                self.store.find_by_path(&record.path)?.ok_or(error)
            }
            Err(error) => Err(error),
        }
    }

    pub fn update_default_branch(
        &self,
        repo_root_id: &str,
        default_branch: Option<&str>,
    ) -> anyhow::Result<Option<RepoRootRecord>> {
        let existing = self.store.find_by_id(repo_root_id)?;
        let Some(existing) = existing else {
            return Ok(None);
        };
        let updated_at = chrono::Utc::now().to_rfc3339();
        self.store
            .update_default_branch(repo_root_id, default_branch, &updated_at)?;
        Ok(Some(RepoRootRecord {
            default_branch: default_branch.map(str::to_string),
            updated_at,
            ..existing
        }))
    }
}

fn is_unique_violation(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<rusqlite::Error>()
        .and_then(|inner| match inner {
            rusqlite::Error::SqliteFailure(code, _) => Some(code.extended_code),
            _ => None,
        })
        .is_some_and(|code| {
            code == rusqlite::ffi::SQLITE_CONSTRAINT
                || code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                || code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
        })
}
