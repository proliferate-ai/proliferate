use std::sync::atomic::{AtomicUsize, Ordering};

use anyharness_contract::v1::StopReason;
use anyharness_contract::v1::{
    InteractionKind, PendingInteractionPayloadSummary, PendingInteractionSource,
    PendingInteractionSummary, PermissionInteractionOption, PermissionInteractionOptionKind,
};
use serde_json::json;

use super::*;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
};
use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::live::sessions::actor::command::{Resolution, ResolveInteractionCommandError};
use crate::live::sessions::actor::tests::conditional_cancel::unload::FailingTerminalPersist;
use crate::live::sessions::actor::turn::finish::commit_staged_terminal_with_retry;
use crate::live::sessions::model::{
    SessionDomainOp, SessionOpEmitter, SessionOpStep, TerminalTurnOutcome,
};
use crate::live::sessions::rendezvous::broker::InteractionCancelOutcome;
use crate::live::sessions::sink::{AcpChunkPayload, PromptTerminalEvent};

struct CountingDomainOp(Arc<AtomicUsize>);

impl SessionDomainOp for CountingDomainOp {
    fn begin(self: Box<Self>, _emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        self.0.fetch_add(1, Ordering::SeqCst);
        SessionOpStep::Done(Box::new(()))
    }
}

fn pending_permission_summary(request_id: &str) -> PendingInteractionSummary {
    PendingInteractionSummary {
        request_id: request_id.into(),
        kind: InteractionKind::Permission,
        title: "Existing permission".into(),
        description: None,
        source: PendingInteractionSource {
            tool_call_id: Some("tool-existing".into()),
            tool_kind: Some("execute".into()),
            tool_status: None,
            linked_plan_id: None,
        },
        payload: PendingInteractionPayloadSummary::Permission {
            options: vec![PermissionInteractionOption {
                option_id: "allow".into(),
                label: "Allow".into(),
                kind: PermissionInteractionOptionKind::AllowOnce,
            }],
            context: None,
        },
    }
}

fn standard_mcp_request() -> acp::schema::CreateElicitationRequest {
    acp::schema::CreateElicitationRequest::new(
        acp::schema::ElicitationFormMode::new(
            acp::schema::ElicitationSessionScope::new(NATIVE_SESSION_ID),
            acp::schema::ElicitationSchema::new().string("account", true),
        ),
        "Pick account",
    )
}

