use anyharness_contract::v1::{GoalSourceKind, GoalStatus};
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
                token_budget, max_turns, max_wall_secs, tokens_used, time_used_seconds,
                met_reason, failed_reason, iterations, source_kind, source_run_id,
                native, pending_op, revision, native_state_json, guard_turns_used,
                guard_started_at, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                     ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            params![
                goal.id,
                goal.workspace_id,
                goal.session_id,
                goal.objective,
                status_to_db(goal.status),
                goal.native_status,
                goal.token_budget,
                goal.max_turns,
                goal.max_wall_secs.map(|value| value as i64),
                goal.tokens_used,
                goal.time_used_seconds,
                goal.met_reason,
                goal.failed_reason,
                goal.iterations,
                source_kind_to_db(goal.source_kind),
                goal.source_run_id,
                goal.native,
                goal.pending_op.map(GoalPendingOp::as_str),
                goal.revision,
                goal.native_state_json,
                goal.guard_turns_used,
                goal.guard_started_at,
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
                 max_turns = ?6,
                 max_wall_secs = ?7,
                 tokens_used = ?8,
                 time_used_seconds = ?9,
                 met_reason = ?10,
                 failed_reason = ?11,
                 iterations = ?12,
                 source_kind = ?13,
                 source_run_id = ?14,
                 native = ?15,
                 pending_op = ?16,
                 revision = ?17,
                 native_state_json = ?18,
                 guard_turns_used = ?19,
                 guard_started_at = ?20,
                 updated_at = ?21
             WHERE id = ?1",
            params![
                goal.id,
                goal.objective,
                status_to_db(goal.status),
                goal.native_status,
                goal.token_budget,
                goal.max_turns,
                goal.max_wall_secs.map(|value| value as i64),
                goal.tokens_used,
                goal.time_used_seconds,
                goal.met_reason,
                goal.failed_reason,
                goal.iterations,
                source_kind_to_db(goal.source_kind),
                goal.source_run_id,
                goal.native,
                goal.pending_op.map(GoalPendingOp::as_str),
                goal.revision,
                goal.native_state_json,
                goal.guard_turns_used,
                goal.guard_started_at,
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

    /// Persists the cap guard's turn counter for a goal row. Deliberately
    /// touches nothing else — the counter is internal bookkeeping, not a
    /// mirror-state edit, so it never bumps `revision` nor emits an event.
    pub fn update_guard_turns(
        tx: &Connection,
        goal_id: &str,
        guard_turns_used: i64,
    ) -> rusqlite::Result<()> {
        tx.execute(
            "UPDATE goals SET guard_turns_used = ?2 WHERE id = ?1",
            params![goal_id, guard_turns_used],
        )?;
        Ok(())
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

pub fn source_kind_to_db(source_kind: GoalSourceKind) -> &'static str {
    match source_kind {
        GoalSourceKind::User => "user",
        GoalSourceKind::Workflow => "workflow",
        GoalSourceKind::Agent => "agent",
    }
}

fn source_kind_from_db(value: &str) -> rusqlite::Result<GoalSourceKind> {
    match value {
        "user" => Ok(GoalSourceKind::User),
        "workflow" => Ok(GoalSourceKind::Workflow),
        "agent" => Ok(GoalSourceKind::Agent),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown goal source kind: {other}").into(),
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
        max_turns: row.get("max_turns")?,
        max_wall_secs: row
            .get::<_, Option<i64>>("max_wall_secs")?
            .map(|value| value as u64),
        tokens_used: row.get("tokens_used")?,
        time_used_seconds: row.get("time_used_seconds")?,
        met_reason: row.get("met_reason")?,
        failed_reason: row.get("failed_reason")?,
        iterations: row.get("iterations")?,
        source_kind: source_kind_from_db(row.get::<_, String>("source_kind")?.as_str())?,
        source_run_id: row.get("source_run_id")?,
        native: row.get("native")?,
        pending_op: row
            .get::<_, Option<String>>("pending_op")?
            .as_deref()
            .and_then(GoalPendingOp::parse),
        revision: row.get("revision")?,
        native_state_json: row.get("native_state_json")?,
        guard_turns_used: row.get("guard_turns_used")?,
        guard_started_at: row.get("guard_started_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
