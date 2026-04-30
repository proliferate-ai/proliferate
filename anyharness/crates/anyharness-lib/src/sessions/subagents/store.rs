use super::model::{SubagentCompletionRecord, SubagentWakeScheduleRecord};
use crate::persistence::Db;
use crate::sessions::links::completions::{LinkCompletionInsert, LinkCompletionStore};
use crate::sessions::model::PendingPromptRecord;
use crate::sessions::prompt::PromptPayload;

#[derive(Debug, Clone)]
pub struct SubagentCompletionInsert {
    pub completion: SubagentCompletionRecord,
    pub wake_prompt: Option<PendingPromptRecord>,
}

impl From<LinkCompletionInsert> for SubagentCompletionInsert {
    fn from(value: LinkCompletionInsert) -> Self {
        Self {
            completion: value.completion,
            wake_prompt: value.wake_prompt,
        }
    }
}

#[derive(Clone)]
pub struct SubagentStore {
    inner: LinkCompletionStore,
}

impl SubagentStore {
    pub fn new(db: Db) -> Self {
        Self {
            inner: LinkCompletionStore::new(db),
        }
    }

    pub fn insert_completion_if_absent(
        &self,
        record: &SubagentCompletionRecord,
    ) -> anyhow::Result<Option<SubagentCompletionRecord>> {
        self.inner.insert_completion_if_absent(record)
    }

    pub fn insert_completion_and_consume_schedule(
        &self,
        record: &SubagentCompletionRecord,
        parent_session_id: &str,
        wake_prompt: &PromptPayload,
    ) -> anyhow::Result<Option<SubagentCompletionInsert>> {
        Ok(self
            .inner
            .insert_completion_and_consume_schedule(record, parent_session_id, wake_prompt)?
            .map(SubagentCompletionInsert::from))
    }

    pub fn schedule_wake(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.inner.schedule_wake(session_link_id)
    }

    pub fn delete_wake_schedule(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.inner.delete_wake_schedule(session_link_id)
    }

    pub fn list_wake_schedules(
        &self,
        link_ids: &[String],
    ) -> anyhow::Result<Vec<SubagentWakeScheduleRecord>> {
        self.inner.list_wake_schedules(link_ids)
    }

    pub fn import_wake_schedule(&self, session_link_id: &str) -> anyhow::Result<()> {
        self.inner.import_wake_schedule(session_link_id)
    }

    pub fn find_completion(
        &self,
        session_link_id: &str,
        child_turn_id: &str,
    ) -> anyhow::Result<Option<SubagentCompletionRecord>> {
        self.inner.find_completion(session_link_id, child_turn_id)
    }

    pub fn mark_parent_event_seq(&self, completion_id: &str, seq: i64) -> anyhow::Result<()> {
        self.inner.mark_parent_event_seq(completion_id, seq)
    }

    pub fn list_completions_for_links(
        &self,
        link_ids: &[String],
    ) -> anyhow::Result<Vec<SubagentCompletionRecord>> {
        self.inner.list_completions_for_links(link_ids)
    }

    pub fn latest_completion_for_link(
        &self,
        session_link_id: &str,
    ) -> anyhow::Result<Option<SubagentCompletionRecord>> {
        self.inner.latest_completion_for_link(session_link_id)
    }

    pub fn import_completion(&self, record: &SubagentCompletionRecord) -> anyhow::Result<()> {
        self.inner.import_completion(record)
    }
}
