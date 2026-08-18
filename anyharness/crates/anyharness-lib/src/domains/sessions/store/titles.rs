use rusqlite::params;

use super::SessionStore;

impl SessionStore {
    pub fn update_title(&self, id: &str, title: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, now, id],
            )?;
            Ok(())
        })
    }

    /// Sets the title only when the session has none yet; returns whether the
    /// title was applied. Harness-provided titles use this so they never
    /// replace a title assigned by the user or the product.
    pub fn update_title_if_absent(&self, id: &str, title: &str, now: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE sessions SET title = ?1, updated_at = ?2
                 WHERE id = ?3 AND (title IS NULL OR TRIM(title) = '')",
                params![title, now, id],
            )?;
            Ok(changed > 0)
        })
    }

    /// Clears a title only while it still matches `title`, so a prompt title
    /// stored before dispatch can be undone when that dispatch fails without
    /// touching a title assigned in the meantime.
    pub fn clear_title_if_matches(&self, id: &str, title: &str, now: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE sessions SET title = NULL, updated_at = ?2 WHERE id = ?3 AND title = ?1",
                params![title, now, id],
            )?;
            Ok(changed > 0)
        })
    }
}
