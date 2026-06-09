use super::store::WorkspaceStore;

mod metadata;

const MAX_WORKSPACE_DISPLAY_NAME_CHARS: usize = 160;

#[derive(Clone)]
pub struct WorkspaceService {
    store: WorkspaceStore,
}

impl WorkspaceService {
    pub fn new(store: WorkspaceStore) -> Self {
        Self { store }
    }
}
