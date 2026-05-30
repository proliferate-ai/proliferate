use std::sync::Arc;

use crate::persistence::Db;

pub trait SessionDeleteParticipant: Send + Sync {
    fn delete_session_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> rusqlite::Result<()>;
}

#[derive(Clone)]
pub struct SessionDeleteWorkflow {
    db: Db,
    participants: Vec<Arc<dyn SessionDeleteParticipant>>,
}

impl SessionDeleteWorkflow {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            participants: Vec::new(),
        }
    }

    pub fn with_participants(db: Db, participants: Vec<Arc<dyn SessionDeleteParticipant>>) -> Self {
        Self { db, participants }
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
        for participant in &self.participants {
            participant.delete_session_rows_in_tx(conn, session_id)?;
        }
        crate::sessions::links::store::delete_session_link_rows_for_session_in_tx(
            conn, session_id,
        )?;
        crate::sessions::store::sessions::delete_session_rows_in_tx(conn, session_id)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "deletion_tests.rs"]
mod tests;
