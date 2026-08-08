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
//!
//! Two watcher classes are treated specially by that transaction, and both
//! decisions live here rather than in the caller so they stay inside the one
//! write: a CLOSED watcher's row is deleted without a prompt (ruling 6 — a
//! closed session takes no input, so the schedule is unfulfillable, not
//! pending), and a workflow-controlled watcher's row is left ARMED so the wake
//! fires after control releases. Who is controlled is decided by the caller
//! with a read-only controller lookup and passed in — this module never touches
//! admission.

use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::model::PendingPromptRecord;
use crate::domains::sessions::prompt::PromptPayload;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentWakeScheduleRecord {
    pub watcher_session_id: String,
    pub target_session_id: String,
    pub created_at: String,
    pub armed_for_reply: bool,
    pub dispatch_confirmed_at: Option<String>,
}

/// Why a schedule was armed. The row is the same row either way; the reason
/// decides only what may consume it before the target's turn ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentWakeReason {
    /// `schedule_agent_wake` (agent) or the human wake route: a standing
    /// request that only the target's turn finish consumes.
    ExplicitSchedule,
    /// `wakeOnReply` on a send: the safety net for an answer that may never
    /// come, so the answer itself consumes it.
    Reply,
}

impl AgentWakeReason {
    fn armed_for_reply(self) -> i64 {
        match self {
            Self::ExplicitSchedule => 0,
            Self::Reply => 1,
        }
    }
}

/// One schedule that a finished turn consumed, with the pointer prompt queued
/// for its watcher in the same transaction.
#[derive(Debug, Clone)]
pub struct ConsumedAgentWake {
    pub watcher_session_id: String,
    pub wake_prompt: PendingPromptRecord,
}

/// What one turn-finish transaction did to the target's schedules.
#[derive(Debug, Clone, Default)]
pub struct AgentWakeConsumption {
    /// Schedules consumed with their pointer queued.
    pub fired: Vec<ConsumedAgentWake>,
    /// Schedules dropped without a pointer because the watcher is closed.
    pub dropped_closed_watchers: Vec<String>,
    /// Schedules deliberately left armed because a workflow controls the
    /// watcher; they fire at the target's next finished turn after release.
    pub left_armed_controlled_watchers: Vec<String>,
}

impl SessionStore {
    /// Arm `watcher` on `target` for `reason`.
    ///
    /// Idempotent by the pair primary key: arming a schedule that already
    /// exists reports `false` and never queues a second wake. When the reasons
    /// differ the row keeps the STRONGER one — an explicit schedule outranks a
    /// reply arm and is never downgraded back, because a reply must not
    /// silently cancel a wake the caller asked for standalone.
    ///
    /// This is a plain `INSERT`, not `INSERT OR IGNORE`: the pair CHECK
    /// (`watcher != target`) must surface as an error rather than as a silent
    /// no-op. `authorize`'s `SelfTarget` refusal makes a self-arm unreachable
    /// from every caller; the SQL layer says so too.
    pub fn arm_agent_wake(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
        reason: AgentWakeReason,
    ) -> anyhow::Result<bool> {
        let created_at = chrono::Utc::now().to_rfc3339();
        let armed_for_reply = reason.armed_for_reply();
        self.db.with_tx(|tx| {
            let existing: Option<i64> = tx
                .query_row(
                    "SELECT armed_for_reply FROM session_wake_schedules
                     WHERE watcher_session_id = ?1 AND target_session_id = ?2",
                    params![watcher_session_id, target_session_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(existing_armed_for_reply) = existing else {
                tx.execute(
                    "INSERT INTO session_wake_schedules (
                        watcher_session_id, target_session_id, created_at, armed_for_reply
                     ) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        watcher_session_id,
                        target_session_id,
                        created_at,
                        armed_for_reply
                    ],
                )?;
                return Ok(true);
            };
            if existing_armed_for_reply == 1 && armed_for_reply == 0 {
                tx.execute(
                    "UPDATE session_wake_schedules SET armed_for_reply = 0
                     WHERE watcher_session_id = ?1 AND target_session_id = ?2",
                    params![watcher_session_id, target_session_id],
                )?;
            }
            Ok(false)
        })
    }

