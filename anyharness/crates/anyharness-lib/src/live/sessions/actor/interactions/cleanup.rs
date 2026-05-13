use std::sync::Arc;

use tokio::sync::Mutex;

use crate::acp::event_sink::SessionEventSink;
use crate::acp::permission_broker::{InteractionBroker, InteractionCancelOutcome};
use crate::live::sessions::actor::command::InteractionResolution;
use crate::live::sessions::actor::interactions::handle::broker_outcome_to_interaction_event;
use crate::live::sessions::handle::LiveSessionHandle;
pub(in crate::live::sessions::actor) async fn resolve_pending_interactions(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionBroker>,
    session_id: &str,
    resolution: InteractionResolution,
) {
    let broker_outcome = match resolution {
        InteractionResolution::Cancelled => InteractionCancelOutcome::Cancelled,
        InteractionResolution::Dismissed => InteractionCancelOutcome::Dismissed,
        InteractionResolution::Selected { .. }
        | InteractionResolution::Decision(_)
        | InteractionResolution::Submitted { .. }
        | InteractionResolution::Accepted { .. }
        | InteractionResolution::Declined => {
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
