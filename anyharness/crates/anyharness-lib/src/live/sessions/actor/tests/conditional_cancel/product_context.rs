use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex as StdMutex;

use super::*;
use crate::domains::sessions::prompt::{
    StoredPromptBlock, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE,
    AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL,
};
use crate::live::sessions::actor::command::PromptAcceptError;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::turn::start::BeginPromptTurnOutcome;
use crate::live::sessions::product_context::{
    AgentProductContext, AgentProductContextResolutionError, AgentProductContextResolver,
};

enum ResolverMode {
    Context(String),
    Fail,
}

struct MutableProductContextResolver {
    mode: StdMutex<ResolverMode>,
    calls: AtomicUsize,
}

impl MutableProductContextResolver {
    fn context(instruction: &str) -> Self {
        Self {
            mode: StdMutex::new(ResolverMode::Context(instruction.to_string())),
            calls: AtomicUsize::new(0),
        }
    }

    fn failing() -> Self {
        Self {
            mode: StdMutex::new(ResolverMode::Fail),
            calls: AtomicUsize::new(0),
        }
    }

    fn set_context(&self, instruction: &str) {
        *self.mode.lock().expect("resolver lock") = ResolverMode::Context(instruction.to_string());
    }
}

impl AgentProductContextResolver for MutableProductContextResolver {
    fn resolve(
        &self,
        _session_id: &str,
    ) -> Result<AgentProductContext, AgentProductContextResolutionError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match &*self.mode.lock().expect("resolver lock") {
            ResolverMode::Context(instruction) => Ok(AgentProductContext::new(instruction.clone())),
            ResolverMode::Fail => Err(AgentProductContextResolutionError::new(anyhow::anyhow!(
                "sensitive internal relationship lookup detail must not enter the receipt"
            ))),
        }
    }
}

#[tokio::test]
async fn direct_context_failure_precedes_turn_transcript_and_acp_dispatch() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let mut harness = spawn_harness().await;
            let resolver = Arc::new(MutableProductContextResolver::failing());
            harness.actor.caps.product_context = resolver.clone();
            let store = harness._store.clone();
            let (accept_tx, accept_rx) = oneshot::channel();

            let disposition = harness
                .actor
                .run_turn(
                    ActivePromptRequest {
                        payload: PromptPayload::text("private authored prompt".to_string()),
                        prompt_id: Some("prompt-1".to_string()),
                        from_queue_seq: None,
                        respond_to: accept_tx,
                    },
                    &mut harness.command_rx,
                    &mut harness.notification_rx,
                    &mut harness.background_work_rx,
                )
                .await;

            assert!(
                disposition.is_none(),
                "direct failure keeps actor retryable"
            );
            let error = accept_rx
                .await
                .expect("direct response")
                .expect_err("context must fail closed");
            let PromptAcceptError::ProductContextUnavailable { incident_id, .. } = error else {
                panic!("expected typed product-context failure");
            };
            assert_eq!(
                uuid::Uuid::parse_str(&incident_id)
                    .expect("incident uuid")
                    .get_version_num(),
                4
            );
            assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
            assert!(store.list_events(SESSION_ID).expect("events").is_empty());
            assert!(matches!(
                harness.prompt_responder_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));

            resolver.set_context("You are currently an ordinary agent in this workspace.");
            let retry = harness
                .actor
                .begin_prompt_turn(
                    &PromptPayload::text("private authored prompt".to_string()),
                    Some("prompt-1-retry".to_string()),
                    None,
                )
                .await
                .expect("later retry re-resolves context");
            assert!(matches!(retry, BeginPromptTurnOutcome::Started(_)));
            assert_eq!(resolver.calls.load(Ordering::SeqCst), 2);
        })
        .await;
}

