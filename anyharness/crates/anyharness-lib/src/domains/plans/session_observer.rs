//! Plan detection as a [`SessionEventObserver`].
//!
//! This observer owns every plan-sniffing path that previously lived in
//! `live/sessions/actor/notifications/plans.rs`:
//!
//! - **Codex turn plans** — protocol chunks tagged by the anyharness adapter
//!   (`meta.anyharness.transcript_event = proposed_plan_completed|proposed_plan_delta`)
//!   that the dispatcher keeps out of the transcript and surfaces as
//!   [`SessionObservation::NonTranscriptChunk`].
//! - **Claude `ExitPlanMode`** — normalized tool traffic surfaced as
//!   [`SessionObservation::ToolCall`] (both `ToolCall` and `ToolCallUpdate`
//!   notifications flow through this variant).
//! - **Tagged proposed plans** — `<proposed_plan>…</proposed_plan>` bodies in
//!   assistant messages, surfaced as
//!   [`SessionObservation::AssistantMessageCompleted`] once the sink finishes
//!   assembling the message.
//!
//! # Dispatch contract
//!
//! Observers run in a **single ordered pass in registration order**. Envelopes
//! returned by observer `i` are published immediately and observed only by
//! observers `j > i` as [`SessionObservation::Event`]; they are never re-fed
//! backward, and the pass is bounded by the observer list. This observer must
//! therefore be registered **before** the reviews observer, which picks up the
//! proposed-plan envelopes emitted here (see "reviews" note on
//! [`PlanSessionObserver::ingest_completed_plan`]).
//!
//! # Partial-failure contract
//!
//! An observer must either fail **without committing event rows**, or commit
//! and return **every** committed envelope in
//! [`ObserverEffects::persisted_events`]. The sink advances its sequence
//! counter only by returned envelopes; a committed-but-unreturned row collides
//! loudly on the next insert. [`PlanService::create_completed_plan`] satisfies
//! this: it persists the plan row and all event rows in a single transaction
//! and returns the full envelope batch. Dispatch logs observer failures and
//! continues the pass.
//!
//! # Threading contract
//!
//! `observe` runs **synchronously under the sink lock, on the per-session
//! thread**. All event-emitting work happens inline here; this observer
//! performs no async hand-off. (Side effects that emit nothing may hand off
//! via the main-runtime tokio `Handle` captured at app wiring — the
//! per-session runtime dies with the session — but this observer needs none.)

use std::sync::Arc;

use crate::domains::plans::model::NewPlan;
use crate::domains::plans::service::{PlanCreateError, PlanEventContext, PlanService};
use crate::live::sessions::model::{AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage};
use crate::live::sessions::model::{
    ObserverEffects, SessionEventObserver, SessionObservation, SessionObserverContext,
};

/// Detects completed plans in live-session traffic and ingests them through
/// [`PlanService`], returning the persisted envelopes for sink publication.
pub struct PlanSessionObserver {
    plans: Arc<PlanService>,
}

impl PlanSessionObserver {
    pub fn new(plans: Arc<PlanService>) -> Self {
        Self { plans }
    }

    /// Codex turn plans arrive as adapter-tagged protocol chunks that the
    /// dispatcher already excluded from the transcript.
    fn observe_codex_plan_chunk(
        &self,
        ctx: &SessionObserverContext,
        payload: &AcpChunkPayload,
    ) -> ObserverEffects {
        let meta = parse_proposed_plan_meta(payload.meta.as_ref());
        let Some(anyharness_meta) = meta.anyharness else {
            return ObserverEffects::default();
        };
        if anyharness_meta.transcript_event.as_deref() == Some("proposed_plan_delta") {
            // V1 treats Codex plan deltas as non-canonical preview evidence. A later
            // version can surface these as a transient proposed-plan item.
            return ObserverEffects::default();
        }
        if anyharness_meta.transcript_event.as_deref() != Some("proposed_plan_completed") {
            return ObserverEffects::default();
        }
        let Some(body) = extract_text_from_value(&payload.content) else {
            return ObserverEffects::default();
        };
        let title = anyharness_meta
            .title
            .filter(|value| !value.trim().is_empty())
            .or_else(|| title_from_markdown(&body))
            .unwrap_or_else(|| "Plan".to_string());
        let source_item_id = anyharness_meta
            .source_item_id
            .or_else(|| payload.message_id.clone());
        self.ingest_completed_plan(
            ctx,
            NewPlan {
                workspace_id: ctx.workspace_id.clone(),
                session_id: ctx.session_id.clone(),
                title,
                body_markdown: body,
                source_agent_kind: ctx.agent_kind.clone(),
                source_kind: "codex_turn_plan".to_string(),
                source_turn_id: None,
                source_item_id,
                source_tool_call_id: None,
            },
        )
    }

