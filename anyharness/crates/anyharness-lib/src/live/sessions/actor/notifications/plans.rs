use std::sync::Arc;

use tokio::sync::Mutex;

use crate::domains::plans::model::NewPlan;
use crate::domains::plans::service::{PlanCreateError, PlanService};
use crate::domains::reviews::service::ReviewService;
use crate::live::sessions::actor::notifications::types::ProposedPlanChunkMeta;
use crate::live::sessions::event_sink::{
    AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage, SessionEventSink,
};

pub(in crate::live::sessions::actor) async fn maybe_ingest_codex_completed_plan(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    plan_service: &PlanService,
    review_service: Option<&ReviewService>,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    payload: &AcpChunkPayload,
) -> bool {
    let meta = parse_proposed_plan_meta(payload.meta.as_ref());
    let Some(anyharness_meta) = meta.anyharness else {
        return false;
    };
    if anyharness_meta.transcript_event.as_deref() == Some("proposed_plan_delta") {
        // V1 treats Codex plan deltas as non-canonical preview evidence. A later
        // version can surface these as a transient proposed-plan item.
        return true;
    }
    if anyharness_meta.transcript_event.as_deref() != Some("proposed_plan_completed") {
        return false;
    }
    let Some(body) = extract_text_from_value(&payload.content) else {
        return true;
    };
    let title = anyharness_meta
        .title
        .filter(|value| !value.trim().is_empty())
        .or_else(|| title_from_markdown(&body))
        .unwrap_or_else(|| "Plan".to_string());
    let source_item_id = anyharness_meta
        .source_item_id
        .or_else(|| payload.message_id.clone());
    ingest_completed_plan(
        event_sink,
        plan_service,
        review_service,
        NewPlan {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            title,
            body_markdown: body,
            source_agent_kind: source_agent_kind.to_string(),
            source_kind: "codex_turn_plan".to_string(),
            source_turn_id: None,
            source_item_id,
            source_tool_call_id: None,
        },
    )
    .await;
    true
}

pub(in crate::live::sessions::actor) async fn maybe_ingest_tagged_completed_plan(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    plan_service: &PlanService,
    review_service: Option<&ReviewService>,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    completed: Option<CompletedAssistantMessage>,
) -> bool {
    let Some(completed) = completed else {
        return false;
    };
    let Some(body) = extract_tagged_proposed_plan(&completed.text) else {
        return false;
    };
    let title = title_from_markdown(&body).unwrap_or_else(|| "Plan".to_string());
    ingest_completed_plan(
        event_sink,
        plan_service,
        review_service,
        NewPlan {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            title,
            body_markdown: body,
            source_agent_kind: source_agent_kind.to_string(),
            source_kind: "tagged_proposed_plan".to_string(),
            source_turn_id: None,
            source_item_id: completed.message_id,
            source_tool_call_id: None,
        },
    )
    .await;
    true
}

pub(in crate::live::sessions::actor) async fn maybe_ingest_claude_exit_plan(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    plan_service: &PlanService,
    review_service: Option<&ReviewService>,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    turn_id: Option<String>,
    payload: &AcpToolPayload,
) {
    if source_agent_kind != "claude" {
        return;
    }
    let meta = parse_proposed_plan_meta(payload.meta.as_ref());
    let is_exit_plan =
        meta.claude_code.and_then(|meta| meta.tool_name).as_deref() == Some("ExitPlanMode");
    if !is_exit_plan {
        return;
    }
    let body = payload
        .content
        .as_ref()
        .and_then(|values| extract_text_from_values(values))
        .or_else(|| extract_string_field(payload.raw_input.as_ref(), "plan"))
        .or_else(|| extract_string_field(payload.raw_output.as_ref(), "plan"));
    let Some(body) = body else {
        return;
    };
    let title = title_from_markdown(&body).unwrap_or_else(|| "Plan".to_string());
    ingest_completed_plan(
        event_sink,
        plan_service,
        review_service,
        NewPlan {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            title,
            body_markdown: body,
            source_agent_kind: source_agent_kind.to_string(),
            source_kind: "claude_exit_plan_mode".to_string(),
            source_turn_id: turn_id,
            source_item_id: Some(payload.tool_call_id.clone()),
            source_tool_call_id: Some(payload.tool_call_id.clone()),
        },
    )
    .await;
}

pub(in crate::live::sessions::actor) async fn ingest_completed_plan(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    plan_service: &PlanService,
    review_service: Option<&ReviewService>,
    input: NewPlan,
) {
    let mut sink = event_sink.lock().await;
    sink.close_open_transcript_items();
    let context = sink.plan_event_context();
    let input = NewPlan {
        source_turn_id: input.source_turn_id.or_else(|| context.turn_id.clone()),
        ..input
    };
    match plan_service.create_completed_plan(input, context) {
        Ok(batch) => {
            if let Some(review_service) = review_service {
                review_service.record_candidate_plan(&batch.plan);
            }
            sink.publish_persisted_events(batch.envelopes);
        }
        Err(PlanCreateError::EmptyBody) => {}
        Err(error) => {
            tracing::warn!(error = %error, "failed to ingest proposed plan");
        }
    }
}

pub(in crate::live::sessions::actor) fn parse_proposed_plan_meta(
    meta: Option<&serde_json::Value>,
) -> ProposedPlanChunkMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

pub(in crate::live::sessions::actor) fn extract_text_from_values(
    values: &[serde_json::Value],
) -> Option<String> {
    let text = values
        .iter()
        .filter_map(extract_text_from_value)
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.trim().is_empty()).then(|| text.trim().to_string())
}

pub(in crate::live::sessions::actor) fn extract_text_from_value(
    value: &serde_json::Value,
) -> Option<String> {
    value
        .get("text")
        .and_then(serde_json::Value::as_str)
        .or_else(|| value.get("content").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

pub(in crate::live::sessions::actor) fn extract_string_field(
    value: Option<&serde_json::Value>,
    key: &str,
) -> Option<String> {
    value?
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

pub(in crate::live::sessions::actor) fn extract_tagged_proposed_plan(
    value: &str,
) -> Option<String> {
    let trimmed = value.trim();
    let body = trimmed.strip_prefix("<proposed_plan>")?;
    let body = body.strip_suffix("</proposed_plan>")?;
    let body = body.trim();
    (!body.is_empty()).then(|| body.to_string())
}

pub(in crate::live::sessions::actor) fn title_from_markdown(value: &str) -> Option<String> {
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
