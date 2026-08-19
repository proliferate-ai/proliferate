use rusqlite::{params, OptionalExtension};

use super::types::{HarnessLaunchOptionStateRow, HarnessLaunchOptions, ProbeState};
use crate::persistence::Db;

#[derive(Clone)]
pub(super) struct HarnessLaunchOptionsStore {
    db: Db,
}

impl HarnessLaunchOptionsStore {
    pub(super) fn new(db: Db) -> Self {
        Self { db }
    }

    pub(super) fn read(&self, harness_kind: &str) -> anyhow::Result<Option<HarnessLaunchOptionStateRow>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT harness_kind, basis_revision, revision, options_json, observed_at,
                        probe_state, probe_attempted_at, probe_failure_code
                 FROM harness_launch_option_states WHERE harness_kind = ?1",
                [harness_kind],
                map_row,
            )
            .optional()
        })
    }

    pub(super) fn begin_probe(
        &self,
        harness_kind: &str,
        basis_revision: &str,
        attempted_at: &str,
    ) -> anyhow::Result<HarnessLaunchOptionStateRow> {
        self.db.with_tx(|conn| {
            let current = conn
                .query_row(
                    "SELECT harness_kind, basis_revision, revision, options_json, observed_at,
                            probe_state, probe_attempted_at, probe_failure_code
                     FROM harness_launch_option_states WHERE harness_kind = ?1",
                    [harness_kind],
                    map_row,
                )
                .optional()?;
            match current {
                Some(current) if current.basis_revision == basis_revision => {
                    conn.execute(
                        "UPDATE harness_launch_option_states
                         SET revision = revision + 1, probe_state = 'probing',
                             probe_attempted_at = ?1, probe_failure_code = NULL
                         WHERE harness_kind = ?2",
                        params![attempted_at, harness_kind],
                    )?;
                }
                Some(_) => {
                    conn.execute(
                        "UPDATE harness_launch_option_states
                         SET basis_revision = ?1, revision = revision + 1,
                             options_json = NULL, observed_at = NULL,
                             probe_state = 'probing', probe_attempted_at = ?2,
                             probe_failure_code = NULL
                         WHERE harness_kind = ?3",
                        params![basis_revision, attempted_at, harness_kind],
                    )?;
                }
                None => {
                    conn.execute(
                        "INSERT INTO harness_launch_option_states (
                            harness_kind, basis_revision, revision, options_json, observed_at,
                            probe_state, probe_attempted_at, probe_failure_code
                         ) VALUES (?1, ?2, 1, NULL, NULL, 'probing', ?3, NULL)",
                        params![harness_kind, basis_revision, attempted_at],
                    )?;
                }
            }
            conn.query_row(
                "SELECT harness_kind, basis_revision, revision, options_json, observed_at,
                        probe_state, probe_attempted_at, probe_failure_code
                 FROM harness_launch_option_states WHERE harness_kind = ?1",
                [harness_kind],
                map_row,
            )
        })
    }

    pub(super) fn finish_success(
        &self,
        harness_kind: &str,
        basis_revision: &str,
        started_revision: i64,
        options: &HarnessLaunchOptions,
        observed_at: &str,
    ) -> anyhow::Result<bool> {
        let options_json = serde_json::to_string(options)?;
        self.db.with_conn(|conn| {
            Ok(conn.execute(
                "UPDATE harness_launch_option_states
                 SET revision = revision + 1, options_json = ?1, observed_at = ?2,
                     probe_state = 'succeeded', probe_attempted_at = ?2,
                     probe_failure_code = NULL
                 WHERE harness_kind = ?3 AND basis_revision = ?4 AND revision = ?5",
                params![options_json, observed_at, harness_kind, basis_revision, started_revision],
            )? == 1)
        })
    }

    pub(super) fn finish_failure(
        &self,
        harness_kind: &str,
        basis_revision: &str,
        started_revision: i64,
        attempted_at: &str,
        failure_code: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            Ok(conn.execute(
                "UPDATE harness_launch_option_states
                 SET revision = revision + 1, probe_state = 'failed',
                     probe_attempted_at = ?1, probe_failure_code = ?2
                 WHERE harness_kind = ?3 AND basis_revision = ?4 AND revision = ?5",
                params![attempted_at, failure_code, harness_kind, basis_revision, started_revision],
            )? == 1)
        })
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HarnessLaunchOptionStateRow> {
    let options_json: Option<String> = row.get("options_json")?;
    let options = options_json
        .map(|json| {
            serde_json::from_str::<HarnessLaunchOptions>(&json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()?;
    let probe_state: String = row.get("probe_state")?;
    Ok(HarnessLaunchOptionStateRow {
        harness_kind: row.get("harness_kind")?,
        basis_revision: row.get("basis_revision")?,
        revision: row.get("revision")?,
        options,
        observed_at: row.get("observed_at")?,
        probe_state: ProbeState::parse(&probe_state)?,
        probe_attempted_at: row.get("probe_attempted_at")?,
        probe_failure_code: row.get("probe_failure_code")?,
    })
}
