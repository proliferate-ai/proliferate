use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::StatusCode;
use tokio::time::{sleep, Duration, Instant};
use tracing::{debug, info, warn};

use crate::{
    anyharness_client::{
        events::SessionEventEnvelope, health as anyharness_health, AnyHarnessClient,
    },
    cloud_client::{
        events::{EventBatchRequest, ProjectionGapRequest, WorkerSessionEventEnvelope},
        exposures::WorkerExposureSnapshot as CloudWorkerExposureSnapshot,
        CloudClient,
    },
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    store::{
        ProjectionCursor, ProjectionCursorUpsert,
        WorkerExposureSnapshot as CachedWorkerExposureSnapshot, WorkerStore,
    },
};

const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(500);
const EXPOSURE_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const WORKSPACE_DISCOVERY_INTERVAL: Duration = Duration::from_secs(5);
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
    let mut exposure_cache = ExposureRefreshState::default();
    loop {
        if !anyharness_health::probe(&anyharness).await {
            warn!("worker event sync paused because anyharness health check failed");
            sleep(ERROR_SLEEP).await;
            continue;
        }
        if let Err(error) =
            sync_once(&store, &anyharness, &cloud, &identity, &mut exposure_cache).await
        {
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
    exposure_cache: &mut ExposureRefreshState,
) -> Result<(), WorkerError> {
    let exposures =
        refresh_exposure_cache_if_needed(store, cloud, identity, exposure_cache).await?;
    discover_workspace_sessions(store, anyharness, cloud, identity, &exposures).await;
    let cursors = store.list_active_projection_cursors()?;
    for cursor in cursors {
        if let Err(error) =
            sync_projection_cursor(store, anyharness, cloud, identity, &cursor).await
        {
            warn!(
                ?error,
                exposure_id = %cursor.exposure_id,
                session_projection_id = %cursor.session_projection_id,
                session_id = %cursor.anyharness_session_id,
                "worker event sync failed for projection cursor"
            );
        }
    }
    Ok(())
}

async fn refresh_exposure_cache_if_needed(
    store: &WorkerStore,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    exposure_cache: &mut ExposureRefreshState,
) -> Result<Vec<CachedWorkerExposureSnapshot>, WorkerError> {
    let state = store.load_worker_control_state()?;
    if !state.legacy_exposure_polling_enabled {
        return store.list_cached_exposure_snapshots();
    }
    if !exposure_cache.should_refresh() {
        return store.list_cached_exposure_snapshots();
    }
    let response = match cloud.list_worker_exposures(&identity.worker_token).await {
        Ok(response) => response,
        Err(error)
            if state.exposure_cache_initialized && is_retryable_exposure_refresh_error(&error) =>
        {
            warn!(
                ?error,
                "worker exposure refresh failed; reusing last exposure snapshot"
            );
            return store.list_cached_exposure_snapshots();
        }
        Err(error) => return Err(error),
    };
    reconcile_exposure_snapshots(store, &response.exposures)?;
    exposure_cache.last_refresh = Some(Instant::now());
    store.list_cached_exposure_snapshots()
}

pub(crate) fn reconcile_exposure_snapshots(
    store: &WorkerStore,
    exposures: &[CloudWorkerExposureSnapshot],
) -> Result<(), WorkerError> {
    let cached_exposures = exposures
        .iter()
        .map(cached_exposure_snapshot)
        .collect::<Vec<_>>();
    let max_revision = exposures
        .iter()
        .filter_map(|snapshot| snapshot.revision)
        .max();
    let first_target_id = exposures
        .first()
        .map(|snapshot| snapshot.target_id.as_str());
    let first_cloud_workspace_id = exposures
        .first()
        .map(|snapshot| snapshot.cloud_workspace_id.as_str());
    let exposure_count = exposures.len();
    let workspace_exposure_count = exposures
        .iter()
        .filter(|snapshot| snapshot.anyharness_session_id.is_none())
        .count();
    let cursors = exposures
        .iter()
        .map(cached_exposure_snapshot)
        .filter_map(|snapshot| projection_cursor_upsert(&snapshot))
        .collect::<Vec<_>>();
    let session_cursor_count = cursors.len();
    store.reconcile_exposure_snapshots(&cached_exposures, &cursors)?;
    debug!(
        exposure_count,
        workspace_exposure_count,
        session_cursor_count,
        max_revision,
        first_target_id,
        first_cloud_workspace_id,
        "reconciled worker projection cursors"
    );
    Ok(())
}

fn is_retryable_exposure_refresh_error(error: &WorkerError) -> bool {
    match error {
        WorkerError::Cloud { status, .. } => {
            status.is_server_error()
                || *status == StatusCode::REQUEST_TIMEOUT
                || *status == StatusCode::TOO_MANY_REQUESTS
        }
        WorkerError::Http(source) => source.is_timeout() || source.is_connect(),
        _ => false,
    }
}

#[derive(Default)]
struct ExposureRefreshState {
    last_refresh: Option<Instant>,
}

impl ExposureRefreshState {
    fn should_refresh(&self) -> bool {
        self.last_refresh
            .map(|last_refresh| last_refresh.elapsed() >= EXPOSURE_REFRESH_INTERVAL)
            .unwrap_or(true)
    }
}

async fn discover_workspace_sessions(
    store: &WorkerStore,
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    exposures: &[CachedWorkerExposureSnapshot],
) {
    let min_interval_ms = duration_ms(WORKSPACE_DISCOVERY_INTERVAL);
    for exposure in exposures {
        if let Err(error) = discover_workspace_sessions_for_exposure(
            store,
            anyharness,
            cloud,
            identity,
            exposure,
            min_interval_ms,
        )
        .await
        {
            warn!(
                ?error,
                exposure_id = %exposure.exposure_id,
                cloud_workspace_id = %exposure.cloud_workspace_id,
                workspace_id = %exposure.anyharness_workspace_id,
                "worker workspace session discovery failed"
            );
        }
    }
}

async fn discover_workspace_sessions_for_exposure(
    store: &WorkerStore,
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    exposure: &CachedWorkerExposureSnapshot,
    min_interval_ms: i64,
) -> Result<(), WorkerError> {
    if exposure.status != "active" || exposure.anyharness_session_id.is_some() {
        return Ok(());
    }
    let workspace_id = exposure.anyharness_workspace_id.as_str();
    if workspace_id.is_empty() {
        return Ok(());
    }
    if !store.should_discover_workspace(
        &exposure.exposure_id,
        workspace_id,
        now_unix_ms(),
        min_interval_ms,
    )? {
        return Ok(());
    }
    let snapshot = anyharness.backfill_snapshot(Some(workspace_id)).await?;
    let known_sessions = store.list_known_session_ids_for_workspace(workspace_id)?;
    let missing_session_count = snapshot
        .sessions
        .iter()
        .filter(|session| session.workspace_id == workspace_id)
        .filter(|session| !known_sessions.contains(&session.id))
        .count();
    debug!(
        exposure_id = %exposure.exposure_id,
        cloud_workspace_id = %exposure.cloud_workspace_id,
        workspace_id,
        snapshot_session_count = snapshot.sessions.len(),
        known_session_count = known_sessions.len(),
        missing_session_count,
        "worker checked exposed workspace for unmapped sessions"
    );
    if missing_session_count == 0 {
        return Ok(());
    }
    info!(
        exposure_id = %exposure.exposure_id,
        cloud_workspace_id = %exposure.cloud_workspace_id,
        workspace_id,
        missing_session_count,
        "worker discovered unmapped sessions for exposed workspace"
    );
    super::backfill::backfill_exposed_workspace(
        store,
        anyharness,
        cloud,
        identity,
        Some(workspace_id),
    )
    .await?;
    Ok(())
}

async fn sync_projection_cursor(
    store: &WorkerStore,
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    cursor: &ProjectionCursor,
) -> Result<(), WorkerError> {
    debug!(
        exposure_id = %cursor.exposure_id,
        session_projection_id = %cursor.session_projection_id,
        session_id = %cursor.anyharness_session_id,
        projection_level = %cursor.projection_level,
        commandable = cursor.commandable,
        last_uploaded_seq = cursor.last_uploaded_seq,
        last_ack_seq = cursor.last_ack_seq,
        "tailing active worker projection cursor"
    );
    let events = anyharness
        .list_session_events(
            &cursor.anyharness_session_id,
            cursor.last_uploaded_seq,
            Some(ANYHARNESS_EVENT_LIMIT),
        )
        .await?;
    if events.is_empty() {
        return Ok(());
    }
    let event_count = events.len();
    let first_seq = events.first().map(|event| event.seq);
    let last_seq = events.last().map(|event| event.seq);
    info!(
        exposure_id = %cursor.exposure_id,
        session_projection_id = %cursor.session_projection_id,
        session_id = %cursor.anyharness_session_id,
        last_uploaded_seq = cursor.last_uploaded_seq,
        event_count,
        first_seq = ?first_seq,
        last_seq = ?last_seq,
        "worker fetched anyharness events for projection cursor"
    );
    if let Some(gap) = first_sequence_gap(cursor.last_uploaded_seq, &events) {
        let response = cloud
            .report_projection_gap(
                &identity.worker_token,
                &ProjectionGapRequest {
                    exposure_id: cursor.exposure_id.clone(),
                    session_projection_id: cursor.session_projection_id.clone(),
                    session_id: cursor.anyharness_session_id.clone(),
                    expected_seq: gap.expected_seq,
                    first_observed_seq: gap.first_observed_seq,
                    last_uploaded_seq: cursor.last_uploaded_seq,
                },
            )
            .await?;
        store.record_projection_cursor_gap(
            &cursor.session_projection_id,
            gap.expected_seq,
            gap.first_observed_seq,
        )?;
        warn!(
            exposure_id = %cursor.exposure_id,
            session_id = %cursor.anyharness_session_id,
            expected_seq = gap.expected_seq,
            first_observed_seq = gap.first_observed_seq,
            cloud_updated = response.updated,
            "worker event sync paused for projection cursor after sequence gap"
        );
        return Ok(());
    }
    let request = EventBatchRequest {
        events: events
            .into_iter()
            .map(|event| worker_event(cursor, event))
            .collect(),
    };
    let upload_event_count = request.events.len();
    let response = cloud
        .upload_event_batch(&identity.worker_token, &request)
        .await?;
    let session_ack_count = response.session_acks.len();
    info!(
        exposure_id = %cursor.exposure_id,
        session_projection_id = %cursor.session_projection_id,
        session_id = %cursor.anyharness_session_id,
        event_count = upload_event_count,
        accepted_events = response.accepted_events,
        duplicate_events = response.duplicate_events,
        live_only_events = response.live_only_events,
        session_ack_count,
        "uploaded worker event batch"
    );
    for ack in response.session_acks {
        store.update_projection_cursor_ack(&ack.session_id, ack.last_contiguous_seq)?;
    }
    Ok(())
}

fn cached_exposure_snapshot(
    snapshot: &CloudWorkerExposureSnapshot,
) -> CachedWorkerExposureSnapshot {
    CachedWorkerExposureSnapshot {
        exposure_id: snapshot.exposure_id.clone(),
        target_id: snapshot.target_id.clone(),
        cloud_workspace_id: snapshot.cloud_workspace_id.clone(),
        session_projection_id: snapshot.session_projection_id.clone(),
        anyharness_workspace_id: snapshot.anyharness_workspace_id.clone(),
        anyharness_session_id: snapshot.anyharness_session_id.clone(),
        projection_level: snapshot.projection_level.clone(),
        commandable: snapshot.commandable,
        status: snapshot.status.clone(),
        revision: snapshot.revision,
        last_uploaded_seq: snapshot.last_uploaded_seq,
    }
}

fn projection_cursor_upsert(
    snapshot: &CachedWorkerExposureSnapshot,
) -> Option<ProjectionCursorUpsert> {
    Some(ProjectionCursorUpsert {
        exposure_id: snapshot.exposure_id.clone(),
        session_projection_id: snapshot.session_projection_id.clone()?,
        anyharness_workspace_id: snapshot.anyharness_workspace_id.clone(),
        anyharness_session_id: snapshot.anyharness_session_id.clone()?,
        projection_level: snapshot.projection_level.clone(),
        commandable: snapshot.commandable,
        last_uploaded_seq: snapshot.last_uploaded_seq,
        status: snapshot.status.clone(),
    })
}

fn duration_ms(duration: Duration) -> i64 {
    duration.as_millis().try_into().unwrap_or(i64::MAX)
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration_ms(duration))
        .unwrap_or(0)
}

