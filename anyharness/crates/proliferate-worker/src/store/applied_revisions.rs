use rusqlite::{params, OptionalExtension};

use super::WorkerStore;
use crate::error::WorkerError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ReconcileDomain {
    RuntimeConfig,
    Exposures,
    RevokedJti,
}

impl ReconcileDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RuntimeConfig => "runtime_config",
            Self::Exposures => "exposures",
            Self::RevokedJti => "revoked_jti",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedRevisionState {
    pub domain: ReconcileDomain,
    pub applied_revision: i64,
    pub desired_revision: i64,
    pub failure_count: i64,
    pub next_attempt_unix_ms: Option<i64>,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct RevisionFailure<'a> {
    pub next_attempt_unix_ms: Option<i64>,
    pub terminal: bool,
    pub error_code: Option<&'a str>,
    pub error_message: Option<&'a str>,
}

impl WorkerStore {
    pub fn get_applied_revision_state(
        &self,
        domain: ReconcileDomain,
    ) -> Result<AppliedRevisionState, WorkerError> {
        let conn = self.connection()?;
        let state = conn
            .query_row(
                r#"
                SELECT
                    applied_revision,
                    desired_revision,
                    failure_count,
                    next_attempt_unix_ms,
                    status,
                    error_code,
                    error_message
                FROM applied_revisions
                WHERE domain = ?1
                "#,
                params![domain.as_str()],
                |row| {
                    Ok(AppliedRevisionState {
                        domain,
                        applied_revision: row.get(0)?,
                        desired_revision: row.get(1)?,
                        failure_count: row.get(2)?,
                        next_attempt_unix_ms: row.get(3)?,
                        status: row.get(4)?,
                        error_code: row.get(5)?,
                        error_message: row.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(state.unwrap_or_else(|| AppliedRevisionState {
            domain,
            applied_revision: 0,
            desired_revision: 0,
            failure_count: 0,
            next_attempt_unix_ms: None,
            status: "idle".to_string(),
            error_code: None,
            error_message: None,
        }))
    }

    pub fn note_desired_revision(
        &self,
        domain: ReconcileDomain,
        desired_revision: i64,
    ) -> Result<AppliedRevisionState, WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO applied_revisions (
                domain,
                applied_revision,
                desired_revision,
                failure_count,
                next_attempt_unix_ms,
                status,
                updated_at
            )
            VALUES (?1, 0, ?2, 0, NULL, 'pending', CURRENT_TIMESTAMP)
            ON CONFLICT(domain) DO UPDATE SET
                desired_revision = MAX(applied_revisions.desired_revision, excluded.desired_revision),
                status = CASE
                    WHEN MAX(applied_revisions.desired_revision, excluded.desired_revision)
                        > applied_revisions.applied_revision
                    THEN 'pending'
                    ELSE applied_revisions.status
                END,
                next_attempt_unix_ms = CASE
                    WHEN excluded.desired_revision > applied_revisions.desired_revision
                    THEN NULL
                    ELSE applied_revisions.next_attempt_unix_ms
                END,
                error_code = CASE
                    WHEN excluded.desired_revision > applied_revisions.desired_revision
                    THEN NULL
                    ELSE applied_revisions.error_code
                END,
                error_message = CASE
                    WHEN excluded.desired_revision > applied_revisions.desired_revision
                    THEN NULL
                    ELSE applied_revisions.error_message
                END,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![domain.as_str(), desired_revision],
        )?;
        self.get_applied_revision_state(domain)
    }

    pub fn mark_revision_applied(
        &self,
        domain: ReconcileDomain,
        applied_revision: i64,
    ) -> Result<AppliedRevisionState, WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO applied_revisions (
                domain,
                applied_revision,
                desired_revision,
                failure_count,
                next_attempt_unix_ms,
                status,
                error_code,
                error_message,
                updated_at
            )
            VALUES (?1, ?2, ?2, 0, NULL, 'applied', NULL, NULL, CURRENT_TIMESTAMP)
            ON CONFLICT(domain) DO UPDATE SET
                applied_revision = MAX(applied_revisions.applied_revision, excluded.applied_revision),
                desired_revision = MAX(applied_revisions.desired_revision, excluded.desired_revision),
                failure_count = 0,
                next_attempt_unix_ms = NULL,
                status = 'applied',
                error_code = NULL,
                error_message = NULL,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![domain.as_str(), applied_revision],
        )?;
        self.get_applied_revision_state(domain)
    }

