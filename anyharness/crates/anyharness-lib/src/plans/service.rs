use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, ProposedPlanDecisionState,
    ProposedPlanDetail, ProposedPlanNativeResolutionState, ProposedPlanSummary, SessionEvent,
    SessionEventEnvelope, TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload,
    TranscriptItemStatus,
};
use serde_json::json;

use super::document;
use super::model::{
    NewPlan, PlanCreateOutcome, PlanInteractionLinkRecord, PlanRecord, MAX_PLAN_BODY_BYTES,
};
use super::store::PlanStore;
use crate::sessions::model::SessionEventRecord;

#[derive(Debug, thiserror::Error)]
pub enum PlanCreateError {
    #[error("proposed plan body is empty")]
    EmptyBody,
    #[error("proposed plan body exceeds {MAX_PLAN_BODY_BYTES} bytes")]
    BodyTooLarge,
    #[error("same source emitted a different proposed plan body")]
    SourceConflict,
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum PlanDecisionError {
    #[error("plan not found")]
    NotFound,
    #[error("stale plan decision version")]
    StaleVersion,
    #[error("plan decision is already terminal")]
    TerminalState,
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
enum PlanCreateTxError {
    #[error("same source emitted a different proposed plan body")]
    SourceConflict,
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, thiserror::Error)]
enum PlanDecisionTxError {
    #[error("plan not found")]
    NotFound,
    #[error("stale plan decision version")]
    StaleVersion,
    #[error("plan decision is already terminal")]
    TerminalState,
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone)]
pub struct PlanEventContext {
    pub session_id: String,
    pub source_agent_kind: String,
    pub turn_id: Option<String>,
    pub next_seq: i64,
}

#[derive(Debug, Clone)]
pub struct PlanEventBatch {
    pub plan: PlanRecord,
    pub envelopes: Vec<SessionEventEnvelope>,
    pub outcome: PlanCreateOutcome,
}

#[derive(Clone)]
pub struct PlanService {
    store: PlanStore,
}

const DEFAULT_WORKSPACE_PLAN_LIMIT: usize = 100;

