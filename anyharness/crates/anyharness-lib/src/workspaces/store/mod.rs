use crate::persistence::Db;

mod listings;
mod lookups;
mod mutations;
mod row;

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
