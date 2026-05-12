use crate::sessions::live_config::snapshot_from_record;
use crate::sessions::model::{SessionEventRecord, SessionRawNotificationRecord, SessionRecord};
use crate::sessions::store::SessionStore;

use super::{GetLiveConfigSnapshotError, SessionService, UpdateSessionTitleError};

impl SessionService {
    pub fn get_session(&self, id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.session_store.find_by_id(id)
    }

    pub fn list_sessions(
        &self,
        workspace_id: Option<&str>,
        include_dismissed: bool,
    ) -> anyhow::Result<Vec<SessionRecord>> {
        match (workspace_id, include_dismissed) {
            (Some(wid), false) => self.session_store.list_visible_by_workspace(wid),
            (Some(wid), true) => self.session_store.list_with_dismissed_by_workspace(wid),
            (None, false) => self.session_store.list_visible_all(),
            (None, true) => self.session_store.list_with_dismissed_all(),
        }
    }

    pub fn list_session_event_records(
        &self,
        session_id: &str,
        after_seq: Option<i64>,
        before_seq: Option<i64>,
        limit: Option<i64>,
        turn_limit: Option<i64>,
    ) -> anyhow::Result<Option<Vec<SessionEventRecord>>> {
        if self.session_store.find_by_id(session_id)?.is_none() {
            return Ok(None);
        }

        match (after_seq, before_seq, limit, turn_limit) {
            (Some(_), Some(_), _, _) | (Some(_), _, _, Some(_)) => {
                anyhow::bail!("after_seq cannot be combined with before_seq or turn_limit")
            }
            (Some(seq), None, Some(limit), None) => self
                .session_store
                .list_events_after_limited(session_id, seq, limit)
                .map(Some),
            (Some(seq), None, None, None) => self
                .session_store
                .list_events_after(session_id, seq)
                .map(Some),
            (None, Some(seq), Some(limit), Some(turn_limit)) => self
                .session_store
                .list_events_before_for_latest_turns(session_id, seq, turn_limit, limit)
                .map(Some),
            (None, Some(seq), Some(limit), None) => self
                .session_store
                .list_events_before_limited(session_id, seq, limit)
                .map(Some),
            (None, Some(seq), None, Some(turn_limit)) => self
                .session_store
                .list_events_before_for_latest_turns(session_id, seq, turn_limit, 5_000)
                .map(Some),
            (None, Some(seq), None, None) => self
                .session_store
                .list_events_before_limited(session_id, seq, 5_000)
                .map(Some),
            (None, None, Some(limit), Some(turn_limit)) => self
                .session_store
                .list_events_for_latest_turns(session_id, turn_limit, limit)
                .map(Some),
            (None, None, None, Some(turn_limit)) => self
                .session_store
                .list_events_for_latest_turns(session_id, turn_limit, 5_000)
                .map(Some),
            (None, None, Some(limit), None) => self
                .session_store
                .list_events_limited(session_id, limit)
                .map(Some),
            (None, None, None, None) => self.session_store.list_events(session_id).map(Some),
        }
    }

    pub fn list_session_raw_notification_records(
        &self,
        session_id: &str,
        after_seq: Option<i64>,
    ) -> anyhow::Result<Option<Vec<SessionRawNotificationRecord>>> {
        if self.session_store.find_by_id(session_id)?.is_none() {
            return Ok(None);
        }

        match after_seq {
            Some(seq) => self
                .session_store
                .list_raw_notifications_after(session_id, seq)
                .map(Some),
            None => self
                .session_store
                .list_raw_notifications(session_id)
                .map(Some),
        }
    }

    pub fn store(&self) -> &SessionStore {
        &self.session_store
    }

    pub fn attachment_storage(
        &self,
    ) -> &crate::sessions::attachment_storage::PromptAttachmentStorage {
        &self.attachment_storage
    }

    pub fn update_session_title(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<SessionRecord, UpdateSessionTitleError> {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err(UpdateSessionTitleError::EmptyTitle);
        }
        if trimmed.chars().count() > 160 {
            return Err(UpdateSessionTitleError::TitleTooLong(160));
        }

        let existing = self
            .session_store
            .find_by_id(session_id)
            .map_err(UpdateSessionTitleError::Internal)?
            .ok_or_else(|| UpdateSessionTitleError::SessionNotFound(session_id.to_string()))?;

        let now = chrono::Utc::now().to_rfc3339();
        self.session_store
            .update_title(session_id, trimmed, &now)
            .map_err(UpdateSessionTitleError::Internal)?;

        let mut updated = existing;
        updated.title = Some(trimmed.to_string());
        updated.updated_at = now;
        Ok(updated)
    }

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
