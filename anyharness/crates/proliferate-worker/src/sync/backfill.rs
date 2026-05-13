use crate::anyharness_client::AnyHarnessClient;
use crate::error::Result;
use crate::identity::StoredIdentity;
use crate::store::cursors::SyncCursorRecord;
use crate::store::Store;

use super::{event_batch, mapper, outbox};

pub async fn backfill_session(
    store: &Store,
    anyharness: &AnyHarnessClient,
    identity: &StoredIdentity,
    workspace_id: Option<&str>,
    session_id: &str,
) -> Result<()> {
    let cursor = workspace_id
        .and_then(|workspace_id| store.load_cursor(workspace_id, session_id).ok().flatten());
    let after_seq = cursor.as_ref().map(|cursor| cursor.last_uploaded_seq);
    let envelopes = anyharness
        .list_session_events(session_id, after_seq, Some(100))
        .await?;
    let mut events = Vec::new();
    for envelope in &envelopes {
        events.push(mapper::map_session_event(
            &identity.target_id,
            workspace_id,
            envelope,
        )?);
    }
    for batch in event_batch::build_batches(&identity.target_id, session_id, events) {
        outbox::enqueue_batch(store, &batch)?;
        if let Some(workspace_id) = workspace_id {
            store.upsert_cursor(&SyncCursorRecord {
                workspace_id: workspace_id.to_string(),
                session_id: session_id.to_string(),
                last_uploaded_seq: batch.seq_end,
                last_ack_seq: cursor
                    .as_ref()
                    .map(|cursor| cursor.last_ack_seq)
                    .unwrap_or(0),
            })?;
        }
    }
    Ok(())
}
