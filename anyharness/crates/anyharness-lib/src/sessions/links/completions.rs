use rusqlite::{params, OptionalExtension};

use crate::persistence::Db;
use crate::sessions::extensions::SessionTurnOutcome;
use crate::sessions::model::PendingPromptRecord;
use crate::sessions::prompt::PromptPayload;

#[derive(Debug, thiserror::Error)]
#[error("unknown session link completion outcome: {0}")]
struct LinkCompletionParseError(String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkCompletionRecord {
    pub completion_id: String,
    pub session_link_id: String,
    pub child_turn_id: String,
    pub child_last_event_seq: i64,
    pub outcome: SessionTurnOutcome,
    pub parent_event_seq: Option<i64>,
    pub parent_prompt_seq: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkWakeScheduleRecord {
    pub session_link_id: String,
}

#[derive(Debug, Clone)]
pub struct LinkCompletionInsert {
    pub completion: LinkCompletionRecord,
    pub wake_prompt: Option<PendingPromptRecord>,
}

#[derive(Clone)]
pub struct LinkCompletionStore {
    db: Db,
}

impl LinkCompletionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn insert_completion_if_absent(
        &self,
        record: &LinkCompletionRecord,
    ) -> anyhow::Result<Option<LinkCompletionRecord>> {
        self.db.with_tx(|tx| {
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO session_link_completions (
                    completion_id, session_link_id, child_turn_id, child_last_event_seq, outcome,
                    parent_event_seq, parent_prompt_seq, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.completion_id,
                    record.session_link_id,
                    record.child_turn_id,
                    record.child_last_event_seq,
                    record.outcome.as_str(),
                    record.parent_event_seq,
                    record.parent_prompt_seq,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            if inserted == 0 {
                return Ok(None);
            }
            Ok(Some(record.clone()))
        })
    }

    pub fn insert_completion_and_consume_schedule(
        &self,
        record: &LinkCompletionRecord,
        parent_session_id: &str,
        wake_prompt: &PromptPayload,
    ) -> anyhow::Result<Option<LinkCompletionInsert>> {
        let blocks_json = wake_prompt.blocks_json()?;
        let provenance_json = wake_prompt.provenance_json()?;
        self.db.with_tx(|tx| {
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO session_link_completions (
                    completion_id, session_link_id, child_turn_id, child_last_event_seq, outcome,
                    parent_event_seq, parent_prompt_seq, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.completion_id,
                    record.session_link_id,
                    record.child_turn_id,
                    record.child_last_event_seq,
                    record.outcome.as_str(),
                    record.parent_event_seq,
                    record.parent_prompt_seq,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            if inserted == 0 {
                return Ok(None);
            }

            let consumed = tx.execute(
                "DELETE FROM session_link_wake_schedules WHERE session_link_id = ?1",
                [record.session_link_id.as_str()],
            )?;
            if consumed == 0 {
                return Ok(Some(LinkCompletionInsert {
                    completion: record.clone(),
                    wake_prompt: None,
                }));
            }

            let next_seq: i64 = tx.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_pending_prompts WHERE session_id = ?1",
                [parent_session_id],
                |row| row.get(0),
            )?;
            let queued_at = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO session_pending_prompts (
                    session_id, seq, prompt_id, text, blocks_json, provenance_json, queued_at
                 ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)",
                params![
                    parent_session_id,
                    next_seq,
                    wake_prompt.text_summary.as_str(),
                    blocks_json,
                    provenance_json,
                    queued_at,
                ],
            )?;
            tx.execute(
                "UPDATE session_link_completions
                 SET parent_prompt_seq = ?2, updated_at = ?3
                 WHERE completion_id = ?1",
                params![record.completion_id, next_seq, queued_at],
            )?;
            Ok(Some(LinkCompletionInsert {
                completion: record.clone(),
                wake_prompt: Some(PendingPromptRecord {
                    session_id: parent_session_id.to_string(),
                    seq: next_seq,
                    prompt_id: None,
                    text: wake_prompt.text_summary.clone(),
                    blocks_json,
                    provenance_json,
                    queued_at,
                }),
            }))
        })
    }

    pub fn schedule_wake(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT OR IGNORE INTO session_link_wake_schedules (session_link_id)
                 VALUES (?1)",
                [session_link_id],
            )?;
            Ok(inserted > 0)
        })
    }

    pub fn delete_wake_schedule(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute(
                "DELETE FROM session_link_wake_schedules WHERE session_link_id = ?1",
                [session_link_id],
            )?;
            Ok(deleted > 0)
        })
    }

    pub fn list_wake_schedules(
        &self,
        link_ids: &[String],
    ) -> anyhow::Result<Vec<LinkWakeScheduleRecord>> {
        if link_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.db.with_conn(|conn| {
            let placeholders = std::iter::repeat("?")
                .take(link_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT session_link_id FROM session_link_wake_schedules
                 WHERE session_link_id IN ({placeholders})"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(link_ids.iter()), |row| {
                Ok(LinkWakeScheduleRecord {
                    session_link_id: row.get(0)?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn import_wake_schedule(&self, session_link_id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO session_link_wake_schedules (session_link_id)
                 VALUES (?1)",
                [session_link_id],
            )?;
            Ok(())
        })
    }

    pub fn find_completion(
        &self,
        session_link_id: &str,
        child_turn_id: &str,
    ) -> anyhow::Result<Option<LinkCompletionRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_link_completions
                 WHERE session_link_id = ?1 AND child_turn_id = ?2",
                params![session_link_id, child_turn_id],
                map_completion,
            )
            .optional()
        })
    }

    pub fn mark_parent_event_seq(&self, completion_id: &str, seq: i64) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE session_link_completions
                 SET parent_event_seq = ?2, updated_at = ?3
                 WHERE completion_id = ?1 AND parent_event_seq IS NULL",
                params![completion_id, seq, now],
            )?;
            Ok(())
        })
    }

    pub fn list_completions_for_links(
        &self,
        link_ids: &[String],
    ) -> anyhow::Result<Vec<LinkCompletionRecord>> {
        if link_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.db.with_conn(|conn| {
            let placeholders = std::iter::repeat("?")
                .take(link_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT * FROM session_link_completions
                 WHERE session_link_id IN ({placeholders})
                 ORDER BY created_at ASC, completion_id ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows =
                stmt.query_map(rusqlite::params_from_iter(link_ids.iter()), map_completion)?;
            rows.collect()
        })
    }

    pub fn latest_completion_for_link(
        &self,
        session_link_id: &str,
    ) -> anyhow::Result<Option<LinkCompletionRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_link_completions
                 WHERE session_link_id = ?1
                 ORDER BY created_at DESC, completion_id DESC
                 LIMIT 1",
                [session_link_id],
                map_completion,
            )
            .optional()
        })
    }

    pub fn import_completion(&self, record: &LinkCompletionRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_link_completions (
                    completion_id, session_link_id, child_turn_id, child_last_event_seq, outcome,
                    parent_event_seq, parent_prompt_seq, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.completion_id,
                    record.session_link_id,
                    record.child_turn_id,
                    record.child_last_event_seq,
                    record.outcome.as_str(),
                    record.parent_event_seq,
                    record.parent_prompt_seq,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }
}

