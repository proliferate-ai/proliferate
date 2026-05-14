use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, DesiredVersions},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    observability,
};

use super::{status, supervisor};

pub async fn reconcile(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    desired: &DesiredVersions,
) -> Result<(), WorkerError> {
    if !desired.should_update {
        return Ok(());
    }
    observability::update_requested(desired);
    cloud
        .report_update_status(&identity.worker_token, &status::staging())
        .await?;
    match supervisor::stage_update_request(config, desired) {
        Ok(staged) => {
            info!(
                component = staged.component.as_deref(),
                version = staged.version.as_deref(),
                path = %staged.path.display(),
                "supervisor update request written"
            );
            Ok(())
        }
        Err(error) => {
            warn!(?error, "failed to stage supervisor update request");
            let _ = cloud
                .report_update_status(&identity.worker_token, &status::failed(error.to_string()))
                .await;
            Err(error)
        }
    }
}
