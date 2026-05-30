use rusqlite::{params, OptionalExtension};

use super::rows::map_round;
use super::ReviewStore;
use crate::domains::reviews::model::ReviewRoundRecord;

impl ReviewStore {
    pub fn list_rounds_for_run(&self, run_id: &str) -> anyhow::Result<Vec<ReviewRoundRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_rounds
                 WHERE review_run_id = ?1
                 ORDER BY round_number ASC",
            )?;
            let rows = stmt.query_map([run_id], map_round)?;
            rows.collect()
        })
    }

    pub fn find_round(&self, round_id: &str) -> anyhow::Result<Option<ReviewRoundRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_rounds WHERE id = ?1",
                [round_id],
                map_round,
            )
            .optional()
        })
    }

    pub fn claim_round_for_completion(&self, round_id: &str) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_rounds
                 SET status = 'completing', updated_at = ?1
                 WHERE id = ?2 AND status = 'reviewing'",
                params![now, round_id],
            )?;
            Ok(changed == 1)
        })
    }
}
