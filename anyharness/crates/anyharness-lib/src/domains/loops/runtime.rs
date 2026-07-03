//! External loop mutations, the emulated fire executor, and the attach-time
//! reconcile pull.
//!
//! Two lifecycles share this runtime, split by capability:
//!
//! - **Native** (Claude session crons — `supports_loops && loops_native`):
//!   strict mirror. `set`/`clear` drive the sidecar's `_anyharness/loop/*` ext
//!   methods and are confirmed only when the native `loop_*` notification
//!   round-trips through [`LoopSessionObserver`](super::session_observer). The
//!   attach reconcile pulls `_anyharness/loop/list`.
//! - **Emulated** (Codex — no native cron surface): a runtime-owned
//!   [`LoopScheduler`](super::scheduler::LoopScheduler) fires user-armed
//!   `native: false` loops. Records are written directly (there is no sidecar
//!   to mirror) and re-armed from sqlite on attach; fires enqueue the loop's
//!   prompt as an ordinary user turn while the session is idle.

use std::any::Any;
use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::{Loop, SessionEventEnvelope, SetSessionLoopRequest};
use async_trait::async_trait;
use tokio::sync::broadcast;

use super::model::LoopRecord;
use super::scheduler::{
    LoopFireExecutor, LoopFireReport, LoopScheduler, LoopSessionLiveness,
};
use super::service::{
    EmulatedLoopSpec, LoopEventContext, LoopService, MAX_LOOP_PROMPT_BYTES,
};
use super::wire::{
    LoopClearedWireResult, LoopListWireResult, LOOP_CLEAR_EXT_METHOD, LOOP_LIST_EXT_METHOD,
    LOOP_SET_EXT_METHOD,
};
use crate::domains::sessions::model::{parse_action_capabilities, SessionRecord};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::live::sessions::model::{
    SessionDomainOp, SessionObserverContext, SessionOpEmitter, SessionOpStep,
};
use crate::live::sessions::{
    AgentExtMethodError, LiveSessionCommandError, LiveSessionHandle, LiveSessionManager,
};

/// How long a native loop mutation waits for its `loop_*` notification to
/// round-trip before reporting the write unconfirmed.
const LOOP_CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(15);

/// Agent kinds for which the runtime emulates loops (no native cron surface).
/// Deliberately conservative — the emulated scheduler is a user-armed product
/// feature, not synthetic harness behavior, and only Codex is in scope in v1.
const EMULATED_LOOP_AGENT_KINDS: &[&str] = &["codex"];

/// The `PromptProvenance` label carried by an emulated loop fire so the UI can
/// attribute the turn. Maps to the public `System { label }` provenance — no
/// contract/SDK surface is added.
pub const LOOP_FIRED_PROVENANCE_LABEL: &str = "loop_fired";

#[derive(Debug, thiserror::Error)]
pub enum LoopOpError {
    #[error("session not found")]
    SessionNotFound,
    #[error("agent does not support loops")]
    Unsupported,
    #[error("session is not running")]
    SessionNotLive,
    #[error("loop prompt is empty")]
    EmptyPrompt,
    #[error("loop prompt exceeds {MAX_LOOP_PROMPT_BYTES} bytes")]
    PromptTooLarge,
    #[error("loop schedule is invalid: {0}")]
    InvalidSchedule(String),
    #[error("loop not found")]
    LoopNotFound,
    #[error("editing a native loop by id is not supported; clear and re-set")]
    NativeEditUnsupported,
    #[error("loop mutation was accepted but the native confirmation did not arrive")]
    NotConfirmed,
    #[error("agent rejected loop operation: {0}")]
    Rejected(String),
    #[error("agent could not service the loop operation: {0}")]
    AgentUnavailable(String),
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LoopSupport {
    Native,
    Emulated,
}

#[derive(Clone)]
pub struct LoopRuntime {
    loop_service: Arc<LoopService>,
    session_service: Arc<SessionService>,
    acp_manager: LiveSessionManager,
    access_gate: Arc<WorkspaceAccessGate>,
    scheduler: Arc<LoopScheduler>,
}

impl LoopRuntime {
    pub fn new(
        loop_service: Arc<LoopService>,
        session_service: Arc<SessionService>,
        acp_manager: LiveSessionManager,
        access_gate: Arc<WorkspaceAccessGate>,
        scheduler: Arc<LoopScheduler>,
    ) -> Self {
        Self {
            loop_service,
            session_service,
            acp_manager,
            access_gate,
            scheduler,
        }
    }

