//! Session-scoped wake schedules: `session_wake_schedules`.
//!
//! The link-scoped table next door (`link_completions.rs`) keys a wake on a
//! `session_links` row, so it can only ever wake a parent about its own child.
//! These rows key on the session pair instead, which is what lets a wake be
//! armed on any session in the runtime.
//!
//! The consumption law is the link-scoped one: when the target finishes a turn,
//! ONE transaction deletes every schedule for that target and enqueues one
//! pointer prompt per deleted watcher. Nothing here can leave a schedule
//! consumed without a prompt, or fire two prompts for one schedule. A watcher
//! that is offline needs no special case — the pending prompt is a durable row
//! that drains when it next runs.

use rusqlite::params;

use super::SessionStore;
use crate::domains::sessions::model::PendingPromptRecord;
use crate::domains::sessions::prompt::PromptPayload;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentWakeScheduleRecord {
    pub watcher_session_id: String,
    pub target_session_id: String,
    pub created_at: String,
}

/// One schedule that a finished turn consumed, with the pointer prompt queued
/// for its watcher in the same transaction.
#[derive(Debug, Clone)]
pub struct ConsumedAgentWake {
    pub watcher_session_id: String,
    pub wake_prompt: PendingPromptRecord,
}

impl SessionStore {
    /// Arm `watcher` on `target`. Idempotent by the pair primary key: arming a
    /// schedule that already exists is a no-op and reports `false`.
    pub fn arm_agent_wake(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        let created_at = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT OR IGNORE INTO session_wake_schedules (
                    watcher_session_id, target_session_id, created_at
                 ) VALUES (?1, ?2, ?3)",
                params![watcher_session_id, target_session_id, created_at],
            )?;
            Ok(inserted > 0)
        })
    }

    /// Drop one schedule without waking anyone. Used when a real reply already
    /// carried the content the pointer would only have pointed at, and to
    /// compensate an arm whose send then failed.
    pub fn delete_agent_wake(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute(
                "DELETE FROM session_wake_schedules
                 WHERE watcher_session_id = ?1 AND target_session_id = ?2",
                params![watcher_session_id, target_session_id],
            )?;
            Ok(deleted > 0)
        })
    }

    pub fn list_agent_wakes_for_target(
        &self,
        target_session_id: &str,
    ) -> anyhow::Result<Vec<AgentWakeScheduleRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT watcher_session_id, target_session_id, created_at
                 FROM session_wake_schedules
                 WHERE target_session_id = ?1
                 ORDER BY created_at ASC, watcher_session_id ASC",
            )?;
            let rows = stmt.query_map([target_session_id], map_schedule)?;
            rows.collect()
        })
    }

    pub fn list_agent_wakes_for_watcher(
        &self,
        watcher_session_id: &str,
    ) -> anyhow::Result<Vec<AgentWakeScheduleRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT watcher_session_id, target_session_id, created_at
                 FROM session_wake_schedules
                 WHERE watcher_session_id = ?1
                 ORDER BY created_at ASC, target_session_id ASC",
            )?;
            let rows = stmt.query_map([watcher_session_id], map_schedule)?;
            rows.collect()
        })
    }

    /// The turn-finish transaction. Deletes every schedule watching `target`
    /// and queues one pointer prompt per deleted watcher, atomically.
    ///
    /// A schedule armed while the target's turn was still running is an
    /// ordinary row by the time this reads, so ruling 10 ("wakes cover the
    /// current turn") needs no schema and no special case — it falls out of
    /// consuming at turn finish rather than at arm time.
    pub fn consume_agent_wakes_for_target(
        &self,
        target_session_id: &str,
        wake_prompt: &PromptPayload,
    ) -> anyhow::Result<Vec<ConsumedAgentWake>> {
        let blocks_json = wake_prompt.blocks_json()?;
        let provenance_json = wake_prompt.provenance_json()?;
        self.db.with_tx(|tx| {
            let watchers: Vec<String> = {
                let mut stmt = tx.prepare(
                    "SELECT watcher_session_id FROM session_wake_schedules
                     WHERE target_session_id = ?1
                     ORDER BY created_at ASC, watcher_session_id ASC",
                )?;
                let rows = stmt.query_map([target_session_id], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<String>>>()?
            };
            if watchers.is_empty() {
                return Ok(Vec::new());
            }

            let deleted = tx.execute(
                "DELETE FROM session_wake_schedules WHERE target_session_id = ?1",
                [target_session_id],
            )?;
            // The read and the delete run under the same write transaction, so
            // this can only trip if the two statements ever stop selecting the
            // same rows.
            debug_assert_eq!(deleted, watchers.len());

            let queued_at = chrono::Utc::now().to_rfc3339();
            let mut consumed = Vec::with_capacity(watchers.len());
            for watcher_session_id in watchers {
                tx.execute(
                    "UPDATE sessions
                     SET pending_prompt_seq_cursor = pending_prompt_seq_cursor + 1
                     WHERE id = ?1",
                    [watcher_session_id.as_str()],
                )?;
                let next_seq: i64 = tx.query_row(
                    "SELECT pending_prompt_seq_cursor FROM sessions WHERE id = ?1",
                    [watcher_session_id.as_str()],
                    |row| row.get(0),
                )?;
                let next_position: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(queue_position), 0) + 1
                     FROM session_pending_prompts WHERE session_id = ?1",
                    [watcher_session_id.as_str()],
                    |row| row.get(0),
                )?;
                tx.execute(
                    "INSERT INTO session_pending_prompts (
                        session_id, seq, queue_position, prompt_id, text,
                        blocks_json, provenance_json, queued_at
                     ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)",
                    params![
                        watcher_session_id,
                        next_seq,
                        next_position,
                        wake_prompt.text_summary.as_str(),
                        blocks_json,
                        provenance_json,
                        queued_at,
                    ],
                )?;
                consumed.push(ConsumedAgentWake {
                    wake_prompt: PendingPromptRecord {
                        session_id: watcher_session_id.clone(),
                        seq: next_seq,
                        queue_position: next_position,
                        prompt_id: None,
                        text: wake_prompt.text_summary.clone(),
                        blocks_json: blocks_json.clone(),
                        provenance_json: provenance_json.clone(),
                        queued_at: queued_at.clone(),
                    },
                    watcher_session_id,
                });
            }
            Ok(consumed)
        })
    }
}