impl PlanService {
    pub fn new(store: PlanStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &PlanStore {
        &self.store
    }

    pub fn list_by_workspace(&self, workspace_id: &str) -> anyhow::Result<Vec<PlanRecord>> {
        self.store
            .list_by_workspace(workspace_id, DEFAULT_WORKSPACE_PLAN_LIMIT)
    }

    pub fn get(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>> {
        self.store.find_by_id(plan_id)
    }

    pub fn find_by_session_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> anyhow::Result<Option<PlanRecord>> {
        self.store
            .find_by_session_tool_call(session_id, tool_call_id)
    }

    pub fn create_completed_plan(
        &self,
        mut input: NewPlan,
        context: PlanEventContext,
    ) -> Result<PlanEventBatch, PlanCreateError> {
        let body = input.body_markdown.trim().to_string();
        if body.is_empty() {
            return Err(PlanCreateError::EmptyBody);
        }
        if body.len() > MAX_PLAN_BODY_BYTES {
            return Err(PlanCreateError::BodyTooLarge);
        }
        if input.source_turn_id.is_none() {
            input.source_turn_id = context.turn_id.clone();
        }

        self.store
            .with_tx_anyhow(|tx| {
                (|| -> Result<PlanEventBatch, PlanCreateTxError> {
                    let snapshot_hash =
                        document::snapshot_hash(&input.title, &body, &input.source_kind);
                    if let Some(existing) = PlanStore::find_by_source_key(
                        tx,
                        &input.session_id,
                        input.source_turn_id.as_deref(),
                        input.source_item_id.as_deref(),
                        &input.source_kind,
                    )? {
                        if existing.snapshot_hash != snapshot_hash {
                            return Err(PlanCreateTxError::SourceConflict);
                        }
                        return Ok(PlanEventBatch {
                            plan: existing,
                            envelopes: Vec::new(),
                            outcome: PlanCreateOutcome::Existing,
                        });
                    }

                    let now = chrono::Utc::now().to_rfc3339();
                    let plan_id = uuid::Uuid::new_v4().to_string();
                    let plan = PlanRecord {
                        id: plan_id.clone(),
                        workspace_id: input.workspace_id,
                        session_id: input.session_id.clone(),
                        item_id: plan_id.clone(),
                        title: input.title,
                        body_markdown: body,
                        snapshot_hash,
                        decision_state: ProposedPlanDecisionState::Pending,
                        native_resolution_state: if input.source_tool_call_id.is_some() {
                            ProposedPlanNativeResolutionState::PendingLink
                        } else {
                            ProposedPlanNativeResolutionState::None
                        },
                        decision_version: 1,
                        source_agent_kind: input.source_agent_kind,
                        source_kind: input.source_kind,
                        source_session_id: input.session_id,
                        source_turn_id: input.source_turn_id,
                        source_item_id: input.source_item_id,
                        source_tool_call_id: input.source_tool_call_id,
                        superseded_by_plan_id: None,
                        created_at: now.clone(),
                        updated_at: now,
                    };

                    PlanStore::insert_plan(tx, &plan)?;

                    let mut seq = context.next_seq;
                    let mut envelopes = Vec::new();
                    for pending in PlanStore::find_pending_by_lineage(
                        tx,
                        &plan.session_id,
                        &plan.source_agent_kind,
                        &plan.source_kind,
                        &plan.id,
                    )? {
                        let updated = PlanStore::update_decision(
                            tx,
                            &pending.id,
                            &ProposedPlanDecisionState::Superseded,
                            &ProposedPlanNativeResolutionState::Finalized,
                            pending.decision_version + 1,
                            Some(&plan.id),
                            &chrono::Utc::now().to_rfc3339(),
                        )?;
                        let envelope = decision_envelope(
                            &updated,
                            &context,
                            seq,
                            None,
                            Some(updated.item_id.clone()),
                        );
                        PlanStore::insert_event(tx, &event_record(&envelope)?)?;
                        seq += 1;
                        envelopes.push(envelope);
                    }

                    let item = plan_item_payload(&plan, &context.source_agent_kind);
                    let started = envelope(
                        &context,
                        seq,
                        Some(plan.item_id.clone()),
                        SessionEvent::ItemStarted(ItemStartedEvent { item: item.clone() }),
                    );
                    PlanStore::insert_event(tx, &event_record(&started)?)?;
                    seq += 1;
                    let completed = envelope(
                        &context,
                        seq,
                        Some(plan.item_id.clone()),
                        SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
                    );
                    PlanStore::insert_event(tx, &event_record(&completed)?)?;
                    envelopes.push(started);
                    envelopes.push(completed);

                    Ok(PlanEventBatch {
                        plan,
                        envelopes,
                        outcome: PlanCreateOutcome::Created,
                    })
                })()
                .map_err(anyhow::Error::new)
            })
            .map_err(map_create_tx_error)
    }

    pub fn update_decision_offline(
        &self,
        plan_id: &str,
        expected_version: i64,
        decision: ProposedPlanDecisionState,
    ) -> Result<(PlanRecord, Vec<SessionEventEnvelope>), PlanDecisionError> {
        self.store
            .with_tx_anyhow(|tx| {
                (|| -> Result<(PlanRecord, Vec<SessionEventEnvelope>), PlanDecisionTxError> {
                    let plan = tx
                        .query_row(
                            "SELECT * FROM plans WHERE id = ?1",
                            [plan_id],
                            super::store::map_plan,
                        )
                        .map_err(|error| match error {
                            rusqlite::Error::QueryReturnedNoRows => PlanDecisionTxError::NotFound,
                            other => PlanDecisionTxError::Sqlite(other),
                        })?;
                    if plan.decision_version != expected_version {
                        return Err(PlanDecisionTxError::StaleVersion);
                    }
                    if plan.decision_state != ProposedPlanDecisionState::Pending {
                        return Err(PlanDecisionTxError::TerminalState);
                    }
                    let native_state = initial_native_state_for_decision(
                        &plan,
                        &decision,
                        plan_has_interaction_link(tx, &plan.id)?,
                        false,
                    );
                    let next = PlanStore::update_decision(
                        tx,
                        &plan.id,
                        &decision,
                        &native_state,
                        plan.decision_version + 1,
                        None,
                        &chrono::Utc::now().to_rfc3339(),
                    )?;
                    let seq = PlanStore::next_event_seq(tx, &next.session_id)?;
                    let context = PlanEventContext {
                        session_id: next.session_id.clone(),
                        source_agent_kind: next.source_agent_kind.clone(),
                        turn_id: next.source_turn_id.clone(),
                        next_seq: seq,
                    };
                    let envelope =
                        decision_envelope(&next, &context, seq, None, Some(next.item_id.clone()));
                    PlanStore::insert_event(tx, &event_record(&envelope)?)?;
                    Ok((next, vec![envelope]))
                })()
                .map_err(anyhow::Error::new)
            })
            .map_err(map_decision_tx_error)
    }

    pub fn update_decision_with_context(
        &self,
        plan_id: &str,
        expected_version: i64,
        decision: ProposedPlanDecisionState,
        context: PlanEventContext,
    ) -> Result<(PlanRecord, Vec<SessionEventEnvelope>), PlanDecisionError> {
        self.store
            .with_tx_anyhow(|tx| {
                (|| -> Result<(PlanRecord, Vec<SessionEventEnvelope>), PlanDecisionTxError> {
                    let plan = tx
                        .query_row(
                            "SELECT * FROM plans WHERE id = ?1",
                            [plan_id],
                            super::store::map_plan,
                        )
                        .map_err(|error| match error {
                            rusqlite::Error::QueryReturnedNoRows => PlanDecisionTxError::NotFound,
                            other => PlanDecisionTxError::Sqlite(other),
                        })?;
                    if plan.decision_version != expected_version {
                        return Err(PlanDecisionTxError::StaleVersion);
                    }
                    if plan.decision_state != ProposedPlanDecisionState::Pending {
                        return Err(PlanDecisionTxError::TerminalState);
                    }
                    let native_state = initial_native_state_for_decision(
                        &plan,
                        &decision,
                        plan_has_interaction_link(tx, &plan.id)?,
                        true,
                    );
                    let next = PlanStore::update_decision(
                        tx,
                        &plan.id,
                        &decision,
                        &native_state,
                        plan.decision_version + 1,
                        None,
                        &chrono::Utc::now().to_rfc3339(),
                    )?;
                    let envelope = decision_envelope(
                        &next,
                        &context,
                        context.next_seq,
                        None,
                        Some(next.item_id.clone()),
                    );
                    PlanStore::insert_event(tx, &event_record(&envelope)?)?;
                    Ok((next, vec![envelope]))
                })()
                .map_err(anyhow::Error::new)
            })
            .map_err(map_decision_tx_error)
    }

    pub fn update_native_resolution_with_context(
        &self,
        plan_id: &str,
        native_state: ProposedPlanNativeResolutionState,
        context: PlanEventContext,
        error_message: Option<String>,
    ) -> Result<(PlanRecord, Vec<SessionEventEnvelope>), PlanDecisionError> {
        self.store
            .with_tx_anyhow(|tx| {
                (|| -> Result<(PlanRecord, Vec<SessionEventEnvelope>), PlanDecisionTxError> {
                    let plan = tx
                        .query_row(
                            "SELECT * FROM plans WHERE id = ?1",
                            [plan_id],
                            super::store::map_plan,
                        )
                        .map_err(|error| match error {
                            rusqlite::Error::QueryReturnedNoRows => PlanDecisionTxError::NotFound,
                            other => PlanDecisionTxError::Sqlite(other),
                        })?;
                    if plan.native_resolution_state == native_state {
                        return Ok((plan, Vec::new()));
                    }
                    let next = PlanStore::update_decision(
                        tx,
                        &plan.id,
                        &plan.decision_state,
                        &native_state,
                        plan.decision_version + 1,
                        None,
                        &chrono::Utc::now().to_rfc3339(),
                    )?;
                    let envelope = decision_envelope(
                        &next,
                        &context,
                        context.next_seq,
                        error_message,
                        Some(next.item_id.clone()),
                    );
                    PlanStore::insert_event(tx, &event_record(&envelope)?)?;
                    Ok((next, vec![envelope]))
                })()
                .map_err(anyhow::Error::new)
            })
            .map_err(map_decision_tx_error)
    }

    pub fn register_interaction_link(
        &self,
        plan: &PlanRecord,
        request_id: &str,
        tool_call_id: &str,
        option_mappings: serde_json::Value,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.store
            .insert_or_replace_interaction_link(&PlanInteractionLinkRecord {
                plan_id: plan.id.clone(),
                request_id: request_id.to_string(),
                session_id: plan.session_id.clone(),
                tool_call_id: tool_call_id.to_string(),
                resolution_state: "unresolved".to_string(),
                option_mappings_json: option_mappings.to_string(),
                created_at: now.clone(),
                updated_at: now,
            })
    }
}

pub fn plan_to_summary(plan: &PlanRecord) -> ProposedPlanSummary {
    ProposedPlanSummary {
        id: plan.id.clone(),
        workspace_id: plan.workspace_id.clone(),
        session_id: plan.session_id.clone(),
        item_id: plan.item_id.clone(),
        title: plan.title.clone(),
        snapshot_hash: plan.snapshot_hash.clone(),
        decision_state: plan.decision_state.clone(),
        native_resolution_state: plan.native_resolution_state.clone(),
        decision_version: plan.decision_version,
        source_agent_kind: plan.source_agent_kind.clone(),
        source_session_id: plan.source_session_id.clone(),
        source_kind: plan.source_kind.clone(),
        source_turn_id: plan.source_turn_id.clone(),
        source_item_id: plan.source_item_id.clone(),
        source_tool_call_id: plan.source_tool_call_id.clone(),
        created_at: plan.created_at.clone(),
        updated_at: plan.updated_at.clone(),
    }
}

pub fn plan_to_detail(plan: &PlanRecord) -> ProposedPlanDetail {
    ProposedPlanDetail {
        summary: plan_to_summary(plan),
        body_markdown: plan.body_markdown.clone(),
    }
}

pub fn plan_item_payload(plan: &PlanRecord, source_agent_kind: &str) -> TranscriptItemPayload {
    TranscriptItemPayload {
        kind: TranscriptItemKind::ProposedPlan,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: source_agent_kind.to_string(),
        is_transient: false,
        message_id: None,
        prompt_id: None,
        title: Some(plan.title.clone()),
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: plan.source_tool_call_id.clone(),
        raw_input: None,
        raw_output: Some(json!({
            "planId": plan.id,
            "snapshotHash": plan.snapshot_hash,
        })),
        content_parts: vec![snapshot_part(plan), decision_part(plan, None)],
        prompt_provenance: None,
    }
}

fn map_create_tx_error(error: anyhow::Error) -> PlanCreateError {
    match error.downcast::<PlanCreateTxError>() {
        Ok(PlanCreateTxError::SourceConflict) => PlanCreateError::SourceConflict,
        Ok(PlanCreateTxError::Sqlite(error)) => PlanCreateError::Store(error.into()),
        Err(error) => PlanCreateError::Store(error),
    }
}

fn map_decision_tx_error(error: anyhow::Error) -> PlanDecisionError {
    match error.downcast::<PlanDecisionTxError>() {
        Ok(PlanDecisionTxError::NotFound) => PlanDecisionError::NotFound,
        Ok(PlanDecisionTxError::StaleVersion) => PlanDecisionError::StaleVersion,
        Ok(PlanDecisionTxError::TerminalState) => PlanDecisionError::TerminalState,
        Ok(PlanDecisionTxError::Sqlite(error)) => PlanDecisionError::Store(error.into()),
        Err(error) => PlanDecisionError::Store(error),
    }
}

fn plan_has_interaction_link(tx: &rusqlite::Connection, plan_id: &str) -> rusqlite::Result<bool> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM plan_interaction_links WHERE plan_id = ?1)",
        [plan_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|value| value != 0)
}

