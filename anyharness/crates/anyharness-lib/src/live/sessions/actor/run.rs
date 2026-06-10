use agent_client_protocol as acp;
use tokio::sync::mpsc;

use crate::live::sessions::actor::command::{Resolution, SessionCommand};
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::turn::active::ActivePromptRequest;
use crate::live::sessions::background_work::BackgroundWorkUpdate;

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
        loop {
            tokio::select! {
                cmd = command_rx.recv() => {
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
                notification = notification_rx.recv() => {
                    if let Some(notif) = notification {
                        self.handle_notification(&notif).await;
                    }
                }
                background_update = background_work_rx.recv() => {
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
            SessionCommand::Prompt { payload, prompt_id, latency, from_queue_seq, respond_to } => {
                self.run_turn(
                    ActivePromptRequest {
                        payload,
                        prompt_id,
                        latency,
                        from_queue_seq,
                        respond_to,
                    },
                    command_rx,
                    notification_rx,
                    background_work_rx,
                )
                .await
            }
            SessionCommand::EditPendingPrompt { seq, payload, respond_to } => {
                let _ = respond_to.send(self.handle_edit_pending_prompt(seq, payload).await);
                None
            }
            SessionCommand::DeletePendingPrompt { seq, respond_to } => {
                let _ = respond_to.send(self.handle_delete_pending_prompt(seq).await);
                None
            }
            SessionCommand::ResolveInteraction { request_id, resolution, respond_to } => {
                let result = self.resolve_interaction(request_id, resolution).await;
                let _ = respond_to.send(result);
                None
            }
            SessionCommand::RunDomainOp { op, respond_to } => {
                let result = self.run_domain_op_cmd(op).await;
                let _ = respond_to.send(result);
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
                respond_to,
            } => {
                let result = self.handle_idle_config_command(&config_id, &value).await;

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
                let _ = self.conn.send_notification(acp::schema::CancelNotification::new(
                    self.native_session_id.clone(),
                ));
                None
            }
            SessionCommand::Dismiss { respond_to } => {
                self.resolve_pending_interactions(Resolution::Dismissed).await;
                let _ = respond_to.send(Ok(()));
                Some(ActorExitDisposition::Dismiss)
            }
            SessionCommand::Close { respond_to } => {
                self.resolve_pending_interactions(Resolution::Cancelled).await;
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
}
