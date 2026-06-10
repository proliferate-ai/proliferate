//! The one place HTTP learns catalog sync failures: From<SyncError> for
//! ApiError. Every rejection leaves the active catalog unchanged.

use super::error::ApiError;
use crate::domains::agents::catalog::sync::SyncError;

impl From<SyncError> for ApiError {
    fn from(error: SyncError) -> Self {
        match error {
            SyncError::InvalidUtf8(_) | SyncError::InvalidCatalog(_) => {
                ApiError::bad_request(error.to_string(), "AGENT_CATALOG_REJECTED")
            }
        }
    }
}