    pub fn scheduler(&self) -> &Arc<LoopScheduler> {
        &self.scheduler
    }

    /// Arm a new loop. Native harnesses drive `_anyharness/loop/set`; emulated
    /// harnesses mint a `native: false` record and arm the scheduler.
    pub async fn set_loop(
        &self,
        session_id: &str,
        request: SetSessionLoopRequest,
    ) -> Result<Loop, LoopOpError> {
        let loop_id = uuid::Uuid::new_v4().to_string();
        self.upsert_loop(session_id, loop_id, request, true).await
    }

    /// Edit an existing loop by id. Emulated only (native crons have no
    /// external edit-by-id surface in v1).
    pub async fn edit_loop(
        &self,
        session_id: &str,
        loop_id: &str,
        request: SetSessionLoopRequest,
    ) -> Result<Loop, LoopOpError> {
        self.upsert_loop(session_id, loop_id.to_string(), request, false)
            .await
    }

    async fn upsert_loop(
        &self,
        session_id: &str,
        loop_id: String,
        request: SetSessionLoopRequest,
        is_create: bool,
    ) -> Result<Loop, LoopOpError> {
        let prompt = request.prompt.trim().to_string();
        if prompt.is_empty() {
            return Err(LoopOpError::EmptyPrompt);
        }
        if prompt.len() > MAX_LOOP_PROMPT_BYTES {
            return Err(LoopOpError::PromptTooLarge);
        }
        let (_session, handle, native_session_id, support) = self.loop_session(session_id).await?;

        match support {
            LoopSupport::Native => {
                if !is_create {
                    return Err(LoopOpError::NativeEditUnsupported);
                }
                self.set_native_loop(session_id, &handle, native_session_id, &prompt, &request)
                    .await
            }
            LoopSupport::Emulated => {
                self.arm_emulated_loop(session_id, &handle, loop_id, prompt, request)
                    .await
            }
        }
    }

    async fn set_native_loop(
        &self,
        session_id: &str,
        handle: &Arc<LiveSessionHandle>,
        native_session_id: String,
        prompt: &str,
        request: &SetSessionLoopRequest,
    ) -> Result<Loop, LoopOpError> {
        let params = serde_json::json!({
            "sessionId": native_session_id,
            "prompt": prompt,
            "schedule": { "kind": schedule_kind_wire(request), "expr": request.schedule.expr },
            "recurring": request.recurring,
        });
        let mut events = handle.subscribe();
        let response = handle
            .call_agent_ext_method(LOOP_SET_EXT_METHOD.to_string(), params)
            .await
            .map_err(map_ext_call_error)?;
        // The response confirms the NATIVE write landed; the mirror still
        // transitions only via the observed notification.
        if serde_json::from_value::<super::wire::LoopWireEnvelope>(response).is_err() {
            tracing::warn!(session_id, "loop/set returned an unexpected result shape");
        }
        if !wait_for_loop_event(&mut events, &["loop_upserted", "loop_fired"]).await {
            return Err(LoopOpError::NotConfirmed);
        }
        // Return the most-recently-updated native loop as the confirmation.
        self.loop_service
            .current_loops(session_id)?
            .into_iter()
            .find(|record| record.native)
            .map(|record| record.to_contract())
            .ok_or(LoopOpError::NotConfirmed)
    }

