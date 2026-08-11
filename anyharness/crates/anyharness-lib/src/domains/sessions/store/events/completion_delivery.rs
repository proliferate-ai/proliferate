use rusqlite::params;

use super::map_event;
use crate::domains::sessions::store::SessionStore;

impl SessionStore {
    /// Resolve the durable transcript turn that consumed a stable prompt id.
    /// Only completed user-message items qualify; queue visibility events and
    /// assistant/tool items cannot acknowledge delivery.
    pub(crate) fn find_completed_user_prompt_turn(
        &self,
        session_id: &str,
        prompt_id: &str,
    ) -> anyhow::Result<Option<(String, i64)>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_events
                 WHERE session_id = ?1 AND event_type = 'item_completed'
                   AND json_extract(payload_json, '$.item.promptId') = ?2
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, prompt_id], map_event)?;
            for row in rows {
                let record = row?;
                let Ok(event) = serde_json::from_str::<serde_json::Value>(&record.payload_json)
                else {
                    continue;
                };
                if event["type"] == "item_completed"
                    && event["item"]["kind"] == "user_message"
                    && event["item"]["promptId"] == prompt_id
                {
                    if let Some(turn_id) = record.turn_id {
                        return Ok(Some((turn_id, record.seq)));
                    }
                }
            }
            Ok(None)
        })
    }
}
