use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use self::state::{PlanItemState, StreamingItemState, ToolItemState};
use crate::live::sessions::model::EventPersist;
use crate::observability::transcript_phase::TranscriptPhaseDebugState;
use anyharness_contract::v1::SessionEventEnvelope;

mod assistant;
mod background_work;
mod config;
mod interactions;
mod lifecycle;
mod metadata;
mod normalization;
mod pending_prompts;
mod plans;
pub(crate) mod publish;
mod reasoning;
mod runtime_events;
mod state;
mod tools;
mod turns;

#[cfg(test)]
mod tests;

pub use state::{
    AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage, SessionEventSinkDebugSnapshot,
};

pub struct SessionEventSink {
    session_id: String,
    source_agent_kind: String,
    workspace_root: PathBuf,
    next_seq: i64,
    event_tx: broadcast::Sender<SessionEventEnvelope>,
    store: Arc<dyn EventPersist>,

    current_turn_id: Option<String>,
    open_assistant_item: Option<StreamingItemState>,
    open_reasoning_item: Option<StreamingItemState>,
    open_plan_item: Option<PlanItemState>,
    tool_items: HashMap<String, ToolItemState>,
    transcript_phase_debug: TranscriptPhaseDebugState,
}

impl SessionEventSink {
    pub fn new(
        session_id: String,
        source_agent_kind: String,
        workspace_root: PathBuf,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        store: Arc<dyn EventPersist>,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            workspace_root,
            next_seq: 1,
            event_tx,
            store,
            current_turn_id: None,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
            transcript_phase_debug: TranscriptPhaseDebugState::default(),
        }
    }

    pub fn resume_from_seq(
        session_id: String,
        source_agent_kind: String,
        workspace_root: PathBuf,
        last_seq: i64,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        store: Arc<dyn EventPersist>,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            workspace_root,
            next_seq: last_seq + 1,
            event_tx,
            store,
            current_turn_id: None,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
            transcript_phase_debug: TranscriptPhaseDebugState::default(),
        }
    }

    pub fn next_seq(&self) -> i64 {
        self.next_seq
    }

    pub fn current_turn_id(&self) -> Option<String> {
        self.current_turn_id.clone()
    }

    pub fn close_open_transcript_items(&mut self) {
        self.close_open_items();
    }

    pub fn publish_persisted_events(&mut self, envelopes: Vec<SessionEventEnvelope>) {
        for envelope in envelopes {
            if envelope.seq >= self.next_seq {
                self.next_seq = envelope.seq + 1;
            }
            let _ = self.event_tx.send(envelope);
        }
    }

    pub fn debug_snapshot(&self) -> SessionEventSinkDebugSnapshot {
        SessionEventSinkDebugSnapshot {
            current_turn_id: self.current_turn_id.clone(),
            open_assistant_item_id: self
                .open_assistant_item
                .as_ref()
                .map(|item| item.item_id.clone()),
            open_assistant_chars: self
                .open_assistant_item
                .as_ref()
                .map(|item| item.text.chars().count())
                .unwrap_or(0),
            open_reasoning_item_id: self
                .open_reasoning_item
                .as_ref()
                .map(|item| item.item_id.clone()),
            open_reasoning_chars: self
                .open_reasoning_item
                .as_ref()
                .map(|item| item.text.chars().count())
                .unwrap_or(0),
            open_plan_item_id: self
                .open_plan_item
                .as_ref()
                .map(|item| item.item_id.clone()),
            open_tool_call_ids: self.tool_items.keys().cloned().collect(),
            next_seq: self.next_seq,
        }
    }
}
