use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, Mutex};

use crate::domains::sessions::prompt::capabilities::capabilities_from_acp;
use crate::live::sessions::actor::capabilities::{
    action_capabilities_from_acp, persist_session_action_capabilities,
};
use crate::live::sessions::actor::config::diagnostics::ConfigFailureStage;
use crate::live::sessions::actor::config::handle::apply_resolved_launch_intent;
use crate::live::sessions::actor::config::persist::{
    emit_live_config_update, emit_startup_state, load_startup_restore_snapshot,
    log_config_stage_result,
};
use crate::live::sessions::actor::config::restore::restore_persisted_live_config_if_needed;
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActor, SessionActorConfig, SessionStartupState};
use crate::live::sessions::background_work::{
    BackgroundWorkOptions, BackgroundWorkRegistry, BackgroundWorkUpdate,
};
use crate::live::sessions::driver::connection::establish_connection;
use crate::live::sessions::driver::inbound::InboundDoor;
use crate::live::sessions::driver::native_session::start_native_session;
use crate::live::sessions::driver::opencode_sidedoor::{
    derive_sidedoor_capability, provision_sidedoor_spawn,
};
use crate::live::sessions::driver::process::spawn_agent_process;
use crate::live::sessions::driver::session_lifecycle::{
    initialize_connection, initialize_protected_connection,
};
use crate::live::sessions::driver::types::NativeSessionStartupDisposition;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::sink::SessionEventSink;
use crate::observability::AGENT_STDERR_TRACING_TARGET;

