use agent_client_protocol as acp;
use tokio::sync::{mpsc, oneshot};

use crate::live::sessions::actor::command::{Resolution, SessionCommand};
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::turn::active::ActivePromptRequest;
use crate::live::sessions::background_work::BackgroundWorkUpdate;
use crate::live::sessions::AgentExtMethodError;

pub(in crate::live::sessions::actor) const STARTUP_QUEUE_DRAIN_GRACE: std::time::Duration =
    std::time::Duration::from_millis(50);

pub(in crate::live::sessions::actor) enum IdleWork {
    Command(Option<SessionCommand>),
    DrainQueuedPrompt,
    Notification(Option<acp::schema::SessionNotification>),
    Background(Option<BackgroundWorkUpdate>),
}

pub(in crate::live::sessions::actor) async fn select_idle_work(
    command_rx: &mut mpsc::Receiver<SessionCommand>,
    notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    has_queued_prompt: bool,
    queue_drain_not_before: Option<tokio::time::Instant>,
) -> IdleWork {
    let queue_drain_not_before = queue_drain_not_before.unwrap_or_else(tokio::time::Instant::now);
    tokio::select! {
        biased;
        command = command_rx.recv() => IdleWork::Command(command),
        _ = tokio::time::sleep_until(queue_drain_not_before), if has_queued_prompt => {
            IdleWork::DrainQueuedPrompt
        },
        notification = notification_rx.recv() => IdleWork::Notification(notification),
        background = background_work_rx.recv() => IdleWork::Background(background),
    }
}

impl SessionActor {
    /// Drives the actor to completion: the idle loop, then the established
    /// exit sequence (background-work shutdown, exit finalization, busy
    /// release, process drop) exactly as before.
    pub(in crate::live::sessions::actor) async fn run(
        mut self,
        mut command_rx: mpsc::Receiver<SessionCommand>,
        mut notification_rx: mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        mut background_work_rx: mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) -> anyhow::Result<()> {
        let exit_reason = self
            .run_idle(
                &mut command_rx,
                &mut notification_rx,
                &mut background_work_rx,
            )
            .await;
        self.background_work_registry.shutdown();
        self.finalize_exit(exit_reason).await;
        self.handle.finish_prompt();
        drop(self.child);
        Ok(())
    }

    /// The idle select loop. Every arm is one method call; a returned
    /// disposition ends the loop.
    async fn run_idle(
        &mut self,
        command_rx: &mut mpsc::Receiver<SessionCommand>,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) -> ActorExitDisposition {
        // The startup caller cannot enqueue its first reorder/steer command
        // until after the actor's readiness signal returns on another thread.
        // Give that caller one bounded mailbox window before the first durable
        // drain. This deadline is one-shot and is never paid between turns.
        let startup_drain_deadline = tokio::time::Instant::now() + STARTUP_QUEUE_DRAIN_GRACE;
        let mut startup_drain_grace = true;
        loop {
            // Durable queue drain is an idle, low-priority action. A queue
            // mutation already accepted into the actor mailbox wins this
            // boundary, so startup and turn completion cannot capture and run
            // an obsolete head before reorder/steer is applied.
            let queued_prompt = self.next_pending_prompt_for_drain();
            let has_queued_prompt = queued_prompt.is_some();
            match select_idle_work(
                command_rx,
                notification_rx,
                background_work_rx,
                has_queued_prompt,
                startup_drain_grace.then_some(startup_drain_deadline),
            )
            .await
            {
                IdleWork::Command(cmd) => {
                    startup_drain_grace = false;
                    let Some(cmd) = cmd else {
                        return ActorExitDisposition::Close;
                    };
                    if let Some(exit) = self
                        .handle_idle_command(cmd, command_rx, notification_rx, background_work_rx)
                        .await
                    {
                        return exit;
                    }
                }
                IdleWork::DrainQueuedPrompt => {
                    startup_drain_grace = false;
                    let (payload, prompt_id, seq) =
                        queued_prompt.expect("guarded queued prompt must exist");
                    let (respond_to, _response_rx) = oneshot::channel();
                    if let Some(exit) = self
                        .run_turn(
                            ActivePromptRequest {
                                payload,
                                prompt_id,
                                from_queue_seq: Some(seq),
                                respond_to,
                            },
                            command_rx,
                            notification_rx,
                            background_work_rx,
                        )
                        .await
                    {
                        return exit;
                    }
                }
                IdleWork::Notification(notification) => {
                    if let Some(notif) = notification {
                        self.handle_notification(&notif).await;
                    }
                }
                IdleWork::Background(background_update) => {
                    if let Some(update) = background_update {
                        self.handle_background(update).await;
                    }
                }
            }
        }
    }

