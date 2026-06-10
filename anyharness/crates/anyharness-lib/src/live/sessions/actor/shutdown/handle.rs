use std::sync::Arc;

use tokio::sync::Mutex;

use crate::live::sessions::actor::interactions::cleanup::resolve_pending_interactions;
use crate::live::sessions::actor::shutdown::cleanup::interaction_resolution_for_exit;
use crate::live::sessions::actor::shutdown::persist::persist_exit_disposition;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::model::SessionStateDurable;
use crate::live::sessions::sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::rendezvous::broker::InteractionRendezvous;
pub(in crate::live::sessions::actor) async fn finalize_established_actor_exit(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionRendezvous>,
    store: &dyn SessionStateDurable,
    session_id: &str,
    disposition: ActorExitDisposition,
) {
    let execution_snapshot = handle.execution_snapshot().await;
    let pending_interactions = execution_snapshot.pending_interactions.clone();
    let busy = handle.is_busy();
    let sink_snapshot = {
        let sink = event_sink.lock().await;
        sink.debug_snapshot()
    };
    let now = chrono::Utc::now().to_rfc3339();

    tracing::info!(
        session_id = %session_id,
        disposition = ?disposition,
        busy = busy,
        execution_phase = ?execution_snapshot.phase,
        pending_interaction_count = pending_interactions.len(),
        turn_id = ?sink_snapshot.current_turn_id,
        open_assistant_item_id = ?sink_snapshot.open_assistant_item_id,
        open_reasoning_item_id = ?sink_snapshot.open_reasoning_item_id,
        open_plan_item_id = ?sink_snapshot.open_plan_item_id,
        open_tool_call_ids = ?sink_snapshot.open_tool_call_ids,
        next_event_seq = sink_snapshot.next_seq,
        "session.actor.exit.finalized"
    );

    let pending_resolution = interaction_resolution_for_exit(&disposition);
    resolve_pending_interactions(
        handle,
        event_sink,
        interaction_broker,
        session_id,
        pending_resolution,
    )
    .await;

    persist_exit_disposition(handle, event_sink, store, session_id, disposition, &now).await;
}
