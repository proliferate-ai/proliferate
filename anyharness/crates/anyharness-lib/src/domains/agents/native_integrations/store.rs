//! The `native_integration_selections` table: which integration ids the user
//! enabled, per agent kind. Spec: "Owned state". A row is a selection; there
//! is no disabled row, so disabling deletes.

use rusqlite::params;

use crate::persistence::Db;

#[derive(Clone)]
pub struct NativeIntegrationSelectionStore {
    db: Db,
}

impl NativeIntegrationSelectionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// Enabled integration ids for `agent_kind`, oldest selection first.
    pub fn list_enabled(&self, agent_kind: &str) -> anyhow::Result<Vec<String>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT integration_id FROM native_integration_selections
                 WHERE agent_kind = ?1
                 ORDER BY enabled_at, integration_id",
            )?;
            let ids = statement
                .query_map([agent_kind], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            Ok(ids)
        })
    }

    /// Enable inserts (a second enable is a no-op); disable deletes.
    pub fn set_enabled(
        &self,
        agent_kind: &str,
        integration_id: &str,
        enabled: bool,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            if enabled {
                conn.execute(
                    "INSERT OR IGNORE INTO native_integration_selections
                        (id, agent_kind, integration_id, enabled_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        agent_kind,
                        integration_id,
                        chrono::Utc::now().to_rfc3339(),
                    ],
                )?;
            } else {
                conn.execute(
                    "DELETE FROM native_integration_selections
                     WHERE agent_kind = ?1 AND integration_id = ?2",
                    params![agent_kind, integration_id],
                )?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> NativeIntegrationSelectionStore {
        NativeIntegrationSelectionStore::new(Db::open_in_memory().unwrap())
    }

    #[test]
    fn a_fresh_store_lists_no_selections_for_any_kind() {
        assert!(store().list_enabled("codex").unwrap().is_empty());
    }

    #[test]
    fn enabling_an_integration_makes_it_listed_for_its_kind_only() {
        let store = store();
        store
            .set_enabled("codex", "bundle:computer-use", true)
            .unwrap();
        assert_eq!(
            store.list_enabled("codex").unwrap(),
            vec!["bundle:computer-use".to_string()]
        );
        assert!(store.list_enabled("claude").unwrap().is_empty());
    }

    #[test]
    fn enabling_twice_keeps_a_single_selection_row() {
        let store = store();
        store.set_enabled("codex", "mcp:linear", true).unwrap();
        store.set_enabled("codex", "mcp:linear", true).unwrap();
        assert_eq!(
            store.list_enabled("codex").unwrap(),
            vec!["mcp:linear".to_string()]
        );
    }

    #[test]
    fn disabling_removes_the_selection_and_disabling_again_is_harmless() {
        let store = store();
        store.set_enabled("codex", "mcp:linear", true).unwrap();
        store.set_enabled("codex", "mcp:linear", false).unwrap();
        store.set_enabled("codex", "mcp:linear", false).unwrap();
        assert!(store.list_enabled("codex").unwrap().is_empty());
    }
}
