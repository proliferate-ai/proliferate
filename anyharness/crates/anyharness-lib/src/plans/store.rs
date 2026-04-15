use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::model::{PlanHandoffRecord, PlanInteractionLinkRecord, PlanRecord};
use crate::persistence::Db;
use crate::sessions::model::SessionEventRecord;

#[derive(Clone)]
pub struct PlanStore {
    db: Db,
}

impl PlanStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn with_tx<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T>,
    {
        self.db.with_tx(f)
    }

    pub fn with_tx_anyhow<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        self.db.with_tx_anyhow(f)
    }

    pub fn find_by_id(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM plans WHERE id = ?1", [plan_id], map_plan)
                .optional()
        })
    }

    pub fn list_by_workspace(
        &self,
        workspace_id: &str,
        limit: usize,
    ) -> anyhow::Result<Vec<PlanRecord>> {
        let limit = i64::try_from(limit.max(1)).unwrap_or(100);
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM plans
                 WHERE workspace_id = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![workspace_id, limit], map_plan)?;
            rows.collect()
        })
    }

    pub fn find_by_source_key(
        tx: &Connection,
        source_session_id: &str,
        source_turn_id: Option<&str>,
        source_item_id: Option<&str>,
        source_kind: &str,
    ) -> rusqlite::Result<Option<PlanRecord>> {
        let Some(source_turn_id) = source_turn_id else {
            return Ok(None);
        };
        let Some(source_item_id) = source_item_id else {
            return Ok(None);
        };
        tx.query_row(
            "SELECT * FROM plans
             WHERE source_session_id = ?1
               AND source_turn_id = ?2
               AND source_item_id = ?3
               AND source_kind = ?4",
            params![
                source_session_id,
                source_turn_id,
                source_item_id,
                source_kind
            ],
            map_plan,
        )
        .optional()
    }

    pub fn find_pending_by_lineage(
        tx: &Connection,
        session_id: &str,
        source_agent_kind: &str,
        source_kind: &str,
        exclude_plan_id: &str,
    ) -> rusqlite::Result<Vec<PlanRecord>> {
        let mut stmt = tx.prepare(
            "SELECT * FROM plans
             WHERE session_id = ?1
               AND source_agent_kind = ?2
               AND source_kind = ?3
               AND decision_state = 'pending'
               AND id != ?4
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(
            params![session_id, source_agent_kind, source_kind, exclude_plan_id],
            map_plan,
        )?;
        rows.collect()
    }

    pub fn find_by_session_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> anyhow::Result<Option<PlanRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM plans
                 WHERE session_id = ?1 AND source_tool_call_id = ?2
                 ORDER BY created_at DESC
                 LIMIT 1",
                params![session_id, tool_call_id],
                map_plan,
            )
            .optional()
        })
    }

    pub fn find_link_by_request(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> anyhow::Result<Option<PlanInteractionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM plan_interaction_links
                 WHERE session_id = ?1 AND request_id = ?2",
                params![session_id, request_id],
                map_interaction_link,
            )
            .optional()
        })
    }

    pub fn find_link_by_plan(
        &self,
        plan_id: &str,
    ) -> anyhow::Result<Option<PlanInteractionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM plan_interaction_links
                 WHERE plan_id = ?1
                 ORDER BY created_at DESC
                 LIMIT 1",
                [plan_id],
                map_interaction_link,
            )
            .optional()
        })
    }

    pub fn insert_plan(tx: &Connection, plan: &PlanRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO plans (
                id, workspace_id, session_id, item_id, title, body_markdown, snapshot_hash,
                decision_state, native_resolution_state, decision_version, source_agent_kind,
                source_kind, source_session_id, source_turn_id, source_item_id,
                source_tool_call_id, superseded_by_plan_id, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                plan.id,
                plan.workspace_id,
                plan.session_id,
                plan.item_id,
                plan.title,
                plan.body_markdown,
                plan.snapshot_hash,
                decision_state_to_db(&plan.decision_state),
                native_state_to_db(&plan.native_resolution_state),
                plan.decision_version,
                plan.source_agent_kind,
                plan.source_kind,
                plan.source_session_id,
                plan.source_turn_id,
                plan.source_item_id,
                plan.source_tool_call_id,
                plan.superseded_by_plan_id,
                plan.created_at,
                plan.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_decision(
        tx: &Connection,
        plan_id: &str,
        decision_state: &ProposedPlanDecisionState,
        native_state: &ProposedPlanNativeResolutionState,
        decision_version: i64,
        superseded_by_plan_id: Option<&str>,
        updated_at: &str,
    ) -> rusqlite::Result<PlanRecord> {
        tx.execute(
            "UPDATE plans
             SET decision_state = ?2,
                 native_resolution_state = ?3,
                 decision_version = ?4,
                 superseded_by_plan_id = COALESCE(?5, superseded_by_plan_id),
                 updated_at = ?6
             WHERE id = ?1",
            params![
                plan_id,
                decision_state_to_db(decision_state),
                native_state_to_db(native_state),
                decision_version,
                superseded_by_plan_id,
                updated_at,
            ],
        )?;
        tx.query_row("SELECT * FROM plans WHERE id = ?1", [plan_id], map_plan)
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

    pub fn insert_or_replace_interaction_link(
        &self,
        link: &PlanInteractionLinkRecord,
    ) -> anyhow::Result<()> {
        self.db.with_tx(|tx| {
            tx.execute(
                "INSERT OR REPLACE INTO plan_interaction_links (
                    plan_id, request_id, session_id, tool_call_id, resolution_state,
                    option_mappings_json, created_at, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    link.plan_id,
                    link.request_id,
                    link.session_id,
                    link.tool_call_id,
                    link.resolution_state,
                    link.option_mappings_json,
                    link.created_at,
                    link.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn insert_handoff(&self, record: &PlanHandoffRecord) -> anyhow::Result<()> {
        self.db.with_tx(|tx| {
            tx.execute(
                "INSERT INTO plan_handoffs (
                    id, plan_id, source_session_id, target_session_id, instruction,
                    prompt_status, created_at, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    record.id,
                    record.plan_id,
                    record.source_session_id,
                    record.target_session_id,
                    record.instruction,
                    record.prompt_status,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }
}

pub fn decision_state_to_db(state: &ProposedPlanDecisionState) -> &'static str {
    match state {
        ProposedPlanDecisionState::Pending => "pending",
        ProposedPlanDecisionState::Approved => "approved",
        ProposedPlanDecisionState::Rejected => "rejected",
        ProposedPlanDecisionState::Superseded => "superseded",
    }
}

pub fn native_state_to_db(state: &ProposedPlanNativeResolutionState) -> &'static str {
    match state {
        ProposedPlanNativeResolutionState::None => "none",
        ProposedPlanNativeResolutionState::PendingLink => "pending_link",
        ProposedPlanNativeResolutionState::PendingResolution => "pending_resolution",
        ProposedPlanNativeResolutionState::Finalized => "finalized",
        ProposedPlanNativeResolutionState::Failed => "failed",
    }
}

pub(crate) fn map_plan(row: &Row<'_>) -> rusqlite::Result<PlanRecord> {
    Ok(PlanRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        item_id: row.get("item_id")?,
        title: row.get("title")?,
        body_markdown: row.get("body_markdown")?,
        snapshot_hash: row.get("snapshot_hash")?,
        decision_state: decision_state_from_db(row.get::<_, String>("decision_state")?.as_str())?,
        native_resolution_state: native_state_from_db(
            row.get::<_, String>("native_resolution_state")?.as_str(),
        )?,
        decision_version: row.get("decision_version")?,
        source_agent_kind: row.get("source_agent_kind")?,
        source_kind: row.get("source_kind")?,
        source_session_id: row.get("source_session_id")?,
        source_turn_id: row.get("source_turn_id")?,
        source_item_id: row.get("source_item_id")?,
        source_tool_call_id: row.get("source_tool_call_id")?,
        superseded_by_plan_id: row.get("superseded_by_plan_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_interaction_link(row: &Row<'_>) -> rusqlite::Result<PlanInteractionLinkRecord> {
    Ok(PlanInteractionLinkRecord {
        plan_id: row.get("plan_id")?,
        request_id: row.get("request_id")?,
        session_id: row.get("session_id")?,
        tool_call_id: row.get("tool_call_id")?,
        resolution_state: row.get("resolution_state")?,
        option_mappings_json: row.get("option_mappings_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn decision_state_from_db(value: &str) -> rusqlite::Result<ProposedPlanDecisionState> {
    match value {
        "pending" => Ok(ProposedPlanDecisionState::Pending),
        "approved" => Ok(ProposedPlanDecisionState::Approved),
        "rejected" => Ok(ProposedPlanDecisionState::Rejected),
        "superseded" => Ok(ProposedPlanDecisionState::Superseded),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown proposed plan decision_state: {other}").into(),
        )),
    }
}

fn native_state_from_db(value: &str) -> rusqlite::Result<ProposedPlanNativeResolutionState> {
    match value {
        "none" => Ok(ProposedPlanNativeResolutionState::None),
        "pending_link" => Ok(ProposedPlanNativeResolutionState::PendingLink),
        "pending_resolution" => Ok(ProposedPlanNativeResolutionState::PendingResolution),
        "finalized" => Ok(ProposedPlanNativeResolutionState::Finalized),
        "failed" => Ok(ProposedPlanNativeResolutionState::Failed),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown proposed plan native_resolution_state: {other}").into(),
        )),
    }
}