    async fn arm_emulated_loop(
        &self,
        session_id: &str,
        handle: &Arc<LiveSessionHandle>,
        loop_id: String,
        prompt: String,
        request: SetSessionLoopRequest,
    ) -> Result<Loop, LoopOpError> {
        let now = chrono::Utc::now().timestamp_millis();
        let next_fire_at_ms = super::schedule::next_fire_at_ms(&request.schedule, now)
            .map_err(|error| LoopOpError::InvalidSchedule(error.to_string()))?;
        let spec = EmulatedLoopSpec {
            loop_id: loop_id.clone(),
            prompt,
            schedule: request.schedule.clone(),
            recurring: request.recurring,
            max_fires: request.max_fires,
            next_fire_at_ms,
        };
        let op = Box::new(LoopArmOp {
            loop_service: self.loop_service.clone(),
            spec,
        });
        let reply = handle
            .run_domain_op(op)
            .await
            .map_err(map_domain_op_error)?;
        let output = reply
            .downcast::<LoopArmOpOutput>()
            .map_err(|_| LoopOpError::Store(anyhow::anyhow!("loop arm op returned unexpected reply")))?;
        let record = output.result.map_err(LoopOpError::Store)?;
        self.scheduler
            .arm(session_id, &loop_id, next_fire_at_ms)
            .await;
        Ok(record.to_contract())
    }

    /// Clear one loop (`loop_id = Some`) or every loop (`None`) for the
    /// session. Returns how many were cleared.
    pub async fn clear_loop(
        &self,
        session_id: &str,
        loop_id: Option<String>,
    ) -> Result<u32, LoopOpError> {
        let (_session, handle, native_session_id, support) = self.loop_session(session_id).await?;
        match support {
            LoopSupport::Native => {
                self.clear_native_loop(&handle, native_session_id, loop_id)
                    .await
            }
            LoopSupport::Emulated => {
                self.clear_emulated_loop(session_id, &handle, loop_id).await
            }
        }
    }

    async fn clear_native_loop(
        &self,
        handle: &Arc<LiveSessionHandle>,
        native_session_id: String,
        loop_id: Option<String>,
    ) -> Result<u32, LoopOpError> {
        let mut params = serde_json::Map::new();
        params.insert(
            "sessionId".to_string(),
            serde_json::Value::String(native_session_id),
        );
        if let Some(loop_id) = loop_id.clone() {
            params.insert("loopId".to_string(), serde_json::Value::String(loop_id));
        }
        let response = handle
            .call_agent_ext_method(
                LOOP_CLEAR_EXT_METHOD.to_string(),
                serde_json::Value::Object(params),
            )
            .await
            .map_err(map_ext_call_error)?;
        let result: LoopClearedWireResult =
            serde_json::from_value(response).unwrap_or(LoopClearedWireResult { cleared: 0 });
        // Heal the mirror from an authoritative re-list rather than trusting
        // local optimism.
        self.reconcile_native_with_handle(handle).await?;
        Ok(result.cleared.max(0) as u32)
    }

    async fn clear_emulated_loop(
        &self,
        session_id: &str,
        handle: &Arc<LiveSessionHandle>,
        loop_id: Option<String>,
    ) -> Result<u32, LoopOpError> {
        let op = Box::new(LoopClearOp {
            loop_service: self.loop_service.clone(),
            target: loop_id.clone(),
        });
        let reply = handle
            .run_domain_op(op)
            .await
            .map_err(map_domain_op_error)?;
        let output = reply.downcast::<LoopClearOpOutput>().map_err(|_| {
            LoopOpError::Store(anyhow::anyhow!("loop clear op returned unexpected reply"))
        })?;
        let cleared = output.result.map_err(LoopOpError::Store)?;
        match loop_id {
            Some(loop_id) => self.scheduler.disarm(session_id, &loop_id).await,
            None => self.scheduler.disarm_session(session_id).await,
        }
        Ok(cleared)
    }

    /// The loop list is served from the adapter mirror (there is no zero-turn
    /// native `list` — see harness-runtime-mechanics §3 pull asymmetry).
    pub fn list_loops(&self, session_id: &str) -> anyhow::Result<Vec<Loop>> {
        Ok(self
            .loop_service
            .current_loops(session_id)?
            .iter()
            .map(LoopRecord::to_contract)
            .collect())
    }

