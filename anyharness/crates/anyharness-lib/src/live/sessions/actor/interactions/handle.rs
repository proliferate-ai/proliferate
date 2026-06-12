use std::sync::Arc;

use tokio::sync::Mutex;

use crate::live::sessions::actor::command::{
    Resolution, ResolveInteractionCommandError,
};
use crate::live::sessions::actor::interactions::outcomes::{
    broker_outcome_to_interaction_event, map_resolve_interaction_error,
};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{SessionDomainOp, SessionOpEmitter, SessionOpStep};
use crate::live::sessions::sink::SessionEventSink;
use crate::live::sessions::rendezvous::broker::{
    InteractionRendezvous, InteractionRendezvousOutcome, InteractionCancelOutcome,
};

pub(in crate::live::sessions::actor) async fn handle_resolve_interaction(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionRendezvous>,
    session_id: &str,
    request_id: String,
    resolution: Resolution,
) -> Result<(), ResolveInteractionCommandError> {
    let outcome = match resolution {
        Resolution::Selected { option_id } => interaction_broker
            .resolve_with_option_id(session_id, &request_id, &option_id)
            .await
            .map(InteractionRendezvousOutcome::Permission),
        Resolution::Decision(decision) => interaction_broker
            .resolve_with_decision(session_id, &request_id, decision)
            .await
            .map(InteractionRendezvousOutcome::Permission),
        Resolution::Submitted { answers } => interaction_broker
            .submit_user_input(session_id, &request_id, answers)
            .await
            .map(InteractionRendezvousOutcome::UserInput),
        Resolution::Accepted { fields } => interaction_broker
            .accept_mcp_elicitation(session_id, &request_id, fields)
            .await
            .map(InteractionRendezvousOutcome::McpElicitation),
        Resolution::Declined => interaction_broker
            .decline_mcp_elicitation(session_id, &request_id)
            .await
            .map(InteractionRendezvousOutcome::McpElicitation),
        Resolution::Cancelled => {
            interaction_broker
                .cancel(session_id, &request_id, InteractionCancelOutcome::Cancelled)
                .await
        }
        Resolution::Dismissed => {
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

/// Drives a [`SessionDomainOp`] through its synchronous two-step protocol:
/// phase 1 (`begin`) under the sink lock; if it requests an interaction
/// resolution, the actor performs it with the sink lock RELEASED (the
/// rendezvous + handle snapshot take their own locks), then phase 2
/// (`finish`) under the sink lock again.
pub(in crate::live::sessions::actor) async fn run_domain_op(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionRendezvous>,
    session_id: &str,
    workspace_id: &str,
    agent_kind: &str,
    op: Box<dyn SessionDomainOp>,
) -> Box<dyn std::any::Any + Send> {
    let step = {
        let mut sink = event_sink.lock().await;
        let mut emitter = SessionOpEmitter::new(&mut sink, session_id, workspace_id, agent_kind);
        op.begin(&mut emitter)
    };
    match step {
        SessionOpStep::Done(value) => value,
        SessionOpStep::ResolveInteraction {
            request_id,
            resolution,
            then,
        } => {
            let outcome = handle_resolve_interaction(
                handle,
                event_sink,
                interaction_broker,
                session_id,
                request_id,
                resolution,
            )
            .await;
            let mut sink = event_sink.lock().await;
            let mut emitter =
                SessionOpEmitter::new(&mut sink, session_id, workspace_id, agent_kind);
            then.finish(&mut emitter, outcome)
        }
    }
}