#[tokio::test]
async fn queued_context_failure_retains_head_and_recovers_persisted_authored_bytes() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let mut failed = spawn_harness().await;
            let store = failed._store.clone();
            let authored = " \nqueued authored prompt\t ";
            let queued = store
                .insert_pending_prompt_payload(
                    SESSION_ID,
                    &PromptPayload::text(authored.to_string()),
                    Some("queued-1"),
                )
                .expect("queue prompt");
            assert_eq!(queued.text, authored.trim());
            assert!(
                queued.blocks_json.is_some(),
                "lossy text summary must not replace canonical authored bytes"
            );
            let failed_payload = store
                .find_pending_prompt(SESSION_ID, queued.seq)
                .expect("reload queued prompt")
                .expect("queued prompt exists")
                .prompt_payload();
            assert_authored_text_bytes(&failed_payload, authored);
            let resolver = Arc::new(MutableProductContextResolver::failing());
            failed.actor.caps.product_context = resolver.clone();
            let (accept_tx, accept_rx) = oneshot::channel();

            let disposition = failed
                .actor
                .run_turn(
                    ActivePromptRequest {
                        payload: failed_payload,
                        prompt_id: queued.prompt_id.clone(),
                        from_queue_seq: Some(queued.seq),
                        respond_to: accept_tx,
                    },
                    &mut failed.command_rx,
                    &mut failed.notification_rx,
                    &mut failed.background_work_rx,
                )
                .await;
            assert!(matches!(disposition, Some(ActorExitDisposition::Unload)));
            assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
            let error = accept_rx
                .await
                .expect("queued response")
                .expect_err("queued context must fail closed");
            let PromptAcceptError::ProductContextUnavailable { incident_id, .. } = error else {
                panic!("expected typed product-context failure");
            };
            assert_eq!(
                uuid::Uuid::parse_str(&incident_id)
                    .expect("incident uuid")
                    .get_version_num(),
                4
            );
            assert_eq!(
                store
                    .peek_head_pending_prompt(SESSION_ID)
                    .expect("queue head")
                    .expect("row retained")
                    .seq,
                queued.seq
            );
            let events = store.list_events(SESSION_ID).expect("failure events");
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].event_type, "error");
            assert_eq!(events[0].turn_id, None);
            assert_eq!(events[0].item_id.as_deref(), Some(incident_id.as_str()));
            let SessionEvent::Error(receipt) =
                serde_json::from_str(&events[0].payload_json).expect("error payload")
            else {
                panic!("expected error event");
            };
            assert_eq!(
                receipt.code.as_deref(),
                Some(AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE)
            );
            assert_eq!(receipt.message, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL);
            assert!(!events[0].payload_json.contains("queued authored prompt"));
            assert!(!events[0].payload_json.contains("sensitive internal"));
            assert!(matches!(
                failed.prompt_responder_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));
            drop(failed);

            // A later explicit activation builds a fresh actor, re-resolves
            // context, reloads the exact retained queue row, and drains it.
            let mut recovered =
                spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
            let recovered_resolver = Arc::new(MutableProductContextResolver::context(
                "You are currently an ordinary agent in this workspace.",
            ));
            recovered.actor.caps.product_context = recovered_resolver.clone();
            let (recovered_payload, recovered_prompt_id, recovered_seq) = recovered
                .actor
                .next_pending_prompt_for_drain()
                .expect("retained queue head reloads after actor replacement");
            assert_eq!(recovered_seq, queued.seq);
            assert_eq!(recovered_prompt_id, queued.prompt_id);
            assert_authored_text_bytes(&recovered_payload, authored);
            let started = recovered
                .actor
                .begin_prompt_turn(&recovered_payload, recovered_prompt_id, Some(recovered_seq))
                .await
                .expect("retained prompt starts after context recovery");
            let BeginPromptTurnOutcome::Started(started) = started else {
                panic!("expected retained ordinary prompt to start");
            };
            assert_prompt_context(
                &started.acp_blocks,
                "You are currently an ordinary agent in this workspace.",
                authored,
            );
            assert_eq!(recovered_resolver.calls.load(Ordering::SeqCst), 1);
            assert!(store
                .peek_head_pending_prompt(SESSION_ID)
                .expect("queue read")
                .is_none());
            assert_eq!(
                store
                    .list_events(SESSION_ID)
                    .expect("all events")
                    .iter()
                    .filter(|event| event.event_type == "error")
                    .count(),
                1
            );
        })
        .await;
}

#[tokio::test]
async fn same_actor_resolves_updated_role_context_before_each_render() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let mut harness = spawn_harness().await;
            let resolver = Arc::new(MutableProductContextResolver::context(
                "You are currently a delegated agent. You cannot create agents.",
            ));
            harness.actor.caps.product_context = resolver.clone();
            let authored = "  authored bytes stay exact  ";

            let delegated = harness
                .actor
                .begin_prompt_turn(&PromptPayload::text(authored.to_string()), None, None)
                .await
                .expect("delegated render");
            let BeginPromptTurnOutcome::Started(delegated) = delegated else {
                panic!("expected started delegated turn");
            };
            assert_prompt_context(
                &delegated.acp_blocks,
                "You are currently a delegated agent. You cannot create agents.",
                authored,
            );
            harness
                .actor
                .event_sink
                .lock()
                .await
                .turn_ended(anyharness_contract::v1::StopReason::EndTurn);

            resolver.set_context("You are currently an ordinary agent in this workspace.");
            let ordinary = harness
                .actor
                .begin_prompt_turn(&PromptPayload::text(authored.to_string()), None, None)
                .await
                .expect("ordinary render after promotion");
            let BeginPromptTurnOutcome::Started(ordinary) = ordinary else {
                panic!("expected started ordinary turn");
            };
            assert_prompt_context(
                &ordinary.acp_blocks,
                "You are currently an ordinary agent in this workspace.",
                authored,
            );
            assert_eq!(resolver.calls.load(Ordering::SeqCst), 2);
        })
        .await;
}

fn assert_prompt_context(blocks: &[acp::schema::ContentBlock], instruction: &str, authored: &str) {
    let [acp::schema::ContentBlock::Text(context), acp::schema::ContentBlock::Text(message)] =
        blocks
    else {
        panic!("expected separate context and authored blocks");
    };
    assert_eq!(
        context.text,
        format!("System instruction from AnyHarness, not user content:\n{instruction}")
    );
    assert_eq!(message.text.as_bytes(), authored.as_bytes());
}

fn assert_authored_text_bytes(payload: &PromptPayload, authored: &str) {
    let [StoredPromptBlock::Text { text }] = payload.blocks.as_slice() else {
        panic!("expected one persisted authored text block");
    };
    assert_eq!(text.as_bytes(), authored.as_bytes());
}