    /// Dispatches one mailbox command received while idle. Returns the exit
    /// disposition when the command ends the actor.
    async fn handle_idle_command(
        &mut self,
        cmd: SessionCommand,
        command_rx: &mut mpsc::Receiver<SessionCommand>,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) -> Option<ActorExitDisposition> {
        match cmd {
            SessionCommand::Prompt {
                payload,
                prompt_id,
                from_queue_seq,
                respond_to,
            } => {
                // A prequeued marker is only a wake-up/visibility command.
                // The durable row may already have been selected by the idle
                // drain, so never execute its copied payload directly here or
                // a fast completed turn could be duplicated.
                if from_queue_seq.is_some() || self.next_pending_prompt_for_drain().is_some() {
                    let result = self
                        .handle_busy_prompt_queue(payload, prompt_id, from_queue_seq)
                        .await;
                    let _ = respond_to.send(result);
                    return None;
                }
                self.run_turn(
                    ActivePromptRequest {
                        payload,
                        prompt_id,
                        from_queue_seq,
                        respond_to,
                    },
                    command_rx,
                    notification_rx,
                    background_work_rx,
                )
                .await
            }
            SessionCommand::EditPendingPrompt {
                seq,
                payload,
                respond_to,
            } => {
                let _ = respond_to.send(self.handle_edit_pending_prompt(seq, payload).await);
                None
            }
            SessionCommand::DeletePendingPrompt { seq, respond_to } => {
                let _ = respond_to.send(self.handle_delete_pending_prompt(seq).await);
                None
            }
            SessionCommand::ReorderPendingPrompts {
                expected_seqs,
                desired_seqs,
                respond_to,
            } => {
                let _ = respond_to.send(
                    self.handle_reorder_pending_prompts(expected_seqs, desired_seqs)
                        .await,
                );
                None
            }
            SessionCommand::SteerPendingPrompt { seq, respond_to } => {
                let _ = respond_to.send(self.handle_steer_pending_prompt(seq, false).await);
                None
            }
            SessionCommand::ResolveInteraction {
                request_id,
                resolution,
                respond_to,
            } => {
                let result = self.resolve_interaction(request_id, resolution).await;
                let _ = respond_to.send(result);
                None
            }
            SessionCommand::RunDomainOp { op, respond_to } => {
                let result = self.run_domain_op_cmd(op).await;
                let _ = respond_to.send(result);
                None
            }
            SessionCommand::CallAgentExtMethod {
                method,
                params,
                respond_to,
            } => {
                self.spawn_agent_ext_method(method, params, respond_to);
                None
            }
            SessionCommand::InjectRuntimeEvent { event, respond_to } => {
                let result = self.inject_runtime_event(event).await;
                let _ = respond_to.send(result);
                None
            }
            SessionCommand::SetConfigOption {
                config_id,
                value,
                catalog_authorized_model,
                respond_to,
            } => {
                let result = self
                    .handle_idle_config_command(&config_id, &value, catalog_authorized_model)
                    .await;

                match result {
                    Ok(state) => {
                        let _ = respond_to.send(Ok(state));
                    }
                    Err(error) => {
                        let _ = respond_to.send(Err(error));
                    }
                }
                None
            }
            SessionCommand::Cancel => {
                let _ = self
                    .conn
                    .send_notification(acp::schema::CancelNotification::new(
                        self.native_session_id.clone(),
                    ));
                None
            }
            SessionCommand::Dismiss { respond_to } => {
                self.resolve_pending_interactions(Resolution::Dismissed)
                    .await;
                let _ = respond_to.send(Ok(()));
                Some(ActorExitDisposition::Dismiss)
            }
            SessionCommand::Close { respond_to } => {
                self.resolve_pending_interactions(Resolution::Cancelled)
                    .await;
                let _ = respond_to.send(Ok(()));
                Some(ActorExitDisposition::Close)
            }
            SessionCommand::ReplayAdvance { respond_to } => {
                let _ = respond_to.send(Err(anyhow::anyhow!("session is not a replay session")));
                None
            }
            command => {
                debug_assert!(command.is_fork_lifecycle_command());
                self.handle_idle_fork_lifecycle_command(command).await;
                None
            }
        }
    }

