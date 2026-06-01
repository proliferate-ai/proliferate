use std::path::PathBuf;

use super::store::WorkspaceStore;

mod env;
mod identity;
mod metadata;
mod records;
mod worktrees;

#[cfg(test)]
mod tests;

const MAX_WORKSPACE_DISPLAY_NAME_CHARS: usize = 160;

#[derive(Clone)]
pub struct WorkspaceService {
    store: WorkspaceStore,
    runtime_home: PathBuf,
}

impl WorkspaceService {
    pub fn new(store: WorkspaceStore, runtime_home: PathBuf) -> Self {
        Self {
            store,
            runtime_home,
        }
    }
}
