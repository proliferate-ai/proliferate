use tokio::time::{sleep, Duration};
use tracing::warn;

use crate::{
    anyharness_client::{health as anyharness_health, AnyHarnessClient},
    cloud_client::{heartbeat, CloudClient},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    lifecycle::self_update,
    versions,
};

pub struct RuntimeHealth {
    pub status: &'static str,
    pub status_detail: Option<String>,
    pub anyharness_version: Option<String>,
}

pub fn interval(config: &WorkerConfig) -> Duration {
    Duration::from_secs(config.heartbeat_interval_seconds.max(10))
}

pub async fn send_once(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    let health = runtime_health(config).await;
    let anyharness_version = health.anyharness_version.clone();
    let worker_version = versions::worker_version();
    let supervisor_version = versions::supervisor_version_or_configured(&config.supervisor_version);
    let request = heartbeat::report(
        health.status,
        health.status_detail.clone(),
        worker_version.clone(),
        anyharness_version.clone(),
        supervisor_version.clone(),
    );
    let response = cloud.heartbeat(&identity.worker_token, &request).await?;
    crate::observability::heartbeat_ack(&response);
    let installed = self_update::InstalledVersions {
        anyharness_version,
        worker_version,
        supervisor_version,
    };
    if let Err(error) = self_update::reconcile(
        config,
        cloud,
        identity,
        &response.desired_versions,
        &installed,
    )
    .await
    {
        warn!(?error, "worker update reconciliation failed");
    }
    Ok(())
}

pub async fn runtime_health(config: &WorkerConfig) -> RuntimeHealth {
    if config.anyharness_base_url.is_none() {
        return RuntimeHealth {
            status: "online",
            status_detail: None,
            anyharness_version: None,
        };
    }
    match anyharness_version(config).await {
        Some(version) => RuntimeHealth {
            status: "online",
            status_detail: None,
            anyharness_version: Some(version),
        },
        None => RuntimeHealth {
            status: "degraded",
            status_detail: Some("AnyHarness health probe failed.".to_string()),
            anyharness_version: None,
        },
    }
}

async fn anyharness_version(config: &WorkerConfig) -> Option<String> {
    let base_url = config.anyharness_base_url.clone()?;
    let client = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone()).ok()?;
    for attempt in 0..20 {
        if let Some(version) = anyharness_health::version(&client).await {
            return Some(version);
        }
        if attempt < 19 {
            sleep(Duration::from_millis(500)).await;
        }
    }
    None
}
