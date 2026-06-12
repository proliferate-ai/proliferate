//! Domain-side implementations of live's durable-capability traits.
//!
//! Live declares the capability vocabulary in `live/sessions/model.rs`; the
//! sessions domain implements it here over `SessionStore` (and the attachment
//! storage); `app/` wires the implementations in. Every method is pure
//! delegation — signatures mirror the store originals 1:1, no behavior.

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope};

use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PromptAttachmentRecord, PromptAttachmentState,
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionEventRecord,
    SessionLiveConfigSnapshotRecord,
};
use crate::domains::sessions::prompt::{PromptPayload, PromptValidationError};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::model::{
    AttachmentSource, BackgroundWorkDurable, EventPersist, QueueDurable, SessionStateDurable,
};

impl EventPersist for SessionStore {
    fn append_event(&self, event: &SessionEventRecord) -> anyhow::Result<()> {
        SessionStore::append_event(self, event)
    }

    fn append_event_and_touch_session(&self, event: &SessionEventRecord) -> anyhow::Result<()> {
        SessionStore::append_event_and_touch_session(self, event)
    }

    fn append_event_with_next_seq(
        &self,
        session_id: &str,
        event: SessionEvent,
        touch_session_activity: bool,
    ) -> anyhow::Result<SessionEventEnvelope> {
        SessionStore::append_event_with_next_seq(self, session_id, event, touch_session_activity)
    }

    fn next_event_seq(&self, session_id: &str) -> anyhow::Result<i64> {
        SessionStore::next_event_seq(self, session_id)
    }

    fn last_event_seq(&self, session_id: &str) -> anyhow::Result<i64> {
        SessionStore::last_event_seq(self, session_id)
    }

    fn has_turn_started_event(&self, session_id: &str) -> anyhow::Result<bool> {
        SessionStore::has_turn_started_event(self, session_id)
    }

    fn append_raw_notification(
        &self,
        session_id: &str,
        notification_kind: &str,
        timestamp: &str,
        payload_json: &str,
    ) -> anyhow::Result<()> {
        SessionStore::append_raw_notification(
            self,
            session_id,
            notification_kind,
            timestamp,
            payload_json,
        )
    }
}

impl QueueDurable for SessionStore {
    fn insert_pending_prompt_payload(
        &self,
        session_id: &str,
        payload: &PromptPayload,
        prompt_id: Option<&str>,
    ) -> anyhow::Result<PendingPromptRecord> {
        SessionStore::insert_pending_prompt_payload(self, session_id, payload, prompt_id)
    }

    fn peek_head_pending_prompt(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        SessionStore::peek_head_pending_prompt(self, session_id)
    }

    fn find_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        SessionStore::find_pending_prompt(self, session_id, seq)
    }

    fn update_pending_prompt_payload(
        &self,
        session_id: &str,
        seq: i64,
        payload: &PromptPayload,
    ) -> anyhow::Result<bool> {
        SessionStore::update_pending_prompt_payload(self, session_id, seq, payload)
    }

    fn delete_pending_prompt(&self, session_id: &str, seq: i64) -> anyhow::Result<bool> {
        SessionStore::delete_pending_prompt(self, session_id, seq)
    }

    fn delete_pending_prompt_record(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        SessionStore::delete_pending_prompt_record(self, session_id, seq)
    }
}

impl BackgroundWorkDurable for SessionStore {
    fn upsert_or_refresh_pending_background_work(
        &self,
        record: &SessionBackgroundWorkRecord,
    ) -> anyhow::Result<bool> {
        SessionStore::upsert_or_refresh_pending_background_work(self, record)
    }

    fn list_pending_background_work(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<SessionBackgroundWorkRecord>> {
        SessionStore::list_pending_background_work(self, session_id)
    }

    fn touch_background_work_activity(
        &self,
        session_id: &str,
        tool_call_id: &str,
        last_activity_at: &str,
    ) -> anyhow::Result<()> {
        SessionStore::touch_background_work_activity(self, session_id, tool_call_id, last_activity_at)
    }

    fn mark_background_work_terminal(
        &self,
        session_id: &str,
        tool_call_id: &str,
        state: SessionBackgroundWorkState,
        completed_at: &str,
    ) -> anyhow::Result<bool> {
        SessionStore::mark_background_work_terminal(self, session_id, tool_call_id, state, completed_at)
    }
}

impl SessionStateDurable for SessionStore {
    fn update_status(&self, id: &str, status: &str, now: &str) -> anyhow::Result<()> {
        SessionStore::update_status(self, id, status, now)
    }

