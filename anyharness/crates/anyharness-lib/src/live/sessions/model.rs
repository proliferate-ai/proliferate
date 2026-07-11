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
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope};

use crate::domains::agents::model::ResolvedAgent;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PendingPromptReorderOutcome,
    PromptAttachmentRecord, PromptAttachmentState, SessionBackgroundWorkRecord,
    SessionBackgroundWorkState, SessionEventRecord, SessionLiveConfigSnapshotRecord, SessionRecord,
};
use crate::domains::sessions::prompt::{PromptPayload, PromptValidationError, ResolvedParts};
use crate::live::sessions::actor::command::{Resolution, ResolveInteractionCommandError};
use crate::live::sessions::actor::turn::types::SessionTurnFinishResult;
use crate::live::sessions::sink::SessionEventSink;
// Re-exported: the normalized-payload vocabulary observers consume. The sink
// module itself stays private to live; these shapes are part of the doorstep.
pub use crate::live::sessions::sink::{AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage};

/// How the actor should establish the native agent session at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStartupStrategy {
    Fresh,
    ResumeSeqFreshNative,
    LoadNative(String),
    LoadNativeNoFallback(String),
    ForkFromNative { parent_native_session_id: String },
}

impl SessionStartupStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::ResumeSeqFreshNative => "resume_seq_fresh_native",
            Self::LoadNative(_) => "load_native",
            Self::LoadNativeNoFallback(_) => "load_native_no_fallback",
            Self::ForkFromNative { .. } => "fork_from_native",
        }
    }

    pub fn resumes_durable_history(&self) -> bool {
        !matches!(self, Self::Fresh)
    }

    pub(in crate::live::sessions) fn allows_missing_load_fallback(&self) -> bool {
        matches!(self, Self::LoadNative(_))
    }
}

