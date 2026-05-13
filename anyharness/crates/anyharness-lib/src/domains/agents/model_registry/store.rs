use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::persistence::Db;

use super::model::{
    DynamicModelRegistryModel, DynamicModelRegistrySnapshot, DynamicModelRegistrySource,
    DynamicModelRegistryStatus,
};

#[derive(Clone)]
pub struct DynamicModelRegistryStore {
    db: Db,
}

impl DynamicModelRegistryStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn get(
        &self,
        kind: &str,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Option<DynamicModelRegistrySnapshot>> {
        let workspace_scope = workspace_scope(workspace_id);
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT kind, workspace_id, source, status, refreshed_at, expires_at,
                        models_json, warnings_json, error_message
                 FROM agent_model_registry_snapshots
                 WHERE kind = ?1 AND workspace_scope = ?2",
                params![kind, workspace_scope],
                row_to_snapshot,
            )
            .optional()
        })
    }

    pub fn upsert(&self, snapshot: &DynamicModelRegistrySnapshot) -> anyhow::Result<()> {
        let workspace_scope = workspace_scope(snapshot.workspace_id.as_deref());
        let models_json = serde_json::to_string(&snapshot.models)?;
        let warnings_json = serde_json::to_string(&snapshot.warnings)?;
        let refreshed_at = snapshot.refreshed_at.to_rfc3339();
        let expires_at = snapshot.expires_at.map(|value| value.to_rfc3339());
        let id = Uuid::new_v4().to_string();

        self.db.with_tx(|conn| {
            conn.execute(
                "INSERT INTO agent_model_registry_snapshots (
                    id, kind, workspace_id, workspace_scope, source, status,
                    refreshed_at, expires_at, models_json, warnings_json,
                    error_message, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    datetime('now'), datetime('now')
                 )
                 ON CONFLICT(kind, workspace_scope) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    source = excluded.source,
                    status = excluded.status,
                    refreshed_at = excluded.refreshed_at,
                    expires_at = excluded.expires_at,
                    models_json = excluded.models_json,
                    warnings_json = excluded.warnings_json,
                    error_message = excluded.error_message,
                    updated_at = datetime('now')",
                params![
                    id,
                    snapshot.kind.as_str(),
                    snapshot.workspace_id.as_deref(),
                    workspace_scope,
                    snapshot.source.as_str(),
                    snapshot.status.as_str(),
                    refreshed_at,
                    expires_at,
                    models_json,
                    warnings_json,
                    snapshot.error_message.as_deref(),
                ],
            )?;
            Ok(())
        })
    }
}

fn row_to_snapshot(row: &rusqlite::Row<'_>) -> rusqlite::Result<DynamicModelRegistrySnapshot> {
    let source: String = row.get(2)?;
    let status: String = row.get(3)?;
    let refreshed_at: String = row.get(4)?;
    let expires_at: Option<String> = row.get(5)?;
    let models_json: String = row.get(6)?;
    let warnings_json: String = row.get(7)?;

    Ok(DynamicModelRegistrySnapshot {
        kind: row.get(0)?,
        workspace_id: row.get(1)?,
        source: DynamicModelRegistrySource::parse(&source)
            .unwrap_or(DynamicModelRegistrySource::ProviderCli),
        status: DynamicModelRegistryStatus::parse(&status)
            .unwrap_or(DynamicModelRegistryStatus::RefreshFailed),
        refreshed_at: parse_time(&refreshed_at),
        expires_at: expires_at.as_deref().map(parse_time),
        models: serde_json::from_str::<Vec<DynamicModelRegistryModel>>(&models_json)
            .unwrap_or_default(),
        warnings: serde_json::from_str::<Vec<String>>(&warnings_json).unwrap_or_default(),
        error_message: row.get(8)?,
    })
}

fn parse_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn workspace_scope(workspace_id: Option<&str>) -> String {
    workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::domains::agents::model::ModelCatalogStatus;
    use crate::persistence::Db;

    use super::*;

    #[test]
    fn stores_and_replaces_workspace_scoped_snapshot() {
        let store = DynamicModelRegistryStore::new(Db::open_in_memory().expect("db"));
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "opencode".to_string(),
            workspace_id: Some("workspace-1".to_string()),
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: Utc::now(),
            expires_at: None,
            models: vec![DynamicModelRegistryModel {
                id: "opencode/big-pickle".to_string(),
                display_name: "Big Pickle".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: Some(true),
                provider: Some("opencode".to_string()),
            }],
            warnings: vec![],
            error_message: None,
        };

        store.upsert(&snapshot).expect("upsert");
        let loaded = store
            .get("opencode", Some("workspace-1"))
            .expect("load")
            .expect("snapshot");

        assert_eq!(loaded.kind, "opencode");
        assert_eq!(loaded.workspace_id.as_deref(), Some("workspace-1"));
        assert_eq!(loaded.models[0].display_name, "Big Pickle");
        assert_eq!(loaded.models[0].default_opt_in, Some(true));
    }
}
