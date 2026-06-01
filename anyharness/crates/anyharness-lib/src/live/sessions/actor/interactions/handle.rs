use std::sync::Arc;

use tokio::sync::Mutex;

use crate::live::sessions::actor::command::{
    InteractionResolution, ResolveInteractionCommandError,
};
use crate::live::sessions::actor::interactions::outcomes::{
    broker_outcome_to_interaction_event, map_resolve_interaction_error,
};
use crate::live::sessions::event_sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::interactions::broker::{
    InteractionBroker, InteractionBrokerOutcome, InteractionCancelOutcome,
};

pub(in crate::live::sessions::actor) async fn handle_resolve_interaction(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionBroker>,
    session_id: &str,
    request_id: String,
    resolution: InteractionResolution,
) -> Result<(), ResolveInteractionCommandError> {
    let outcome = match resolution {
        InteractionResolution::Selected { option_id } => interaction_broker
            .resolve_with_option_id(session_id, &request_id, &option_id)
            .await
            .map(InteractionBrokerOutcome::Permission),
        InteractionResolution::Decision(decision) => interaction_broker
            .resolve_with_decision(session_id, &request_id, decision)
            .await
            .map(InteractionBrokerOutcome::Permission),
        InteractionResolution::Submitted { answers } => interaction_broker
            .submit_user_input(session_id, &request_id, answers)
            .await
            .map(InteractionBrokerOutcome::UserInput),
        InteractionResolution::Accepted { fields } => interaction_broker
            .accept_mcp_elicitation(session_id, &request_id, fields)
            .await
            .map(InteractionBrokerOutcome::McpElicitation),
        InteractionResolution::Declined => interaction_broker
            .decline_mcp_elicitation(session_id, &request_id)
            .await
            .map(InteractionBrokerOutcome::McpElicitation),
        InteractionResolution::Cancelled => {
            interaction_broker
                .cancel(session_id, &request_id, InteractionCancelOutcome::Cancelled)
                .await
        }
        InteractionResolution::Dismissed => {
            interaction_broker
                .cancel(session_id, &request_id, InteractionCancelOutcome::Dismissed)
                .await
        }
    }
    .map_err(map_resolve_interaction_error)?;

    let (kind, contract_outcome) = broker_outcome_to_interaction_event(outcome);

    {
        let mut sink = event_sink.lock().await;
        sink.interaction_resolved(request_id.clone(), kind, contract_outcome);
    }
    handle.remove_pending_interaction(&request_id).await;
    Ok(())
}