fn worker_event(
    cursor: &ProjectionCursor,
    event: SessionEventEnvelope,
) -> WorkerSessionEventEnvelope {
    WorkerSessionEventEnvelope {
        workspace_id: Some(cursor.anyharness_workspace_id.clone()),
        session_id: event.session_id,
        seq: event.seq,
        timestamp: event.timestamp,
        turn_id: event.turn_id,
        item_id: event.item_id,
        event: event.event,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EventSequenceGap {
    expected_seq: i64,
    first_observed_seq: i64,
}

fn first_sequence_gap(
    last_uploaded_seq: i64,
    events: &[SessionEventEnvelope],
) -> Option<EventSequenceGap> {
    let mut seqs = events
        .iter()
        .map(|event| event.seq)
        .filter(|seq| *seq > last_uploaded_seq)
        .collect::<Vec<_>>();
    seqs.sort_unstable();
    seqs.dedup();
    let mut expected_seq = last_uploaded_seq + 1;
    for seq in seqs {
        if seq > expected_seq {
            return Some(EventSequenceGap {
                expected_seq,
                first_observed_seq: seq,
            });
        }
        if seq == expected_seq {
            expected_seq += 1;
        }
    }
    None
}

#[cfg(test)]
#[path = "tailer_tests.rs"]
mod tailer_tests;
