use std::sync::Arc;

use agent_client_protocol as acp;
use tokio::sync::mpsc;

use crate::live::sessions::actor::background_work::handle_background_work_update;
use crate::live::sessions::actor::command::{Resolution, SessionCommand};
use crate::live::sessions::actor::config::handle::handle_idle_config_command;
use crate::live::sessions::actor::fork::handle::handle_idle_fork_lifecycle_command;
use crate::live::sessions::actor::interactions::cleanup::resolve_pending_interactions;
use crate::live::sessions::actor::interactions::handle::handle_resolve_interaction;
use crate::live::sessions::actor::interactions::plan_decisions::handle_apply_plan_decision;
use crate::live::sessions::actor::notifications::dispatch::inject_runtime_event;
use crate::live::sessions::actor::notifications::handle::handle_notification_with_resume_replay_filter;
use crate::live::sessions::actor::shutdown::handle::finalize_established_actor_exit;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::startup::{start_actor, StartedActor};
use crate::live::sessions::actor::state::SessionActorConfig;
use crate::live::sessions::actor::turn::active::ActivePromptRequest;
use crate::live::sessions::actor::turn::handle::{handle_idle_prompt_command, IdlePromptContext};
use crate::live::sessions::actor::turn::queue::{
    handle_delete_pending_prompt, handle_edit_pending_prompt,
};
use crate::live::sessions::handle::LiveSessionHandle;

