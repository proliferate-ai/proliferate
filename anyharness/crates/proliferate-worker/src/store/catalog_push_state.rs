//! Last catalog version successfully pushed into the runtime, per catalog
//! kind. Heartbeat convergence compares the heartbeat-advertised version to
//! this record and only fetches/pushes on a DIFFERENCE (rollbacks included).

use rusqlite::{params, OptionalExtension};

use super::WorkerStore;
use crate::error::WorkerError;

const AGENT_CATALOG_KEY: &str = "agents";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogPushState {
    pub pushed_version: String,
    pub etag: Option<String>,
}

impl WorkerStore {
    pub fn load_agent_catalog_push_state(&self) -> Result<Option<CatalogPushState>, WorkerError> {
        let conn = self.connection()?;
        let value = conn
            .query_row(
                "SELECT pushed_version, etag FROM catalog_push_state WHERE catalog = ?1",
                params![AGENT_CATALOG_KEY],
                |row| {
                    Ok(CatalogPushState {
                        pushed_version: row.get(0)?,
                        etag: row.get(1)?,
                    })
                },
            )
            .optional()?;
        Ok(value)
    }

    pub fn record_agent_catalog_push(
        &self,
        pushed_version: &str,
        etag: Option<&str>,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO catalog_push_state (catalog, pushed_version, etag, updated_at)
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
            ON CONFLICT(catalog) DO UPDATE SET
                pushed_version = excluded.pushed_version,
                etag = excluded.etag,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![AGENT_CATALOG_KEY, pushed_version, etag],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::CatalogPushState;
    use crate::store::WorkerStore;

    static NEXT_DB_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn push_state_starts_empty_and_round_trips() {
        let store = test_store();
        assert_eq!(store.load_agent_catalog_push_state().expect("load"), None);

        store
            .record_agent_catalog_push("2026-06-10.6", Some("\"abc\""))
            .expect("record");
        assert_eq!(
            store.load_agent_catalog_push_state().expect("load"),
            Some(CatalogPushState {
                pushed_version: "2026-06-10.6".to_string(),
                etag: Some("\"abc\"".to_string()),
            })
        );
    }

    #[test]
    fn push_state_overwrites_including_downgrade() {
        let store = test_store();
        store
            .record_agent_catalog_push("2026-06-10.6", Some("\"new\""))
            .expect("record");
        store
            .record_agent_catalog_push("2026-06-09.1", None)
            .expect("rollback record");
        assert_eq!(
            store.load_agent_catalog_push_state().expect("load"),
            Some(CatalogPushState {
                pushed_version: "2026-06-09.1".to_string(),
                etag: None,
            })
        );
    }

    fn test_store() -> WorkerStore {
        let id = NEXT_DB_ID.fetch_add(1, Ordering::Relaxed);
        let dir: PathBuf = std::env::temp_dir().join(format!(
            "proliferate-worker-catalog-push-state-test-{}-{id}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        WorkerStore::open(dir.join("worker.sqlite3")).expect("store")
    }
}
