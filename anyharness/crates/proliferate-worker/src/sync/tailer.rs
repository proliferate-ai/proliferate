use tokio::time::{sleep, Duration};
use tracing::{debug, warn};

use crate::{
    anyharness_client::{
        events::SessionEventEnvelope, health as anyharness_health, AnyHarnessClient,
    },
    cloud_client::{
        events::{EventBatchRequest, WorkerSessionEventEnvelope},
        CloudClient,
    },
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    store::{SyncSession, WorkerStore},
};

const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(500);
const ERROR_SLEEP: Duration = Duration::from_secs(5);
const ANYHARNESS_EVENT_LIMIT: usize = 100;

pub async fn run_loop(
    config: WorkerConfig,
    cloud: CloudClient,
    identity: WorkerIdentity,
    store: WorkerStore,
) -> Result<(), WorkerError> {
    let Some(base_url) = config.anyharness_base_url.clone() else {
        warn!("worker event sync disabled because anyharness_base_url is not configured");
        return Ok(());
    };
    let anyharness = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone())?;
    loop {
        if !anyharness_health::probe(&anyharness).await {
            warn!("worker event sync paused because anyharness health check failed");
            sleep(ERROR_SLEEP).await;
            continue;
        }
        if let Err(error) = sync_once(&store, &anyharness, &cloud, &identity).await {
            warn!(?error, "worker event sync pass failed");
            sleep(ERROR_SLEEP).await;
            continue;
        }
        sleep(EVENT_POLL_INTERVAL).await;
    }
}

async fn sync_once(
    store: &WorkerStore,
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    let sessions = store.list_sync_sessions()?;
    for session in sessions {
        if let Err(error) = sync_session(store, anyharness, cloud, identity, &session).await {
            warn!(
                ?error,
                session_id = %session.session_id,
                "worker event sync failed for session"
            );
        }
    }
    Ok(())
}

async fn sync_session(
    store: &WorkerStore,
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    session: &SyncSession,
) -> Result<(), WorkerError> {
    let events = anyharness
        .list_session_events(&session.session_id, session.last_uploaded_seq, None)
        .await?;
    if events.is_empty() {
        return Ok(());
    }
    let request = EventBatchRequest {
        events: events
            .into_iter()
            .take(ANYHARNESS_EVENT_LIMIT)
            .map(|event| worker_event(session, event))
            .collect(),
    };
    let response = cloud
        .upload_event_batch(&identity.worker_token, &request)
        .await?;
    debug!(
        accepted_events = response.accepted_events,
        duplicate_events = response.duplicate_events,
        live_only_events = response.live_only_events,
        session_ack_count = response.session_acks.len(),
        "uploaded worker event batch"
    );
    for ack in response.session_acks {
        store.update_sync_cursor(&ack.session_id, ack.last_contiguous_seq)?;
    }
    Ok(())
}

fn worker_event(session: &SyncSession, event: SessionEventEnvelope) -> WorkerSessionEventEnvelope {
    WorkerSessionEventEnvelope {
        workspace_id: session.workspace_id.clone(),
        session_id: event.session_id,
        seq: event.seq,
        timestamp: event.timestamp,
        turn_id: event.turn_id,
        item_id: event.item_id,
        event: event.event,
    }
}
