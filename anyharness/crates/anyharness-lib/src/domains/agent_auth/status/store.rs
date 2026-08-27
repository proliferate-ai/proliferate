//! SQLite-backed store for the per-harness status documents (migration
//! `0078_agent_auth_status`). Pattern-matched on the seat-cooling store:
//! **no operation here ever surfaces an error** — status is a display truth,
//! never a launch gate, so a locked or unreadable database degrades to "no
//! persisted status" with a `tracing::warn` rather than bricking anything.
//!
//! Two facts per row, deliberately separate:
//! - `doc_json` — the served document verbatim (the truth the doors return);
//! - `probe_verdict` / `probe_at` — the last OBSERVATION, the serve-stale
//!   memory that survives failures and restarts. A failure rewrites the doc
//!   to serve the prior observation dimmed; it never overwrites the
//!   observation itself.
//!
//! Nothing here ever holds token material: documents carry seat ids and
//! verdicts only, so every value this store reads or writes is log-safe.

use rusqlite::{params, OptionalExtension};

use crate::persistence::Db;

#[derive(Clone)]
pub struct AgentStatusStore {
    db: Db,
}

/// One persisted row: the served document plus the last-observation columns.
#[derive(Debug, Clone)]
pub(super) struct StatusRow {
    pub(super) doc_json: String,
    pub(super) probe_verdict: Option<String>,
    pub(super) probe_at: Option<String>,
}

/// What a document write does to the last-observation columns.
#[derive(Debug, Clone, Copy)]
pub(super) enum ObservationWrite<'a> {
    /// Leave the stored observation untouched (every non-completion write:
    /// composition refreshes, stale marks, failures serving a prior
    /// observation).
    Keep,
    /// Record a new observation alongside the document (a probe completed).
    Set { verdict: &'a str, at: &'a str },
}

impl AgentStatusStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// Every persisted document's JSON, ordered by harness kind so reads are
    /// deterministic.
    pub(super) fn read_all(&self) -> Vec<(String, String)> {
        let result = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT harness_kind, doc_json FROM agent_auth_status ORDER BY harness_kind",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        });
        match result {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(%error, "failed to read agent-auth status rows; serving none");
                Vec::new()
            }
        }
    }

    pub(super) fn read(&self, harness_kind: &str) -> Option<StatusRow> {
        let result = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT doc_json, probe_verdict, probe_at FROM agent_auth_status
                 WHERE harness_kind = ?1",
                [harness_kind],
                |row| {
                    Ok(StatusRow {
                        doc_json: row.get(0)?,
                        probe_verdict: row.get(1)?,
                        probe_at: row.get(2)?,
                    })
                },
            )
            .optional()
        });
        match result {
            Ok(row) => row,
            Err(error) => {
                tracing::warn!(harness_kind, %error, "failed to read agent-auth status row; treating as absent");
                None
            }
        }
    }

    /// Persist a document (and optionally a fresh observation). The caller
    /// owns byte-stability: an unchanged document is not written at all, so
    /// `updated_at_epoch_s` moves only on real changes.
    pub(super) fn upsert(
        &self,
        harness_kind: &str,
        doc_json: &str,
        observation: ObservationWrite<'_>,
        now_epoch_s: i64,
    ) {
        let result = match observation {
            ObservationWrite::Keep => self.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO agent_auth_status (
                        harness_kind, doc_json, updated_at_epoch_s
                     ) VALUES (?1, ?2, ?3)
                     ON CONFLICT(harness_kind) DO UPDATE SET
                        doc_json = excluded.doc_json,
                        updated_at_epoch_s = excluded.updated_at_epoch_s",
                    params![harness_kind, doc_json, now_epoch_s],
                )
            }),
            ObservationWrite::Set { verdict, at } => self.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO agent_auth_status (
                        harness_kind, doc_json, probe_verdict, probe_at, updated_at_epoch_s
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(harness_kind) DO UPDATE SET
                        doc_json = excluded.doc_json,
                        probe_verdict = excluded.probe_verdict,
                        probe_at = excluded.probe_at,
                        updated_at_epoch_s = excluded.updated_at_epoch_s",
                    params![harness_kind, doc_json, verdict, at, now_epoch_s],
                )
            }),
        };
        if let Err(error) = result {
            tracing::warn!(harness_kind, %error, "failed to persist agent-auth status document");
        }
    }

    /// The row's `updated_at_epoch_s`, for tests asserting that byte-stable
    /// refreshes do not rewrite.
    #[cfg(test)]
    pub(super) fn updated_at(&self, harness_kind: &str) -> Option<i64> {
        self.db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT updated_at_epoch_s FROM agent_auth_status WHERE harness_kind = ?1",
                    [harness_kind],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
            })
            .ok()
            .flatten()
    }
}
