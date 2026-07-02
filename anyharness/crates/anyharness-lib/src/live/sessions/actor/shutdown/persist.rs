use std::sync::Arc;

use anyharness_contract::v1::{SessionEndReason, SessionExecutionPhase};
use tokio::sync::Mutex;

use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::SessionStateDurable;
use crate::live::sessions::sink::SessionEventSink;

pub(in crate::live::sessions::actor) async fn persist_exit_disposition(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    store: &dyn SessionStateDurable,
    session_id: &str,
    disposition: ActorExitDisposition,
    now: &str,
) {
    {
        let mut sink = event_sink.lock().await;
        match &disposition {
            ActorExitDisposition::Error { message, code } => {
                sink.error(message.clone(), code.clone());
                sink.session_ended(SessionEndReason::Error);
            }
            ActorExitDisposition::Close => {
                sink.session_ended(SessionEndReason::Closed);
            }
            // Invariant: dismiss detaches the live actor without announcing a
            // terminal session_ended event. The session remains durable and
            // resumable from the client's perspective.
            ActorExitDisposition::Dismiss => {}
        }
    }

    match disposition {
        ActorExitDisposition::Error { .. } => {
            handle
                .clear_pending_interactions_for_terminal_state(SessionExecutionPhase::Errored)
                .await;
            let _ = store.update_status(session_id, "errored", now);
        }
        ActorExitDisposition::Close => {
            handle
                .clear_pending_interactions_for_terminal_state(SessionExecutionPhase::Closed)
                .await;
        }
        ActorExitDisposition::Dismiss => {
            handle
                .clear_pending_interactions_for_terminal_state(SessionExecutionPhase::Idle)
                .await;
        }
    }
}
