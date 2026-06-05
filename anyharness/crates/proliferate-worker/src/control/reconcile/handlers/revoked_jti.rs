use chrono::{DateTime, Utc};
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};

use crate::{
    anyharness_client::{health as anyharness_health, AnyHarnessClient},
    cloud_client::{revoked_jti::WorkerRevokedJtiEntry, CloudClient},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
};

const REVOKED_JTI_POLL_INTERVAL: Duration = Duration::from_secs(60);
const ERROR_SLEEP: Duration = Duration::from_secs(5);
const DRAIN_SLEEP: Duration = Duration::from_secs(1);
const JWT_LEEWAY_SECONDS: i64 = 30;

pub async fn run_loop(
    config: WorkerConfig,
    cloud: CloudClient,
    identity: WorkerIdentity,
) -> Result<(), WorkerError> {
    let Some(base_url) = config.anyharness_base_url.clone() else {
        warn!(
            "worker revoked-jti reconcile disabled because anyharness_base_url is not configured"
        );
        return Ok(());
    };
    let anyharness = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone())?;
    let mut cursor: Option<String> = None;
    loop {
        if !anyharness_health::probe(&anyharness).await {
            warn!("worker revoked-jti reconcile paused because anyharness health check failed");
            sleep(ERROR_SLEEP).await;
            continue;
        }
        match reconcile_once(&anyharness, &cloud, &identity, cursor.as_deref()).await {
            Ok(outcome) => {
                cursor = Some(outcome.next_cursor);
                sleep(if outcome.has_more {
                    DRAIN_SLEEP
                } else {
                    REVOKED_JTI_POLL_INTERVAL
                })
                .await;
            }
            Err(error) => {
                warn!(?error, "worker revoked-jti reconcile pass failed");
                sleep(ERROR_SLEEP).await;
            }
        }
    }
}

async fn reconcile_once(
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    cursor: Option<&str>,
) -> Result<RevokedJtiSyncOutcome, WorkerError> {
    let response = cloud
        .list_revoked_jtis(&identity.worker_token, cursor)
        .await?;
    let revoked_count = response.revoked_jtis.len();
    for entry in response.revoked_jtis {
        if let Some(expires_at) = expires_at_timestamp(&entry) {
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
    debug!(
        revoked_count,
        server_time = %response.server_time,
        next_cursor = %response.next_cursor,
        has_more = response.has_more,
        "reconciled revoked direct-attach token ids"
    );
    Ok(RevokedJtiSyncOutcome {
        next_cursor: response.next_cursor,
        has_more: response.has_more,
    })
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

struct RevokedJtiSyncOutcome {
    next_cursor: String,
    has_more: bool,
}
