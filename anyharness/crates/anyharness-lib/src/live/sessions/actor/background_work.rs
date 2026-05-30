use std::sync::Arc;

use tokio::sync::Mutex;

use crate::live::sessions::background_work::BackgroundWorkUpdate;
use crate::live::sessions::event_sink::SessionEventSink;
use crate::sessions::store::SessionStore;
pub(in crate::live::sessions::actor) async fn handle_background_work_update(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    store: &SessionStore,
    session_id: &str,
    update: BackgroundWorkUpdate,
) {
    let marked_terminal = match store.mark_background_work_terminal(
        session_id,
        &update.tool_call_id,
        update.state,
        &chrono::Utc::now().to_rfc3339(),
    ) {
        Ok(marked_terminal) => marked_terminal,
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
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

    let mut sink = event_sink.lock().await;
    sink.resolve_background_tool_call(
        update.turn_id.clone(),
        update.tool_call_id.clone(),
        update.state,
        update.agent_id,
        update.output_file,
        update.result_text,
    );
}
