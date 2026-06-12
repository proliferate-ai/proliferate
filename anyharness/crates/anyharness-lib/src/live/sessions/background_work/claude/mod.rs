use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::{BackgroundWorkOptions, BackgroundWorkUpdate};
use crate::domains::sessions::model::SessionBackgroundWorkRecord;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::sink::AcpToolPayload;

mod output;
mod registration;
mod watch;

#[cfg(test)]
mod tests;

pub(super) const BACKGROUND_WORK_FALLBACK_RESULT: &str =
    "Background subagent stopped updating before a final result was observed.";

pub fn detect_async_agent_registration(
    session_id: &str,
    source_agent_kind: &str,
    turn_id: &str,
    payload: &AcpToolPayload,
) -> Option<SessionBackgroundWorkRecord> {
    registration::detect_async_agent_registration(session_id, source_agent_kind, turn_id, payload)
}

pub fn spawn_async_agent_tracker(
    record: SessionBackgroundWorkRecord,
    store: SessionStore,
    updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
    options: BackgroundWorkOptions,
) -> JoinHandle<()> {
    watch::spawn_async_agent_tracker(record, store, updates_tx, options)
}