fn initial_native_state_for_decision(
    plan: &PlanRecord,
    decision: &ProposedPlanDecisionState,
    has_link: bool,
    live_session: bool,
) -> ProposedPlanNativeResolutionState {
    if *decision == ProposedPlanDecisionState::Approved {
        return ProposedPlanNativeResolutionState::Finalized;
    }
    if has_link {
        if live_session {
            ProposedPlanNativeResolutionState::PendingResolution
        } else {
            ProposedPlanNativeResolutionState::Failed
        }
    } else if plan.source_tool_call_id.is_some() {
        ProposedPlanNativeResolutionState::PendingLink
    } else {
        ProposedPlanNativeResolutionState::Finalized
    }
}

pub fn decision_envelope(
    plan: &PlanRecord,
    context: &PlanEventContext,
    seq: i64,
    error_message: Option<String>,
    item_id: Option<String>,
) -> SessionEventEnvelope {
    envelope(
        context,
        seq,
        item_id,
        SessionEvent::ItemDelta(ItemDeltaEvent {
            delta: TranscriptItemDeltaPayload {
                is_transient: None,
                status: None,
                title: None,
                native_tool_name: None,
                parent_tool_call_id: None,
                raw_input: None,
                raw_output: None,
                append_text: None,
                append_reasoning: None,
                replace_content_parts: None,
                append_content_parts: Some(vec![decision_part(plan, error_message)]),
            },
        }),
    )
}

