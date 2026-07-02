use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionActionCapabilities, SessionExecutionPhase};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::domains::sessions::model::serialize_action_capabilities;
use crate::domains::sessions::prompt::capabilities::capabilities_from_acp;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::config::apply::restore_persisted_live_config_if_needed;
use crate::live::sessions::actor::config::handle::apply_requested_session_preferences;
use crate::live::sessions::actor::config::persist::{
    emit_live_config_update, emit_startup_state, load_startup_restore_snapshot,
};
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActor, SessionActorConfig, SessionStartupState};
use crate::live::sessions::background_work::{
    BackgroundWorkOptions, BackgroundWorkRegistry, BackgroundWorkUpdate,
};
use crate::live::sessions::driver::connection::establish_connection;
use crate::live::sessions::driver::native_session::{
    has_anyharness_targeted_fork_extension, start_native_session,
};
use crate::live::sessions::driver::process::spawn_agent_process;
use crate::live::sessions::driver::stderr::AgentStderrTail;
use crate::live::sessions::driver::inbound::InboundDoor;
use crate::live::sessions::driver::session_lifecycle::initialize_connection;
use crate::live::sessions::driver::types::NativeSessionStartupDisposition;
use crate::live::sessions::model::{QueueDurable, SessionStateDurable};
use crate::live::sessions::sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;