fn map_schedule(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentWakeScheduleRecord> {
    Ok(AgentWakeScheduleRecord {
        watcher_session_id: row.get("watcher_session_id")?,
        target_session_id: row.get("target_session_id")?,
        created_at: row.get("created_at")?,
    })
}

pub(crate) fn delete_agent_wake_rows_for_session_in_tx(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM session_wake_schedules
         WHERE watcher_session_id = ?1 OR target_session_id = ?1",
        [session_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::persistence::Db;

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some(format!("Agent {id}")),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn store_fixture() -> SessionStore {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        let store = SessionStore::new(db);
        for id in ["ses_watcher", "ses_target"] {
            store.insert(&session_record(id)).expect("insert session");
        }
        store
    }

    #[test]
    fn the_pair_key_makes_a_double_arm_one_row() {
        let store = store_fixture();

        assert!(store
            .arm_agent_wake("ses_watcher", "ses_target")
            .expect("arm"));
        assert!(!store
            .arm_agent_wake("ses_watcher", "ses_target")
            .expect("arm again"));

        assert_eq!(
            store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")
                .len(),
            1
        );
    }

    #[test]
    fn the_table_refuses_a_session_watching_itself() {
        let store = store_fixture();

        let error = store
            .db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO session_wake_schedules (
                        watcher_session_id, target_session_id, created_at
                     ) VALUES ('ses_watcher', 'ses_watcher', '2026-08-08T00:00:00Z')",
                    [],
                )
            })
            .err()
            .expect("the CHECK constraint rejects a self-wake");

        assert!(error.to_string().to_lowercase().contains("constraint"));
        // `INSERT OR IGNORE` swallows a CHECK violation the same way it
        // swallows a duplicate pair, so the store's own arm reports a plain
        // no-op here. That is why the service refuses a self-wake explicitly
        // instead of letting the row be the whole guard.
        assert!(!store
            .arm_agent_wake("ses_watcher", "ses_watcher")
            .expect("arm reports a no-op"));
        assert!(store
            .list_agent_wakes_for_target("ses_watcher")
            .expect("list")
            .is_empty());
    }

    #[test]
    fn consumption_queues_exactly_one_prompt_per_deleted_schedule() {
        let store = store_fixture();
        store
            .insert(&session_record("ses_watcher_2"))
            .expect("insert second watcher");
        store
            .arm_agent_wake("ses_watcher", "ses_target")
            .expect("arm");
        store
            .arm_agent_wake("ses_watcher_2", "ses_target")
            .expect("arm");
        let payload = PromptPayload::text("pointer".to_string());

        let consumed = store
            .consume_agent_wakes_for_target("ses_target", &payload)
            .expect("consume");

        assert_eq!(consumed.len(), 2);
        assert!(store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .is_empty());
        for watcher in ["ses_watcher", "ses_watcher_2"] {
            let pending = store
                .list_pending_prompts(watcher)
                .expect("pending prompts");
            assert_eq!(
                pending.len(),
                1,
                "{watcher} should have exactly one pointer"
            );
            assert_eq!(pending[0].text, "pointer");
        }
    }

    #[test]
    fn a_wake_on_one_target_is_untouched_by_another_targets_turn() {
        let store = store_fixture();
        store
            .insert(&session_record("ses_other"))
            .expect("insert other target");
        store
            .arm_agent_wake("ses_watcher", "ses_target")
            .expect("arm");
        store
            .arm_agent_wake("ses_watcher", "ses_other")
            .expect("arm");
        let payload = PromptPayload::text("pointer".to_string());

        let consumed = store
            .consume_agent_wakes_for_target("ses_other", &payload)
            .expect("consume");

        assert_eq!(consumed.len(), 1);
        let remaining = store
            .list_agent_wakes_for_watcher("ses_watcher")
            .expect("list");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].target_session_id, "ses_target");
    }

    #[test]
    fn a_failed_enqueue_rolls_the_whole_consumption_back() {
        // Atomicity, the guarantee the link-scoped wake also makes: a schedule
        // is never consumed without its prompt, and one watcher's failure
        // cannot leave another watcher's schedule deleted. A trigger fails the
        // SECOND watcher's enqueue, so the first watcher's already-executed
        // DELETE and INSERT have to roll back with it.
        let store = store_fixture();
        store
            .insert(&session_record("ses_watcher_2"))
            .expect("insert second watcher");
        store
            .arm_agent_wake("ses_watcher", "ses_target")
            .expect("arm");
        store
            .arm_agent_wake("ses_watcher_2", "ses_target")
            .expect("arm");
        store
            .db
            .with_conn(|conn| {
                conn.execute_batch(
                    "CREATE TRIGGER refuse_second_watcher
                     BEFORE INSERT ON session_pending_prompts
                     WHEN NEW.session_id = 'ses_watcher_2'
                     BEGIN SELECT RAISE(ABORT, 'enqueue refused'); END;",
                )?;
                Ok(())
            })
            .expect("install the failing enqueue");
        let payload = PromptPayload::text("pointer".to_string());

        store
            .consume_agent_wakes_for_target("ses_target", &payload)
            .expect_err("the enqueue fails");

        assert_eq!(
            store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")
                .len(),
            2,
            "a schedule must never be consumed without its prompt"
        );
        assert!(
            store
                .list_pending_prompts("ses_watcher")
                .expect("pending prompts")
                .is_empty(),
            "the first watcher's prompt must roll back with the failed one"
        );
    }
}
