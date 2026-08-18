use super::super::SessionStore;
use crate::domains::sessions::model::PendingPromptRecord;

impl SessionStore {
    pub(crate) fn has_pending_prompt_added_event(
        &self,
        pending_prompt: &PendingPromptRecord,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT payload_json FROM session_events
                 WHERE session_id = ?1 AND event_type = 'pending_prompt_added'",
            )?;
            let payloads = stmt.query_map([pending_prompt.session_id.as_str()], |row| {
                row.get::<_, String>(0)
            })?;
            for payload in payloads {
                let Ok(added) = serde_json::from_str::<serde_json::Value>(&payload?) else {
                    continue;
                };
                // `seq` can repeat only on a legacy under-backfilled database;
                // `queued_at` is the immutable identity of that allocation and
                // survives an in-place completion-wake rewrite.
                if added["type"] == "pending_prompt_added"
                    && added["seq"].as_i64() == Some(pending_prompt.seq)
                    && added["queuedAt"].as_str() == Some(pending_prompt.queued_at.as_str())
                {
                    return Ok(true);
                }
            }
            Ok(false)
        })
    }
}
