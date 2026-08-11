use rusqlite::{params, OptionalExtension};

use crate::domains::sessions::extensions::{SessionTurnFinishedContext, SessionTurnOutcome};
use crate::persistence::Db;

#[derive(Debug, thiserror::Error)]
#[error("invalid completion delivery value: {0}")]
struct CompletionDeliveryParseError(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionDeliveryState {
    Pending,
    Enqueued,
    Delivered,
}

impl CompletionDeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Enqueued => "enqueued",
            Self::Delivered => "delivered",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "enqueued" => Ok(Self::Enqueued),
            "delivered" => Ok(Self::Delivered),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(CompletionDeliveryParseError(format!(
                    "unknown state {other}"
                ))),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionDeliveryRecord {
    pub delivery_id: String,
    pub completion_id: String,
    pub session_link_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub subagent_public_id: Option<String>,
    pub label: Option<String>,
    pub child_turn_id: String,
    pub child_last_event_seq: i64,
    pub outcome: SessionTurnOutcome,
    pub assistant_text: Option<String>,
    pub notification_text: String,
    pub state: CompletionDeliveryState,
    pub parent_prompt_seq: Option<i64>,
    pub parent_turn_id: Option<String>,
    pub attempt_count: i64,
    pub next_attempt_at: String,
    pub lease_token: Option<String>,
    pub lease_expires_at: Option<String>,
    pub last_error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub enqueued_at: Option<String>,
    pub delivered_at: Option<String>,
}

impl CompletionDeliveryRecord {
    pub fn prompt_id(&self) -> String {
        format!("subagent_completion:{}", self.delivery_id)
    }
}

#[derive(Debug, Clone)]
pub struct CaptureCompletionDeliveryInput {
    pub turn: SessionTurnFinishedContext,
    pub assistant_text: Option<String>,
    pub notification_text: String,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureCompletionDeliveryOutcome {
    NotSubagent,
    Captured {
        delivery: CompletionDeliveryRecord,
        was_existing: bool,
    },
}

#[derive(Clone)]
pub struct CompletionDeliveryStore {
    db: Db,
}

impl CompletionDeliveryStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// Atomically records terminal child completion and its independent
    /// delivery snapshot. The relationship lookup shares this transaction
    /// with both inserts, making promotion versus completion capture ordered.
    pub fn capture(
        &self,
        input: &CaptureCompletionDeliveryInput,
    ) -> anyhow::Result<CaptureCompletionDeliveryOutcome> {
        self.db.with_tx(|tx| {
            if let Some(delivery) =
                find_by_child_turn(tx, &input.turn.session_id, &input.turn.turn_id)?
            {
                return Ok(CaptureCompletionDeliveryOutcome::Captured {
                    delivery,
                    was_existing: true,
                });
            }

            let link = tx
                .query_row(
                    "SELECT id, parent_session_id, child_session_id, public_id, label
                     FROM session_links
                     WHERE relation = 'subagent' AND child_session_id = ?1
                       AND closed_at IS NULL",
                    [input.turn.session_id.as_str()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((link_id, parent_id, child_id, public_id, label)) = link else {
                return Ok(CaptureCompletionDeliveryOutcome::NotSubagent);
            };

            let completion_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT OR IGNORE INTO session_link_completions (
                    completion_id, session_link_id, child_turn_id, child_last_event_seq, outcome,
                    parent_event_seq, parent_prompt_seq, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)",
                params![
                    completion_id,
                    link_id,
                    input.turn.turn_id,
                    input.turn.last_event_seq,
                    input.turn.outcome.as_str(),
                    input.captured_at,
                ],
            )?;
            let completion_id: String = tx.query_row(
                "SELECT completion_id FROM session_link_completions
                 WHERE session_link_id = ?1 AND child_turn_id = ?2",
                params![link_id, input.turn.turn_id],
                |row| row.get(0),
            )?;
            let delivery_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT OR IGNORE INTO session_link_completion_deliveries (
                    delivery_id, completion_id, session_link_id, parent_session_id,
                    child_session_id, subagent_public_id, label, child_turn_id,
                    child_last_event_seq, outcome, assistant_text, notification_text,
                    state, next_attempt_at, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                    'pending', ?13, ?13, ?13
                 )",
                params![
                    delivery_id,
                    completion_id,
                    link_id,
                    parent_id,
                    child_id,
                    public_id,
                    label,
                    input.turn.turn_id,
                    input.turn.last_event_seq,
                    input.turn.outcome.as_str(),
                    input.assistant_text,
                    input.notification_text,
                    input.captured_at,
                ],
            )?;
            let delivery = find_by_child_turn(tx, &child_id, &input.turn.turn_id)?
                .expect("capture inserted or found a completion delivery");
            Ok(CaptureCompletionDeliveryOutcome::Captured {
                delivery,
                was_existing: false,
            })
        })
    }

    pub fn find(&self, delivery_id: &str) -> anyhow::Result<Option<CompletionDeliveryRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_link_completion_deliveries WHERE delivery_id = ?1",
                [delivery_id],
                map_delivery,
            )
            .optional()
        })
    }
}

