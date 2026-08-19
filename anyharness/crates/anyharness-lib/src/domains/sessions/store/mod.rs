use crate::persistence::Db;

mod adapter_markers;
mod attachments;
mod background_work;
pub(crate) mod completion_deliveries;
mod events;
pub(crate) mod fork_operations;
pub(crate) mod idempotent_create;
pub(crate) mod link_completions;
mod links;
pub(crate) mod launch_intents;
mod live_config;
pub(crate) mod mobility;
mod notifications;
pub(crate) mod opencode_message_ids;
pub(in crate::domains::sessions) mod pending_prompts;
pub(crate) mod persisted_payloads;
pub(crate) mod sessions;
pub(crate) mod support_windows;
mod titles;
mod workflow_links;

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct SessionStore {
    db: Db,
}

impl SessionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub(crate) fn db(&self) -> Db {
        self.db.clone()
    }
}
