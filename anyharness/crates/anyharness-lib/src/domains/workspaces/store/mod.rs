use crate::persistence::Db;

mod listings;
mod lookups;
mod mutations;
mod row;

pub(crate) use mutations::delete_workspace_row_in_tx;
pub(crate) use row::insert_workspace_with_materialization_base_commit;

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