    #[allow(dead_code)]
    pub fn mark_revision_failed(
        &self,
        domain: ReconcileDomain,
        failure: RevisionFailure<'_>,
    ) -> Result<AppliedRevisionState, WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO applied_revisions (
                domain,
                applied_revision,
                desired_revision,
                failure_count,
                next_attempt_unix_ms,
                status,
                error_code,
                error_message,
                updated_at
            )
            VALUES (?1, 0, 0, 1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
            ON CONFLICT(domain) DO UPDATE SET
                failure_count = applied_revisions.failure_count + 1,
                next_attempt_unix_ms = excluded.next_attempt_unix_ms,
                status = excluded.status,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                domain.as_str(),
                failure.next_attempt_unix_ms,
                if failure.terminal {
                    "failed"
                } else {
                    "backing_off"
                },
                failure.error_code,
                failure.error_message,
            ],
        )?;
        self.get_applied_revision_state(domain)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::store::{ReconcileDomain, RevisionFailure, WorkerStore};

    static NEXT_DB_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn desired_revision_is_monotonic() {
        let store = test_store();
        store
            .note_desired_revision(ReconcileDomain::Exposures, 7)
            .expect("desired");
        let state = store
            .note_desired_revision(ReconcileDomain::Exposures, 6)
            .expect("stale desired");

        assert_eq!(state.desired_revision, 7);
        assert_eq!(state.applied_revision, 0);
        assert_eq!(state.status, "pending");
    }

    #[test]
    fn applied_revision_clears_backoff_state() {
        let store = test_store();
        store
            .note_desired_revision(ReconcileDomain::RevokedJti, 3)
            .expect("desired");
        store
            .mark_revision_failed(
                ReconcileDomain::RevokedJti,
                RevisionFailure {
                    next_attempt_unix_ms: Some(1000),
                    terminal: false,
                    error_code: Some("temporary"),
                    error_message: Some("temporary failure"),
                },
            )
            .expect("failed");

        let state = store
            .mark_revision_applied(ReconcileDomain::RevokedJti, 3)
            .expect("applied");
        assert_eq!(state.applied_revision, 3);
        assert_eq!(state.desired_revision, 3);
        assert_eq!(state.failure_count, 0);
        assert_eq!(state.next_attempt_unix_ms, None);
        assert_eq!(state.status, "applied");
    }

    #[test]
    fn newer_desired_revision_clears_backoff_state() {
        let store = test_store();
        store
            .note_desired_revision(ReconcileDomain::RevokedJti, 3)
            .expect("desired");
        store
            .mark_revision_failed(
                ReconcileDomain::RevokedJti,
                RevisionFailure {
                    next_attempt_unix_ms: Some(1000),
                    terminal: false,
                    error_code: Some("temporary"),
                    error_message: Some("temporary failure"),
                },
            )
            .expect("failed");

        let state = store
            .note_desired_revision(ReconcileDomain::RevokedJti, 4)
            .expect("new desired");
        assert_eq!(state.desired_revision, 4);
        assert_eq!(state.next_attempt_unix_ms, None);
        assert_eq!(state.error_code, None);
        assert_eq!(state.error_message, None);
        assert_eq!(state.status, "pending");
    }

    fn test_store() -> WorkerStore {
        let id = NEXT_DB_ID.fetch_add(1, Ordering::Relaxed);
        let dir: PathBuf = std::env::temp_dir().join(format!(
            "proliferate-worker-applied-revisions-test-{}-{id}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        WorkerStore::open(dir.join("worker.sqlite3")).expect("store")
    }
}
