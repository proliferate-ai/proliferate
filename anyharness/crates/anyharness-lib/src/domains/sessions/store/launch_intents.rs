use rusqlite::OptionalExtension;

use super::SessionStore;
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;

impl SessionStore {
    pub fn find_launch_intent(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<ResolvedLaunchIntent>> {
        self.db
            .with_conn(|conn| find_launch_intent_row(conn, session_id))
    }

    /// Mirror the 0076 migration's reality for directly inserted fixture
    /// rows: every persisted session owns exactly one immutable (possibly
    /// empty) launch intent, and real starts fail closed without it.
    #[cfg(test)]
    pub(crate) fn seed_empty_launch_intent(&self, session_id: &str) {
        self.db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT OR IGNORE INTO session_launch_intents (
                        session_id, requested_model_id, requested_controls_json, created_at
                     ) VALUES (?1, NULL, '{}', ?2)",
                    rusqlite::params![session_id, "2026-08-10T23:59:00Z"],
                )?;
                Ok(())
            })
            .expect("seed empty launch intent");
    }
}

pub(crate) fn find_launch_intent_row(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<Option<ResolvedLaunchIntent>> {
    conn.query_row(
        "SELECT requested_model_id, requested_controls_json, created_at
         FROM session_launch_intents WHERE session_id = ?1",
        [session_id],
        |row| {
            let controls_json: String = row.get(1)?;
            let control_values = serde_json::from_str(&controls_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(ResolvedLaunchIntent {
                model_id: row.get(0)?,
                control_values,
                created_at: row.get(2)?,
            })
        },
    )
    .optional()
}

pub(crate) fn insert_launch_intent_row(
    conn: &rusqlite::Connection,
    session_id: &str,
    intent: &ResolvedLaunchIntent,
) -> rusqlite::Result<()> {
    let controls_json = serde_json::to_string(&intent.control_values)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    conn.execute(
        "INSERT INTO session_launch_intents (
            session_id, requested_model_id, requested_controls_json, created_at
         ) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            session_id,
            intent.model_id,
            controls_json,
            intent.created_at
        ],
    )?;
    Ok(())
}
