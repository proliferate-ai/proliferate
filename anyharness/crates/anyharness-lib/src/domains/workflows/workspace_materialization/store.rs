//! Synchronous SQLite for Workflow workspace materialization. The store owns
//! atomic acceptance and guarded state transitions; it never validates product
//! input, calls the workspace/Git seams, or awaits. Expected conditions
//! (replay, conflict, not-found) are returned as `Ok` data. `resolved_placement`
//! commits before any filesystem/Git effect; `workspace_id` is durable non-FK
//! correlation evidence.

use rusqlite::{params, types::Type, OptionalExtension, Row};

use super::model::{
    MaterializationFailureCode, MaterializationFailureDetail, MaterializationRecord,
    MaterializationStatus,
};
use crate::persistence::Db;

/// Result of an acceptance attempt.
#[derive(Debug)]
pub enum StoreAcceptOutcome {
    /// No row existed; it was inserted in this transaction.
    Created(MaterializationRecord),
    /// A row existed with an identical `request_json`; returned unchanged.
    ExactReplay(MaterializationRecord),
    /// A row existed with a different `request_json`; nothing changed.
    Conflict,
    /// No materialization existed, but the same run id was already claimed by
    /// `workflow_runs`; accepting now would create a one-way conflicting
    /// binding.
    RunAlreadyAccepted,
}

#[derive(Clone)]
pub struct MaterializationStore {
    db: Db,
}

impl MaterializationStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    /// Insert the `accepted` row, exactly replay, or conflict — atomically. The
    /// durable claim for the deterministic path must exist before any effect.
    pub fn accept(&self, record: &MaterializationRecord) -> anyhow::Result<StoreAcceptOutcome> {
        self.db.with_tx(|conn| match find(conn, &record.run_id)? {
            None => {
                let run_exists = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM workflow_runs WHERE id = ?1)",
                    [&record.run_id],
                    |row| row.get::<_, bool>(0),
                )?;
                if run_exists {
                    return Ok(StoreAcceptOutcome::RunAlreadyAccepted);
                }
                insert(conn, record)?;
                Ok(StoreAcceptOutcome::Created(record.clone()))
            }
            Some(existing) if existing.request_json == record.request_json => {
                Ok(StoreAcceptOutcome::ExactReplay(existing))
            }
            Some(_) => Ok(StoreAcceptOutcome::Conflict),
        })
    }

    /// The durable record, or `None` when unknown.
    pub fn get(&self, run_id: &str) -> anyhow::Result<Option<MaterializationRecord>> {
        self.db.with_conn(|conn| find(conn, run_id))
    }

    /// Persist the resolved placement and transition `accepted -> materializing`
    /// in one write. The placement commits before any effect; the resolved
    /// placement is only written when still unset (replay never re-resolves).
    pub fn persist_resolved_and_begin(
        &self,
        run_id: &str,
        resolved_placement_json: &str,
    ) -> anyhow::Result<bool> {
        let now = Self::now();
        let updated = self.db.with_tx(|conn| {
            conn.execute(
                "UPDATE workflow_workspace_materializations
                 SET resolved_placement_json = ?2, status = 'materializing', updated_at = ?3
                 WHERE run_id = ?1 AND status = 'accepted' AND resolved_placement_json IS NULL",
                params![run_id, resolved_placement_json, now],
            )
        })?;
        Ok(updated > 0)
    }

    /// Transition `accepted -> materializing` when the resolved placement is
    /// already durably present (crash replay). No-op if already materializing.
    pub fn ensure_materializing(&self, run_id: &str) -> anyhow::Result<bool> {
        let now = Self::now();
        let updated = self.db.with_tx(|conn| {
            conn.execute(
                "UPDATE workflow_workspace_materializations
                 SET status = 'materializing', updated_at = ?2
                 WHERE run_id = ?1 AND status = 'accepted'",
                params![run_id, now],
            )
        })?;
        Ok(updated > 0)
    }

    /// Persist the durable workspace id immediately after artifact creation,
    /// only while still unbound.
    pub fn bind_workspace(&self, run_id: &str, workspace_id: &str) -> anyhow::Result<bool> {
        let now = Self::now();
        let updated = self.db.with_tx(|conn| {
            conn.execute(
                "UPDATE workflow_workspace_materializations
                 SET workspace_id = ?2, updated_at = ?3
                 WHERE run_id = ?1 AND workspace_id IS NULL",
                params![run_id, workspace_id, now],
            )
        })?;
        Ok(updated > 0)
    }

    /// Guarded terminalization `materializing -> ready`.
    pub fn mark_ready(&self, run_id: &str) -> anyhow::Result<bool> {
        let now = Self::now();
        let updated = self.db.with_tx(|conn| {
            conn.execute(
                "UPDATE workflow_workspace_materializations
                 SET status = 'ready', finished_at = ?2, updated_at = ?2
                 WHERE run_id = ?1 AND status = 'materializing'",
                params![run_id, now],
            )
        })?;
        Ok(updated > 0)
    }

    /// Terminal coded failure. Retains the row (and any ambiguous artifact) for
    /// inspection; terminal rows are never overwritten.
    pub fn mark_failed(
        &self,
        run_id: &str,
        failure_code: MaterializationFailureCode,
        failure_detail: &MaterializationFailureDetail,
    ) -> anyhow::Result<bool> {
        let now = Self::now();
        // The typed detail is already bounded and secret-free by construction;
        // no caller can hand a raw arbitrary string to this durable boundary.
        let updated = self.db.with_tx(|conn| {
            conn.execute(
                "UPDATE workflow_workspace_materializations
                 SET status = 'failed', failure_code = ?2, failure_message = ?3,
                     finished_at = ?4, updated_at = ?4
                 WHERE run_id = ?1 AND status IN ('accepted', 'materializing')",
                params![run_id, failure_code.as_str(), failure_detail.as_str(), now],
            )
        })?;
        Ok(updated > 0)
    }
}