fn find_by_child_turn(
    conn: &rusqlite::Connection,
    child_session_id: &str,
    child_turn_id: &str,
) -> rusqlite::Result<Option<CompletionDeliveryRecord>> {
    conn.query_row(
        "SELECT * FROM session_link_completion_deliveries
         WHERE child_session_id = ?1 AND child_turn_id = ?2",
        params![child_session_id, child_turn_id],
        map_delivery,
    )
    .optional()
}

fn map_delivery(row: &rusqlite::Row<'_>) -> rusqlite::Result<CompletionDeliveryRecord> {
    let outcome: String = row.get("outcome")?;
    let state: String = row.get("state")?;
    Ok(CompletionDeliveryRecord {
        delivery_id: row.get("delivery_id")?,
        completion_id: row.get("completion_id")?,
        session_link_id: row.get("session_link_id")?,
        parent_session_id: row.get("parent_session_id")?,
        child_session_id: row.get("child_session_id")?,
        subagent_public_id: row.get("subagent_public_id")?,
        label: row.get("label")?,
        child_turn_id: row.get("child_turn_id")?,
        child_last_event_seq: row.get("child_last_event_seq")?,
        outcome: parse_outcome(&outcome)?,
        assistant_text: row.get("assistant_text")?,
        notification_text: row.get("notification_text")?,
        state: CompletionDeliveryState::parse(&state)?,
        parent_prompt_seq: row.get("parent_prompt_seq")?,
        parent_turn_id: row.get("parent_turn_id")?,
        attempt_count: row.get("attempt_count")?,
        next_attempt_at: row.get("next_attempt_at")?,
        lease_token: row.get("lease_token")?,
        lease_expires_at: row.get("lease_expires_at")?,
        last_error_code: row.get("last_error_code")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        enqueued_at: row.get("enqueued_at")?,
        delivered_at: row.get("delivered_at")?,
    })
}

