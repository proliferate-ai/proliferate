pub mod credentials;
pub mod enrollment;
pub mod fingerprint;

use tracing::warn;

use crate::{
    cloud_client::CloudClient, config::WorkerConfig, error::WorkerError, inventory,
    store::WorkerStore,
};

use self::credentials::WorkerIdentity;

pub async fn ensure_enrolled(
    config: &WorkerConfig,
    store: &WorkerStore,
    cloud: &CloudClient,
) -> Result<WorkerIdentity, WorkerError> {
    if let Some(identity) = WorkerIdentity::load(store)? {
        clear_enrollment_token(config);
        return Ok(identity);
    }

    let request = enrollment::build_enroll_request(config, inventory::collect())?;
    let response = cloud.enroll(&request).await?;
    let identity = enrollment::identity_from_response(response);
    identity.save(store)?;
    clear_enrollment_token(config);
    Ok(identity)
}

fn clear_enrollment_token(config: &WorkerConfig) {
    if let Err(error) = config.clear_enrollment_token() {
        warn!(
            ?error,
            "failed to clear enrollment token from worker config"
        );
    }
}
