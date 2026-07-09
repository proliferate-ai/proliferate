use std::sync::Arc;

use tokio::sync::Mutex;

use crate::live::sessions::actor::command::Resolution;
use crate::live::sessions::actor::interactions::outcomes::broker_outcome_to_interaction_event;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::rendezvous::broker::{InteractionCancelOutcome, InteractionRendezvous};
use crate::live::sessions::sink::SessionEventSink;

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn resolve_pending_interactions(
        &self,
        resolution: Resolution,
    ) {
        resolve_pending_interactions(
            &self.handle,
            &self.event_sink,
            &self.interaction_broker,
            &self.session_id,
            resolution,
        )
        .await;
    }
}

pub(in crate::live::sessions::actor) async fn resolve_pending_interactions(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionRendezvous>,
    session_id: &str,
    resolution: Resolution,
) {
    let broker_outcome = match resolution {
        Resolution::Cancelled => InteractionCancelOutcome::Cancelled,
        Resolution::Dismissed => InteractionCancelOutcome::Dismissed,
        Resolution::Selected { .. }
        | Resolution::Decision(_)
        | Resolution::Submitted { .. }
        | Resolution::Accepted { .. }
        | Resolution::Declined => {
            tracing::warn!(
                session_id = %session_id,
                resolution = ?resolution,
                "cleanup attempted non-terminal interaction resolution"
            );
            return;
        }
    };

    let cancelled = {
        let mut sink = event_sink.lock().await;
        let cancelled = interaction_broker
            .cancel_session(session_id, broker_outcome)
            .await;

        for interaction in &cancelled {
            let (kind, outcome) = broker_outcome_to_interaction_event(interaction.outcome.clone());
            sink.interaction_resolved(interaction.request_id.clone(), kind, outcome);
        }

        cancelled
    };

    for interaction in cancelled {
        handle
            .remove_pending_interaction(&interaction.request_id)
            .await;
    }
}