fn insert(conn: &rusqlite::Connection, record: &MaterializationRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO workflow_workspace_materializations (
            run_id, schema_version, request_json, resolved_placement_json, status,
            workspace_id, failure_code, failure_message, created_at, updated_at, finished_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            record.run_id,
            record.schema_version,
            record.request_json,
            record.resolved_placement_json,
            record.status.as_str(),
            record.workspace_id,
            record.failure_code.map(MaterializationFailureCode::as_str),
            record
                .failure_message
                .as_ref()
                .map(MaterializationFailureDetail::as_str),
            record.created_at,
            record.updated_at,
            record.finished_at,
        ],
    )?;
    Ok(())
}

fn find(
    conn: &rusqlite::Connection,
    run_id: &str,
) -> rusqlite::Result<Option<MaterializationRecord>> {
    conn.query_row(
        "SELECT * FROM workflow_workspace_materializations WHERE run_id = ?1",
        [run_id],
        map_row,
    )
    .optional()
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<MaterializationRecord> {
    Ok(MaterializationRecord {
        run_id: row.get("run_id")?,
        schema_version: row.get("schema_version")?,
        request_json: row.get("request_json")?,
        resolved_placement_json: row.get("resolved_placement_json")?,
        status: parse_status(row.get::<_, String>("status")?.as_str())?,
        workspace_id: row.get("workspace_id")?,
        failure_code: parse_failure_code(row.get::<_, Option<String>>("failure_code")?)?,
        failure_message: row
            .get::<_, Option<String>>("failure_message")?
            .map(MaterializationFailureDetail::from_stored),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        finished_at: row.get("finished_at")?,
    })
}

fn parse_status(value: &str) -> rusqlite::Result<MaterializationStatus> {
    MaterializationStatus::parse(value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown materialization status: {value}").into(),
        )
    })
}

fn parse_failure_code(
    value: Option<String>,
) -> rusqlite::Result<Option<MaterializationFailureCode>> {
    match value {
        None => Ok(None),
        Some(raw) => MaterializationFailureCode::parse(&raw)
            .map(Some)
            .ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    Type::Text,
                    format!("unknown materialization failure code: {raw}").into(),
                )
            }),
    }
}
