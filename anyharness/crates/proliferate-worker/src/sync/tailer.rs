use std::time::Duration;

use crate::anyharness_client::AnyHarnessClient;
use crate::error::Result;
use crate::identity::StoredIdentity;
use crate::store::Store;

use super::{event_batch, mapper, outbox};

#[derive(Debug, Clone)]
pub struct TailSession {
    pub workspace_id: Option<String>,
    pub session_id: String,
    pub after_seq: Option<i64>,
}

pub async fn tail_once(
    store: &Store,
    anyharness: &AnyHarnessClient,
    identity: &StoredIdentity,
    session: &TailSession,
) -> Result<()> {
    let envelopes = anyharness
        .stream_session_events_once(
            &session.session_id,
            session.after_seq,
            Duration::from_millis(500),
        )
        .await?;
    if envelopes.is_empty() {
        return Ok(());
    }

    let mut events = Vec::new();
    for envelope in &envelopes {
        events.push(mapper::map_session_event(
            &identity.target_id,
            session.workspace_id.as_deref(),
            envelope,
        )?);
    }
    for batch in event_batch::build_batches(&identity.target_id, &session.session_id, events) {
        outbox::enqueue_batch(store, &batch)?;
    }
    Ok(())
}