    /// Attach/resume reconcile. Native: pull `_anyharness/loop/list` and heal
    /// the mirror. Emulated: re-arm the scheduler from persisted `native: false`
    /// loops (missed fires — armed while dead — fire promptly on the next pass).
    pub async fn reconcile_on_attach(&self, session_id: &str) -> anyhow::Result<()> {
        let Some(session) = self.session_service.get_session(session_id)? else {
            return Ok(());
        };
        match self.support_for(&session) {
            Some(LoopSupport::Native) => self.reconcile_native_on_attach(session_id).await,
            Some(LoopSupport::Emulated) => self.rearm_emulated(session_id).await,
            None => Ok(()),
        }
    }

    async fn reconcile_native_on_attach(&self, session_id: &str) -> anyhow::Result<()> {
        let Some(handle) = self.acp_manager.get_handle(session_id).await else {
            return Ok(());
        };
        self.reconcile_native_with_handle(&handle).await
    }

    async fn reconcile_native_with_handle(
        &self,
        handle: &Arc<LiveSessionHandle>,
    ) -> anyhow::Result<()> {
        let Some(native_session_id) = handle.native_session_id() else {
            return Ok(());
        };
        let response = match handle
            .call_agent_ext_method(
                LOOP_LIST_EXT_METHOD.to_string(),
                serde_json::json!({ "sessionId": native_session_id }),
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::debug!(error = ?error, "loop/list reconcile pull failed; leaving mirror untouched");
                return Ok(());
            }
        };
        let list: LoopListWireResult = match serde_json::from_value(response) {
            Ok(list) => list,
            Err(error) => {
                tracing::warn!(error = %error, "loop/list returned an unexpected result shape");
                return Ok(());
            }
        };
        let op = Box::new(LoopReconcileOp {
            loop_service: self.loop_service.clone(),
            wires: list.loops,
        });
        let reply = handle.run_domain_op(op).await.map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable => {
                anyhow::anyhow!("session actor unavailable for loop reconcile")
            }
            LiveSessionCommandError::ResponseDropped => {
                anyhow::anyhow!("session actor dropped loop reconcile response")
            }
            LiveSessionCommandError::Rejected(infallible) => match infallible {},
        })?;
        let output = reply
            .downcast::<LoopReconcileOpOutput>()
            .map_err(|_| anyhow::anyhow!("loop reconcile op returned unexpected reply"))?;
        output.result
    }

    async fn rearm_emulated(&self, session_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let records = self.loop_service.active_emulated_loops(session_id)?;
        for record in records {
            // A loop armed before the process died may have a past (or missing)
            // next-fire; fire it promptly on the next pass rather than skipping
            // the whole missed window.
            let next_fire = record.next_fire_at_ms.filter(|next| *next > now).unwrap_or(now);
            self.scheduler.arm(session_id, &record.loop_id, next_fire).await;
        }
        Ok(())
    }

    fn support_for(&self, session: &SessionRecord) -> Option<LoopSupport> {
        let caps = parse_action_capabilities(session.action_capabilities_json.as_deref());
        if caps.supports_loops && caps.loops_native {
            Some(LoopSupport::Native)
        } else if EMULATED_LOOP_AGENT_KINDS.contains(&session.agent_kind.as_str()) {
            Some(LoopSupport::Emulated)
        } else {
            None
        }
    }

    async fn loop_session(
        &self,
        session_id: &str,
    ) -> Result<(SessionRecord, Arc<LiveSessionHandle>, String, LoopSupport), LoopOpError> {
        let session = self
            .session_service
            .get_session(session_id)?
            .ok_or(LoopOpError::SessionNotFound)?;
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| LoopOpError::Store(anyhow::anyhow!(error.to_string())))?;
        let support = self.support_for(&session).ok_or(LoopOpError::Unsupported)?;
        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or(LoopOpError::SessionNotLive)?;
        let native_session_id = handle
            .native_session_id()
            .ok_or(LoopOpError::SessionNotLive)?;
        Ok((session, handle, native_session_id, support))
    }
}