    /// Mark that a send this reply arm rode along with LANDED, so the failure
    /// compensation of a CONCURRENT send can no longer take the row away.
    ///
    /// Upsert, not update: the losing order (the failing send compensates
    /// before the succeeding one confirms) would otherwise leave the successful
    /// send's watcher with no schedule at all. Re-arming is confined to a
    /// target that still exists and is still open — a closed target never
    /// finishes another turn, so a row for one would be unconsumable.
    pub fn confirm_agent_wake_dispatch(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let touched = conn.execute(
                "INSERT INTO session_wake_schedules (
                    watcher_session_id, target_session_id, created_at,
                    armed_for_reply, dispatch_confirmed_at
                 )
                 SELECT ?1, ?2, ?3, 1, ?3
                   FROM sessions target
                  WHERE target.id = ?2
                    AND target.closed_at IS NULL
                    AND target.status != 'closed'
                 ON CONFLICT(watcher_session_id, target_session_id)
                 DO UPDATE SET dispatch_confirmed_at = ?3",
                params![watcher_session_id, target_session_id, now],
            )?;
            Ok(touched > 0)
        })
    }

    /// The reply consumed the schedule it was the safety net for. Deletes ONLY
    /// a reply arm: an explicit `schedule_agent_wake` survives an incidental
    /// message from the target ("starting now") and still fires at its turn end.
    pub fn consume_reply_agent_wake(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute(
                "DELETE FROM session_wake_schedules
                 WHERE watcher_session_id = ?1 AND target_session_id = ?2
                   AND armed_for_reply = 1",
                params![watcher_session_id, target_session_id],
            )?;
            Ok(deleted > 0)
        })
    }

    /// Compensate a reply arm whose send then failed. Deletes ONLY a reply arm
    /// that no landed send relies on, so a parallel send that DID land keeps
    /// the schedule it owes its watcher.
    pub fn delete_unconfirmed_reply_agent_wake(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute(
                "DELETE FROM session_wake_schedules
                 WHERE watcher_session_id = ?1 AND target_session_id = ?2
                   AND armed_for_reply = 1
                   AND dispatch_confirmed_at IS NULL",
                params![watcher_session_id, target_session_id],
            )?;
            Ok(deleted > 0)
        })
    }

    /// Drop every schedule watching `target` without waking anyone. The target
    /// closed: it never finishes another turn, so the rows can only ever be
    /// unconsumable state.
    pub fn delete_agent_wakes_for_target(&self, target_session_id: &str) -> anyhow::Result<usize> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute(
                "DELETE FROM session_wake_schedules WHERE target_session_id = ?1",
                [target_session_id],
            )?;
            Ok(deleted)
        })
    }

    pub fn list_agent_wakes_for_target(
        &self,
        target_session_id: &str,
    ) -> anyhow::Result<Vec<AgentWakeScheduleRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT watcher_session_id, target_session_id, created_at,
                        armed_for_reply, dispatch_confirmed_at
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
                "SELECT watcher_session_id, target_session_id, created_at,
                        armed_for_reply, dispatch_confirmed_at
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
    ///
    /// Two exceptions, both decided inside this one write:
    /// - a watcher in `controlled_watchers` (a workflow owns its execution) is
    ///   SKIPPED ENTIRELY — its row stays armed and fires at the target's next
    ///   finished turn after control releases. A pointer is a prompt, and every
    ///   other prompt path refuses a controlled session
    ///   (`peer_ops::admit_peer_send`).
    /// - a CLOSED watcher's row is deleted with NO prompt: a closed session
    ///   takes no input (ruling 6), so the schedule can never be fulfilled and
    ///   leaving it would strand the row forever.
    pub fn consume_agent_wakes_for_target(
        &self,
        target_session_id: &str,
        wake_prompt: &PromptPayload,
        controlled_watchers: &HashSet<String>,
    ) -> anyhow::Result<AgentWakeConsumption> {
        let blocks_json = wake_prompt.blocks_json()?;
        let provenance_json = wake_prompt.provenance_json()?;
        self.db.with_tx(|tx| {
            let scheduled: Vec<(String, bool)> = {
                let mut stmt = tx.prepare(
                    "SELECT schedule.watcher_session_id,
                            (watcher.closed_at IS NOT NULL OR watcher.status = 'closed')
                     FROM session_wake_schedules schedule
                     JOIN sessions watcher ON watcher.id = schedule.watcher_session_id
                     WHERE schedule.target_session_id = ?1
                     ORDER BY schedule.created_at ASC, schedule.watcher_session_id ASC",
                )?;
                let rows = stmt.query_map([target_session_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            let mut consumption = AgentWakeConsumption::default();
            let mut watchers = Vec::with_capacity(scheduled.len());
            for (watcher_session_id, watcher_closed) in scheduled {
                if controlled_watchers.contains(&watcher_session_id) {
                    consumption
                        .left_armed_controlled_watchers
                        .push(watcher_session_id);
                    continue;
                }
                if watcher_closed {
                    delete_schedule(tx, &watcher_session_id, target_session_id)?;
                    consumption.dropped_closed_watchers.push(watcher_session_id);
                    continue;
                }
                watchers.push(watcher_session_id);
            }
            if watchers.is_empty() {
                return Ok(consumption);
            }

            let queued_at = chrono::Utc::now().to_rfc3339();
            for watcher_session_id in watchers {
                delete_schedule(tx, &watcher_session_id, target_session_id)?;
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
                consumption.fired.push(ConsumedAgentWake {
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
            Ok(consumption)
        })
    }
}

fn delete_schedule(
    tx: &rusqlite::Connection,
    watcher_session_id: &str,
    target_session_id: &str,
) -> rusqlite::Result<()> {
    let deleted = tx.execute(
        "DELETE FROM session_wake_schedules
         WHERE watcher_session_id = ?1 AND target_session_id = ?2",
        params![watcher_session_id, target_session_id],
    )?;
    // The read and the deletes run under the same write transaction, so this
    // can only trip if the two statements ever stop selecting the same rows.
    debug_assert_eq!(deleted, 1);
    Ok(())
}

fn map_schedule(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentWakeScheduleRecord> {
    Ok(AgentWakeScheduleRecord {
        watcher_session_id: row.get("watcher_session_id")?,
        target_session_id: row.get("target_session_id")?,
        created_at: row.get("created_at")?,
        armed_for_reply: row.get::<_, i64>("armed_for_reply")? == 1,
        dispatch_confirmed_at: row.get("dispatch_confirmed_at")?,
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

    fn no_controlled_watchers() -> HashSet<String> {
        HashSet::new()
    }

    fn close_session(store: &SessionStore, session_id: &str) {
        store
            .db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE sessions SET closed_at = ?2, status = 'closed' WHERE id = ?1",
                    params![session_id, "2026-08-08T02:00:00Z"],
                )
            })
            .expect("close session");
    }

    #[test]
    fn the_pair_key_makes_a_double_arm_one_row() {
        let store = store_fixture();

        assert!(store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule
            )
            .expect("arm"));
        assert!(!store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule
            )
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
    fn the_row_records_why_it_was_armed_and_never_downgrades_to_a_reply_arm() {
        // The reason decides what may consume the row early, so re-arming
        // resolves to the STRONGER one: an explicit schedule outranks a reply
        // arm, and a later reply arm cannot pull it back down.
        let store = store_fixture();

        store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("arm for reply");
        assert!(
            store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")[0]
                .armed_for_reply
        );

        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("upgrade to an explicit schedule");
        assert!(
            !store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")[0]
                .armed_for_reply
        );

        store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("arm for reply again");
        assert!(
            !store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")[0]
                .armed_for_reply,
            "an explicit schedule must not be downgraded by a later wakeOnReply send"
        );
    }

    #[test]
    fn a_reply_consumes_only_a_reply_arm() {
        // An incidental message from the target ("starting now") must not
        // cancel an explicit schedule; it only ever consumes the reply arm it
        // is the answer to.
        let store = store_fixture();
        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");

        assert!(!store
            .consume_reply_agent_wake("ses_watcher", "ses_target")
            .expect("consume reply"));
        assert_eq!(
            store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")
                .len(),
            1
        );

        store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("re-arm");
        // The row is still the explicit schedule (no downgrade), so the reply
        // still leaves it alone.
        assert!(!store
            .consume_reply_agent_wake("ses_watcher", "ses_target")
            .expect("consume reply"));
    }

    #[test]
    fn a_reply_arm_is_consumed_by_the_reply() {
        let store = store_fixture();
        store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("arm");

        assert!(store
            .consume_reply_agent_wake("ses_watcher", "ses_target")
            .expect("consume reply"));
        assert!(store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .is_empty());
    }

    #[test]
    fn compensation_spares_a_row_a_landed_send_relies_on() {
        // Two concurrent sends share one row: the first armed it, the second
        // reused it and LANDED. The first's failure compensation must not take
        // away the schedule the landed send owes its watcher.
        let store = store_fixture();
        store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("send A arms");
        assert!(!store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("send B re-arms"));

        assert!(store
            .confirm_agent_wake_dispatch("ses_watcher", "ses_target")
            .expect("send B lands"));
        assert!(!store
            .delete_unconfirmed_reply_agent_wake("ses_watcher", "ses_target")
            .expect("send A compensates"));

        assert_eq!(
            store
                .list_agent_wakes_for_target("ses_target")
                .expect("list")
                .len(),
            1,
            "the landed send's schedule must survive the failed send's compensation"
        );
    }

    #[test]
    fn confirming_re_arms_a_row_a_racing_compensation_already_removed() {
        // The other order: the failing send compensates BEFORE the landed one
        // confirms. Confirming re-arms, so the landed send's watcher still gets
        // its wake — the row is the promise, not the ordering.
        let store = store_fixture();
        store
            .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("send A arms");
        assert!(store
            .delete_unconfirmed_reply_agent_wake("ses_watcher", "ses_target")
            .expect("send A compensates first"));

        assert!(store
            .confirm_agent_wake_dispatch("ses_watcher", "ses_target")
            .expect("send B lands after"));

        let rows = store
            .list_agent_wakes_for_target("ses_target")
            .expect("list");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].armed_for_reply);
        assert!(rows[0].dispatch_confirmed_at.is_some());
    }

    #[test]
    fn confirming_a_closed_target_re_arms_nothing() {
        // A closed target never finishes another turn, so re-arming one would
        // only leave a row nothing can consume.
        let store = store_fixture();
        close_session(&store, "ses_target");

        assert!(!store
            .confirm_agent_wake_dispatch("ses_watcher", "ses_target")
            .expect("confirm"));
        assert!(store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .is_empty());
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

        // The store's own arm surfaces that violation rather than swallowing
        // it: `INSERT OR IGNORE` used to report a plain no-op here, which made
        // the SQL guard invisible to every caller. A self-arm is unreachable in
        // practice — `authorize` refuses `SelfTarget` before any store call —
        // and this pins that the layer under it is not silently permissive.
        let error = store
            .arm_agent_wake(
                "ses_watcher",
                "ses_watcher",
                AgentWakeReason::ExplicitSchedule,
            )
            .err()
            .expect("a self-arm errors at the SQL layer");
        assert!(error.to_string().to_lowercase().contains("constraint"));
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
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        store
            .arm_agent_wake(
                "ses_watcher_2",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        let payload = PromptPayload::text("pointer".to_string());

        let consumption = store
            .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
            .expect("consume");

        assert_eq!(consumption.fired.len(), 2);
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
    fn a_controlled_watcher_keeps_its_schedule_and_takes_no_pointer() {
        // A workflow owns this watcher's execution, so it takes no prompt —
        // and its schedule is NOT consumed, so the wake it asked for still
        // fires once control releases.
        let store = store_fixture();
        store
            .insert(&session_record("ses_watcher_2"))
            .expect("insert second watcher");
        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        store
            .arm_agent_wake(
                "ses_watcher_2",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        let payload = PromptPayload::text("pointer".to_string());
        let controlled = HashSet::from(["ses_watcher".to_string()]);

        let consumption = store
            .consume_agent_wakes_for_target("ses_target", &payload, &controlled)
            .expect("consume");

        assert_eq!(consumption.left_armed_controlled_watchers, ["ses_watcher"]);
        assert_eq!(consumption.fired.len(), 1);
        assert_eq!(consumption.fired[0].watcher_session_id, "ses_watcher_2");
        assert!(store
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
        let remaining = store
            .list_agent_wakes_for_target("ses_target")
            .expect("list");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].watcher_session_id, "ses_watcher");

        // Control releases: the very same schedule fires at the next finished
        // turn, so nothing was lost by skipping it.
        let consumption = store
            .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
            .expect("consume after release");
        assert_eq!(consumption.fired.len(), 1);
        assert_eq!(consumption.fired[0].watcher_session_id, "ses_watcher");
    }

    #[test]
    fn a_closed_watchers_schedule_is_dropped_without_a_pointer() {
        // Ruling 6: a closed session takes no input. The row cannot be left
        // armed either — nothing would ever consume it.
        let store = store_fixture();
        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        close_session(&store, "ses_watcher");
        let payload = PromptPayload::text("pointer".to_string());

        let consumption = store
            .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
            .expect("consume");

        assert!(consumption.fired.is_empty());
        assert_eq!(consumption.dropped_closed_watchers, ["ses_watcher"]);
        assert!(store
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
        assert!(store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .is_empty());
    }

    #[test]
    fn a_wake_on_one_target_is_untouched_by_another_targets_turn() {
        let store = store_fixture();
        store
            .insert(&session_record("ses_other"))
            .expect("insert other target");
        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_other",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        let payload = PromptPayload::text("pointer".to_string());

        let consumption = store
            .consume_agent_wakes_for_target("ses_other", &payload, &no_controlled_watchers())
            .expect("consume");

        assert_eq!(consumption.fired.len(), 1);
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
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        store
            .arm_agent_wake(
                "ses_watcher_2",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
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
            .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
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

    #[test]
    fn a_closed_targets_schedules_can_be_cleared_in_one_sweep() {
        let store = store_fixture();
        store
            .insert(&session_record("ses_watcher_2"))
            .expect("insert second watcher");
        store
            .arm_agent_wake(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        store
            .arm_agent_wake(
                "ses_watcher_2",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");

        assert_eq!(
            store
                .delete_agent_wakes_for_target("ses_target")
                .expect("clear"),
            2
        );
        assert!(store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .is_empty());
    }
}