impl SessionActor {
    /// Spawns the agent process, establishes the ACP connection, starts the
    /// native session, and runs the startup config-restore sequence — in
    /// exactly the same order as before this became a constructor. Returns
    /// the constructed actor plus the notification/background-work receivers,
    /// which stay out of the struct (they are threaded through the run loop
    /// as parameters).
    pub(in crate::live::sessions::actor) async fn start(
        mut config: SessionActorConfig,
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

        // See `opencode_sidedoor::provision_sidedoor_spawn`: for OpenCode
        // only, provisions the HTTP side-door (fresh loopback port +
        // Basic-auth password) and mutates `config.launch.env` to wire it
        // into the spawned process.
        let sidedoor_config =
            provision_sidedoor_spawn(&source_agent_kind, &mut config.launch.env, &session_id);

        let spawned = spawn_agent_process(
            &config.launch.agent,
            &config.launch.workspace_path,
            &config.launch.env,
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

        let mut sink = if startup_strategy.resumes_durable_history() {
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
        };
        sink.set_interaction_hooks(
            config.hooks.on_interaction_requested.clone(),
            config.hooks.on_interaction_resolved.clone(),
        );
        let event_sink = Arc::new(Mutex::new(sink));
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

        if let crate::live::sessions::model::SessionStartupStrategy::ForkFromNative {
            parent_native_session_id,
            ..
        } = &startup_strategy
        {
            if client
                .prepare_process_local_fork_epoch(parent_native_session_id)
                .is_err()
            {
                let detail = "process-local fork inbound epoch could not be prepared";
                let _ = ready_tx.send(Err(anyhow::anyhow!(detail)));
                return Err(anyhow::anyhow!(detail));
            }
        }

        let (conn, shutdown_tx) = establish_connection(client.clone(), stdin, stdout).await?;

        // Race the initialize/new-session handshake against agent-process
        // exit: an agent that dies before responding (bad install, crash on
        // boot) should fail that phase immediately with its stderr instead of
        // letting the caller burn the full ready timeout on a misleading
        // "waiting for authentication" message.
        let handshake = async {
            let init_response = if matches!(
                &startup_strategy,
                crate::live::sessions::model::SessionStartupStrategy::ForkFromNative { .. }
            ) {
                initialize_protected_connection(
                    &conn,
                    &source_agent_kind,
                    &config.launch.agent,
                    &session_id,
                    &workspace_id,
                    &ready_tx,
                )
                .await?
            } else {
                initialize_connection(
                    &conn,
                    &source_agent_kind,
                    &config.launch.agent,
                    &session_id,
                    &workspace_id,
                    &ready_tx,
                )
                .await?
            };

            persist_session_action_capabilities(
                config.caps.state.as_ref(),
                &session_id,
                &source_agent_kind,
                &init_response,
            );
            let action_capabilities =
                action_capabilities_from_acp(&source_agent_kind, &init_response);

            let native = start_native_session(
                &conn,
                client.clone(),
                config.caps.fork_dispatch.clone(),
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
        let (init_response, mut action_capabilities, native_session) = tokio::select! {
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
                let error = stderr_tail.startup_exit_error(exit_status);
                tracing::warn!(
                    target: AGENT_STDERR_TRACING_TARGET,
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    agent_kind = %source_agent_kind,
                    error = %error.caller_detail().replace('\n', " | "),
                    elapsed_ms = startup_started.elapsed().as_millis(),
                    "[workspace-latency] session.actor.process_exited_during_startup"
                );
                // Ordinary Display/Debug formatting is status-only, so generic
                // actor and API logging cannot retransmit raw child output.
                // The initiating authenticated API mapper can still opt into
                // the bounded caller detail carried by this typed error.
                let _ = ready_tx.send(Err(anyhow::Error::new(error.clone())));
                return Err(anyhow::Error::new(error));
            }
        };
        let supports_native_close = init_response
            .agent_capabilities
            .session_capabilities
            .close
            .is_some();
        let (native_session_id, mut native_startup_state, startup_disposition) = native_session;
        native_startup_state.absorb_init_meta_model_state(init_response.meta.as_ref());
        let mut startup_state: SessionStartupState = native_startup_state.into();
        startup_state.prompt_capabilities =
            capabilities_from_acp(Some(&init_response.agent_capabilities.prompt_capabilities));

        // See `opencode_sidedoor::derive_sidedoor_capability`: with the vendor
        // server up (native session established), runs the fail-closed
        // side-door readiness check and derives `targeted_fork` for OpenCode.
        // Other kinds retain the exact agent/target-domain classification from
        // `action_capabilities_from_acp`.
        let sidedoor = if let Some(config_sd) = sidedoor_config {
            let native_id = native_session_id.to_string();
            let resolved_native_version = config
                .launch
                .agent
                .native
                .as_ref()
                .and_then(|artifact| artifact.version.clone());
            Some(
                derive_sidedoor_capability(
                    config_sd,
                    &native_id,
                    &session_id,
                    &workspace_id,
                    resolved_native_version.as_deref(),
                    &mut action_capabilities,
                    config.caps.state.as_ref(),
                )
                .await,
            )
        } else {
            None
        };

        tracing::info!(
            target: "anyharness.session.established",
            session_id = %session_id,
            native_session_id = %native_session_id,
            startup_strategy = startup_strategy_label,
            native_startup_disposition = startup_disposition.as_str(),
            resumed = startup_disposition == NativeSessionStartupDisposition::LoadedExisting,
            "ACP session established"
        );

        let mut persisted_config_state =
            PersistedSessionConfigState::from_session(&config.launch.session);
        let startup_restore_snapshot = load_startup_restore_snapshot(
            config.caps.state.as_ref(),
            &session_id,
            startup_strategy.resumes_durable_history(),
        )?;
        {
            let mut sink = event_sink.lock().await;
            if startup_disposition == NativeSessionStartupDisposition::CreatedFresh {
                sink.session_started(native_session_id.to_string());
            }
            emit_startup_state(&mut sink, &startup_state);
        }
        let launch_intent = config
            .caps
            .state
            .find_launch_intent(&session_id)?
            .ok_or_else(|| {
                anyhow::anyhow!("session {session_id} has no persisted launch intent")
            })?;
        let restore_live_config_started = Instant::now();
        let result = restore_persisted_live_config_if_needed(
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
        .await;
        log_config_stage_result(
            &session_id,
            &workspace_id,
            &result,
            restore_live_config_started.elapsed(),
            "failed to restore persisted live config",
            ConfigFailureStage::RestoreLiveConfig,
        );
        if let Err(error) = result {
            queue_launch_observation_refresh(&config.caps, &source_agent_kind, &session_id);
            let _ = ready_tx.send(Err(startup_config_failure(&startup_strategy, &error)));
            return Err(error);
        }
        // A newly-created session has no durable live authority until its
        // complete immutable intent is applied and confirmed. Persisting the
        // handshake before this point would let a failed attempt promote its
        // defaults into a resume snapshot and skip the intent on retry.
        // Established sessions instead restore their already-confirmed full
        // snapshot so later live mutations remain authoritative.
        if startup_restore_snapshot.is_none() {
            // Only non-posture controls are ever dropped here, so the mode
            // projection can never diverge from a dropped value and needs no
            // compensating clear.
            if let Err(error) = apply_resolved_launch_intent(
                &conn,
                &native_session_id,
                &session_id,
                &source_agent_kind,
                &launch_intent,
                &mut startup_state,
            )
            .await
            {
                tracing::warn!(session_id = %session_id, error = %error, "failed to apply and confirm launch intent");
                queue_launch_observation_refresh(&config.caps, &source_agent_kind, &session_id);
                let _ = ready_tx.send(Err(startup_config_failure(&startup_strategy, &error)));
                return Err(error);
            }
        }
        // This is the first snapshot write for a newly-created session. At this
        // point either the complete launch intent or every saved current value
        // has passed membership, setter confirmation, and final aggregate
        // equality. A persistence failure is therefore fatal before readiness.
        let post_preferences_live_config_started = Instant::now();
        let result = emit_live_config_update(
            &source_agent_kind,
            &session_id,
            config.caps.state.as_ref(),
            &event_sink,
            &mut persisted_config_state,
            &mut startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await;
        log_config_stage_result(
            &session_id,
            &workspace_id,
            &result,
            post_preferences_live_config_started.elapsed(),
            "failed to persist post-preference live config snapshot",
            ConfigFailureStage::PostPreferencesLiveConfig,
        );
        if let Err(error) = result {
            let _ = ready_tx.send(Err(anyhow::anyhow!(error.to_string())));
            return Err(error);
        }

        if let crate::live::sessions::model::SessionStartupStrategy::ForkFromNative {
            fork_operation_id,
            ..
        } = &startup_strategy
        {
            // Acquire the in-memory publication lock while ChildStarting still
            // denies requests. The epoch's finalizer rechecks the fault bit,
            // then holds its mutex across the durable commit, Idle update, and
            // ReadyChild transition without an await gap.
            let mut execution = handle.execution.write().await;
            let finalized_at = chrono::Utc::now().to_rfc3339();
            if client
                .finalize_process_local_fork_ready(|| {
                    config.caps.fork_dispatch.finalize_startup(
                        fork_operation_id,
                        &session_id,
                        &native_session_id,
                        &finalized_at,
                    )?;
                    execution.phase = SessionExecutionPhase::Idle;
                    execution.updated_at = finalized_at.clone();
                    Ok(())
                })
                .is_err()
            {
                let detail = "durable process-local fork finalization failed";
                tracing::warn!(
                    fork_stage = "finalize",
                    failure_class = "process_local_fork_finalization_failed",
                    "process-local fork startup failed"
                );
                let _ = ready_tx.send(Err(anyhow::anyhow!(detail)));
                return Err(anyhow::anyhow!(detail));
            }
            tracing::info!(
                fork_stage = "finalize",
                phase = "completed",
                "process-local fork phase"
            );
        } else {
            handle
                .set_execution_phase(SessionExecutionPhase::Idle)
                .await;
        }

        let _ = ready_tx.send(Ok(native_session_id.to_string()));
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
            sidedoor,
            conn,
            caps,
            hooks,
            interaction_broker,
            handle,
            _acp_shutdown: shutdown_tx,
            child,
            pending_stop_response: None,
        };
        Ok((actor, notification_rx, background_work_rx))
    }
}

pub(in crate::live::sessions::actor) fn queue_launch_observation_refresh(
    caps: &crate::live::sessions::model::ActorCapabilities,
    harness_kind: &str,
    session_id: &str,
) {
    let Some(invalidator) = caps.launch_observation_invalidator.as_ref() else {
        return;
    };
    if invalidator.queue_refresh(harness_kind) {
        tracing::info!(
            session_id,
            harness_kind,
            event = "session.launch_observation.contradiction",
            "queued a deduplicated target launch-options refresh"
        );
    } else {
        tracing::warn!(
            session_id,
            harness_kind,
            event = "session.launch_observation.contradiction_queue_closed",
            "could not queue target launch-options refresh"
        );
    }
}

/// Process-local fork children report a fork-shaped startup failure (Lane D):
/// the fork dispatcher classifies the child by this readiness error, so a
/// configuration failure during a `ForkFromNative` start must not surface as an
/// ordinary config error. Every other startup keeps the launch-options
/// cutover's exact error text.
fn startup_config_failure(
    startup_strategy: &crate::live::sessions::model::SessionStartupStrategy,
    error: &anyhow::Error,
) -> anyhow::Error {
    if matches!(
        startup_strategy,
        crate::live::sessions::model::SessionStartupStrategy::ForkFromNative { .. }
    ) {
        anyhow::anyhow!("process-local fork session configuration failed")
    } else {
        anyhow::anyhow!(error.to_string())
    }
}
