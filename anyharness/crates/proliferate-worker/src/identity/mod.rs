pub mod credentials;
pub mod enrollment;
pub mod fingerprint;

use crate::cloud_client::CloudClient;
use crate::config::WorkerConfig;
use crate::error::Result;
use crate::inventory::InventoryReport;
use crate::store::Store;

pub use credentials::StoredIdentity;

pub async fn ensure_identity(
    store: &Store,
    config: &WorkerConfig,
    cloud: &CloudClient,
    inventory: &InventoryReport,
) -> Result<StoredIdentity> {
    if let Some(identity) = store.load_identity()? {
        tracing::info!(
            target_id = %identity.target_id,
            worker_id = %identity.worker_id,
            "loaded persisted worker identity"
        );
        return Ok(identity);
    }

    let identity = enrollment::enroll(config, cloud, inventory).await?;
    store.save_identity(&identity)?;
    tracing::info!(
        target_id = %identity.target_id,
        worker_id = %identity.worker_id,
        "persisted enrolled worker identity"
    );
    Ok(identity)
}