#[tokio::test(flavor = "current_thread")]
async fn failed_engine_terminal_fences_mutations_then_retires_for_one_repair() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let db = Db::open_in_memory().expect("db");
            seed_workspace_with_repo_root(&db, WORKSPACE_ID, "local", "/tmp/workspace");
            let store = SessionStore::new(db.clone());
            store.insert(&test_session_record()).expect("child");
            let mut parent = test_session_record();
            parent.id = "parent-1".into();
            parent.native_session_id = Some("native-parent-1".into());
            store.insert(&parent).expect("parent");
            SessionLinkStore::new(db.clone())
                .insert(&SessionLinkRecord {
                    id: "link-1".into(),
                    public_id: Some("subagent-1".into()),
                    relation: SessionLinkRelation::Subagent,
                    parent_session_id: parent.id,
                    child_session_id: SESSION_ID.into(),
                    workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                    label: Some("worker".into()),
                    created_by_turn_id: None,
                    created_by_tool_call_id: None,
                    created_at: "2026-08-11T00:00:00Z".into(),
                    subagent_closed_at: None,
                    closed_at: None,
                })
                .expect("link");
            let attempts = Arc::new(AtomicUsize::new(0));
            let mut caps = actor_capabilities_for_store(&store);
            caps.events = Arc::new(FailingTerminalPersist {
                store: store.clone(),
                attempts: attempts.clone(),
                failures_before_success: usize::MAX,
            });
            let mut harness =
                spawn_harness_with_capabilities(store.clone(), SessionHooks::default(), caps).await;

            let existing_permission = acp::schema::PermissionOption::new(
                acp::schema::PermissionOptionId::new("allow"),
                "Allow",
                acp::schema::PermissionOptionKind::AllowOnce,
            );
            harness
                .actor
                .interaction_broker
                .insert_pending_for_test(
                    SESSION_ID,
                    "existing-permission",
                    vec![existing_permission],
                )
                .await;
            harness
                .handle
                .add_pending_interaction(pending_permission_summary("existing-permission"))
                .await;

            {
                let mut sink = harness.actor.event_sink.lock().await;
                sink.agent_message_chunk(AcpChunkPayload {
                    content: json!("engine output"),
                    ..Default::default()
                });
                sink.stage_prompt_terminal(
                    TerminalTurnOutcome::Cancelled,
                    PromptTerminalEvent::TurnEnded(StopReason::Cancelled),
                )
                .expect("stage engine terminal");
            }
            assert!(
                commit_staged_terminal_with_retry(&harness.actor.event_sink, SESSION_ID)
                    .await
                    .is_err()
            );
            let frozen = harness.actor.event_sink.lock().await.debug_snapshot();
            let event_count = store.list_events(SESSION_ID).expect("events").len();
            let mut broadcasts = harness.handle.subscribe();

            let record = SessionBackgroundWorkRecord {
                session_id: SESSION_ID.into(),
                tool_call_id: "tool-bg".into(),
                turn_id: frozen.current_turn_id.clone().expect("engine turn"),
                tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
                source_agent_kind: "claude".into(),
                agent_id: Some("agent-bg".into()),
                output_file: "/tmp/bg".into(),
                state: SessionBackgroundWorkState::Pending,
                created_at: "2026-08-11T00:00:00Z".into(),
                updated_at: "2026-08-11T00:00:00Z".into(),
                launched_at: "2026-08-11T00:00:00Z".into(),
                last_activity_at: "2026-08-11T00:00:00Z".into(),
                completed_at: None,
            };
            store
                .upsert_or_refresh_pending_background_work(&record)
                .expect("background seed");
            harness
                .actor
                .handle_background(BackgroundWorkUpdate {
                    tool_call_id: "tool-bg".into(),
                    turn_id: record.turn_id.clone(),
                    state: SessionBackgroundWorkState::Completed,
                    agent_id: record.agent_id.clone(),
                    output_file: record.output_file.clone(),
                    result_text: "done".into(),
                })
                .await;
            assert!(harness
                .actor
                .handle_busy_prompt_queue(PromptPayload::text("queued".into()), None, None)
                .await
                .is_err());
            assert!(harness
                .actor
                .handle_busy_config_command("model", "new-model", true)
                .await
                .is_err());
            let domain_calls = Arc::new(AtomicUsize::new(0));
            assert!(harness
                .actor
                .run_domain_op_cmd(Box::new(CountingDomainOp(domain_calls.clone())))
                .await
                .is_none());
            assert!(harness
                .actor
                .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
                    title: Some("must-not-land".into()),
                    updated_at: None,
                })
                .await
                .is_err());
            assert!(matches!(
                harness
                    .actor
                    .resolve_interaction(
                        "existing-permission".into(),
                        Resolution::Selected {
                            option_id: "allow".into(),
                        },
                    )
                    .await,
                Err(ResolveInteractionCommandError::ActorDead)
            ));

            let (notification_tx, _notification_rx) = mpsc::unbounded_channel();
            let inbound = InboundDoor::new(
                SESSION_ID.into(),
                notification_tx,
                harness.actor.interaction_broker.clone(),
                harness.actor.event_sink.clone(),
                harness.handle.clone(),
                WORKSPACE_ID.into(),
                "claude".into(),
                None,
            );
            let params = serde_json::value::to_raw_value(&json!({
                "callId": "call-1",
                "turnId": "turn-1",
                "questions": [{
                    "questionId": "q1", "header": "Choose", "question": "Continue?",
                    "isOther": false, "isSecret": false,
                    "options": [{"label": "Yes", "description": "Continue"}]
                }]
            }))
            .expect("params")
            .into();
            assert!(inbound
                .handle_ext_request(acp::schema::ExtRequest::new(
                    "experimental/codex/requestUserInput",
                    params,
                ))
                .await
                .is_err());
            assert!(inbound
                .handle_request_permission(acp::schema::RequestPermissionRequest::new(
                    NATIVE_SESSION_ID,
                    acp::schema::ToolCallUpdate::new(
                        "tool-inbound",
                        acp::schema::ToolCallUpdateFields::new().title("Inbound permission"),
                    ),
                    vec![acp::schema::PermissionOption::new(
                        acp::schema::PermissionOptionId::new("allow-inbound"),
                        "Allow inbound",
                        acp::schema::PermissionOptionKind::AllowOnce,
                    )],
                ))
                .await
                .is_err());
            assert!(inbound
                .standard_mcp_elicitation(standard_mcp_request())
                .await
                .is_err());

            assert_eq!(domain_calls.load(Ordering::SeqCst), 0);
            assert_eq!(store.list_pending_prompts(SESSION_ID).unwrap().len(), 0);
            assert_eq!(
                store.list_pending_config_changes(SESSION_ID).unwrap().len(),
                0
            );
            assert_eq!(
                store
                    .list_pending_background_work(SESSION_ID)
                    .unwrap()
                    .len(),
                1
            );
            let pending = harness
                .handle
                .execution_snapshot()
                .await
                .pending_interactions;
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].request_id, "existing-permission");
            let cancelled = harness
                .actor
                .interaction_broker
                .cancel_session(SESSION_ID, InteractionCancelOutcome::Cancelled)
                .await;
            assert_eq!(
                cancelled.len(),
                1,
                "inbound gates must not leak broker entries"
            );
            assert_eq!(cancelled[0].request_id, "existing-permission");
            harness
                .actor
                .interaction_broker
                .insert_pending_for_test(
                    SESSION_ID,
                    "existing-permission",
                    vec![acp::schema::PermissionOption::new(
                        acp::schema::PermissionOptionId::new("allow"),
                        "Allow",
                        acp::schema::PermissionOptionKind::AllowOnce,
                    )],
                )
                .await;
            assert_eq!(store.list_events(SESSION_ID).unwrap().len(), event_count);
            assert_eq!(
                harness.actor.event_sink.lock().await.debug_snapshot(),
                frozen
            );
            assert!(matches!(
                broadcasts.try_recv(),
                Err(broadcast::error::TryRecvError::Empty)
            ));

            let retired_handle = harness.handle.clone();
            let Harness {
                actor,
                command_rx,
                notification_rx,
                background_work_rx,
                ..
            } = harness;
            tokio::time::timeout(
                Duration::from_secs(1),
                actor.run(command_rx, notification_rx, background_work_rx),
            )
            .await
            .expect("fenced actor retires")
            .expect("actor exit");
            assert!(matches!(
                retired_handle
                    .send_prompt(PromptPayload::text("after-retirement".into()), None)
                    .await,
                Err(crate::live::sessions::handle::LiveSessionCommandError::ActorUnavailable)
            ));
            assert!(retired_handle
                .execution_snapshot()
                .await
                .pending_interactions
                .is_empty());
            let before_repair = store.list_events(SESSION_ID).unwrap();
            assert_eq!(before_repair.len(), event_count);
            assert_eq!(
                before_repair.last().map(|event| event.seq),
                Some(event_count as i64)
            );
            assert!(matches!(
                broadcasts.try_recv(),
                Err(broadcast::error::TryRecvError::Empty)
            ));
            assert_eq!(store.repair_unclosed_turns(SESSION_ID).unwrap(), 1);
            assert_eq!(store.repair_unclosed_turns(SESSION_ID).unwrap(), 0);
            let repaired = store.list_events(SESSION_ID).unwrap();
            assert_eq!(repaired.len(), event_count + 2);
            assert_eq!(
                repaired[event_count..]
                    .iter()
                    .map(|event| event.event_type.as_str())
                    .collect::<Vec<_>>(),
                ["item_completed", "turn_ended"]
            );
            assert_eq!(
                repaired.last().map(|event| event.seq),
                Some(repaired.len() as i64)
            );
            assert_eq!(
                crate::domains::sessions::subagents::delivery::CompletionDeliveryStore::new(db,)
                    .list_all_for_test()
                    .unwrap()
                    .len(),
                1
            );
        })
        .await;
}
