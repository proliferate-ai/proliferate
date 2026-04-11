use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::event_sink::AcpToolPayload;
use crate::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
};
use crate::sessions::store::SessionStore;

mod claude;

#[derive(Debug, Clone)]
pub struct BackgroundWorkUpdate {
    pub tool_call_id: String,
    pub turn_id: String,
    pub state: SessionBackgroundWorkState,
    pub agent_id: Option<String>,
    pub output_file: String,
    pub result_text: String,
}

#[derive(Debug, Clone, Copy)]
pub struct BackgroundWorkOptions {
    pub poll_interval: Duration,
    pub stale_after: Option<Duration>,
}

impl Default for BackgroundWorkOptions {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(1),
            stale_after: None,
        }
    }
}

pub struct BackgroundWorkRegistry {
    session_id: String,
    source_agent_kind: String,
    store: SessionStore,
    updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
    options: BackgroundWorkOptions,
    trackers: HashMap<String, JoinHandle<()>>,
    observed_tool_payloads: HashMap<String, AcpToolPayload>,
}

impl BackgroundWorkRegistry {
    pub fn new(
        session_id: String,
        source_agent_kind: String,
        store: SessionStore,
        updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
        options: BackgroundWorkOptions,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            store,
            updates_tx,
            options,
            trackers: HashMap::new(),
            observed_tool_payloads: HashMap::new(),
        }
    }

    pub async fn rehydrate_pending(&mut self) {
        let pending = match self.store.list_pending_background_work(&self.session_id) {
            Ok(records) => records,
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    error = %error,
                    "failed to load pending background work trackers"
                );
                return;
            }
        };

        for record in pending {
            self.ensure_tracker(record);
        }
    }

    pub async fn observe_tool_payload(
        &mut self,
        turn_id: Option<String>,
        payload: &AcpToolPayload,
    ) {
        let Some(turn_id) = turn_id else {
            return;
        };

        let merged_payload = self.merge_tool_payload(payload);
        let Some(record) = self.detect_registration(&turn_id, &merged_payload) else {
            return;
        };

        match self
            .store
            .upsert_or_refresh_pending_background_work(&record)
        {
            Ok(true) => {
                self.observed_tool_payloads.remove(&record.tool_call_id);
                self.ensure_tracker(record);
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    tool_call_id = %record.tool_call_id,
                    error = %error,
                    "failed to upsert pending background work tracker"
                );
            }
        }
    }

    pub fn shutdown(&mut self) {
        for (_, handle) in self.trackers.drain() {
            handle.abort();
        }
    }

    fn detect_registration(
        &self,
        turn_id: &str,
        payload: &AcpToolPayload,
    ) -> Option<SessionBackgroundWorkRecord> {
        match self.source_agent_kind.as_str() {
            "claude" => claude::detect_async_agent_registration(
                &self.session_id,
                &self.source_agent_kind,
                turn_id,
                payload,
            ),
            _ => None,
        }
    }

    fn ensure_tracker(&mut self, record: SessionBackgroundWorkRecord) {
        if self.trackers.contains_key(&record.tool_call_id) {
            return;
        }

        let tool_call_id = record.tool_call_id.clone();
        let handle = match record.tracker_kind {
            SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent => {
                claude::spawn_async_agent_tracker(
                    record,
                    self.store.clone(),
                    self.updates_tx.clone(),
                    self.options,
                )
            }
        };
        self.trackers.insert(tool_call_id, handle);
    }

    fn merge_tool_payload(&mut self, payload: &AcpToolPayload) -> AcpToolPayload {
        let entry = self
            .observed_tool_payloads
            .entry(payload.tool_call_id.clone())
            .or_insert_with(|| AcpToolPayload {
                tool_call_id: payload.tool_call_id.clone(),
                ..Default::default()
            });

        if let Some(title) = &payload.title {
            entry.title = Some(title.clone());
        }
        if let Some(kind) = &payload.kind {
            entry.kind = Some(kind.clone());
        }
        if let Some(status) = &payload.status {
            entry.status = Some(status.clone());
        }
        if let Some(content) = &payload.content {
            entry.content = Some(content.clone());
        }
        if let Some(locations) = &payload.locations {
            entry.locations = Some(locations.clone());
        }
        if let Some(raw_input) = &payload.raw_input {
            entry.raw_input = Some(raw_input.clone());
        }
        if let Some(raw_output) = &payload.raw_output {
            entry.raw_output = Some(raw_output.clone());
        }
        if let Some(meta) = &payload.meta {
            entry.meta = Some(meta.clone());
        }

        entry.clone()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;
    use tokio::sync::mpsc;

    use super::{BackgroundWorkOptions, BackgroundWorkRegistry};
    use crate::acp::event_sink::AcpToolPayload;
    use crate::persistence::Db;
    use crate::sessions::model::SessionRecord;
    use crate::sessions::store::SessionStore;

    #[tokio::test(flavor = "current_thread")]
    async fn registry_merges_split_claude_async_launch_updates() {
        let local = tokio::task::LocalSet::new();
        local
            .run_until(async {
                let store = seeded_store();
                let (updates_tx, _updates_rx) = mpsc::unbounded_channel();
                let mut registry = BackgroundWorkRegistry::new(
                    "session-1".to_string(),
                    "claude".to_string(),
                    store.clone(),
                    updates_tx,
                    BackgroundWorkOptions {
                        poll_interval: Duration::from_secs(60),
                        stale_after: None,
                    },
                );

                registry
                    .observe_tool_payload(
                        Some("turn-1".to_string()),
                        &AcpToolPayload {
                            tool_call_id: "tool-1".to_string(),
                            raw_input: Some(json!({
                                "description": "Pick favorite file from desktop",
                                "run_in_background": true,
                            })),
                            meta: Some(json!({
                                "claudeCode": {
                                    "toolName": "Agent"
                                }
                            })),
                            ..Default::default()
                        },
                    )
                    .await;

                assert!(store
                    .list_pending_background_work("session-1")
                    .expect("pending background work after first split update")
                    .is_empty());

                registry
                    .observe_tool_payload(
                        Some("turn-1".to_string()),
                        &AcpToolPayload {
                            tool_call_id: "tool-1".to_string(),
                            meta: Some(json!({
                                "claudeCode": {
                                    "toolName": "Agent",
                                    "toolResponse": {
                                        "agentId": "agent-1",
                                        "isAsync": true,
                                        "outputFile": "/tmp/agent.output"
                                    }
                                }
                            })),
                            ..Default::default()
                        },
                    )
                    .await;

                let pending = store
                    .list_pending_background_work("session-1")
                    .expect("pending background work after merged update");
                assert_eq!(pending.len(), 1);
                assert_eq!(pending[0].tool_call_id, "tool-1");
                assert_eq!(pending[0].agent_id.as_deref(), Some("agent-1"));
                assert_eq!(pending[0].output_file, "/tmp/agent.output");

                registry.shutdown();
            })
            .await;
    }

    fn seeded_store() -> SessionStore {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-04-11T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

        let store = SessionStore::new(db);
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
                native_session_id: Some("native-1".to_string()),
                requested_model_id: None,
                current_model_id: None,
                requested_mode_id: None,
                current_mode_id: None,
                title: None,
                thinking_level_id: None,
                thinking_budget_tokens: None,
                status: "idle".to_string(),
                mode_locked: false,
                permission_policy: crate::sessions::model::SessionPermissionPolicy::Interactive,
                created_at: "2026-04-11T00:00:00Z".to_string(),
                updated_at: "2026-04-11T00:00:00Z".to_string(),
                last_prompt_at: None,
                closed_at: None,
                dismissed_at: None,
                mcp_bindings_ciphertext: None,
            })
            .expect("insert session");
        store
    }
}
