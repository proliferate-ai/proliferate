use crate::persistence::Db;

mod attachments;
mod background_work;
mod events;
mod links;
mod live_config;
mod notifications;
mod pending_prompts;
mod sessions;

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct SessionStore {
    db: Db,
}

impl SessionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

pub(crate) fn delete_session_in_tx(conn: &rusqlite::Connection, id: &str) -> rusqlite::Result<()> {
    // Several durable tables still reference sessions without database-level
    // cascade rules, so session deletion must clear dependent rows explicitly.
    conn.execute("DELETE FROM cowork_threads WHERE session_id = ?1", [id])?;
    conn.execute(
        "DELETE FROM cowork_managed_workspaces WHERE parent_session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_background_work WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM review_feedback_jobs
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         )",
        [id],
    )?;
    conn.execute(
        "DELETE FROM review_run_candidate_plans
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         )",
        [id],
    )?;
    conn.execute(
        "DELETE FROM review_assignments
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         ) OR reviewer_session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM review_rounds
         WHERE review_run_id IN (
            SELECT id FROM review_runs
            WHERE parent_session_id = ?1
         )",
        [id],
    )?;
    conn.execute("DELETE FROM review_runs WHERE parent_session_id = ?1", [id])?;
    conn.execute(
        "DELETE FROM session_link_wake_schedules
         WHERE session_link_id IN (
            SELECT id FROM session_links
            WHERE parent_session_id = ?1 OR child_session_id = ?1
         )",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_link_completions
         WHERE session_link_id IN (
            SELECT id FROM session_links
            WHERE parent_session_id = ?1 OR child_session_id = ?1
         )",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_links WHERE parent_session_id = ?1 OR child_session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_pending_prompts WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_prompt_attachments WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_pending_config_changes WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_live_config_snapshots WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_raw_notifications WHERE session_id = ?1",
        [id],
    )?;
    conn.execute("DELETE FROM session_events WHERE session_id = ?1", [id])?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    Ok(())
}