impl SessionActor {
    /// Spawns the agent process, establishes the ACP connection, starts the
    /// native session, and runs the startup config-restore sequence — in
    /// exactly the same order as before this became a constructor. Returns
    /// the constructed actor plus the notification/background-work receivers,
    /// which stay out of the struct (they are threaded through the run loop
    /// as parameters).
    pub(in crate::live::sessions::actor) async fn start(
        config: SessionActorConfig,
        ready_tx: std::sync::mpsc::Sender<anyhow::Result<String>>,
        handle: Arc<LiveSessionHandle>,
    ) -> anyhow::Result<(
        SessionActor,
        mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    )> {
        let session_id = config.launch.session.id.clone();
        let source_agent_kind = config.launch.session.agent_kind.clone();
        let workspace_id = config.launch.session.workspace_id.clone();
        let startup_strategy = config.launch.startup.clone();
        let startup_strategy_label = startup_strategy.as_str();
        let startup_started = Instant::now();

        let spawned = spawn_agent_process(
            &config.launch.agent,
            &config.launch.workspace_path,
            &config.launch.env.workspace,
            &config.launch.env.session,
            &session_id,
            &workspace_id,
            &source_agent_kind,
            &ready_tx,
        )?;
        let mut child = spawned.child;
        let stdin = spawned.stdin;
        let stdout = spawned.stdout;
        let stderr_tail = spawned.stderr_tail;
        let mut stderr_done = spawned.stderr_done;

        let (notification_tx, notification_rx) =
            mpsc::unbounded_channel::<acp::schema::SessionNotification>();

        let event_sink = Arc::new(Mutex::new(if startup_strategy.resumes_durable_history() {
            SessionEventSink::resume_from_seq(
                session_id.clone(),
                source_agent_kind.clone(),
                config.launch.workspace_path.clone(),
                config.launch.last_seq,
                config.event_tx.clone(),
                config.caps.events.clone(),
            )
        } else {
            SessionEventSink::new(
                session_id.clone(),
                source_agent_kind.clone(),
                config.launch.workspace_path.clone(),
                config.event_tx.clone(),
                config.caps.events.clone(),
            )
        }));
        let (background_work_tx, background_work_rx) =
            mpsc::unbounded_channel::<BackgroundWorkUpdate>();
        let mut background_work_registry = BackgroundWorkRegistry::new(
            session_id.clone(),
            source_agent_kind.clone(),
            config.caps.background.clone(),
            background_work_tx,
            BackgroundWorkOptions::default(),
        );

        let client = Arc::new(InboundDoor::new(
            session_id.clone(),
            notification_tx,
            config.interaction_broker.clone(),
            event_sink.clone(),
            handle.clone(),
            config.launch.session.workspace_id.clone(),
            config.launch.session.agent_kind.clone(),
            config.caps.permission_advisor.clone(),
        ));

        let (conn, shutdown_tx) = establish_connection(client, stdin, stdout).await?;

        // Race the initialize/new-session handshake against agent-process
        // exit: an agent that dies before responding (bad install, crash on
        // boot) should fail that phase immediately with its stderr instead of
        // letting the caller burn the full ready timeout on a misleading
        // "waiting for authentication" message.
        let handshake = async {
            let init_response = initialize_connection(
                &conn,
                &source_agent_kind,
                &config.launch.agent,
                &session_id,
                &workspace_id,
                &ready_tx,
            )
            .await?;

            persist_session_action_capabilities(
                config.caps.state.as_ref(),
                &session_id,
                &init_response.agent_capabilities,
            );
            let action_capabilities =
                action_capabilities_from_acp(&init_response.agent_capabilities);

            let native = start_native_session(
                &conn,
                &config.launch.workspace_path,
                &config.launch.mcp_servers,
                config.launch.prompts.every_prompt.as_deref(),
                &startup_strategy,
                action_capabilities,
                &session_id,
                &workspace_id,
                &ready_tx,
            )
            .await?;
            anyhow::Ok((init_response, action_capabilities, native))
        };
        let (init_response, action_capabilities, native_session) = tokio::select! {
            // Biased so a handshake that completed on the same poll as the
            // exit (agent answered and then died) is reported as the success
            // it was; the exit arm only fires while it is genuinely pending.
            biased;
            result = handshake => result?,
            exit_status = child.wait() => {
                if let Some(reader_task) = stderr_done.take() {
                    // The child held the only write end of the pipe, so EOF
                    // arrives promptly after exit; give the reader a moment to
                    // drain the final lines before snapshotting.
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_millis(250),
                        reader_task,
                    )
                    .await;
                }
                let error = agent_exited_during_startup_error(exit_status, &stderr_tail);
                tracing::warn!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    agent_kind = %source_agent_kind,
                    error = %error.to_string().replace('\n', " | "),
                    elapsed_ms = startup_started.elapsed().as_millis(),
                    "[workspace-latency] session.actor.process_exited_during_startup"
                );
                let _ = ready_tx.send(Err(anyhow::anyhow!("{error}")));
                return Err(error);
            }
        };
        let supports_native_close = init_response
            .agent_capabilities
            .session_capabilities
            .close
            .is_some();
        let (native_session_id, native_startup_state, startup_disposition) = native_session;
        let mut startup_state: SessionStartupState = native_startup_state.into();
        startup_state.prompt_capabilities =
            capabilities_from_acp(Some(&init_response.agent_capabilities.prompt_capabilities));

        tracing::info!(
            session_id = %session_id,
            native_session_id = %native_session_id,
            startup_strategy = startup_strategy_label,
            native_startup_disposition = startup_disposition.as_str(),
            "ACP session established"
        );

        let mut persisted_config_state =
            PersistedSessionConfigState::from_session(&config.launch.session);
        let startup_restore_snapshot = load_startup_restore_snapshot(
            config.caps.state.as_ref(),
            &session_id,
            &source_agent_kind,
            startup_strategy.resumes_durable_history(),
        )?;

        {
            let mut sink = event_sink.lock().await;
            if startup_disposition == NativeSessionStartupDisposition::CreatedFresh {
                sink.session_started(native_session_id.to_string());
            }
            emit_startup_state(&mut sink, &startup_state);
        }

        let initial_live_config_started = Instant::now();
        if let Err(error) = emit_live_config_update(
            &source_agent_kind,
            &session_id,
            config.caps.state.as_ref(),
            &event_sink,
            &mut persisted_config_state,
            &mut startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await
        {
            tracing::warn!(session_id = %session_id, error = %error, "failed to persist initial live config snapshot");
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                error = %error,
                elapsed_ms = initial_live_config_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.initial_live_config.failed"
            );
        } else {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = initial_live_config_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.initial_live_config.completed"
            );
        }

        let apply_preferences_started = Instant::now();
        if let Err(error) = apply_requested_session_preferences(
            &conn,
            &native_session_id,
            &config.launch.session,
            &mut startup_state,
        )
        .await
        {
            tracing::warn!(session_id = %session_id, error = %error, "failed to apply session preferences");
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                error = %error,
                elapsed_ms = apply_preferences_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.apply_preferences.failed"
            );
        } else {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = apply_preferences_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.apply_preferences.completed"
            );
        }
        let restore_live_config_started = Instant::now();
        if let Err(error) = restore_persisted_live_config_if_needed(
            &conn,
            &native_session_id,
            &source_agent_kind,
            &session_id,
            config.caps.state.as_ref(),
            &event_sink,
            &mut persisted_config_state,
            &mut startup_state,
            startup_restore_snapshot.as_ref(),
        )
        .await
        {
            tracing::warn!(session_id = %session_id, error = %error, "failed to restore persisted live config");
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                error = %error,
                elapsed_ms = restore_live_config_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.restore_live_config.failed"
            );
        } else {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = restore_live_config_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.restore_live_config.completed"
            );
        }
        let post_preferences_live_config_started = Instant::now();
        if let Err(error) = emit_live_config_update(
            &source_agent_kind,
            &session_id,
            config.caps.state.as_ref(),
            &event_sink,
            &mut persisted_config_state,
            &mut startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await
        {
            tracing::warn!(session_id = %session_id, error = %error, "failed to persist post-preference live config snapshot");
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                error = %error,
                elapsed_ms = post_preferences_live_config_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.post_preferences_live_config.failed"
            );
        } else {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = post_preferences_live_config_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.post_preferences_live_config.completed"
            );
        }

        let _ = ready_tx.send(Ok(native_session_id.to_string()));
        handle
            .set_execution_phase(SessionExecutionPhase::Idle)
            .await;
        background_work_registry.rehydrate_pending().await;
        tracing::info!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            native_session_id = %native_session_id,
            startup_strategy = startup_strategy_label,
            native_startup_disposition = startup_disposition.as_str(),
            total_elapsed_ms = startup_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.startup_ready"
        );
        let resume_replay_filter = ResumeReplayFilter::new(
            &source_agent_kind,
            startup_disposition,
            &config.launch.session.status,
        );

        dispatch_startup_drain(config.caps.queue.as_ref(), &session_id, &handle).await;

        let SessionActorConfig {
            launch,
            caps,
            hooks,
            interaction_broker,
            event_tx: _,
        } = config;

        let actor = SessionActor {
            session_id,
            workspace_id,
            agent_kind: source_agent_kind,
            workspace_path: launch.workspace_path,
            mcp_servers: launch.mcp_servers,
            prompts: launch.prompts,
            event_sink,
            background_work_registry,
            resume_replay_filter,
            persisted_config_state,
            startup_state,
            native_session_id,
            action_capabilities,
            supports_native_close,
            conn,
            caps,
            hooks,
            interaction_broker,
            handle,
            _acp_shutdown: shutdown_tx,
            child,
        };
        Ok((actor, notification_rx, background_work_rx))
    }
}

