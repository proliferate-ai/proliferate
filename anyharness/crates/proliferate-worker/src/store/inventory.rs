use rusqlite::{params, OptionalExtension};

use crate::error::Result;

use super::{now_rfc3339, Store};

#[derive(Debug, Clone)]
pub struct InventoryCacheRecord {
    pub cache_key: String,
    pub last_report_hash: String,
    pub last_reported_at: String,
    pub payload: String,
}

impl Store {
    pub fn load_inventory_cache(&self, cache_key: &str) -> Result<Option<InventoryCacheRecord>> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT cache_key, last_report_hash, last_reported_at, payload
                 FROM inventory_cache WHERE cache_key = ?1",
                params![cache_key],
                |row| {
                    Ok(InventoryCacheRecord {
                        cache_key: row.get(0)?,
                        last_report_hash: row.get(1)?,
                        last_reported_at: row.get(2)?,
                        payload: row.get(3)?,
                    })
                },
            )
            .optional()
        })
    }

    pub fn save_inventory_cache(
        &self,
        cache_key: &str,
        report_hash: &str,
        payload: &str,
    ) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO inventory_cache(cache_key, last_report_hash, last_reported_at, payload)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(cache_key) DO UPDATE SET
                    last_report_hash = excluded.last_report_hash,
                    last_reported_at = excluded.last_reported_at,
                    payload = excluded.payload",
                params![cache_key, report_hash, now, payload],
            )?;
            Ok(())
        })
    }
}