pub(in crate::live::sessions::actor) async fn run_actor(
    config: SessionActorConfig,
    mut command_rx: mpsc::Receiver<SessionCommand>,
    ready_tx: std::sync::mpsc::Sender<anyhow::Result<String>>,
    handle: Arc<LiveSessionHandle>,
) -> anyhow::Result<()> {
    let session_id = config.session.id.clone();
    let source_agent_kind = config.session.agent_kind.clone();
    let workspace_id = config.session.workspace_id.clone();

    let StartedActor {
        child,
        conn,
        mut notification_rx,
        mut background_work_rx,
        mut background_work_registry,
        event_sink,
        native_session_id,
        mut startup_state,
        mut persisted_config_state,
        action_capabilities,
        supports_native_close,
        mut resume_replay_filter,
        _acp_shutdown,
    } = start_actor(&config, ready_tx, &handle).await?;

    let store = config.session_store.clone();
    let attachment_storage = config.attachment_storage.clone();

    let mut exit_reason = ActorExitDisposition::Close;
    loop {
        tokio::select! {
            cmd = command_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Prompt { payload, prompt_id, latency, from_queue_seq, respond_to }) => {
                        let exit_after_prompt = handle_idle_prompt_command(
                            IdlePromptContext {
                                config: &config,
                                conn: &conn,
                                native_session_id: &native_session_id,
                                command_rx: &mut command_rx,
                                notification_rx: &mut notification_rx,
                                background_work_rx: &mut background_work_rx,
                                background_work_registry: &mut background_work_registry,
                                event_sink: &event_sink,
                                persisted_config_state: &mut persisted_config_state,
                                startup_state: &mut startup_state,
                                resume_replay_filter: &mut resume_replay_filter,
                                handle: &handle,
                                store: &store,
                                attachment_storage: &attachment_storage,
                            },
                            ActivePromptRequest {
                                payload,
                                prompt_id,
                                latency,
                                from_queue_seq,
                                respond_to,
                            },
                        )
                        .await;
                        if let Some(next_exit) = exit_after_prompt {
                            exit_reason = next_exit;
                            break;
                        }
                    }
                    Some(SessionCommand::EditPendingPrompt { seq, payload, respond_to }) => {
                        let _ = respond_to.send(handle_edit_pending_prompt(&store, &attachment_storage, &event_sink, &session_id, seq, payload).await);
                    }
                    Some(SessionCommand::DeletePendingPrompt { seq, respond_to }) => {
                        let _ = respond_to.send(handle_delete_pending_prompt(&store, &attachment_storage, &event_sink, &session_id, seq).await);
                    }
                    Some(SessionCommand::ResolveInteraction { request_id, resolution, respond_to }) => {
                        let result = handle_resolve_interaction(
                            &handle,
                            &event_sink,
                            &config.interaction_broker,
                            &session_id,
                            request_id,
                            resolution,
                        )
                        .await;
                        let _ = respond_to.send(result);
                    }
                    Some(SessionCommand::ApplyPlanDecision { plan_id, expected_version, decision, respond_to }) => {
                        let result = handle_apply_plan_decision(
                            &handle,
                            &event_sink,
                            &config.interaction_broker,
                            config.plan_service.as_ref(),
                            &session_id,
                            &plan_id,
                            expected_version,
                            decision,
                        )
                        .await;
                        let _ = respond_to.send(result);
                    }
                    Some(SessionCommand::InjectRuntimeEvent { event, respond_to }) => {
                        let result = inject_runtime_event(&event_sink, &handle, event).await;
                        let _ = respond_to.send(result);
                    }
                    Some(SessionCommand::SetConfigOption {
                        config_id,
                        value,
                        respond_to,
                    }) => {
                        let result = handle_idle_config_command(
                            &conn,
                            &native_session_id,
                            &source_agent_kind,
                            &session_id,
                            &store,
                            &event_sink,
                            &mut persisted_config_state,
                            &mut startup_state,
                            &config_id,
                            &value,
                        )
                        .await;

                        match result {
                            Ok(state) => {
                                let _ = respond_to.send(Ok(state));
                            }
                            Err(error) => {
                                let _ = respond_to.send(Err(error));
                            }
                        }
                    }
                    Some(SessionCommand::Cancel) => {
                        let _ = conn
                            .send_notification(acp::schema::CancelNotification::new(native_session_id.clone()));
                    }
                    Some(SessionCommand::Dismiss { respond_to }) => {
                        resolve_pending_interactions(
                            &handle,
                            &event_sink,
                            &config.interaction_broker,
                            &session_id,
                            Resolution::Dismissed,
                        )
                        .await;
                        let _ = respond_to.send(Ok(()));
                        exit_reason = ActorExitDisposition::Dismiss;
                        break;
                    }
                    Some(SessionCommand::Close { respond_to }) => {
                        resolve_pending_interactions(
                            &handle,
                            &event_sink,
                            &config.interaction_broker,
                            &session_id,
                            Resolution::Cancelled,
                        )
                        .await;
                        let _ = respond_to.send(Ok(()));
                        exit_reason = ActorExitDisposition::Close;
                        break;
                    }
                    Some(SessionCommand::ReplayAdvance { respond_to }) => {
                        let _ = respond_to.send(Err(anyhow::anyhow!("session is not a replay session")));
                    }
                    Some(command) => {
                        debug_assert!(command.is_fork_lifecycle_command());
                        handle_idle_fork_lifecycle_command(
                            command,
                            &conn,
                            &native_session_id,
                            &config.workspace_path,
                            &config.mcp_servers,
                            &handle,
                            &store,
                            &session_id,
                            action_capabilities,
                            supports_native_close,
                        )
                        .await;
                    }
                    None => break,
                }
            }
            notification = notification_rx.recv() => {
                if let Some(notif) = notification {
                    handle_notification_with_resume_replay_filter(
                        &notif,
                        &mut resume_replay_filter,
                        &event_sink,
                        &mut background_work_registry,
                        &store,
                        &session_id,
                        &workspace_id,
                        &source_agent_kind,
                        config.plan_service.clone(),
                        config.review_service.clone(),
                        &mut persisted_config_state,
                        &mut startup_state,
                    ).await;
                }
            }
            background_update = background_work_rx.recv() => {
                if let Some(update) = background_update {
                    handle_background_work_update(&event_sink, &store, &session_id, update).await;
                }
            }
        }
    }
    background_work_registry.shutdown();
    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &config.interaction_broker,
        &store,
        &session_id,
        exit_reason,
    )
    .await;
    handle.finish_prompt();
    drop(child);
    Ok(())
}