fn agent_exited_during_startup_error(
    exit_status: std::io::Result<std::process::ExitStatus>,
    stderr_tail: &AgentStderrTail,
) -> anyhow::Error {
    let status = match exit_status {
        Ok(status) => status.to_string(),
        Err(error) => format!("wait failed: {error}"),
    };
    let tail = stderr_tail.snapshot();
    if tail.is_empty() {
        anyhow::anyhow!("agent process exited during ACP startup ({status})")
    } else {
        anyhow::anyhow!(
            "agent process exited during ACP startup ({status}). Agent stderr:\n{}",
            tail.join("\n")
        )
    }
}

async fn dispatch_startup_drain(
    store: &dyn QueueDurable,
    session_id: &str,
    handle: &Arc<LiveSessionHandle>,
) {
    // Invariant 5: startup drain. If the durable queue is non-empty, self-dispatch
    // a Prompt command for the head row carrying `from_queue_seq`. The first
    // iteration of the outer Prompt arm treats it as a drained iteration:
    // `begin_turn` runs, then the head row is deleted and PendingPromptRemoved
    // is emitted. If more items exist, the turn-end drain loop picks them up
    // naturally from there. Races: the main select loop has not started yet.
    match store.peek_head_pending_prompt(session_id) {
        Ok(Some(head)) => {
            let (drain_respond_tx, _drain_respond_rx) = oneshot::channel();
            if let Err(error) = handle
                .command_tx
                .send(SessionCommand::Prompt {
                    payload: head.prompt_payload(),
                    prompt_id: head.prompt_id,
                    from_queue_seq: Some(head.seq),
                    respond_to: drain_respond_tx,
                })
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    error = %error,
                    "failed to self-dispatch startup drain prompt",
                );
            } else {
                tracing::info!(
                    session_id = %session_id,
                    seq = head.seq,
                    "session.actor.startup_drain.dispatched",
                );
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to peek pending prompt queue at startup",
            );
        }
    }
}
pub(in crate::live::sessions::actor) fn persist_session_action_capabilities(
    store: &dyn SessionStateDurable,
    session_id: &str,
    agent_capabilities: &acp::schema::AgentCapabilities,
) {
    let capabilities = action_capabilities_from_acp(agent_capabilities);
    let Ok(json) = serialize_action_capabilities(capabilities) else {
        tracing::warn!(
            session_id,
            "failed to serialize session action capabilities"
        );
        return;
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(error) = store.update_action_capabilities_json(session_id, Some(json), &now) {
        tracing::warn!(
            session_id,
            error = %error,
            "failed to persist session action capabilities"
        );
    }
}

pub(in crate::live::sessions::actor) fn action_capabilities_from_acp(
    agent_capabilities: &acp::schema::AgentCapabilities,
) -> SessionActionCapabilities {
    let fork_capability = agent_capabilities.session_capabilities.fork.as_ref();
    let fork = agent_capabilities.load_session && fork_capability.is_some();
    let adapter_targeted_fork_ready = fork
        && fork_capability
            .and_then(|capability| capability.meta.as_ref())
            .map(has_anyharness_targeted_fork_extension)
            .unwrap_or(false);
    if adapter_targeted_fork_ready {
        tracing::debug!(
            "agent advertises edit-safe targeted fork metadata; public targeted fork remains disabled until runtime target dispatch is implemented"
        );
    }
    SessionActionCapabilities {
        fork,
        targeted_fork: false,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;

    #[test]
    fn agent_exit_error_reports_status_without_stderr() {
        let tail = AgentStderrTail::default();
        let exit_status = std::process::ExitStatus::from_raw(0x100); // exit code 1

        let error = agent_exited_during_startup_error(Ok(exit_status), &tail);
        let message = error.to_string();
        assert!(message.contains("exited during ACP startup"));
        assert!(!message.contains("Agent stderr"));
    }

    #[test]
    fn agent_exit_error_includes_stderr_tail() {
        let tail = AgentStderrTail::default();
        tail.push("Failed to locate codex-acp binary");
        let exit_status = std::process::ExitStatus::from_raw(0x100);

        let error = agent_exited_during_startup_error(Ok(exit_status), &tail);
        assert!(error
            .to_string()
            .contains("Failed to locate codex-acp binary"));
    }
}
