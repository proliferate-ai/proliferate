use anyharness_contract::v1::GoalStatus;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::model::{GoalPendingOp, GoalRecord};
use crate::domains::sessions::model::SessionEventRecord;
use crate::persistence::Db;

#[derive(Clone)]
pub struct GoalStore {
    db: Db,
}

impl GoalStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn with_tx_anyhow<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        self.db.with_tx_anyhow(f)
    }

    /// The session's current goal mirror for read models: the latest goal row
    /// unless it is cleared (a cleared head means no current goal). Terminal
    /// `met`/`failed` records stay current (the sticky result state) until a
    /// clear or a replacing set.
    pub fn find_current(&self, session_id: &str) -> anyhow::Result<Option<GoalRecord>> {
        self.db
            .with_conn(|conn| Self::find_current_tx(conn, session_id))
    }

    pub fn find_current_tx(
        tx: &Connection,
        session_id: &str,
    ) -> rusqlite::Result<Option<GoalRecord>> {
        // Key strictly off the single latest row rather than skipping cleared
        // rows: skipping a cleared head would fall back to an older,
        // still-uncleared terminal row and resurrect a goal the user cleared
        // two goals ago. A cleared head is authoritative — no current goal.
        Ok(Self::find_latest_tx(tx, session_id)?
            .filter(|goal| goal.status != GoalStatus::Cleared))
    }

    /// The single most-recent goal row for the session, regardless of status
    /// (the head of the goal lifecycle chain). Ingest keys its
    /// insert-vs-update-vs-drop decision off this so a cleared head is never
    /// skipped, and so a stale post-clear notification cannot mint a new goal.
    pub fn find_latest_tx(
        tx: &Connection,
        session_id: &str,
    ) -> rusqlite::Result<Option<GoalRecord>> {
        tx.query_row(
            "SELECT * FROM goals
             WHERE session_id = ?1
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1",
            [session_id],
            map_goal,
        )
        .optional()
    }

    pub fn find_current_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<std::collections::HashMap<String, GoalRecord>> {
        let mut current = std::collections::HashMap::new();
        if session_ids.is_empty() {
            return Ok(current);
        }
        self.db.with_conn(|conn| {
            for session_id in session_ids {
                if let Some(goal) = Self::find_current_tx(conn, session_id)? {
                    current.insert(session_id.clone(), goal);
                }
            }
            Ok(())
        })?;
        Ok(current)
    }

    pub fn insert_goal(tx: &Connection, goal: &GoalRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO goals (
                id, workspace_id, session_id, objective, status, native_status,
                token_budget, tokens_used, time_used_seconds, met_reason, iterations,
                native, pending_op, revision, native_state_json, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                goal.id,
                goal.workspace_id,
                goal.session_id,
                goal.objective,
                status_to_db(goal.status),
                goal.native_status,
                goal.token_budget,
                goal.tokens_used,
                goal.time_used_seconds,
                goal.met_reason,
                goal.iterations,
                goal.native,
                goal.pending_op.map(GoalPendingOp::as_str),
                goal.revision,
                goal.native_state_json,
                goal.created_at,
                goal.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_goal(tx: &Connection, goal: &GoalRecord) -> rusqlite::Result<()> {
        tx.execute(
            "UPDATE goals
             SET objective = ?2,
                 status = ?3,
                 native_status = ?4,
                 token_budget = ?5,
                 tokens_used = ?6,
                 time_used_seconds = ?7,
                 met_reason = ?8,
                 iterations = ?9,
                 native = ?10,
                 pending_op = ?11,
                 revision = ?12,
                 native_state_json = ?13,
                 updated_at = ?14
             WHERE id = ?1",
            params![
                goal.id,
                goal.objective,
                status_to_db(goal.status),
                goal.native_status,
                goal.token_budget,
                goal.tokens_used,
                goal.time_used_seconds,
                goal.met_reason,
                goal.iterations,
                goal.native,
                goal.pending_op.map(GoalPendingOp::as_str),
                goal.revision,
                goal.native_state_json,
                goal.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn set_pending_op(
        &self,
        session_id: &str,
        pending_op: Option<GoalPendingOp>,
    ) -> anyhow::Result<()> {
        self.db.with_tx(|tx| {
            // Mark the latest row regardless of status: a set issued after a
            // clear must be able to stamp the cleared head so ingest can tell
            // the set's own native echo (revive as a new goal) apart from a
            // stale post-clear echo (drop).
            tx.execute(
                "UPDATE goals
                 SET pending_op = ?2, updated_at = ?3
                 WHERE id IN (
                     SELECT id FROM goals
                     WHERE session_id = ?1
                     ORDER BY created_at DESC, rowid DESC
                     LIMIT 1
                 )",
                params![
                    session_id,
                    pending_op.map(GoalPendingOp::as_str),
                    chrono::Utc::now().to_rfc3339(),
                ],
            )?;
            Ok(())
        })
    }

    pub fn insert_event(tx: &Connection, record: &SessionEventRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.session_id,
                record.seq,
                record.timestamp,
                record.event_type,
                record.turn_id,
                record.item_id,
                record.payload_json,
            ],
        )?;
        Ok(())
    }
}

pub fn status_to_db(status: GoalStatus) -> &'static str {
    match status {
        GoalStatus::Active => "active",
        GoalStatus::Paused => "paused",
        GoalStatus::Blocked => "blocked",
        GoalStatus::Met => "met",
        GoalStatus::Failed => "failed",
        GoalStatus::Cleared => "cleared",
    }
}

fn status_from_db(value: &str) -> rusqlite::Result<GoalStatus> {
    match value {
        "active" => Ok(GoalStatus::Active),
        "paused" => Ok(GoalStatus::Paused),
        "blocked" => Ok(GoalStatus::Blocked),
        "met" => Ok(GoalStatus::Met),
        "failed" => Ok(GoalStatus::Failed),
        "cleared" => Ok(GoalStatus::Cleared),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown goal status: {other}").into(),
        )),
    }
}

pub(crate) fn map_goal(row: &Row<'_>) -> rusqlite::Result<GoalRecord> {
    Ok(GoalRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        objective: row.get("objective")?,
        status: status_from_db(row.get::<_, String>("status")?.as_str())?,
        native_status: row.get("native_status")?,
        token_budget: row.get("token_budget")?,
        tokens_used: row.get("tokens_used")?,
        time_used_seconds: row.get("time_used_seconds")?,
        met_reason: row.get("met_reason")?,
        iterations: row.get("iterations")?,
        native: row.get("native")?,
        pending_op: row
            .get::<_, Option<String>>("pending_op")?
            .as_deref()
            .and_then(GoalPendingOp::parse),
        revision: row.get("revision")?,
        native_state_json: row.get("native_state_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
