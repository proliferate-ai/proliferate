use chrono::{Duration as ChronoDuration, Utc};

use crate::cloud_client::events::{EventBatch, UploadEventBatchRequest};
use crate::cloud_client::CloudClient;
use crate::error::Result;
use crate::identity::StoredIdentity;
use crate::store::outbox::OutboxBatchRecord;
use crate::store::Store;

pub fn enqueue_batch(store: &Store, batch: &EventBatch) -> Result<()> {
    let payload = serde_json::to_string(batch)?;
    store.insert_outbox_batch(&OutboxBatchRecord {
        batch_id: batch.batch_id.clone(),
        target_id: batch.target_id.clone(),
        session_id: batch.session_id.clone(),
        seq_start: batch.seq_start,
        seq_end: batch.seq_end,
        payload,
        attempt_count: 0,
        next_attempt_at: None,
    })
}

pub async fn upload_due_batches(
    store: &Store,
    cloud: &CloudClient,
    identity: &StoredIdentity,
) -> Result<()> {
    let batches = store.list_due_outbox_batches(25)?;
    for record in batches {
        let batch = serde_json::from_str::<EventBatch>(&record.payload)?;
        match cloud
            .upload_event_batch(&UploadEventBatchRequest {
                target_id: identity.target_id.clone(),
                worker_id: identity.worker_id.clone(),
                batch,
            })
            .await
        {
            Ok(response) if response.accepted => {
                store.delete_outbox_batch(&record.batch_id)?;
            }
            Ok(_) => {
                schedule_retry(store, &record)?;
            }
            Err(error) => {
                tracing::warn!(
                    batch_id = %record.batch_id,
                    %error,
                    "event batch upload failed"
                );
                schedule_retry(store, &record)?;
            }
        }
    }
    Ok(())
}

fn schedule_retry(store: &Store, record: &OutboxBatchRecord) -> Result<()> {
    let next_attempt_count = record.attempt_count + 1;
    let backoff_seconds = 2_i64.pow(next_attempt_count.min(6) as u32);
    let next_attempt_at = Utc::now() + ChronoDuration::seconds(backoff_seconds);
    store.mark_outbox_attempt(
        &record.batch_id,
        next_attempt_count,
        Some(&next_attempt_at.to_rfc3339()),
    )
}