    fn update_title(&self, id: &str, title: &str, now: &str) -> anyhow::Result<()> {
        SessionStore::update_title(self, id, title, now)
    }

    fn update_last_prompt_at(&self, id: &str, now: &str) -> anyhow::Result<()> {
        SessionStore::update_last_prompt_at(self, id, now)
    }

    fn update_requested_configuration(
        &self,
        id: &str,
        requested_model_id: Option<&str>,
        requested_mode_id: Option<&str>,
        now: &str,
    ) -> anyhow::Result<()> {
        SessionStore::update_requested_configuration(
            self,
            id,
            requested_model_id,
            requested_mode_id,
            now,
        )
    }

    fn update_current_configuration(
        &self,
        id: &str,
        current_model_id: Option<&str>,
        current_mode_id: Option<&str>,
        now: &str,
    ) -> anyhow::Result<()> {
        SessionStore::update_current_configuration(self, id, current_model_id, current_mode_id, now)
    }

    fn update_action_capabilities_json(
        &self,
        id: &str,
        action_capabilities_json: Option<String>,
        now: &str,
    ) -> anyhow::Result<()> {
        SessionStore::update_action_capabilities_json(self, id, action_capabilities_json, now)
    }

    fn upsert_live_config_snapshot(
        &self,
        record: &SessionLiveConfigSnapshotRecord,
    ) -> anyhow::Result<()> {
        SessionStore::upsert_live_config_snapshot(self, record)
    }

    fn find_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<SessionLiveConfigSnapshotRecord>> {
        SessionStore::find_live_config_snapshot(self, session_id)
    }

    fn upsert_pending_config_change(
        &self,
        record: &PendingConfigChangeRecord,
    ) -> anyhow::Result<()> {
        SessionStore::upsert_pending_config_change(self, record)
    }

    fn list_pending_config_changes(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<PendingConfigChangeRecord>> {
        SessionStore::list_pending_config_changes(self, session_id)
    }

    fn delete_pending_config_change(
        &self,
        session_id: &str,
        config_id: &str,
    ) -> anyhow::Result<()> {
        SessionStore::delete_pending_config_change(self, session_id, config_id)
    }

    fn repair_unclosed_turns(&self, session_id: &str) -> anyhow::Result<u32> {
        SessionStore::repair_unclosed_turns(self, session_id)
    }
}

/// [`AttachmentSource`] over the session store + attachment file storage.
#[derive(Clone)]
pub struct SessionAttachmentSource {
    store: SessionStore,
    storage: PromptAttachmentStorage,
}

impl SessionAttachmentSource {
    pub fn new(store: SessionStore, storage: PromptAttachmentStorage) -> Self {
        Self { store, storage }
    }
}

impl AttachmentSource for SessionAttachmentSource {
    fn resolve_prompt_blocks(
        &self,
        session_id: &str,
        payload: &PromptPayload,
    ) -> Result<Vec<acp::schema::ContentBlock>, PromptValidationError> {
        payload.to_acp_blocks(&self.store, &self.storage, session_id)
    }

    fn mark_prompt_attachments_state(
        &self,
        session_id: &str,
        attachment_ids: &[String],
        state: PromptAttachmentState,
    ) -> anyhow::Result<()> {
        self.store
            .mark_prompt_attachments_state(session_id, attachment_ids, state)
    }

    fn find_prompt_attachment(
        &self,
        session_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Option<PromptAttachmentRecord>> {
        self.store.find_prompt_attachment(session_id, attachment_id)
    }

    fn delete_prompt_attachments(
        &self,
        session_id: &str,
        attachment_ids: &[&str],
    ) -> anyhow::Result<()> {
        self.store
            .delete_prompt_attachments(session_id, attachment_ids)
    }

    fn delete_record(&self, record: &PromptAttachmentRecord) -> anyhow::Result<()> {
        self.storage.delete_record(record)
    }
}
