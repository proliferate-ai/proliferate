pub mod desired;
pub mod staging;
pub mod supervisor;

use serde::{Deserialize, Serialize};

use crate::cloud_client::updates::UpdateStatusRequest;
use crate::cloud_client::CloudClient;
use crate::error::Result;
use crate::identity::StoredIdentity;
use crate::store::updates::UpdateStateRecord;
use crate::store::Store;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusReport {
    pub component: String,
    pub installed_version: Option<String>,
    pub desired_version: Option<String>,
    pub staged_path: Option<String>,
    pub status: String,
}

pub async fn reconcile_once(
    store: &Store,
    cloud: &CloudClient,
    identity: &StoredIdentity,
) -> Result<()> {
    let reports = desired::current_reports(store)?;
    if reports.is_empty() {
        return Ok(());
    }

    cloud
        .report_update_status(&UpdateStatusRequest {
            target_id: identity.target_id.clone(),
            worker_id: identity.worker_id.clone(),
            reports,
        })
        .await?;
    Ok(())
}

pub fn seed_installed_versions(store: &Store) -> Result<()> {
    store.upsert_update_state(&UpdateStateRecord {
        component: "proliferate-worker".to_string(),
        installed_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        desired_version: None,
        staged_path: None,
        status: "installed".to_string(),
    })
}