fn parse_outcome(value: &str) -> rusqlite::Result<SessionTurnOutcome> {
    match value {
        "completed" => Ok(SessionTurnOutcome::Completed),
        "failed" => Ok(SessionTurnOutcome::Failed),
        "cancelled" => Ok(SessionTurnOutcome::Cancelled),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(CompletionDeliveryParseError(format!(
                "unknown outcome {other}"
            ))),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };

    fn seed_link(db: &Db, relationship_closed: bool) {
        test_support::seed_workspace_with_repo_root(
            db,
            "workspace-1",
            "local",
            "/tmp/completion-delivery",
        );
        db.with_conn(|conn| {
            for id in ["parent-1", "child-1"] {
                conn.execute(
                    "INSERT INTO sessions (
                        id, workspace_id, agent_kind, status, created_at, updated_at,
                        subagents_enabled
                     ) VALUES (?1, 'workspace-1', 'claude', 'idle', ?2, ?2, 1)",
                    params![id, "2026-08-11T00:00:00Z"],
                )?;
            }
            conn.execute(
                "INSERT INTO session_links (
                    id, public_id, relation, parent_session_id, child_session_id,
                    workspace_relation, label, created_at, subagent_closed_at
                 ) VALUES (
                    'link-1', 'subagent-1', 'subagent', 'parent-1', 'child-1',
                    'same_workspace', 'Researcher', ?1, ?2
                 )",
                params![
                    "2026-08-11T00:00:00Z",
                    relationship_closed.then_some("2026-08-11T00:01:00Z")
                ],
            )?;
            Ok(())
        })
        .expect("seed subagent relationship");
    }

    fn workspace() -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: "repo-root-workspace-1".to_string(),
            path: "/tmp/completion-delivery".to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-08-11T00:00:00Z".to_string(),
            updated_at: "2026-08-11T00:00:00Z".to_string(),
        }
    }

    fn capture_input(turn_id: &str) -> CaptureCompletionDeliveryInput {
        CaptureCompletionDeliveryInput {
            turn: SessionTurnFinishedContext {
                workspace: workspace(),
                session_id: "child-1".to_string(),
                turn_id: turn_id.to_string(),
                prompt_id: Some("prompt-1".to_string()),
                outcome: SessionTurnOutcome::Completed,
                stop_reason: Some("end_turn".to_string()),
                last_event_seq: 42,
                error_details: None,
            },
            assistant_text: Some("Useful answer".to_string()),
            notification_text: "Subagent update".to_string(),
            captured_at: "2026-08-11T00:02:00Z".to_string(),
        }
    }

    #[test]
    fn capture_is_atomic_stable_and_accepts_relationship_closed() {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, true);
        let store = CompletionDeliveryStore::new(db.clone());

        let first = store.capture(&capture_input("turn-1")).expect("capture");
        let CaptureCompletionDeliveryOutcome::Captured {
            delivery: first,
            was_existing: false,
        } = first
        else {
            panic!("expected first capture");
        };
        let second = store
            .capture(&capture_input("turn-1"))
            .expect("duplicate capture");
        let CaptureCompletionDeliveryOutcome::Captured {
            delivery: second,
            was_existing: true,
        } = second
        else {
            panic!("expected stable duplicate capture");
        };
        assert_eq!(first.delivery_id, second.delivery_id);
        assert_eq!(first.completion_id, second.completion_id);
        assert_eq!(first.state, CompletionDeliveryState::Pending);
        db.with_conn(|conn| {
            let completions: i64 =
                conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                    row.get(0)
                })?;
            let deliveries: i64 = conn.query_row(
                "SELECT COUNT(*) FROM session_link_completion_deliveries",
                [],
                |row| row.get(0),
            )?;
            assert_eq!((completions, deliveries), (1, 1));
            Ok(())
        })
        .expect("count rows");
    }

    #[test]
    fn promotion_orders_against_capture_and_snapshot_survives_cascade() {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let store = CompletionDeliveryStore::new(db.clone());
        let captured = store.capture(&capture_input("turn-1")).expect("capture");
        let CaptureCompletionDeliveryOutcome::Captured { delivery, .. } = captured else {
            panic!("expected capture");
        };
        db.with_conn(|conn| {
            conn.execute("DELETE FROM session_links WHERE id = 'link-1'", [])?;
            Ok(())
        })
        .expect("promote child");
        assert!(store
            .find(&delivery.delivery_id)
            .expect("find delivery")
            .is_some());
        assert!(matches!(
            store
                .capture(&capture_input("turn-2"))
                .expect("capture after promotion"),
            CaptureCompletionDeliveryOutcome::NotSubagent
        ));
        let duplicate = store
            .capture(&capture_input("turn-1"))
            .expect("duplicate after promotion");
        assert!(matches!(
            duplicate,
            CaptureCompletionDeliveryOutcome::Captured {
                was_existing: true,
                ..
            }
        ));
    }

    #[test]
    fn failed_outbox_insert_rolls_back_completion() {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        db.with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER fail_delivery_insert
                 BEFORE INSERT ON session_link_completion_deliveries
                 BEGIN SELECT RAISE(ABORT, 'failpoint'); END;",
            )?;
            Ok(())
        })
        .expect("install failpoint");
        let store = CompletionDeliveryStore::new(db.clone());
        assert!(store.capture(&capture_input("turn-1")).is_err());
        db.with_conn(|conn| {
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                    row.get(0)
                })?;
            assert_eq!(count, 0);
            Ok(())
        })
        .expect("verify rollback");
    }
}