/// The named environment layers a session launch carries. Keeping the layers
/// named (rather than adjacent maps) removes the positional swap hazard.
///
/// Layering at spawn: `workspace` → `session` → `route_auth` (later layers
/// win), then `route_auth_remove` strips keys from BOTH the merged layers and
/// the inherited ambient process env — removal always wins (the agent-auth
/// sanitization contract; see `domains::agents::route_auth::render`).
#[derive(Debug, Clone, Default)]
pub struct LaunchEnv {
    pub workspace: BTreeMap<String, String>,
    pub session: BTreeMap<String, String>,
    /// Rendered agent-auth route layer (gateway/api_key credentials, isolated
    /// homes). Empty for native/legacy launches.
    pub route_auth: BTreeMap<String, String>,
    /// Env keys the route-auth render plane requires ABSENT in the spawned
    /// process (ambient Bedrock/Vertex reroutes, stale provider keys).
    pub route_auth_remove: Vec<String>,
    /// Extra CLI args appended to the harness command line, derived from
    /// catalog settings (e.g. `--chrome` when the chrome setting is true).
    pub settings_extra_args: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SystemPromptAppends {
    pub every_prompt: Option<String>,
    pub first_prompt: Option<String>,
}

/// Everything that describes ONE session launch: the durable session row, the
/// resolved agent binary, where and with what environment to run it, and how
/// to establish the native session.
pub struct SessionLaunch {
    pub session: SessionRecord,
    pub agent: ResolvedAgent,
    pub workspace_path: PathBuf,
    pub env: LaunchEnv,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub startup: SessionStartupStrategy,
    pub prompts: SystemPromptAppends,
    /// Last persisted event seq. Owned by the manager: it re-reads this under
    /// the start/inject critical section before spawning the actor; caller
    /// values are overwritten.
    pub last_seq: i64,
}

/// Durable event-ledger persistence as the live actor needs it.
///
/// Signatures mirror `SessionStore` 1:1 so the domain impl is pure delegation.
pub trait EventPersist: Send + Sync {
    fn append_event(&self, event: &SessionEventRecord) -> anyhow::Result<()>;
    fn append_event_and_touch_session(&self, event: &SessionEventRecord) -> anyhow::Result<()>;
    /// Offline injection path: seq assigned from the database under one tx.
    ///
    /// # Invariants
    ///
    /// Callers must hold the ACP start/inject critical section and must have
    /// confirmed that no live actor owns event sequencing for this session.
    fn append_event_with_next_seq(
        &self,
        session_id: &str,
        event: SessionEvent,
        touch_session_activity: bool,
    ) -> anyhow::Result<SessionEventEnvelope>;
    fn next_event_seq(&self, session_id: &str) -> anyhow::Result<i64>;
    fn last_event_seq(&self, session_id: &str) -> anyhow::Result<i64>;
    fn has_turn_started_event(&self, session_id: &str) -> anyhow::Result<bool>;
    fn append_raw_notification(
        &self,
        session_id: &str,
        notification_kind: &str,
        timestamp: &str,
        payload_json: &str,
    ) -> anyhow::Result<()>;
}

/// Durable pending-prompt queue rows.
pub trait QueueDurable: Send + Sync {
    fn insert_pending_prompt_payload(
        &self,
        session_id: &str,
        payload: &PromptPayload,
        prompt_id: Option<&str>,
    ) -> anyhow::Result<PendingPromptRecord>;
    fn list_pending_prompts(&self, session_id: &str) -> anyhow::Result<Vec<PendingPromptRecord>>;
    fn peek_head_pending_prompt(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<PendingPromptRecord>>;
    fn find_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>>;
    fn update_pending_prompt_payload(
        &self,
        session_id: &str,
        seq: i64,
        payload: &PromptPayload,
    ) -> anyhow::Result<bool>;
    fn delete_pending_prompt(&self, session_id: &str, seq: i64) -> anyhow::Result<bool>;
    fn delete_pending_prompt_record(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>>;
    fn reorder_pending_prompts(
        &self,
        session_id: &str,
        expected_seqs: &[i64],
        desired_seqs: &[i64],
    ) -> anyhow::Result<PendingPromptReorderOutcome>;
}

/// Durable background-work tracker rows.
pub trait BackgroundWorkDurable: Send + Sync {
    fn upsert_or_refresh_pending_background_work(
        &self,
        record: &SessionBackgroundWorkRecord,
    ) -> anyhow::Result<bool>;
    fn list_pending_background_work(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<SessionBackgroundWorkRecord>>;
    fn touch_background_work_activity(
        &self,
        session_id: &str,
        tool_call_id: &str,
        last_activity_at: &str,
    ) -> anyhow::Result<()>;
    fn mark_background_work_terminal(
        &self,
        session_id: &str,
        tool_call_id: &str,
        state: SessionBackgroundWorkState,
        completed_at: &str,
    ) -> anyhow::Result<bool>;
}

/// Durable session-row state: status/title/activity, config snapshots and the
/// pending-config queue, capabilities, turn repair.
pub trait SessionStateDurable: Send + Sync {
    fn update_status(&self, id: &str, status: &str, now: &str) -> anyhow::Result<()>;
    fn update_title(&self, id: &str, title: &str, now: &str) -> anyhow::Result<()>;
    fn update_last_prompt_at(&self, id: &str, now: &str) -> anyhow::Result<()>;
    fn update_requested_configuration(
        &self,
        id: &str,
        requested_model_id: Option<&str>,
        requested_mode_id: Option<&str>,
        now: &str,
    ) -> anyhow::Result<()>;
    fn update_current_configuration(
        &self,
        id: &str,
        current_model_id: Option<&str>,
        current_mode_id: Option<&str>,
        now: &str,
    ) -> anyhow::Result<()>;
    fn update_action_capabilities_json(
        &self,
        id: &str,
        action_capabilities_json: Option<String>,
        now: &str,
    ) -> anyhow::Result<()>;
    fn upsert_live_config_snapshot(
        &self,
        record: &SessionLiveConfigSnapshotRecord,
    ) -> anyhow::Result<()>;
    fn find_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<SessionLiveConfigSnapshotRecord>>;
    fn upsert_pending_config_change(
        &self,
        record: &PendingConfigChangeRecord,
    ) -> anyhow::Result<()>;
    fn list_pending_config_changes(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<PendingConfigChangeRecord>>;
    fn delete_pending_config_change(&self, session_id: &str, config_id: &str)
        -> anyhow::Result<()>;
    fn repair_unclosed_turns(&self, session_id: &str) -> anyhow::Result<u32>;
}

/// Prompt-attachment loading and hygiene as the actor's turn machinery needs
/// it. `load` is the IO half of the prompt pipeline; the pure render half is
/// `domains::sessions::prompt::render::render`, which the actor calls itself.
pub trait AttachmentSource: Send + Sync {
    /// Load every attachment the payload references: store rows plus stored
    /// bytes (including the legacy-content fallback). No ACP shapes here —
    /// rendering them is pure and stays out of the capability.
    fn load(
        &self,
        session_id: &str,
        payload: &PromptPayload,
    ) -> Result<ResolvedParts, PromptValidationError>;
    fn mark_prompt_attachments_state(
        &self,
        session_id: &str,
        attachment_ids: &[String],
        state: PromptAttachmentState,
    ) -> anyhow::Result<()>;
    fn find_prompt_attachment(
        &self,
        session_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Option<PromptAttachmentRecord>>;
    fn delete_prompt_attachments(
        &self,
        session_id: &str,
        attachment_ids: &[&str],
    ) -> anyhow::Result<()>;
    /// Delete the stored attachment file for a (pending) record.
    fn delete_record(&self, record: &PromptAttachmentRecord) -> anyhow::Result<()>;
}

/// The never-varies capability set the actor runs against; wired once at
/// manager construction and shared by every session the manager starts.
#[derive(Clone)]
pub struct ActorCapabilities {
    pub events: Arc<dyn EventPersist>,
    pub queue: Arc<dyn QueueDurable>,
    pub background: Arc<dyn BackgroundWorkDurable>,
    pub state: Arc<dyn SessionStateDurable>,
    pub attachments: Arc<dyn AttachmentSource>,
    /// Product reactors, registration order = dispatch order (plans before
    /// reviews). See the dispatch contract on [`SessionEventObserver`].
    pub observers: Vec<Arc<dyn SessionEventObserver>>,
    /// Consulted by the inbound permission door before parking.
    pub permission_advisor: Option<Arc<dyn PermissionAdvisor>>,
}

/// Per-call powers: hooks and context that vary per session start.
#[derive(Default)]
pub struct SessionHooks {
    pub on_turn_finish: Option<Arc<dyn Fn(SessionTurnFinishResult) + Send + Sync>>,
    /// Called after the actor loop exits (normal or error). The bool indicates
    /// whether the actor exited with an error (true = errored).
    pub on_exit: Option<Box<dyn FnOnce(bool) + Send>>,
}

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

    fn observe(&self, ctx: &SessionObserverContext, obs: SessionObservation<'_>)
        -> ObserverEffects;
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
