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
/// acts on `desiredVersions` (self-update convergence). `anyharness_version` is
/// what the runtime actually runs (a converged swap, else the boot-time
/// export), so the server row tracks it within one interval of a swap.
pub async fn send_once(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    anyharness_version: Option<String>,
) -> Result<HeartbeatResponse, WorkerError> {
    let health = runtime_health();
    let request = heartbeat::report(health.status, anyharness_version);
    let response = cloud.heartbeat(&identity.worker_token, &request).await?;
    crate::observability::heartbeat_ack(&response);
    Ok(response)
}

pub fn runtime_health() -> RuntimeHealth {
    RuntimeHealth { status: "online" }
}
