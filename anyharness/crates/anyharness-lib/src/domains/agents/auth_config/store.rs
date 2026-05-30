use anyharness_contract::v1::AgentAuthExternalScope;
use rusqlite::{params, OptionalExtension};

use crate::persistence::Db;

#[derive(Debug, Clone)]
pub(super) struct AgentAuthConfigRecord {
    pub(super) scope_provider: String,
    pub(super) scope_id: String,
    pub(super) target_id: Option<String>,
    pub(super) revision: i64,
    pub(super) config_ciphertext: String,
}

#[derive(Clone)]
pub struct AgentAuthConfigStore {
    db: Db,
}

impl AgentAuthConfigStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub(super) fn current_revision(&self, scope_key: &str) -> anyhow::Result<Option<i64>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT revision FROM agent_auth_config WHERE scope_key = ?1",
                [scope_key],
                |row| row.get(0),
            )
            .optional()
        })
    }

    pub(super) fn upsert(
        &self,
        scope_key: &str,
        scope: &AgentAuthExternalScope,
        revision: i64,
        config_ciphertext: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_tx(|conn| {
            let changed = conn.execute(
                "INSERT INTO agent_auth_config (
                    scope_key, scope_provider, scope_id, target_id, revision,
                    config_ciphertext, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now')
                 )
                 ON CONFLICT(scope_key) DO UPDATE SET
                    scope_provider = excluded.scope_provider,
                    scope_id = excluded.scope_id,
                    target_id = excluded.target_id,
                    revision = excluded.revision,
                    config_ciphertext = excluded.config_ciphertext,
                    updated_at = datetime('now')
                 WHERE agent_auth_config.revision <= excluded.revision",
                params![
                    scope_key,
                    scope.provider,
                    scope.id,
                    scope.target_id.as_deref(),
                    revision,
                    config_ciphertext,
                ],
            )?;
            Ok(changed > 0)
        })
    }

    pub(super) fn latest(&self) -> anyhow::Result<Option<AgentAuthConfigRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision, config_ciphertext
                 FROM agent_auth_config
                 ORDER BY updated_at DESC
                 LIMIT 1",
                [],
                |row| {
                    Ok(AgentAuthConfigRecord {
                        scope_provider: row.get(0)?,
                        scope_id: row.get(1)?,
                        target_id: row.get(2)?,
                        revision: row.get(3)?,
                        config_ciphertext: row.get(4)?,
                    })
                },
            )
            .optional()
        })
    }

    pub(super) fn find_by_scope(
        &self,
        scope_key: &str,
    ) -> anyhow::Result<Option<AgentAuthConfigRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision, config_ciphertext
                 FROM agent_auth_config
                 WHERE scope_key = ?1",
                [scope_key],
                |row| {
                    Ok(AgentAuthConfigRecord {
                        scope_provider: row.get(0)?,
                        scope_id: row.get(1)?,
                        target_id: row.get(2)?,
                        revision: row.get(3)?,
                        config_ciphertext: row.get(4)?,
                    })
                },
            )
            .optional()
        })
    }
}
