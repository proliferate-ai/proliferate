use crate::persistence::Db;

mod attachments;
mod background_work;
mod events;
mod links;
mod live_config;
mod notifications;
mod pending_prompts;
pub(crate) mod persisted_payloads;
pub(crate) mod sessions;

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
}
