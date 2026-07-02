pub mod credentials;
pub mod enrollment;
pub mod fingerprint;

use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, IntegrationGatewayConfig},
    config::WorkerConfig,
    error::WorkerError,
    store::WorkerStore,
};

use self::credentials::WorkerIdentity;

/// Ensure the worker is enrolled, returning its identity. The
/// `IntegrationGatewayConfig` is `Some` only when a fresh enroll occurred this
/// run (the caller then (re)writes the integration-gateway dotfile); it is
/// `None` when the identity was loaded from the store.
pub async fn ensure_enrolled(
    config: &WorkerConfig,
    store: &WorkerStore,
    cloud: &CloudClient,
) -> Result<(WorkerIdentity, Option<IntegrationGatewayConfig>), WorkerError> {
    if let Some(identity) = WorkerIdentity::load(store)? {
        clear_enrollment_token(config);
        return Ok((identity, None));
    }

    let request = enrollment::build_enroll_request(config)?;
    let response = cloud.enroll(&request).await?;
    info!(
        worker_id = %response.worker_id,
        heartbeat_interval_seconds = response.heartbeat_interval_seconds,
        "worker enrolled with cloud"
    );
    let (identity, integration_gateway) = enrollment::identity_from_response(response);
    identity.save(store)?;
    clear_enrollment_token(config);
    Ok((identity, Some(integration_gateway)))
}

fn clear_enrollment_token(config: &WorkerConfig) {
    if let Err(error) = config.clear_enrollment_token() {
        warn!(
            ?error,
            "failed to clear enrollment token from worker config"
        );
    }
}
