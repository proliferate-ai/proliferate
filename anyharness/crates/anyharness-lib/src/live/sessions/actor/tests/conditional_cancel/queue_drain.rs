use std::sync::atomic::{AtomicBool, Ordering};

use super::*;
use crate::domains::sessions::model::{PendingPromptRecord, PendingPromptReorderOutcome};
use crate::live::sessions::model::QueueDurable;
use crate::live::sessions::queue_durable::{
    PendingPromptDeleteOutcome, PendingPromptUpdateOutcome,
};

struct DeleteStagedPromptQueue {
    store: SessionStore,
    staged_seq: i64,
    deleted: Arc<AtomicBool>,
}

impl QueueDurable for DeleteStagedPromptQueue {
    fn insert_pending_prompt_payload(
        &self,
        session_id: &str,
        payload: &PromptPayload,
        prompt_id: Option<&str>,
    ) -> anyhow::Result<PendingPromptRecord> {
        <SessionStore as QueueDurable>::insert_pending_prompt_payload(
            &self.store,
            session_id,
            payload,
            prompt_id,
        )
    }

    fn list_pending_prompts(&self, session_id: &str) -> anyhow::Result<Vec<PendingPromptRecord>> {
        <SessionStore as QueueDurable>::list_pending_prompts(&self.store, session_id)
    }

    fn peek_head_pending_prompt(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        <SessionStore as QueueDurable>::peek_head_pending_prompt(&self.store, session_id)
    }

    fn find_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        if seq == self.staged_seq && !self.deleted.swap(true, Ordering::SeqCst) {
            SessionStore::delete_pending_prompt(&self.store, session_id, seq)?;
            return Ok(None);
        }
        <SessionStore as QueueDurable>::find_pending_prompt(&self.store, session_id, seq)
    }

    fn update_pending_prompt_payload(
        &self,
        session_id: &str,
        seq: i64,
        payload: &PromptPayload,
    ) -> anyhow::Result<PendingPromptUpdateOutcome> {
        <SessionStore as QueueDurable>::update_pending_prompt_payload(
            &self.store,
            session_id,
            seq,
            payload,
        )
    }

    fn delete_pending_prompt(&self, session_id: &str, seq: i64) -> anyhow::Result<bool> {
        <SessionStore as QueueDurable>::delete_pending_prompt(&self.store, session_id, seq)
    }

    fn delete_pending_prompt_record(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<PendingPromptDeleteOutcome> {
        <SessionStore as QueueDurable>::delete_pending_prompt_record(&self.store, session_id, seq)
    }

    fn reorder_pending_prompts(
        &self,
        session_id: &str,
        expected_seqs: &[i64],
        desired_seqs: &[i64],
    ) -> anyhow::Result<PendingPromptReorderOutcome> {
        <SessionStore as QueueDurable>::reorder_pending_prompts(
            &self.store,
            session_id,
            expected_seqs,
            desired_seqs,
        )
    }
}

#[tokio::test]
async fn automatic_drain_repeeks_after_the_staged_row_disappears() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let db = Db::open_in_memory().expect("db");
            seed_workspace_with_repo_root(&db, WORKSPACE_ID, "local", "/tmp/workspace");
            let store = SessionStore::new(db);
            store.insert(&test_session_record()).expect("session");
            let staged = store
                .insert_pending_prompt(SESSION_ID, "stale staged payload", Some("staged"))
                .expect("insert staged prompt");
            let current = store
                .insert_pending_prompt(SESSION_ID, "current durable payload", Some("current"))
                .expect("insert current prompt");
            let deleted = Arc::new(AtomicBool::new(false));
            let mut caps = actor_capabilities_for_store(&store);
            caps.queue = Arc::new(DeleteStagedPromptQueue {
                store: store.clone(),
                staged_seq: staged.seq,
                deleted: deleted.clone(),
            });
            let harness =
                spawn_harness_with_capabilities(store.clone(), SessionHooks::default(), caps).await;
            let Harness {
                actor,
                command_rx,
                notification_rx,
                background_work_rx,
                handle,
                mut prompt_responder_rx,
                cancel_rx: _,
                agent_notification_tx,
                _store,
            } = harness;

            let actor_task = tokio::task::spawn_local(async move {
                let _store = _store;
                let _agent_notification_tx = agent_notification_tx;
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });
            let responder =
                tokio::time::timeout(Duration::from_secs(5), prompt_responder_rx.recv())
                    .await
                    .expect("the next durable row reaches ACP")
                    .expect("prompt responder");
            responder
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::EndTurn,
                ))
                .expect("finish drained turn");
            tokio::time::timeout(Duration::from_secs(5), handle.close())
                .await
                .expect("close command resolves")
                .expect("close idle actor");
            tokio::time::timeout(Duration::from_secs(5), actor_task)
                .await
                .expect("actor exits")
                .expect("actor task")
                .expect("actor exits cleanly");
            assert!(deleted.load(Ordering::SeqCst));

            let events = store.list_events(SESSION_ID).expect("events");
            let queue_events = events
                .iter()
                .filter_map(
                    |event| match serde_json::from_str(&event.payload_json).ok()? {
                        SessionEvent::PendingPromptAdded(payload) => Some(("added", payload.seq)),
                        SessionEvent::PendingPromptRemoved(payload) => {
                            Some(("removed", payload.seq))
                        }
                        _ => None,
                    },
                )
                .collect::<Vec<_>>();
            assert_eq!(
                queue_events,
                vec![("added", current.seq), ("removed", current.seq)]
            );
            assert!(store
                .list_pending_prompts(SESSION_ID)
                .expect("pending prompts")
                .is_empty());
        })
        .await;
}
