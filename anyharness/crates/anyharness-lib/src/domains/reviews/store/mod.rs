mod assignments;
pub(super) mod feedback;
mod iteration;
mod rounds;
mod rows;
mod runs;

use crate::persistence::Db;
use crate::sessions::deletion::SessionDeleteParticipant;

#[derive(Clone)]
pub struct ReviewStore {
    pub(crate) db: Db,
}

impl ReviewStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

pub(crate) fn delete_review_rows_for_session_in_tx(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM review_feedback_jobs
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         )",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM review_run_candidate_plans
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         )",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM review_assignments
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         ) OR reviewer_session_id = ?1",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM review_rounds
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         )",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM review_runs WHERE parent_session_id = ?1",
        [session_id],
    )?;
    Ok(())
}

pub struct ReviewDeleteParticipant;

impl SessionDeleteParticipant for ReviewDeleteParticipant {
    fn delete_session_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> rusqlite::Result<()> {
        delete_review_rows_for_session_in_tx(conn, session_id)
    }
}
