use crate::persistence::Db;

#[derive(Clone)]
pub struct SessionDeleteWorkflow {
    db: Db,
}

impl SessionDeleteWorkflow {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.db
            .with_tx(|conn| self.delete_session_graph_in_tx(conn, session_id))
    }

    pub(crate) fn delete_session_graph_in_tx(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> rusqlite::Result<()> {
        crate::domains::sessions::links::store::delete_session_link_rows_for_session_in_tx(
            conn, session_id,
        )?;
        crate::domains::sessions::store::sessions::delete_session_rows_in_tx(conn, session_id)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "deletion_tests.rs"]
mod tests;
