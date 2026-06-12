use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::background_work::BackgroundWorkUpdate;

impl SessionActor {
    /// Marks a background tool call terminal in the durable store and, if it
    /// transitioned, resolves it in the transcript.
    pub(in crate::live::sessions::actor) async fn handle_background(
        &self,
        update: BackgroundWorkUpdate,
    ) {
        let marked_terminal = match self.caps.background.mark_background_work_terminal(
            &self.session_id,
            &update.tool_call_id,
            update.state,
            &chrono::Utc::now().to_rfc3339(),
        ) {
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
