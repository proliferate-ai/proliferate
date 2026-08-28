use super::*;

use anyharness_contract::v1::{PromptAttachmentSource, PromptCapabilities};

use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::runtime::PendingPromptMutationError;
use crate::domains::sessions::store::completion_deliveries::{
    enqueue::ClaimedDeliveryEnqueueOutcome, CompletionDeliveryStore, DurableTerminalTurn,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn protected_edit_cleans_prepared_attachment_without_mutating_wake_or_outbox() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("protected-completion-edit");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), true);

    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("target actor");
    send_direct_prompt(&state, "blocking turn").await;
    wait_for_path(&script.control_dir.join("turn-seen")).await;

    let store = state.session_service.store();
    store
        .insert(&session(
            "completion-child",
            "workspace-b",
            "idle",
            "Completion child",
        ))
        .expect("child session");
    store.seed_empty_launch_intent("completion-child");
    state
        .subagent_service
        .link_child(
            "target",
            "completion-child",
            Some("Worker".into()),
            None,
            None,
        )
        .expect("subagent link");
    store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: "protected-delivery".into(),
            session_id: "completion-child".into(),
            turn_id: "child-turn".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("done".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "completion-child".into(),
                seq: 1,
                timestamp: "2026-08-11T00:01:00Z".into(),
                event_type: "turn_ended".into(),
                turn_id: Some("child-turn".into()),
                item_id: None,
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:01:00Z".into(),
        })
        .expect("completion delivery");
    let deliveries = CompletionDeliveryStore::new(state.db.clone());
    let delivery = deliveries
        .claim_next_due(
            "2026-08-11T00:02:00Z",
            "2026-08-11T00:02:30Z",
            "protected-edit-worker",
        )
        .expect("claim")
        .expect("delivery claimed");
    let (delivery, canonical) = match deliveries
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            "protected-edit-worker",
            "2026-08-11T00:02:00Z",
            "2099-01-01T00:00:00Z",
        )
        .expect("enqueue canonical")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued {
            delivery, pending, ..
        } => (delivery, pending),
        other => panic!("expected enqueued wake, got {other:?}"),
    };

    let mut live_config = store
        .find_live_config_snapshot("target")
        .expect("live config")
        .expect("snapshot");
    live_config.prompt_capabilities_json = Some(
        serde_json::to_string(&PromptCapabilities {
            image: true,
            ..PromptCapabilities::default()
        })
        .expect("prompt capabilities"),
    );
    store
        .upsert_live_config_snapshot(&live_config)
        .expect("enable image test input");
    assert!(store
        .list_prompt_attachments("target")
        .expect("attachments before edit")
        .is_empty());

    let result = state
        .session_runtime
        .edit_pending_prompt(
            "target",
            canonical.seq,
            vec![PromptInputBlock::Image {
                data: Some("aQ==".into()),
                attachment_id: None,
                mime_type: "image/png".into(),
                name: Some("prepared.png".into()),
                uri: None,
                source: Some(PromptAttachmentSource::Upload),
            }],
        )
        .await;
    assert!(matches!(result, Err(PendingPromptMutationError::Protected)));
    assert!(store
        .list_prompt_attachments("target")
        .expect("attachments after rejection")
        .is_empty());
    assert_eq!(
        store
            .find_pending_prompt("target", canonical.seq)
            .expect("canonical read"),
        Some(canonical)
    );
    assert_eq!(
        deliveries
            .find(&delivery.delivery_id)
            .expect("delivery read")
            .expect("delivery row"),
        delivery
    );

    let handle = state
        .acp_manager
        .get_ready_handle("target")
        .await
        .expect("target handle");
    handle.dismiss().await.expect("dismiss actor");
    std::fs::write(script.control_dir.join("release-turn"), b"").expect("release turn");
    wait_for_actor_gone(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
