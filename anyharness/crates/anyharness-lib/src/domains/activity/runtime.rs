//! Attach-time roster reconcile for the read-only activity domain.
//!
//! Rosters have no external write path — but they still need healing on
//! attach, with per-harness semantics (harness-runtime-mechanics §4, §6.5):
//!
//! - **Claude** processes are process-bound and die with the harness, so on a
//!   reattach every still-`running` process is marked `exited`/stale.
//! - **Codex** child threads are resumable, so the reconcile re-lists them via
//!   `_anyharness/activity/list`.
//!
//! Both happen in one ordered pass: reset first, then upsert whatever the
//! harness currently reports. A harness that doesn't implement `activity/list`
//! (Claude today) simply falls through to the reset-only path.

use std::any::Any;
use std::sync::Arc;

use super::service::{ActivityEventContext, ActivityService};
use super::wire::{ActivityListWireResult, ACTIVITY_LIST_EXT_METHOD};
use crate::domains::sessions::extensions::{SessionExtension, SessionStartedContext};
use crate::domains::sessions::service::SessionService;
use crate::live::sessions::model::{
    SessionDomainOp, SessionObserverContext, SessionOpEmitter, SessionOpStep,
};
use crate::live::sessions::{LiveSessionCommandError, LiveSessionManager};

#[derive(Clone)]
pub struct ActivityRuntime {
    activity_service: Arc<ActivityService>,
    session_service: Arc<SessionService>,
    acp_manager: LiveSessionManager,
}

impl ActivityRuntime {
    pub fn new(
        activity_service: Arc<ActivityService>,
        session_service: Arc<SessionService>,
        acp_manager: LiveSessionManager,
    ) -> Self {
        Self {
            activity_service,
            session_service,
            acp_manager,
        }
    }

    /// Reset stale processes then re-list the harness roster, under the
    /// session's sink lock so the emitted upserts ride the ordered stream.
    pub async fn reconcile_on_attach(&self, session_id: &str) -> anyhow::Result<()> {
        let Some(_session) = self.session_service.get_session(session_id)? else {
            return Ok(());
        };
        let Some(handle) = self.acp_manager.get_handle(session_id).await else {
            return Ok(());
        };

        // Best-effort roster pull; harnesses without `activity/list` (Claude
        // today) fall through to a reset-only reconcile.
        let listed = match handle.native_session_id() {
            Some(native_session_id) => match handle
                .call_agent_ext_method(
                    ACTIVITY_LIST_EXT_METHOD.to_string(),
                    serde_json::json!({ "sessionId": native_session_id }),
                )
                .await
            {
                Ok(response) => match serde_json::from_value::<ActivityListWireResult>(response) {
                    Ok(list) => list,
                    Err(error) => {
                        tracing::warn!(
                            session_id,
                            error = %error,
                            "activity/list returned an unexpected result shape"
                        );
                        ActivityListWireResult::default()
                    }
                },
                Err(error) => {
                    tracing::debug!(
                        session_id,
                        error = ?error,
                        "activity/list reconcile pull failed; applying reset-only"
                    );
                    ActivityListWireResult::default()
                }
            },
            None => ActivityListWireResult::default(),
        };

        let op = Box::new(ActivityReconcileOp {
            activity_service: self.activity_service.clone(),
            processes: listed.processes,
            agents: listed.subagents,
        });
        let reply = handle.run_domain_op(op).await.map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable => {
                anyhow::anyhow!("session actor unavailable for activity reconcile")
            }
            LiveSessionCommandError::ResponseDropped => {
                anyhow::anyhow!("session actor dropped activity reconcile response")
            }
            LiveSessionCommandError::Rejected(infallible) => match infallible {},
        })?;
        let output = reply
            .downcast::<ActivityReconcileOpOutput>()
            .map_err(|_| anyhow::anyhow!("activity reconcile op returned unexpected reply"))?;
        output.result
    }
}

/// One-pass reset-then-relist, run under the sink lock.
struct ActivityReconcileOp {
    activity_service: Arc<ActivityService>,
    processes: Vec<super::wire::ActivityProcessWire>,
    agents: Vec<super::wire::ActivitySubagentWire>,
}
struct ActivityReconcileOpOutput {
    result: anyhow::Result<()>,
}

impl SessionDomainOp for ActivityReconcileOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let ActivityReconcileOp {
            activity_service,
            processes,
            agents,
        } = *self;
        let result = (|| {
            let reset_ctx = activity_event_context(&emitter.event_ctx());
            let reset = activity_service
                .reset_running_processes(reset_ctx)
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            emitter.publish(reset.envelopes);
            // Subagents need the same healing: a still-`running` subagent left
            // behind by a dead harness is stale (Claude Task agents aren't
            // resumable). Re-read the context — the sink counter advanced past
            // the process resets — then reset, then re-list.
            let subagent_reset_ctx = activity_event_context(&emitter.event_ctx());
            let subagent_reset = activity_service
                .reset_running_subagents(subagent_reset_ctx)
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            emitter.publish(subagent_reset.envelopes);
            // Re-read the context: the sink counter advanced past the resets.
            let reconcile_ctx = activity_event_context(&emitter.event_ctx());
            let reconciled = activity_service
                .reconcile_roster(reconcile_ctx, processes, agents)
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            emitter.publish(reconciled.envelopes);
            Ok(())
        })();
        SessionOpStep::Done(Box::new(ActivityReconcileOpOutput { result }) as Box<dyn Any + Send>)
    }
}

fn activity_event_context(ctx: &SessionObserverContext) -> ActivityEventContext {
    ActivityEventContext {
        workspace_id: ctx.workspace_id.clone(),
        session_id: ctx.session_id.clone(),
        source_agent_kind: ctx.agent_kind.clone(),
        turn_id: ctx.turn_id.clone(),
        next_seq: ctx.next_seq,
    }
}

/// Fire-and-forget attach reconcile hook (mirrors the goals/loops hooks).
pub struct ActivitySessionHooks {
    activity_runtime: Arc<ActivityRuntime>,
}

impl ActivitySessionHooks {
    pub fn new(activity_runtime: Arc<ActivityRuntime>) -> Self {
        Self { activity_runtime }
    }
}

impl SessionExtension for ActivitySessionHooks {
    fn on_session_started(&self, ctx: SessionStartedContext) {
        let activity_runtime = self.activity_runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = activity_runtime.reconcile_on_attach(&ctx.session_id).await {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "activity reconcile-on-attach failed"
                );
            }
        });
    }
}
