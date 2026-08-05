use crate::persistence::Db;

mod access;
mod listings;
mod lookups;
mod mutations;
// `retention.rs`, not `retention_policy.rs`: the boundary checker classifies any
// `*_policy.rs` under domains/ as a policy file and holds it to policy purity,
// which a store can never satisfy. The pure policy keeps that name.
mod retention;
mod row;

pub use access::WorkspaceAccessStore;
pub use retention::WorktreeRetentionPolicyStore;

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
