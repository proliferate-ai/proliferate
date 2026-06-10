//! The live-session extension vocabulary: observers, permission advice, and
//! serialized domain ops.
//!
//! This module is the single place where "things that hook into a live
//! session" are declared. Live defines these traits in its own vocabulary;
//! product domains implement them; `app/` wires the implementations in. Live
//! never imports domain services or stores — anything a hook needs from the
//! product side crosses as one of these capability shapes.
//!
//! # Mechanism decision table
//!
//! | Mechanism              | Timing                                            | Task / thread                                   | May emit events                                   | May block                          |
//! |------------------------|---------------------------------------------------|--------------------------------------------------|---------------------------------------------------|-------------------------------------|
//! | `SessionExtension`     | launch / turn-finish / session-close lifecycle    | main tokio runtime (hooks may spawn)             | no — use the runtime-event injection paths        | no                                  |
//! | [`SessionEventObserver`] | each special observation in the dispatch pass   | per-session thread, in-loop, sink lock held      | yes — committed rows returned in [`ObserverEffects`] | sqlite tx only                   |
//! | [`PermissionAdvisor`]  | inbound permission arrival, before parking        | inbound-door task, sink lock held by the caller  | yes — committed rows returned in `Predecided`     | sqlite tx only                      |
//! | [`SessionDomainOp`]    | product-initiated write needing command ordering  | actor loop via the mailbox, sink lock per phase  | yes — via [`SessionOpEmitter::publish`]           | sqlite tx only (sync per phase)     |
//!
//! # The serialization model
//!
//! Session-event emission is protected by two nested guarantees: the
//! per-session `current_thread` runtime (nothing is ever parallel) and the
//! sink lock (every `next_seq` read, every domain tx persisting event rows,
//! and every publish happens while the sink mutex is held). The actor loop
//! adds *ordering* on top — domain writes that must not interleave with
//! commands ride the mailbox as a [`SessionDomainOp`].
//!
//! Anything event-emitting is synchronous under the sink lock. Side effects
//! that emit nothing may hand off to a main-runtime
//! [`Handle`](tokio::runtime::Handle) captured at app wiring — the
//! per-session runtime dies with the session, so never spawn lasting work on
//! it.

use std::any::Any;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionEventEnvelope;

use crate::live::sessions::actor::command::{Resolution, ResolveInteractionCommandError};
use crate::live::sessions::sink::SessionEventSink;
// Re-exported: the normalized-payload vocabulary observers consume. The sink
// module itself stays private to live; these shapes are part of the doorstep.
pub use crate::live::sessions::sink::{AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage};

/// Where in the session's event stream an observation (or op phase) is
/// happening. A snapshot taken under the sink lock at this point in the
/// dispatch pass.
#[derive(Debug, Clone)]
pub struct SessionObserverContext {
    pub session_id: String,
    pub workspace_id: String,
    /// The session's source agent kind (e.g. `"claude"`, `"codex"`).
    pub agent_kind: String,
    pub turn_id: Option<String>,
    /// Sink counter at this point in the dispatch pass. Event rows a hook
    /// persists MUST start at this seq; the sink advances only by the
    /// envelopes returned/published back to it.
    pub next_seq: i64,
}