fn snapshot_part(plan: &PlanRecord) -> ContentPart {
    ContentPart::ProposedPlan {
        plan_id: plan.id.clone(),
        title: plan.title.clone(),
        body_markdown: plan.body_markdown.clone(),
        snapshot_hash: plan.snapshot_hash.clone(),
        source_session_id: plan.source_session_id.clone(),
        source_turn_id: plan.source_turn_id.clone(),
        source_item_id: plan.source_item_id.clone(),
        source_kind: plan.source_kind.clone(),
        source_tool_call_id: plan.source_tool_call_id.clone(),
    }
}

fn decision_part(plan: &PlanRecord, error_message: Option<String>) -> ContentPart {
    ContentPart::ProposedPlanDecision {
        plan_id: plan.id.clone(),
        decision_state: plan.decision_state.clone(),
        native_resolution_state: plan.native_resolution_state.clone(),
        decision_version: plan.decision_version,
        error_message,
    }
}

fn envelope(
    context: &PlanEventContext,
    seq: i64,
    item_id: Option<String>,
    event: SessionEvent,
) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: context.session_id.clone(),
        seq,
        timestamp: chrono::Utc::now().to_rfc3339(),
        turn_id: context.turn_id.clone(),
        item_id,
        event,
    }
}

fn event_record(envelope: &SessionEventEnvelope) -> rusqlite::Result<SessionEventRecord> {
    Ok(SessionEventRecord {
        id: 0,
        session_id: envelope.session_id.clone(),
        seq: envelope.seq,
        timestamp: envelope.timestamp.clone(),
        event_type: envelope.event.event_type().to_string(),
        turn_id: envelope.turn_id.clone(),
        item_id: envelope.item_id.clone(),
        payload_json: serde_json::to_string(&envelope.event)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?,
    })
}
