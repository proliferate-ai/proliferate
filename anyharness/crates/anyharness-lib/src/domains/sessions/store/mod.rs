use crate::persistence::Db;

mod attachments;
mod background_work;
mod events;
pub(crate) mod idempotent_create;
pub(crate) mod link_completions;
mod links;
mod live_config;
mod mobility;
mod notifications;
mod pending_prompts;
pub(crate) mod persisted_payloads;
pub(crate) mod sessions;

pub(crate) use sessions::{
    SessionSearchCursor, SessionSearchQuery, SESSION_SEARCH_DEFAULT_LIMIT, SESSION_SEARCH_MAX_LIMIT,
};

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