    /// Claude `ExitPlanMode` tool calls carry the plan body in their content,
    /// `raw_input`, or `raw_output`.
    fn observe_claude_exit_plan(
        &self,
        ctx: &SessionObserverContext,
        turn_id: Option<&str>,
        payload: &AcpToolPayload,
    ) -> ObserverEffects {
        if ctx.agent_kind != "claude" {
            return ObserverEffects::default();
        }
        let meta = parse_proposed_plan_meta(payload.meta.as_ref());
        let is_exit_plan =
            meta.claude_code.and_then(|meta| meta.tool_name).as_deref() == Some("ExitPlanMode");
        if !is_exit_plan {
            return ObserverEffects::default();
        }
        let body = payload
            .content
            .as_ref()
            .and_then(|values| extract_text_from_values(values))
            .or_else(|| extract_string_field(payload.raw_input.as_ref(), "plan"))
            .or_else(|| extract_string_field(payload.raw_output.as_ref(), "plan"));
        let Some(body) = body else {
            return ObserverEffects::default();
        };
        let title = title_from_markdown(&body).unwrap_or_else(|| "Plan".to_string());
        self.ingest_completed_plan(
            ctx,
            NewPlan {
                workspace_id: ctx.workspace_id.clone(),
                session_id: ctx.session_id.clone(),
                title,
                body_markdown: body,
                source_agent_kind: ctx.agent_kind.clone(),
                source_kind: "claude_exit_plan_mode".to_string(),
                source_turn_id: turn_id.map(ToOwned::to_owned),
                source_item_id: Some(payload.tool_call_id.clone()),
                source_tool_call_id: Some(payload.tool_call_id.clone()),
            },
        )
    }

    /// Assistant messages whose full text is wrapped in
    /// `<proposed_plan>…</proposed_plan>` become tagged proposed plans.
    fn observe_tagged_plan(
        &self,
        ctx: &SessionObserverContext,
        completed: &CompletedAssistantMessage,
    ) -> ObserverEffects {
        let Some(body) = extract_tagged_proposed_plan(&completed.text) else {
            return ObserverEffects::default();
        };
        let title = title_from_markdown(&body).unwrap_or_else(|| "Plan".to_string());
        self.ingest_completed_plan(
            ctx,
            NewPlan {
                workspace_id: ctx.workspace_id.clone(),
                session_id: ctx.session_id.clone(),
                title,
                body_markdown: body,
                source_agent_kind: ctx.agent_kind.clone(),
                source_kind: "tagged_proposed_plan".to_string(),
                source_turn_id: None,
                source_item_id: completed.message_id.clone(),
                source_tool_call_id: None,
            },
        )
    }

