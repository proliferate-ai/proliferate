use super::SessionService;
use crate::domains::sessions::model::{
    SessionEventRecord, SessionRawNotificationRecord, SessionRecord,
};

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
        oldest_first: bool,
    ) -> anyhow::Result<Option<Vec<SessionEventRecord>>> {
        if self.session_store.find_by_id(session_id)?.is_none() {
            return Ok(None);
        }

        match (after_seq, before_seq, limit, turn_limit) {
            (Some(_), Some(_), _, _) | (Some(_), _, _, Some(_)) => {
                anyhow::bail!("after_seq cannot be combined with before_seq or turn_limit")
            }
            (Some(seq), None, Some(limit), None) if oldest_first => self
                .session_store
                .list_events_after_oldest_limited(session_id, seq, limit)
                .map(Some),
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
}
