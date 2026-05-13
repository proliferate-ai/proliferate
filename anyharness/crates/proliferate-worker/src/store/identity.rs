use rusqlite::{params, OptionalExtension};

use crate::error::Result;
use crate::identity::credentials::StoredIdentity;

use super::{now_rfc3339, Store};

impl Store {
    pub fn load_identity(&self) -> Result<Option<StoredIdentity>> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT target_id, worker_id, install_id, cloud_base_url, credential_kind, credential_value
                 FROM identity WHERE singleton = 1",
                [],
                |row| {
                    Ok(StoredIdentity {
                        target_id: row.get(0)?,
                        worker_id: row.get(1)?,
                        install_id: row.get(2)?,
                        cloud_base_url: row.get(3)?,
                        credential_kind: row.get(4)?,
                        credential_value: row.get(5)?,
                    })
                },
            )
            .optional()
        })
    }

    pub fn save_identity(&self, identity: &StoredIdentity) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO identity (
                    singleton, target_id, worker_id, install_id, cloud_base_url,
                    credential_kind, credential_value, created_at, updated_at
                 )
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                 ON CONFLICT(singleton) DO UPDATE SET
                    target_id = excluded.target_id,
                    worker_id = excluded.worker_id,
                    install_id = excluded.install_id,
                    cloud_base_url = excluded.cloud_base_url,
                    credential_kind = excluded.credential_kind,
                    credential_value = excluded.credential_value,
                    updated_at = excluded.updated_at",
                params![
                    identity.target_id,
                    identity.worker_id,
                    identity.install_id,
                    identity.cloud_base_url,
                    identity.credential_kind,
                    identity.credential_value,
                    now,
                ],
            )?;
            Ok(())
        })
    }
}