    /// Dispatches an ACP extension-method request WITHOUT blocking the actor
    /// loop: the request rides an owned connection clone on a detached task,
    /// and the raw JSON result (or the bounded timeout error) is delivered on
    /// `respond_to`.
    ///
    /// This must not be awaited inline. `tokio::select!` runs a chosen arm's
    /// body to completion before re-polling, so awaiting a sidecar
    /// confirmation here would freeze every sibling arm — the streaming
    /// prompt future, notification drain, Cancel, and (the deadlock case)
    /// ResolveInteraction. A goal write queued behind a turn blocked on a
    /// pending interaction could then never be answered: the permission can't
    /// be resolved because the loop is wedged on the write, so the turn can't
    /// end and the write can't land. Spawning keeps the select responsive so
    /// the permission resolves, the turn ends, and the write succeeds.
    pub(in crate::live::sessions::actor) fn spawn_agent_ext_method(
        &self,
        method: String,
        params: serde_json::Value,
        respond_to: oneshot::Sender<anyhow::Result<serde_json::Value>>,
    ) {
        let conn = self.conn.clone();
        tokio::spawn(async move {
            let result = Self::call_agent_ext_method_on(&conn, &method, params).await;
            let _ = respond_to.send(result);
        });
    }

    /// Sends one ACP extension-method request on an owned connection clone off
    /// the actor loop. The wire method name is serialized verbatim (outbound
    /// ext routing does not gate on the `_` prefix); the raw JSON result is
    /// returned untouched.
    ///
    /// The await is bounded so a sidecar that never answers cannot leak the
    /// spawned task forever — the deadline exceeds every sidecar-internal
    /// confirmation window (30s).
    async fn call_agent_ext_method_on(
        conn: &acp::ConnectionTo<acp::Agent>,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        const EXT_METHOD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);
        let params: std::sync::Arc<serde_json::value::RawValue> =
            serde_json::value::to_raw_value(&params)?.into();
        let ext = acp::schema::ExtRequest::new(method.to_string(), params);
        // Classify the failure so callers can distinguish a hung/broken sidecar
        // (Timeout) and a sidecar-internal error from a client-side rejection
        // instead of folding everything into a 400.
        let response = match tokio::time::timeout(
            EXT_METHOD_TIMEOUT,
            conn.send_request(acp::AgentRequest::ExtMethodRequest(ext))
                .block_task(),
        )
        .await
        {
            Err(_elapsed) => {
                return Err(AgentExtMethodError::Timeout {
                    method: method.to_string(),
                    timeout_secs: EXT_METHOD_TIMEOUT.as_secs(),
                }
                .into());
            }
            Ok(Err(rpc_error)) => {
                return Err(AgentExtMethodError::Rpc {
                    method: method.to_string(),
                    code: i32::from(rpc_error.code),
                    message: rpc_error.to_string(),
                }
                .into());
            }
            Ok(Ok(response)) => response,
        };
        Ok(serde_json::to_value(&response)?)
    }
}
