//! Prompt injection + non-goal turn waiting: sending a provenance-stamped
//! prompt (C10/E9) and awaiting its `TurnEnded` off the session's broadcast
//! stream, optionally collecting invoked tool names for the C14
//! `required_invocation` gate ([`super::receipts`]). Split out of
//! [`super::agent_turn`] for line budget (same session/turn cluster). Moved
//! verbatim out of `executor.rs` (WS0B-R).

use std::time::Duration;

use anyharness_contract::v1::{ContentPart, SessionEvent, SessionEventEnvelope};
use serde_json::json;
use tokio::sync::broadcast;

use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::runtime::SendPromptOutcome;
use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{AgentPromptStep, PlanStep};

use super::executor::{failed, failed_msg, WorkflowStepExecutorImpl};
use super::receipts::{run_gate_loop, MAX_GATE_ATTEMPTS};

/// A turn/goal that hangs must never wait forever: this backstop caps a single
/// non-goal turn wait.
pub(super) const TURN_BACKSTOP: Duration = Duration::from_secs(30 * 60);

/// The step identity carried into a prompt injection so it can be stamped with
/// `PromptProvenance::Workflow` and recorded in `workflow_session_injections`
/// (C10 / E9).
pub(super) struct InjectionMeta {
    pub(super) step_key: String,
    pub(super) kind: String,
    pub(super) label: String,
}

impl InjectionMeta {
    pub(super) fn from_step(step: &PlanStep) -> Self {
        Self {
            step_key: step.key.clone(),
            kind: step.kind_slug().to_string(),
            label: step.label.clone(),
        }
    }
}

impl WorkflowStepExecutorImpl {
    /// Inject a prompt into a workflow-owned session via the internal
    /// provenance-carrying path (C10 / E9) — NOT the public `send_prompt` the
    /// lockout guards (C13). The prompt is stamped `PromptProvenance::Workflow`
    /// so the transcript renders the machine bubble from stored truth, and a
    /// normalized `workflow_session_injections` row is written alongside (the
    /// executor owns both step identity and the send).
    pub(super) async fn send_prompt(
        &self,
        session_id: &str,
        text: &str,
        meta: &InjectionMeta,
    ) -> Result<Option<String>, StepOutcome> {
        let label = if meta.label.trim().is_empty() {
            None
        } else {
            Some(meta.label.clone())
        };
        let provenance = PromptProvenance::Workflow {
            run_id: self.run_id.clone(),
            step_key: meta.step_key.clone(),
            step_kind: meta.kind.clone(),
            label,
        };
        match self
            .deps
            .session_runtime
            .send_text_prompt_with_provenance(session_id, text.to_string(), provenance)
            .await
        {
            Ok(SendPromptOutcome::Running { turn_id, .. }) => {
                // Stamp the injection index (contract §5.2). Best-effort: a failed
                // index write must never fail the step (the wire provenance on the
                // event payload is the source of truth for rendering).
                let _ = self.deps.workflow_service.record_injection(
                    session_id,
                    &turn_id,
                    &self.run_id,
                    &meta.step_key,
                    &meta.kind,
                    &meta.label,
                    text,
                );
                Ok(Some(turn_id))
            }
            Ok(SendPromptOutcome::Queued { .. }) => Ok(None),
            Err(error) => Err(failed_msg("prompt_failed", format!("{error:?}"))),
        }
    }

