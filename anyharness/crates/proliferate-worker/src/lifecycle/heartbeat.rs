use tokio::time::Duration;

use crate::{
    cloud_client::{heartbeat, CloudClient, HeartbeatResponse},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
};

pub struct RuntimeHealth {
    pub status: &'static str,
}

pub fn interval(config: &WorkerConfig) -> Duration {
    Duration::from_secs(config.heartbeat_interval_seconds.max(10))
}

/// Send one heartbeat and hand the ack back to the caller: the runtime loop
/// acts on `desiredVersions` (self-update convergence).
pub async fn send_once(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<HeartbeatResponse, WorkerError> {
    let health = runtime_health();
    let request = heartbeat::report(health.status);
    let response = cloud.heartbeat(&identity.worker_token, &request).await?;
    crate::observability::heartbeat_ack(&response);
    Ok(response)
}

pub fn runtime_health() -> RuntimeHealth {
    RuntimeHealth { status: "online" }
}
