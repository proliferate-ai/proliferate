use std::sync::Arc;

use anyharness_contract::v1::SessionExecutionPhase;

use super::LiveSessionManager;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::handle::LiveSessionHandle;

#[cfg(test)]
impl LiveSessionManager {
    /// Register an idle targeted-fork-ready handle that drops only the
    /// OpenCode side-door response. The fork runtime therefore reaches the
    /// post-operation dispatch seam before observing an unknown outcome.
    pub(crate) async fn insert_targeted_fork_ready_sidedoor_dropper_for_test(
        &self,
        session_id: &str,
    ) {
        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            SessionExecutionPhase::Idle,
        ));
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);

        tokio::spawn(async move {
            let Some(SessionCommand::VerifyForkReady {
                requires_targeted_fork: true,
                respond_to,
            }) = command_rx.recv().await
            else {
                return;
            };
            let _ = respond_to.send(Ok(()));

            let Some(SessionCommand::SidedoorTargetedFork { respond_to, .. }) =
                command_rx.recv().await
            else {
                return;
            };
            drop(respond_to);
        });
    }
}
