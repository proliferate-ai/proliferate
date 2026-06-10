use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::background_work::BackgroundWorkUpdate;

impl SessionActor {
    /// Routes one background-work update: the registry (sole owner of durable
    /// background-work state) marks the tool call terminal, and only if it
    /// transitioned does the sink render the resolution in the transcript.
    pub(in crate::live::sessions::actor) async fn handle_background(
        &self,
        update: BackgroundWorkUpdate,
    ) {
        let marked_terminal = match self
            .background_work_registry
            .mark_terminal(&update, &chrono::Utc::now().to_rfc3339())
        {
            Ok(marked_terminal) => marked_terminal,
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    tool_call_id = %update.tool_call_id,
                    error = %error,
                    "failed to mark background work terminal"
                );
                return;
            }
        };

        if !marked_terminal {
            return;
        }

        let mut sink = self.event_sink.lock().await;
        sink.resolve_background_tool_call(
            update.turn_id.clone(),
            update.tool_call_id.clone(),
            update.state,
            update.agent_id,
            update.output_file,
            update.result_text,
        );
    }
}