    pub(super) async fn subscribe(
        &self,
        session_id: &str,
    ) -> Result<broadcast::Receiver<SessionEventEnvelope>, StepOutcome> {
        let handle = self
            .deps
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| failed("session_not_live"))?;
        Ok(handle.subscribe())
    }

    pub(super) async fn run_prompt(
        &self,
        slot: &str,
        agent: &AgentPromptStep,
        meta: &InjectionMeta,
        scope: &str,
    ) -> StepOutcome {
        let session_id = match self.ensure_session(slot, scope).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        // No gate: a single turn suffices.
        let Some(required) = &agent.required_invocation else {
            let mut events = match self.subscribe(&session_id).await {
                Ok(events) => events,
                Err(outcome) => return outcome,
            };
            let turn_id = match self.send_prompt(&session_id, &agent.prompt, meta).await {
                Ok(turn_id) => turn_id,
                Err(outcome) => return outcome,
            };
            return match await_turn_ended(&mut events, turn_id.as_deref(), TURN_BACKSTOP).await {
                TurnWait::Ended => StepOutcome::Completed {
                    output: json!({ "turn_id": turn_id, "session_id": session_id }),
                },
                TurnWait::SessionClosed => failed("session_closed"),
                TurnWait::Timeout => failed("turn_timeout"),
            };
        };
        // The C14 gate (arch §7.6): re-prompt up to MAX_GATE_ATTEMPTS until the
        // provider+tool was invoked within the turn. The attempt budget +
        // exhaustion decision lives in `run_gate_loop` so it can be driven
        // directly by tests without a live session.
        run_gate_loop(
            MAX_GATE_ATTEMPTS,
            &agent.prompt,
            required,
            &session_id,
            |_attempt, prompt| {
                let session_id = session_id.clone();
                async move {
                let mut events = self.subscribe(&session_id).await?;
                let turn_id = self.send_prompt(&session_id, &prompt, meta).await?;
                match await_turn_ended_collecting(&mut events, turn_id.as_deref(), TURN_BACKSTOP)
                    .await
                {
                    (TurnWait::Ended, invoked_tools) => Ok((turn_id, invoked_tools)),
                    (TurnWait::SessionClosed, _) => Err(failed("session_closed")),
                    (TurnWait::Timeout, _) => Err(failed("turn_timeout")),
                }
                }
            },
        )
        .await
    }
}

pub(super) enum TurnWait {
    Ended,
    SessionClosed,
    Timeout,
}

/// Await the end of a turn on the session stream. When `turn_id` is known, only
/// that turn's `TurnEnded` resolves; otherwise the next `TurnEnded` does.
pub(super) async fn await_turn_ended(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    turn_id: Option<&str>,
    backstop: Duration,
) -> TurnWait {
    let deadline = tokio::time::Instant::now() + backstop;
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => match &envelope.event {
                SessionEvent::TurnEnded(_)
                    if turn_id.is_none() || envelope.turn_id.as_deref() == turn_id =>
                {
                    return TurnWait::Ended
                }
                SessionEvent::SessionEnded(_) => return TurnWait::SessionClosed,
                _ => {}
            },
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return TurnWait::SessionClosed,
            Err(_) => return TurnWait::Timeout,
        }
    }
}

/// Like [`await_turn_ended`], but also collects the native tool names invoked
/// during the turn (from `ToolCall` content parts on item events) so the C14
/// gate can check whether the required provider+tool was invoked.
async fn await_turn_ended_collecting(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    turn_id: Option<&str>,
    backstop: Duration,
) -> (TurnWait, Vec<String>) {
    let deadline = tokio::time::Instant::now() + backstop;
    let mut tools: Vec<String> = Vec::new();
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => {
                // Only collect tool calls that belong to this turn (or any, when
                // the turn id is unknown).
                if turn_id.is_none() || envelope.turn_id.as_deref() == turn_id {
                    collect_tool_names(&envelope.event, &mut tools);
                }
                match &envelope.event {
                    SessionEvent::TurnEnded(_)
                        if turn_id.is_none() || envelope.turn_id.as_deref() == turn_id =>
                    {
                        return (TurnWait::Ended, tools)
                    }
                    SessionEvent::SessionEnded(_) => return (TurnWait::SessionClosed, tools),
                    _ => {}
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return (TurnWait::SessionClosed, tools),
            Err(_) => return (TurnWait::Timeout, tools),
        }
    }
}

/// Push every `ToolCall` native tool name carried by an item event into `out`.
pub(super) fn collect_tool_names(event: &SessionEvent, out: &mut Vec<String>) {
    let parts: &[ContentPart] = match event {
        SessionEvent::ItemStarted(e) => &e.item.content_parts,
        SessionEvent::ItemCompleted(e) => &e.item.content_parts,
        SessionEvent::ItemDelta(e) => {
            for parts in e
                .delta
                .replace_content_parts
                .iter()
                .chain(e.delta.append_content_parts.iter())
            {
                push_tool_names(parts, out);
            }
            return;
        }
        _ => return,
    };
    push_tool_names(parts, out);
}

fn push_tool_names(parts: &[ContentPart], out: &mut Vec<String>) {
    for part in parts {
        if let ContentPart::ToolCall {
            native_tool_name: Some(name),
            ..
        } = part
        {
            out.push(name.clone());
        }
    }
}
