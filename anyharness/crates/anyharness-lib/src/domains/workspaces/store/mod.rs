use crate::persistence::Db;

mod access;
mod listings;
mod lookups;
mod mutations;
mod row;

pub use access::WorkspaceAccessStore;

pub(crate) use access::delete_workspace_access_modes_in_tx;
pub(crate) use mutations::delete_workspace_row_in_tx;

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct WorkspaceStore {
    db: Db,
}

impl WorkspaceStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}
