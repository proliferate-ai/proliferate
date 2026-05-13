use crate::cloud_client::inventory::EnrollmentInventory;
use crate::cloud_client::{CloudClient, EnrollRequest};
use crate::config::WorkerConfig;
use crate::error::{Result, WorkerError};
use crate::inventory::InventoryReport;

use super::credentials::StoredIdentity;
use super::fingerprint::{new_install_id, target_fingerprint};

pub async fn enroll(
    config: &WorkerConfig,
    cloud: &CloudClient,
    inventory: &InventoryReport,
) -> Result<StoredIdentity> {
    let Some(enrollment_token) = config.cloud.enrollment_token.clone() else {
        return Err(WorkerError::Identity(
            "first run requires PROLIFERATE_WORKER_ENROLLMENT_TOKEN or cloud.enrollment_token"
                .into(),
        ));
    };

    let install_id = new_install_id();
    let response = cloud
        .enroll(&EnrollRequest {
            enrollment_token,
            install_id: install_id.clone(),
            target_fingerprint: target_fingerprint(),
            inventory: EnrollmentInventory {
                report: inventory.clone(),
            },
        })
        .await?;

    Ok(StoredIdentity {
        target_id: response.target_id,
        worker_id: response.worker_id,
        install_id,
        cloud_base_url: response
            .cloud_base_url
            .unwrap_or_else(|| config.cloud.base_url.to_string()),
        credential_kind: response
            .credential_kind
            .unwrap_or_else(|| "bearer".to_string()),
        credential_value: response.worker_token,
    })
}
