use rusqlite::{params, OptionalExtension};

use super::{map_delivery, CompletionDeliveryRecord, CompletionDeliveryStore};

impl CompletionDeliveryStore {
    pub fn list_for_parent_sessions(
        &self,
        parent_session_ids: &[String],
    ) -> anyhow::Result<Vec<CompletionDeliveryRecord>> {
        if parent_session_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.db.with_conn(|conn| {
            let placeholders = vec!["?"; parent_session_ids.len()].join(", ");
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM session_link_completion_deliveries
                 WHERE parent_session_id IN ({placeholders})
                   AND state IN ('pending', 'enqueued')
                 ORDER BY created_at ASC, delivery_id ASC"
            ))?;
            let rows = stmt
                .query_map(
                    rusqlite::params_from_iter(parent_session_ids.iter()),
                    map_delivery,
                )?
                .collect();
            rows
        })
    }

    pub fn import(&self, record: &CompletionDeliveryRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_link_completion_deliveries (
                    delivery_id, completion_id, session_link_id, parent_session_id,
                    child_session_id, subagent_public_id, label, child_turn_id,
                    child_last_event_seq, outcome, assistant_text, notification_text,
                    state, parent_prompt_seq, parent_turn_id, attempt_count,
                    next_attempt_at, lease_token, lease_expires_at, last_error_code,
                    created_at, updated_at, enqueued_at, delivered_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                    ?13, ?14, ?15, ?16, ?17, NULL, NULL, ?18, ?19, ?20, ?21, ?22
                 )",
                params![
                    record.delivery_id,
                    record.completion_id,
                    record.session_link_id,
                    record.parent_session_id,
                    record.child_session_id,
                    record.subagent_public_id,
                    record.label,
                    record.child_turn_id,
                    record.child_last_event_seq,
                    record.outcome.as_str(),
                    record.assistant_text,
                    record.notification_text,
                    record.state.as_str(),
                    record.parent_prompt_seq,
                    record.parent_turn_id,
                    record.attempt_count,
                    record.next_attempt_at,
                    record.last_error_code,
                    record.created_at,
                    record.updated_at,
                    record.enqueued_at,
                    record.delivered_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn claim_next_due(
        &self,
        now: &str,
        lease_expires_at: &str,
        lease_token: &str,
    ) -> anyhow::Result<Option<CompletionDeliveryRecord>> {
        self.db.with_tx(|tx| {
            let delivery_id = tx
                .query_row(
                    "SELECT delivery_id
                     FROM session_link_completion_deliveries
                     WHERE state != 'delivered' AND next_attempt_at <= ?1
                       AND (lease_token IS NULL OR lease_expires_at <= ?1)
                     ORDER BY next_attempt_at ASC, created_at ASC, delivery_id ASC
                     LIMIT 1",
                    [now],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(delivery_id) = delivery_id else {
                return Ok(None);
            };
            let claimed = tx.execute(
                "UPDATE session_link_completion_deliveries
                 SET lease_token = ?2, lease_expires_at = ?3,
                     attempt_count = attempt_count + 1, updated_at = ?1
                 WHERE delivery_id = ?4 AND state != 'delivered'
                   AND (lease_token IS NULL OR lease_expires_at <= ?1)",
                params![now, lease_token, lease_expires_at, delivery_id],
            )?;
            if claimed == 0 {
                return Ok(None);
            }
            tx.query_row(
                "SELECT * FROM session_link_completion_deliveries
                 WHERE delivery_id = ?1",
                [delivery_id],
                map_delivery,
            )
            .map(Some)
        })
    }

    pub fn retry_later(
        &self,
        delivery_id: &str,
        lease_token: &str,
        error_code: &str,
        now: &str,
        next_attempt_at: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE session_link_completion_deliveries
                 SET next_attempt_at = ?4, last_error_code = ?3, updated_at = ?5,
                     lease_token = NULL, lease_expires_at = NULL
                 WHERE delivery_id = ?1 AND lease_token = ?2 AND state != 'delivered'",
                params![delivery_id, lease_token, error_code, next_attempt_at, now],
            )?;
            Ok(changed > 0)
        })
    }

    #[cfg(test)]
    pub fn list_all_for_test(&self) -> anyhow::Result<Vec<CompletionDeliveryRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_link_completion_deliveries
                 ORDER BY created_at ASC, delivery_id ASC",
            )?;
            let rows = stmt.query_map([], map_delivery)?.collect();
            rows
        })
    }
}

pub(crate) fn delete_parent_deliveries_in_tx(
    conn: &rusqlite::Connection,
    parent_session_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM session_link_completion_deliveries WHERE parent_session_id = ?1",
        [parent_session_id],
    )?;
    Ok(())
}