/// One thing the dispatch pass offers to observers.
pub enum SessionObservation<'a> {
    /// A persisted ledger event — envelopes emitted by EARLIER observers in
    /// this same dispatch pass (see the dispatch contract on
    /// [`SessionEventObserver`]).
    Event(&'a SessionEventEnvelope),
    /// Normalized tool traffic with `meta` / `raw_input` / `raw_output`
    /// intact, after the sink recorded it.
    ToolCall {
        turn_id: Option<String>,
        payload: &'a AcpToolPayload,
    },
    /// An assistant message that just completed assembly in the sink.
    AssistantMessageCompleted(&'a CompletedAssistantMessage),
    /// A protocol chunk the dispatcher intentionally kept out of the
    /// transcript (anyharness adapter meta tag) — e.g. codex plan chunks.
    NonTranscriptChunk(&'a AcpChunkPayload),
}

/// Event rows an observer persisted itself, handed back so the sink can
/// broadcast them and advance its counter.
#[derive(Default)]
pub struct ObserverEffects {
    /// Envelopes the observer committed to the event store during
    /// [`SessionEventObserver::observe`].
    ///
    /// # Partial-failure contract
    ///
    /// An observer must either fail WITHOUT committing event rows, or commit
    /// and return EVERY committed envelope. The sink advances `next_seq` only
    /// by the envelopes returned here; a committed-but-unreturned row leaves
    /// the counter behind and collides loudly (unique-seq violation) on the
    /// next insert — never a silent gap. Dispatch logs observer failures and
    /// continues the pass.
    pub persisted_events: Vec<SessionEventEnvelope>,
}

/// Synchronous post-persistence hook over a live session's event traffic.
///
/// # Dispatch contract
///
/// Observers run in a single ordered pass, in registration order. Observer
/// `i`'s returned envelopes are published immediately and observed only by
/// observers `j > i`, as [`SessionObservation::Event`]; they are never re-fed
/// backward and never trigger a second pass — the pass is bounded by the
/// observer list, so the seq counter is never re-entrant. Cross-observer
/// dependencies are expressed by registration order.
///
/// # Threading contract
///
/// `observe` runs synchronously on the per-session thread with the sink lock
/// held. A synchronous sqlite tx is acceptable; external IO and awaits are
/// not. Side effects that emit no events may be handed off to a main-runtime
/// `Handle` captured at app wiring.
pub trait SessionEventObserver: Send + Sync {
    /// Pure pre-check: does this observation require a clean transcript
    /// boundary? When any registered observer answers `true`, the dispatcher
    /// closes open streaming items (emitting their completion events and
    /// advancing the sink) BEFORE building this observation's context — the
    /// legacy plan-ingestion behavior. Must be cheap and side-effect free;
    /// detection logic may run again inside [`observe`](Self::observe).
    fn needs_transcript_boundary(&self, _obs: &SessionObservation<'_>) -> bool {
        false
    }

    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects;
}

/// A permission request as seen by a [`PermissionAdvisor`], before it is
/// parked in the rendezvous.
pub struct PermissionQuestionView<'a> {
    pub session_id: &'a str,
    pub request_id: &'a str,
    pub tool_call_id: Option<&'a str>,
    /// Raw ACP options exactly as received by the inbound permission handler.
    pub options: &'a [acp::schema::PermissionOption],
}

/// Extra linkage to attach when a permission request is parked.
pub struct PendingInteractionLink {
    pub linked_plan_id: Option<String>,
}

/// What to do with an inbound permission request.
pub enum PermissionAdvice {
    /// Park the request as a pending interaction and wait for a resolution.
    Park {
        pending_interaction: Option<PendingInteractionLink>,
    },
    /// Answer immediately without surfacing an interaction.
    ///
    /// `selected_option_id: None` means respond `Cancelled`. The
    /// `persisted_events` follow the same partial-failure contract as
    /// [`ObserverEffects::persisted_events`]: committed by the advisor, all
    /// returned, published by the door under the same lock hold.
    Predecided {
        selected_option_id: Option<String>,
        persisted_events: Vec<SessionEventEnvelope>,
    },
}

/// Synchronous pre-park hook on inbound permission requests.
///
/// # Threading contract
///
/// `advise` runs on the inbound-door task — exactly where the inline logic it
/// replaces ran — with the sink lock HELD by the caller; `ctx` carries the
/// locked counter. The implementor may run its own synchronous domain tx
/// (e.g. registering interaction links); it must not block otherwise.
pub trait PermissionAdvisor: Send + Sync {
    fn advise(
        &self,
        ctx: &SessionObserverContext,
        q: &PermissionQuestionView<'_>,
    ) -> PermissionAdvice;
}

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