    /// Persists a completed plan and returns the committed envelopes.
    ///
    /// [`PlanService::create_completed_plan`] runs the domain transaction
    /// (plan row + supersede deltas + `ItemStarted`/`ItemCompleted` event
    /// rows) atomically and returns every committed envelope, satisfying the
    /// partial-failure contract: on `Err` nothing was committed and we return
    /// no envelopes; on `Ok` we return the full batch so the sink can advance
    /// its counter and broadcast.
    ///
    /// NOTE (reviews): the legacy `ingest_completed_plan` also called
    /// `ReviewService::record_candidate_plan(&batch.plan)`. That side effect
    /// is intentionally NOT performed here — it moves to the reviews
    /// observer, which must be registered AFTER this one so it sees the
    /// proposed-plan envelopes emitted in this pass as
    /// `SessionObservation::Event(..)`.
    ///
    /// NOTE (transcript closing): the legacy path called
    /// `sink.close_open_transcript_items()` before ingesting. Closing open
    /// transcript items is now the DISPATCHER's responsibility before
    /// invoking observers; this observer assumes it already happened.
    fn ingest_completed_plan(
        &self,
        ctx: &SessionObserverContext,
        input: NewPlan,
    ) -> ObserverEffects {
        // Match the legacy ingest path: a plan with no explicit source turn
        // inherits the dispatch context's current turn.
        let input = NewPlan {
            source_turn_id: input.source_turn_id.or_else(|| ctx.turn_id.clone()),
            ..input
        };
        let context = PlanEventContext {
            session_id: ctx.session_id.clone(),
            source_agent_kind: ctx.agent_kind.clone(),
            turn_id: ctx.turn_id.clone(),
            // The locked sink counter at this point in the dispatch pass; the
            // service stamps event rows starting at this seq.
            next_seq: ctx.next_seq,
        };
        match self.plans.create_completed_plan(input, context) {
            Ok(batch) => ObserverEffects {
                persisted_events: batch.envelopes,
            },
            Err(PlanCreateError::EmptyBody) => ObserverEffects::default(),
            Err(error) => {
                tracing::warn!(error = %error, "failed to ingest proposed plan");
                ObserverEffects::default()
            }
        }
    }
}

