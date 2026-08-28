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
//! The two must never disagree, and they used to: composing a document is
//! read-modify-write, and the read (`read`) and the write (`upsert`) were two
//! separate `with_conn` calls with real file I/O in between. Two writers — an
//! admission on the poke's task and a verdict on the attempt's task, which the
//! engine genuinely runs at the same time — interleaved there and tore the row.
//! So there is exactly ONE write door now, [`AgentStatusStore::write_document`],
//! and it reads and writes inside a single transaction.
//!
//! Nothing here ever holds token material: documents carry seat ids and
//! verdicts only, so every value this store reads or writes is log-safe.

use rusqlite::{params, Connection, OptionalExtension};

use crate::persistence::Db;

/// How many times a decided write retries. A deferred transaction that reads
/// and then writes can lose its snapshot to another connection over the same
/// file (`SQLITE_BUSY_SNAPSHOT`); that is transient and a retry re-reads, so it
/// re-decides against the winner rather than overwriting it.
const WRITE_ATTEMPTS: usize = 3;

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

/// One decided document write.
pub(super) struct DocumentWrite {
    pub(super) doc_json: String,
    /// `Some((verdict, at))` records a fresh observation alongside the document
    /// (a probe completed); `None` leaves the stored observation untouched
    /// (every composition refresh, stale mark, release, and dimming failure).
    pub(super) observation: Option<(String, String)>,
}

/// What a decider concluded about the row it was shown.
pub(super) struct Decided<T> {
    /// The document that is persisted once this call returns, whether or not
    /// this call is the one that wrote it. Callers need it either way: the
    /// publish is gated on `write`, but the stale-mark bookkeeping reads the
    /// resulting probe block regardless.
    pub(super) payload: T,
    /// `None` when the recomposition is byte-identical to the persisted row and
    /// carries no new observation — the byte-stability gate. Nothing is written
    /// and nothing is published.
    pub(super) write: Option<DocumentWrite>,
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
        match self.db.with_conn(|conn| read_row(conn, harness_kind)) {
            Ok(row) => row,
            Err(error) => {
                tracing::warn!(harness_kind, %error, "failed to read agent-auth status row; treating as absent");
                None
            }
        }
    }

    /// The atomic compare-and-write, and the only way a document is persisted.
    ///
    /// `decide` is handed the row as it exists INSIDE a write transaction and
    /// returns the document to persist (or nothing at all, when there is no row
    /// to patch). Because the read it decides against and the write it produces
    /// share one transaction, no other writer — in this process or another one
    /// over the same file — can slip a document in between them. `decide` must
    /// therefore stay pure: composition (file reads, detection, the rotation
    /// readout) happens before this call, never inside it.
    ///
    /// `decide` is `Fn` rather than `FnOnce` because a lost snapshot re-runs it
    /// against a fresh read.
    pub(super) fn write_document<T, F>(
        &self,
        harness_kind: &str,
        now_epoch_s: i64,
        decide: F,
    ) -> Option<(T, bool)>
    where
        F: Fn(Option<&StatusRow>) -> Option<Decided<T>>,
    {
        let mut last_error = None;
        for _ in 0..WRITE_ATTEMPTS {
            let result = self.db.with_tx(|conn| {
                let row = read_row(conn, harness_kind)?;
                let Some(decided) = decide(row.as_ref()) else {
                    return Ok(None);
                };
                let Some(write) = decided.write else {
                    return Ok(Some((decided.payload, false)));
                };
                match &write.observation {
                    None => conn.execute(
                        "INSERT INTO agent_auth_status (
                            harness_kind, doc_json, updated_at_epoch_s
                         ) VALUES (?1, ?2, ?3)
                         ON CONFLICT(harness_kind) DO UPDATE SET
                            doc_json = excluded.doc_json,
                            updated_at_epoch_s = excluded.updated_at_epoch_s",
                        params![harness_kind, &write.doc_json, now_epoch_s],
                    )?,
                    Some((verdict, at)) => conn.execute(
                        "INSERT INTO agent_auth_status (
                            harness_kind, doc_json, probe_verdict, probe_at, updated_at_epoch_s
                         ) VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(harness_kind) DO UPDATE SET
                            doc_json = excluded.doc_json,
                            probe_verdict = excluded.probe_verdict,
                            probe_at = excluded.probe_at,
                            updated_at_epoch_s = excluded.updated_at_epoch_s",
                        params![harness_kind, &write.doc_json, verdict, at, now_epoch_s],
                    )?,
                };
                Ok(Some((decided.payload, true)))
            });
            match result {
                Ok(decided) => return decided,
                Err(error) => last_error = Some(error),
            }
        }
        if let Some(error) = last_error {
            tracing::warn!(harness_kind, %error, "failed to persist agent-auth status document");
        }
        None
    }

    /// Corrupt a row's stored document in place, for the malformed-row healing
    /// test. SQL lives here because the store is the domain's only query site.
    #[cfg(test)]
    pub(super) fn corrupt_doc_json_for_test(&self, harness_kind: &str, garbage: &str) {
        self.db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE agent_auth_status SET doc_json = ?2 WHERE harness_kind = ?1",
                    params![harness_kind, garbage],
                )
            })
            .expect("corrupt status row");
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

fn read_row(conn: &Connection, harness_kind: &str) -> rusqlite::Result<Option<StatusRow>> {
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
}
