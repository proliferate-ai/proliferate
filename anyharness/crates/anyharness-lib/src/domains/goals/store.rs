use anyharness_contract::v1::GoalStatus;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::model::GoalRecord;
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

    pub fn find_by_id(&self, goal_id: &str) -> anyhow::Result<Option<GoalRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM goals WHERE id = ?1", [goal_id], map_goal)
                .optional()
        })
    }

    /// The (at most one) non-terminal goal for a session.
    pub fn find_non_terminal_by_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<GoalRecord>> {
        self.db
            .with_conn(|conn| Self::find_non_terminal_by_session_tx(conn, session_id).optional())
    }

    pub fn find_non_terminal_by_session_tx(
        tx: &Connection,
        session_id: &str,
    ) -> rusqlite::Result<GoalRecord> {
        tx.query_row(
            "SELECT * FROM goals
             WHERE session_id = ?1
               AND status IN ('active', 'paused', 'blocked')
             LIMIT 1",
            [session_id],
            map_goal,
        )
    }

    pub fn list_by_workspace(
        &self,
        workspace_id: &str,
        limit: usize,
    ) -> anyhow::Result<Vec<GoalRecord>> {
        let limit = i64::try_from(limit.max(1)).unwrap_or(100);
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM goals
                 WHERE workspace_id = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![workspace_id, limit], map_goal)?;
            rows.collect()
        })
    }

    pub fn insert_goal(tx: &Connection, goal: &GoalRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO goals (
                id, workspace_id, session_id, objective, status, source_kind, source_run_id,
                token_budget, max_turns, max_wall_secs, tokens_used, time_used_secs, turns_used,
                met_reason, native_state_json, revision, created_at, updated_at, met_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                goal.id,
                goal.workspace_id,
                goal.session_id,
                goal.objective,
                goal.status.as_str(),
                goal.source_kind,
                goal.source_run_id,
                goal.token_budget,
                goal.max_turns,
                goal.max_wall_secs,
                goal.tokens_used,
                goal.time_used_secs,
                goal.turns_used,
                goal.met_reason,
                goal.native_state_json,
                goal.revision,
                goal.created_at,
                goal.updated_at,
                goal.met_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_goal(tx: &Connection, goal: &GoalRecord) -> rusqlite::Result<()> {
        tx.execute(
            "UPDATE goals SET
                objective = ?2, status = ?3, source_kind = ?4, source_run_id = ?5,
                token_budget = ?6, max_turns = ?7, max_wall_secs = ?8, tokens_used = ?9,
                time_used_secs = ?10, turns_used = ?11, met_reason = ?12,
                native_state_json = ?13, revision = ?14, updated_at = ?15, met_at = ?16
             WHERE id = ?1",
            params![
                goal.id,
                goal.objective,
                goal.status.as_str(),
                goal.source_kind,
                goal.source_run_id,
                goal.token_budget,
                goal.max_turns,
                goal.max_wall_secs,
                goal.tokens_used,
                goal.time_used_secs,
                goal.turns_used,
                goal.met_reason,
                goal.native_state_json,
                goal.revision,
                goal.updated_at,
                goal.met_at,
            ],
        )?;
        Ok(())
    }

    /// Guard bookkeeping: bump `turns_used` on the non-terminal goal without
    /// emitting events. Returns the updated row when one exists.
    pub fn increment_turns_used(&self, session_id: &str) -> anyhow::Result<Option<GoalRecord>> {
        self.db.with_tx(|tx| {
            let Some(goal) = Self::find_non_terminal_by_session_tx(tx, session_id).optional()?
            else {
                return Ok(None);
            };
            tx.execute(
                "UPDATE goals SET turns_used = turns_used + 1, updated_at = ?2 WHERE id = ?1",
                params![goal.id, chrono::Utc::now().to_rfc3339()],
            )?;
            tx.query_row("SELECT * FROM goals WHERE id = ?1", [goal.id], map_goal)
                .map(Some)
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

    pub fn next_event_seq(tx: &Connection, session_id: &str) -> rusqlite::Result<i64> {
        let max: Option<i64> = tx.query_row(
            "SELECT MAX(seq) FROM session_events WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(max.unwrap_or(0) + 1)
    }
}

pub(crate) fn map_goal(row: &Row<'_>) -> rusqlite::Result<GoalRecord> {
    Ok(GoalRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        objective: row.get("objective")?,
        status: status_from_db(row.get::<_, String>("status")?.as_str())?,
        source_kind: row.get("source_kind")?,
        source_run_id: row.get("source_run_id")?,
        token_budget: row.get("token_budget")?,
        max_turns: row.get("max_turns")?,
        max_wall_secs: row.get("max_wall_secs")?,
        tokens_used: row.get("tokens_used")?,
        time_used_secs: row.get("time_used_secs")?,
        turns_used: row.get("turns_used")?,
        met_reason: row.get("met_reason")?,
        native_state_json: row.get("native_state_json")?,
        revision: row.get("revision")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        met_at: row.get("met_at")?,
    })
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