impl SessionEventObserver for PlanSessionObserver {
    /// Mirrors the legacy `ingest_completed_plan` behavior of closing open
    /// streaming items before a plan lands: answer `true` exactly when the
    /// observation will actually ingest a plan (codex completed chunks,
    /// claude `ExitPlanMode` tool calls with a plan body, tagged assistant
    /// messages) — never for deltas or unrelated traffic.
    fn needs_transcript_boundary(&self, obs: &SessionObservation<'_>) -> bool {
        match obs {
            SessionObservation::NonTranscriptChunk(payload) => {
                let meta = parse_proposed_plan_meta(payload.meta.as_ref());
                meta.anyharness
                    .and_then(|meta| meta.transcript_event)
                    .as_deref()
                    == Some("proposed_plan_completed")
                    && extract_text_from_value(&payload.content).is_some()
            }
            SessionObservation::ToolCall { payload, .. } => {
                let meta = parse_proposed_plan_meta(payload.meta.as_ref());
                let is_exit_plan = meta.claude_code.and_then(|meta| meta.tool_name).as_deref()
                    == Some("ExitPlanMode");
                is_exit_plan
                    && payload
                        .content
                        .as_ref()
                        .and_then(|values| extract_text_from_values(values))
                        .or_else(|| extract_string_field(payload.raw_input.as_ref(), "plan"))
                        .or_else(|| extract_string_field(payload.raw_output.as_ref(), "plan"))
                        .is_some()
            }
            SessionObservation::AssistantMessageCompleted(completed) => {
                extract_tagged_proposed_plan(&completed.text).is_some()
            }
            SessionObservation::Event(_) => false,
        }
    }

    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects {
        match obs {
            SessionObservation::NonTranscriptChunk(payload) => {
                self.observe_codex_plan_chunk(ctx, payload)
            }
            SessionObservation::ToolCall { turn_id, payload } => {
                self.observe_claude_exit_plan(ctx, turn_id.as_deref(), payload)
            }
            SessionObservation::AssistantMessageCompleted(completed) => {
                self.observe_tagged_plan(ctx, completed)
            }
            // Plans never react to already-persisted ledger events.
            SessionObservation::Event(_) => ObserverEffects::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Chunk-meta shapes (moved from live/sessions/actor/notifications/types.rs)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposedPlanChunkAnyHarnessMeta {
    transcript_event: Option<String>,
    source_item_id: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct ProposedPlanChunkMeta {
    #[serde(default)]
    anyharness: Option<ProposedPlanChunkAnyHarnessMeta>,
    #[serde(rename = "claudeCode")]
    claude_code: Option<ProposedPlanClaudeMeta>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposedPlanClaudeMeta {
    tool_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure detection helpers (moved from live/sessions/actor/notifications/plans.rs)
// ---------------------------------------------------------------------------

fn parse_proposed_plan_meta(meta: Option<&serde_json::Value>) -> ProposedPlanChunkMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

fn extract_text_from_values(values: &[serde_json::Value]) -> Option<String> {
    let text = values
        .iter()
        .filter_map(extract_text_from_value)
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.trim().is_empty()).then(|| text.trim().to_string())
}

fn extract_text_from_value(value: &serde_json::Value) -> Option<String> {
    value
        .get("text")
        .and_then(serde_json::Value::as_str)
        .or_else(|| value.get("content").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn extract_string_field(value: Option<&serde_json::Value>, key: &str) -> Option<String> {
    value?
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn extract_tagged_proposed_plan(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let body = trimmed.strip_prefix("<proposed_plan>")?;
    let body = body.strip_suffix("</proposed_plan>")?;
    let body = body.trim();
    (!body.is_empty()).then(|| body.to_string())
}

fn title_from_markdown(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find_map(|line| {
            line.strip_prefix("# ")
                .or_else(|| line.strip_prefix("## "))
                .or(Some(line))
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .map(|title| title.chars().take(80).collect())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Moved from live/sessions/actor/tests/notifications.rs
    #[test]
    fn title_from_markdown_uses_first_heading_without_marker() {
        assert_eq!(
            title_from_markdown("# Repo Issue Investigation\n\n## Goal\nFind issues"),
            Some("Repo Issue Investigation".to_string())
        );
    }

    // Moved from live/sessions/actor/tests/notifications.rs
    #[test]
    fn extract_tagged_proposed_plan_requires_complete_wrapper() {
        assert_eq!(
            extract_tagged_proposed_plan(
                "\n<proposed_plan>\n# Plan: Tighten review\n\nDo the work.\n</proposed_plan>\n"
            )
            .as_deref(),
            Some("# Plan: Tighten review\n\nDo the work.")
        );
        assert!(extract_tagged_proposed_plan("# Plan\n\nNo wrapper").is_none());
        assert!(extract_tagged_proposed_plan("<proposed_plan># Plan").is_none());
    }

    #[test]
    fn parse_proposed_plan_meta_reads_anyharness_and_claude_code_namespaces() {
        let meta = parse_proposed_plan_meta(Some(&json!({
            "anyharness": {
                "transcriptEvent": "proposed_plan_completed",
                "sourceItemId": "item-1",
                "title": "My Plan"
            },
            "claudeCode": { "toolName": "ExitPlanMode" }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(
            anyharness.transcript_event.as_deref(),
            Some("proposed_plan_completed")
        );
        assert_eq!(anyharness.source_item_id.as_deref(), Some("item-1"));
        assert_eq!(anyharness.title.as_deref(), Some("My Plan"));
        assert_eq!(
            meta.claude_code.and_then(|m| m.tool_name).as_deref(),
            Some("ExitPlanMode")
        );
    }

    #[test]
    fn parse_proposed_plan_meta_defaults_on_missing_or_malformed_meta() {
        assert!(parse_proposed_plan_meta(None).anyharness.is_none());
        assert!(parse_proposed_plan_meta(Some(&json!("not an object")))
            .anyharness
            .is_none());
    }

    #[test]
    fn extract_text_from_value_prefers_text_then_content() {
        assert_eq!(
            extract_text_from_value(&json!({ "text": " hello " })).as_deref(),
            Some("hello")
        );
        assert_eq!(
            extract_text_from_value(&json!({ "content": "body" })).as_deref(),
            Some("body")
        );
        assert!(extract_text_from_value(&json!({ "text": "   " })).is_none());
        assert!(extract_text_from_value(&json!({ "other": "x" })).is_none());
    }

    #[test]
    fn extract_text_from_values_joins_non_empty_parts() {
        assert_eq!(
            extract_text_from_values(&[
                json!({ "text": "first" }),
                json!({ "other": true }),
                json!({ "text": "second" }),
            ])
            .as_deref(),
            Some("first\n\nsecond")
        );
        assert!(extract_text_from_values(&[json!({ "text": "  " })]).is_none());
        assert!(extract_text_from_values(&[]).is_none());
    }

    #[test]
    fn extract_string_field_trims_and_rejects_empty() {
        assert_eq!(
            extract_string_field(Some(&json!({ "plan": " do it " })), "plan").as_deref(),
            Some("do it")
        );
        assert!(extract_string_field(Some(&json!({ "plan": "" })), "plan").is_none());
        assert!(extract_string_field(Some(&json!({ "plan": 7 })), "plan").is_none());
        assert!(extract_string_field(None, "plan").is_none());
    }
}
