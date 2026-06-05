use chrono::{DateTime, Utc};
use tokio::time::{Duration, Instant};
use tracing::{debug, warn};

use crate::{
    anyharness_client::AnyHarnessClient,
    cloud_client::{
        revoked_jti::{WorkerRevokedJtiEntry, WorkerRevokedJtisResponse},
        CloudClient,
    },
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    store::{ReconcileDomain, WorkerStore},
};

const LEGACY_REVOKED_JTI_POLL_INTERVAL: Duration = Duration::from_secs(60);
const JWT_LEEWAY_SECONDS: i64 = 30;

#[derive(Default)]
pub(crate) struct LegacyRevokedJtiPoll {
    last_poll: Option<Instant>,
}

pub(crate) async fn apply_control_bundle(
    anyharness: Option<&AnyHarnessClient>,
    store: &WorkerStore,
    response: &WorkerRevokedJtisResponse,
    desired_revision: i64,
) -> Result<bool, WorkerError> {
    store.note_desired_revision(ReconcileDomain::RevokedJti, desired_revision)?;
    let Some(anyharness) = anyharness else {
        warn!("worker revoked-jti reconcile deferred because AnyHarness is unavailable");
        return Ok(false);
    };
    apply_entries(anyharness, &response.revoked_jtis).await?;
    store.save_revoked_jti_cursor(&response.next_cursor)?;
    if !response.has_more {
        store.mark_revision_applied(ReconcileDomain::RevokedJti, desired_revision)?;
    }
    debug!(
        revoked_count = response.revoked_jtis.len(),
        server_time = %response.server_time,
        next_cursor = %response.next_cursor,
        has_more = response.has_more,
        desired_revision,
        "applied control revoked direct-attach token ids"
    );
    Ok(!response.has_more)
}

pub(crate) async fn poll_legacy_if_due(
    anyharness: Option<&AnyHarnessClient>,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
    state: &mut LegacyRevokedJtiPoll,
) -> Result<(), WorkerError> {
    if state
        .last_poll
        .map(|last_poll| last_poll.elapsed() < LEGACY_REVOKED_JTI_POLL_INTERVAL)
        .unwrap_or(false)
    {
        return Ok(());
    }
    let Some(anyharness) = anyharness else {
        return Ok(());
    };
    let cursor = store.load_worker_control_state()?.revoked_jti_cursor;
    let response = cloud
        .list_revoked_jtis(&identity.worker_token, cursor.as_deref())
        .await?;
    apply_entries(anyharness, &response.revoked_jtis).await?;
    store.save_revoked_jti_cursor(&response.next_cursor)?;
    state.last_poll = if response.has_more {
        None
    } else {
        Some(Instant::now())
    };
    debug!(
        revoked_count = response.revoked_jtis.len(),
        server_time = %response.server_time,
        next_cursor = %response.next_cursor,
        has_more = response.has_more,
        "legacy-polled revoked direct-attach token ids"
    );
    Ok(())
}

async fn apply_entries(
    anyharness: &AnyHarnessClient,
    entries: &[WorkerRevokedJtiEntry],
) -> Result<(), WorkerError> {
    for entry in entries {
        if let Some(expires_at) = expires_at_timestamp(entry) {
            debug!(
                hash_key_id = %entry.hash_key_id,
                revoked_at = %entry.revoked_at,
                "pushing revoked direct-attach token id to AnyHarness"
            );
            anyharness
                .push_revoked_jtis(vec![entry.jti_hash.clone()], expires_at)
                .await?;
        }
    }
    Ok(())
}

fn expires_at_timestamp(entry: &WorkerRevokedJtiEntry) -> Option<i64> {
    DateTime::parse_from_rfc3339(&entry.expires_at)
        .map(|value| {
            value
                .with_timezone(&Utc)
                .timestamp()
                .saturating_add(JWT_LEEWAY_SECONDS)
        })
        .ok()
}
