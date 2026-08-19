//! Serialized domain ops: product-initiated writes that ride the per-session
//! actor mailbox for command ordering. Split out of `model.rs` (PROD-SIZE-1);
//! the vocabulary stays part of the `model` doorstep via re-export, alongside
//! the sink payload shapes.
//!
//! See the mechanism decision table in [`model`](super::model) for how a
//! [`SessionDomainOp`] relates to the other live-session hook shapes.

use std::any::Any;

use anyharness_contract::v1::SessionEventEnvelope;

use crate::live::sessions::actor::command::{Resolution, ResolveInteractionCommandError};
use crate::live::sessions::model::SessionObserverContext;
use crate::live::sessions::sink::SessionEventSink;

/// A domain operation serialized through the per-session actor mailbox.
///
/// The actor drives a synchronous two-step: phase 1 ([`begin`]) runs under
/// the sink lock; if it requests an interaction resolution, the actor
/// performs it (sink lock released for the rendezvous), then phase 2
/// ([`SessionOpFinish::finish`]) runs under the sink lock again. Riding the
/// mailbox gives the op full command-ordering guarantees — it cannot
/// interleave with `Cancel`/`Close`/another op.
///
/// The boxed `Any` reply crosses back to the submitter, which downcasts to
/// its own concrete result type — full typing, no serialization.
///
/// [`begin`]: SessionDomainOp::begin
pub trait SessionDomainOp: Send {
    /// Phase 1, under the sink lock: run the domain tx and publish committed
    /// envelopes via the emitter; optionally request a resolution.
    ///
    /// Same partial-failure contract as
    /// [`ObserverEffects::persisted_events`]: either fail without committing
    /// event rows, or commit and publish EVERY committed envelope before
    /// returning.
    ///
    /// [`ObserverEffects::persisted_events`]: super::model::ObserverEffects::persisted_events
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep;
}

/// Outcome of [`SessionDomainOp::begin`].
pub enum SessionOpStep {
    /// Op complete; the boxed value is handed back to the submitter.
    Done(Box<dyn Any + Send>),
    /// The actor must resolve a pending interaction, then call `then.finish`.
    ResolveInteraction {
        request_id: String,
        resolution: Resolution,
        then: Box<dyn SessionOpFinish>,
    },
}

/// Phase 2 of a [`SessionDomainOp`].
pub trait SessionOpFinish: Send {
    /// Runs under the sink lock again, after the actor performed the
    /// requested resolution. Same partial-failure contract as
    /// [`SessionDomainOp::begin`].
    fn finish(
        self: Box<Self>,
        emitter: &mut SessionOpEmitter<'_>,
        outcome: Result<(), ResolveInteractionCommandError>,
    ) -> Box<dyn Any + Send>;
}

/// Borrow of the LOCKED sink handed to a [`SessionDomainOp`] phase.
///
/// Constructed only by the actor, which holds the sink lock for the duration
/// of the phase and supplies its own identity fields; ops use it to read the
/// event context and publish envelopes they committed themselves.
pub struct SessionOpEmitter<'a> {
    sink: &'a mut SessionEventSink,
    session_id: &'a str,
    workspace_id: &'a str,
    agent_kind: &'a str,
}

impl<'a> SessionOpEmitter<'a> {
    /// Actor-only constructor; `sink` must be the locked per-session sink.
    pub(in crate::live::sessions) fn new(
        sink: &'a mut SessionEventSink,
        session_id: &'a str,
        workspace_id: &'a str,
        agent_kind: &'a str,
    ) -> Self {
        Self {
            sink,
            session_id,
            workspace_id,
            agent_kind,
        }
    }

    /// Context at the sink's current counter. Re-read after every
    /// [`publish`](Self::publish) — the counter advances.
    pub fn event_ctx(&self) -> SessionObserverContext {
        SessionObserverContext {
            session_id: self.session_id.to_string(),
            workspace_id: self.workspace_id.to_string(),
            agent_kind: self.agent_kind.to_string(),
            turn_id: self.sink.current_turn_id(),
            next_seq: self.sink.next_seq(),
        }
    }

    /// Broadcast envelopes the op already committed to the event store and
    /// advance the sink counter past them.
    pub fn publish(&mut self, events: Vec<SessionEventEnvelope>) {
        self.sink.publish_persisted_events(events);
    }
}
