use tokio::time::Duration;

use crate::{
    cloud_client::{heartbeat, CloudClient},
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

pub async fn send_once(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    let health = runtime_health();
    let request = heartbeat::report(health.status);
    let response = cloud.heartbeat(&identity.worker_token, &request).await?;
    crate::observability::heartbeat_ack(&response);
    Ok(())
}

pub fn runtime_health() -> RuntimeHealth {
    RuntimeHealth { status: "online" }
}