fn schedule_kind_wire(request: &SetSessionLoopRequest) -> &'static str {
    match request.schedule.kind {
        anyharness_contract::v1::LoopScheduleKind::Interval => "interval",
        anyharness_contract::v1::LoopScheduleKind::Cron => "cron",
    }
}

/// The scheduler's session-facing half: liveness + the actual emulated fire
/// (prompt enqueue tagged loop-fired, then fire accounting under the sink
/// lock). Kept separate from [`LoopRuntime`] so it satisfies the
/// [`LoopFireExecutor`] object-safe trait the scheduler owns.
pub struct SessionLoopFireExecutor {
    loop_service: Arc<LoopService>,
    acp_manager: LiveSessionManager,
}

impl SessionLoopFireExecutor {
    pub fn new(loop_service: Arc<LoopService>, acp_manager: LiveSessionManager) -> Self {
        Self {
            loop_service,
            acp_manager,
        }
    }
}

#[async_trait]
impl LoopFireExecutor for SessionLoopFireExecutor {
    async fn liveness(&self, session_id: &str) -> LoopSessionLiveness {
        match self.acp_manager.get_handle(session_id).await {
            None => LoopSessionLiveness::Dead,
            Some(handle) if handle.is_busy() => LoopSessionLiveness::Busy,
            Some(_) => LoopSessionLiveness::Idle,
        }
    }

    async fn fire(&self, session_id: &str, loop_id: &str) -> Option<LoopFireReport> {
        let handle = self.acp_manager.get_handle(session_id).await?;
        let record = self
            .loop_service
            .store()
            .find_one(session_id, loop_id)
            .ok()
            .flatten()?;
        if record.status != anyharness_contract::v1::LoopStatus::Active || record.native {
            return None;
        }
        // Enqueue the loop's prompt as an ordinary user turn — faithful
        // mirroring of a human retyping it, never a synthetic wake.
        let payload = PromptPayload::text(record.prompt.clone()).with_provenance(
            PromptProvenance::System {
                label: Some(LOOP_FIRED_PROVENANCE_LABEL.to_string()),
            },
        );
        if handle.send_prompt(payload, None).await.is_err() {
            return None;
        }
        let fired_at_ms = chrono::Utc::now().timestamp_millis();
        let op = Box::new(LoopFireRecordOp {
            loop_service: self.loop_service.clone(),
            loop_id: loop_id.to_string(),
            fired_at_ms,
        });
        let reply = handle.run_domain_op(op).await.ok()?;
        let output = reply.downcast::<LoopFireRecordOutput>().ok()?;
        output.report
    }
}

// -- domain ops (all run under the sink lock for ordered seq + broadcast) ------

struct LoopArmOp {
    loop_service: Arc<LoopService>,
    spec: EmulatedLoopSpec,
}
struct LoopArmOpOutput {
    result: anyhow::Result<LoopRecord>,
}
impl SessionDomainOp for LoopArmOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let LoopArmOp { loop_service, spec } = *self;
        let context = loop_event_context(&emitter.event_ctx());
        let result = match loop_service.arm_emulated_loop(context, spec) {
            Ok(batch) => {
                emitter.publish(batch.envelopes);
                batch
                    .r#loop
                    .ok_or_else(|| anyhow::anyhow!("loop arm produced no record"))
            }
            Err(error) => Err(anyhow::anyhow!(error.to_string())),
        };
        SessionOpStep::Done(Box::new(LoopArmOpOutput { result }) as Box<dyn Any + Send>)
    }
}

