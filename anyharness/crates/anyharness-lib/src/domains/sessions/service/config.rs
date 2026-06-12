use super::{GetLiveConfigSnapshotError, SessionService};
use crate::domains::sessions::live_config::snapshot_from_record;

impl SessionService {
    pub fn get_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<anyharness_contract::v1::SessionLiveConfigSnapshot>> {
        self.session_store
            .find_live_config_snapshot(session_id)?
            .as_ref()
            .map(snapshot_from_record)
            .transpose()
    }

    /// Batched form of [`Self::get_live_config_snapshot`] for list endpoints:
    /// one store query for the whole page, keyed by session id.
    pub fn get_live_config_snapshots(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<
        std::collections::HashMap<String, anyharness_contract::v1::SessionLiveConfigSnapshot>,
    > {
        self.session_store
            .find_live_config_snapshots(session_ids)?
            .into_iter()
            .map(|(session_id, record)| Ok((session_id, snapshot_from_record(&record)?)))
            .collect()
    }

    pub fn get_live_config_snapshot_checked(
        &self,
        session_id: &str,
    ) -> Result<
        Option<anyharness_contract::v1::SessionLiveConfigSnapshot>,
        GetLiveConfigSnapshotError,
    > {
        if self
            .session_store
            .find_by_id(session_id)
            .map_err(GetLiveConfigSnapshotError::Internal)?
            .is_none()
        {
            return Err(GetLiveConfigSnapshotError::SessionNotFound(
                session_id.to_string(),
            ));
        }

        self.get_live_config_snapshot(session_id)
            .map_err(GetLiveConfigSnapshotError::Internal)
    }
}