fn map_completion(row: &rusqlite::Row<'_>) -> rusqlite::Result<LinkCompletionRecord> {
    let outcome: String = row.get("outcome")?;
    Ok(LinkCompletionRecord {
        completion_id: row.get("completion_id")?,
        session_link_id: row.get("session_link_id")?,
        child_turn_id: row.get("child_turn_id")?,
        child_last_event_seq: row.get("child_last_event_seq")?,
        outcome: parse_outcome(&outcome).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        parent_event_seq: row.get("parent_event_seq")?,
        parent_prompt_seq: row.get("parent_prompt_seq")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_outcome(value: &str) -> Result<SessionTurnOutcome, LinkCompletionParseError> {
    match value {
        "completed" => Ok(SessionTurnOutcome::Completed),
        "failed" => Ok(SessionTurnOutcome::Failed),
        "cancelled" => Ok(SessionTurnOutcome::Cancelled),
        other => Err(LinkCompletionParseError(other.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    fn seed_link(db: &Db) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES ('workspace-1', 'repo', '/tmp/workspace', '/tmp/workspace', ?1, ?1)",
                ["2026-03-25T00:00:00Z"],
            )?;
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, native_session_id,
                    requested_model_id, current_model_id, requested_mode_id, current_mode_id,
                    title, thinking_level_id, thinking_budget_tokens, status,
                    created_at, updated_at, last_prompt_at, closed_at, dismissed_at,
                    mcp_bindings_ciphertext, mcp_binding_summaries_json, system_prompt_append,
                    origin_json, subagents_enabled
                ) VALUES (
                    'parent-1', 'workspace-1', 'claude', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'idle',
                    ?1, ?1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1
                )",
                ["2026-03-25T00:00:00Z"],
            )?;
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, native_session_id,
                    requested_model_id, current_model_id, requested_mode_id, current_mode_id,
                    title, thinking_level_id, thinking_budget_tokens, status,
                    created_at, updated_at, last_prompt_at, closed_at, dismissed_at,
                    mcp_bindings_ciphertext, mcp_binding_summaries_json, system_prompt_append,
                    origin_json, subagents_enabled
                ) VALUES (
                    'child-1', 'workspace-1', 'claude', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'idle',
                    ?1, ?1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1
                )",
                ["2026-03-25T00:00:00Z"],
            )?;
            conn.execute(
                "INSERT INTO session_links (
                    id, relation, parent_session_id, child_session_id, workspace_relation,
                    label, created_by_turn_id, created_by_tool_call_id, created_at
                ) VALUES (
                    'link-1', 'subagent', 'parent-1', 'child-1', 'same_workspace',
                    'Child', NULL, NULL, ?1
                )",
                ["2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed link");
    }

    fn completion(turn_id: &str) -> LinkCompletionRecord {
        LinkCompletionRecord {
            completion_id: format!("completion-{turn_id}"),
            session_link_id: "link-1".to_string(),
            child_turn_id: turn_id.to_string(),
            child_last_event_seq: 42,
            outcome: SessionTurnOutcome::Completed,
            parent_event_seq: None,
            parent_prompt_seq: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn wake_schedule_is_idempotent_and_consumed_by_new_completion() {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db);
        let store = LinkCompletionStore::new(db);

        assert!(store.schedule_wake("link-1").expect("schedule wake"));
        assert!(!store.schedule_wake("link-1").expect("schedule wake again"));

        let prompt = PromptPayload::text("wake me".to_string());
        let inserted = store
            .insert_completion_and_consume_schedule(&completion("turn-1"), "parent-1", &prompt)
            .expect("insert completion")
            .expect("completion inserted");

        assert!(inserted.wake_prompt.is_some());
        let schedules = store
            .list_wake_schedules(&["link-1".to_string()])
            .expect("list schedules");
        assert!(schedules.is_empty());
    }

    #[test]
    fn duplicate_completion_does_not_consume_later_schedule() {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db);
        let store = LinkCompletionStore::new(db);
        let prompt = PromptPayload::text("wake me".to_string());

        store
            .insert_completion_and_consume_schedule(&completion("turn-1"), "parent-1", &prompt)
            .expect("insert old completion")
            .expect("old completion inserted");
        assert!(store.schedule_wake("link-1").expect("schedule later wake"));

        let duplicate = store
            .insert_completion_and_consume_schedule(&completion("turn-1"), "parent-1", &prompt)
            .expect("duplicate insert");
        assert!(duplicate.is_none());

        let schedules = store
            .list_wake_schedules(&["link-1".to_string()])
            .expect("list schedules");
        assert_eq!(schedules.len(), 1);
    }
}