struct LoopClearOp {
    loop_service: Arc<LoopService>,
    target: Option<String>,
}
struct LoopClearOpOutput {
    result: anyhow::Result<u32>,
}
impl SessionDomainOp for LoopClearOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let LoopClearOp {
            loop_service,
            target,
        } = *self;
        let context = loop_event_context(&emitter.event_ctx());
        let result = match target {
            Some(loop_id) => match loop_service.clear_loop(context, loop_id) {
                Ok(batch) => {
                    let cleared = if batch.envelopes.is_empty() { 0 } else { 1 };
                    emitter.publish(batch.envelopes);
                    Ok(cleared)
                }
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            },
            None => match loop_service.clear_all_loops(context) {
                Ok((cleared, envelopes)) => {
                    emitter.publish(envelopes);
                    Ok(cleared)
                }
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            },
        };
        SessionOpStep::Done(Box::new(LoopClearOpOutput { result }) as Box<dyn Any + Send>)
    }
}

struct LoopReconcileOp {
    loop_service: Arc<LoopService>,
    wires: Vec<super::wire::LoopWire>,
}
struct LoopReconcileOpOutput {
    result: anyhow::Result<()>,
}
impl SessionDomainOp for LoopReconcileOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let LoopReconcileOp {
            loop_service,
            wires,
        } = *self;
        let context = loop_event_context(&emitter.event_ctx());
        let result = match loop_service.reconcile_native_loops(context, wires) {
            Ok(envelopes) => {
                emitter.publish(envelopes);
                Ok(())
            }
            Err(error) => Err(anyhow::anyhow!(error.to_string())),
        };
        SessionOpStep::Done(Box::new(LoopReconcileOpOutput { result }) as Box<dyn Any + Send>)
    }
}

struct LoopFireRecordOp {
    loop_service: Arc<LoopService>,
    loop_id: String,
    fired_at_ms: i64,
}
struct LoopFireRecordOutput {
    report: Option<LoopFireReport>,
}
impl SessionDomainOp for LoopFireRecordOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let LoopFireRecordOp {
            loop_service,
            loop_id,
            fired_at_ms,
        } = *self;
        let context = loop_event_context(&emitter.event_ctx());
        let report = match loop_service.record_emulated_fire(context, loop_id, fired_at_ms) {
            Ok(Some(outcome)) => {
                emitter.publish(outcome.batch.envelopes);
                Some(LoopFireReport {
                    still_armed: outcome.still_armed,
                    next_fire_at_ms: outcome.next_fire_at_ms,
                })
            }
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(error = %error, "failed to record emulated loop fire");
                None
            }
        };
        SessionOpStep::Done(Box::new(LoopFireRecordOutput { report }) as Box<dyn Any + Send>)
    }
}

fn loop_event_context(ctx: &SessionObserverContext) -> LoopEventContext {
    LoopEventContext {
        workspace_id: ctx.workspace_id.clone(),
        session_id: ctx.session_id.clone(),
        source_agent_kind: ctx.agent_kind.clone(),
        turn_id: ctx.turn_id.clone(),
        next_seq: ctx.next_seq,
    }
}

fn map_ext_call_error(error: LiveSessionCommandError<anyhow::Error>) -> LoopOpError {
    match error {
        LiveSessionCommandError::ActorUnavailable | LiveSessionCommandError::ResponseDropped => {
            LoopOpError::SessionNotLive
        }
        LiveSessionCommandError::Rejected(error) => {
            match error.downcast_ref::<AgentExtMethodError>() {
                Some(ext_error) if ext_error.is_agent_unavailable() => {
                    LoopOpError::AgentUnavailable(error.to_string())
                }
                _ => LoopOpError::Rejected(error.to_string()),
            }
        }
    }
}

fn map_domain_op_error(error: LiveSessionCommandError<std::convert::Infallible>) -> LoopOpError {
    match error {
        LiveSessionCommandError::ActorUnavailable | LiveSessionCommandError::ResponseDropped => {
            LoopOpError::SessionNotLive
        }
        LiveSessionCommandError::Rejected(infallible) => match infallible {},
    }
}

/// Waits for the observer-ingested confirmation of a native loop mutation.
async fn wait_for_loop_event(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    event_types: &[&str],
) -> bool {
    let deadline = tokio::time::Instant::now() + LOOP_CONFIRMATION_TIMEOUT;
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => {
                if event_types.contains(&envelope.event.event_type()) {
                    return true;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return false,
            Err(_) => return false,
        }
    }
}
