use anyharness_contract::v1::{
    SessionExecutionPhase, SessionExecutionSummary, WorkspaceExecutionPhase,
    WorkspaceExecutionSummary,
};

use super::model::{SessionExecutionState, SessionExecutionStatePhase, SessionRecord};
use crate::live::sessions::handle::LiveSessionExecutionSnapshot;

pub fn summarize_session_record(
    record: &SessionRecord,
    live_snapshot: Option<&LiveSessionExecutionSnapshot>,
) -> SessionExecutionSummary {
    let state = session_execution_state(record, live_snapshot);
    SessionExecutionSummary {
        phase: execution_phase_to_contract(state.phase),
        has_live_handle: state.has_live_handle,
        pending_interactions: if state.has_live_handle {
            live_snapshot
                .map(|snapshot| snapshot.pending_interactions.clone())
                .unwrap_or_default()
        } else {
            Vec::new()
        },
        updated_at: if state.has_live_handle {
            live_snapshot
                .map(|snapshot| snapshot.updated_at.clone())
                .unwrap_or_else(|| record.updated_at.clone())
        } else {
            record.updated_at.clone()
        },
    }
}

pub fn session_execution_state(
    record: &SessionRecord,
    live_snapshot: Option<&LiveSessionExecutionSnapshot>,
) -> SessionExecutionState {
    match record.status.as_str() {
        "closed" => SessionExecutionState {
            phase: SessionExecutionStatePhase::Closed,
            has_live_handle: false,
        },
        "errored" => SessionExecutionState {
            phase: SessionExecutionStatePhase::Errored,
            has_live_handle: false,
        },
        "starting" => live_snapshot
            .map(live_execution_state)
            .unwrap_or(SessionExecutionState {
                phase: SessionExecutionStatePhase::Starting,
                has_live_handle: false,
            }),
        _ => live_snapshot
            .map(live_execution_state)
            .unwrap_or(SessionExecutionState {
                phase: SessionExecutionStatePhase::Idle,
                has_live_handle: false,
            }),
    }
}

fn live_execution_state(snapshot: &LiveSessionExecutionSnapshot) -> SessionExecutionState {
    SessionExecutionState {
        phase: match snapshot.phase {
            SessionExecutionPhase::Starting => SessionExecutionStatePhase::Starting,
            SessionExecutionPhase::Running => SessionExecutionStatePhase::Running,
            SessionExecutionPhase::AwaitingInteraction => {
                SessionExecutionStatePhase::AwaitingInteraction
            }
            SessionExecutionPhase::Idle => SessionExecutionStatePhase::Idle,
            SessionExecutionPhase::Errored => SessionExecutionStatePhase::Errored,
            SessionExecutionPhase::Closed => SessionExecutionStatePhase::Closed,
        },
        has_live_handle: true,
    }
}

fn execution_phase_to_contract(phase: SessionExecutionStatePhase) -> SessionExecutionPhase {
    match phase {
        SessionExecutionStatePhase::Starting => SessionExecutionPhase::Starting,
        SessionExecutionStatePhase::Running => SessionExecutionPhase::Running,
        SessionExecutionStatePhase::AwaitingInteraction => {
            SessionExecutionPhase::AwaitingInteraction
        }
        SessionExecutionStatePhase::Idle => SessionExecutionPhase::Idle,
        SessionExecutionStatePhase::Errored => SessionExecutionPhase::Errored,
        SessionExecutionStatePhase::Closed => SessionExecutionPhase::Closed,
    }
}

pub fn summarize_workspace_sessions<'a>(
    summaries: impl IntoIterator<Item = &'a SessionExecutionSummary>,
) -> WorkspaceExecutionSummary {
    let mut total_session_count = 0usize;
    let mut live_session_count = 0usize;
    let mut running_count = 0usize;
    let mut awaiting_interaction_count = 0usize;
    let mut idle_count = 0usize;
    let mut errored_count = 0usize;
    let mut phase = WorkspaceExecutionPhase::Idle;
    let mut updated_at: Option<String> = None;

    for summary in summaries {
        total_session_count += 1;
        if summary.has_live_handle {
            live_session_count += 1;
        }
        if updated_at
            .as_deref()
            .map(|current| summary.updated_at.as_str() > current)
            .unwrap_or(true)
        {
            updated_at = Some(summary.updated_at.clone());
        }

        match summary.phase {
            SessionExecutionPhase::AwaitingInteraction => {
                awaiting_interaction_count += 1;
                phase = WorkspaceExecutionPhase::AwaitingInteraction;
            }
            SessionExecutionPhase::Starting | SessionExecutionPhase::Running => {
                running_count += 1;
                if !matches!(phase, WorkspaceExecutionPhase::AwaitingInteraction) {
                    phase = WorkspaceExecutionPhase::Running;
                }
            }
            SessionExecutionPhase::Errored => {
                errored_count += 1;
                if matches!(phase, WorkspaceExecutionPhase::Idle) {
                    phase = WorkspaceExecutionPhase::Errored;
                }
            }
            SessionExecutionPhase::Idle => {
                idle_count += 1;
            }
            SessionExecutionPhase::Closed => {}
        }
    }

    WorkspaceExecutionSummary {
        phase,
        total_session_count,
        live_session_count,
        running_count,
        awaiting_interaction_count,
        idle_count,
        errored_count,
        updated_at,
    }
}

pub fn idle_workspace_execution_summary() -> WorkspaceExecutionSummary {
    WorkspaceExecutionSummary {
        phase: WorkspaceExecutionPhase::Idle,
        total_session_count: 0,
        live_session_count: 0,
        running_count: 0,
        awaiting_interaction_count: 0,
        idle_count: 0,
        errored_count: 0,
        updated_at: None,
    }
}

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{
        InteractionKind, PendingInteractionPayloadSummary, PendingInteractionSource,
        PendingInteractionSummary, SessionExecutionPhase,
    };

    use super::*;

    fn session_record(status: &str, updated_at: &str) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: status.to_string(),
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn pending_interaction() -> PendingInteractionSummary {
        PendingInteractionSummary {
            request_id: "request-1".to_string(),
            kind: InteractionKind::Permission,
            title: "Approve".to_string(),
            description: None,
            source: PendingInteractionSource {
                tool_call_id: Some("tool-1".to_string()),
                tool_kind: Some("exec".to_string()),
                tool_status: None,
                linked_plan_id: None,
            },
            payload: PendingInteractionPayloadSummary::Permission {
                options: Vec::new(),
                context: None,
            },
        }
    }

    #[test]
    fn summarize_session_prefers_live_snapshot_for_nonterminal_records() {
        let record = session_record("running", "2026-04-06T00:00:00Z");
        let snapshot = LiveSessionExecutionSnapshot {
            phase: SessionExecutionPhase::AwaitingInteraction,
            pending_interactions: vec![pending_interaction()],
            updated_at: "2026-04-06T00:00:01Z".to_string(),
        };

        let summary = summarize_session_record(&record, Some(&snapshot));

        assert_eq!(summary.phase, SessionExecutionPhase::AwaitingInteraction);
        assert!(summary.has_live_handle);
        assert_eq!(
            summary
                .pending_interactions
                .first()
                .map(|pending| pending.request_id.as_str()),
            Some("request-1")
        );
        assert_eq!(summary.updated_at, "2026-04-06T00:00:01Z");
    }

    #[test]
    fn summarize_session_collapses_cold_nonterminal_records_to_idle() {
        let record = session_record("running", "2026-04-06T00:00:00Z");

        let summary = summarize_session_record(&record, None);

        assert_eq!(summary.phase, SessionExecutionPhase::Idle);
        assert!(!summary.has_live_handle);
        assert!(summary.pending_interactions.is_empty());
        assert_eq!(summary.updated_at, "2026-04-06T00:00:00Z");
    }

    #[test]
    fn summarize_session_preserves_cold_starting_records() {
        let record = session_record("starting", "2026-04-06T00:00:00Z");

        let summary = summarize_session_record(&record, None);

        assert_eq!(summary.phase, SessionExecutionPhase::Starting);
        assert!(!summary.has_live_handle);
        assert!(summary.pending_interactions.is_empty());
        assert_eq!(summary.updated_at, "2026-04-06T00:00:00Z");
    }

    #[test]
    fn workspace_summary_uses_expected_precedence() {
        let running = SessionExecutionSummary {
            phase: SessionExecutionPhase::Running,
            has_live_handle: true,
            pending_interactions: Vec::new(),
            updated_at: "2026-04-06T00:00:00Z".to_string(),
        };
        let awaiting = SessionExecutionSummary {
            phase: SessionExecutionPhase::AwaitingInteraction,
            has_live_handle: true,
            pending_interactions: vec![pending_interaction()],
            updated_at: "2026-04-06T00:00:01Z".to_string(),
        };
        let errored = SessionExecutionSummary {
            phase: SessionExecutionPhase::Errored,
            has_live_handle: false,
            pending_interactions: Vec::new(),
            updated_at: "2026-04-06T00:00:02Z".to_string(),
        };
        let closed = SessionExecutionSummary {
            phase: SessionExecutionPhase::Closed,
            has_live_handle: false,
            pending_interactions: Vec::new(),
            updated_at: "2026-04-06T00:00:03Z".to_string(),
        };

        let summary = summarize_workspace_sessions([&running, &awaiting, &errored, &closed]);

        assert_eq!(summary.phase, WorkspaceExecutionPhase::AwaitingInteraction);
        assert_eq!(summary.total_session_count, 4);
        assert_eq!(summary.live_session_count, 2);
        assert_eq!(summary.running_count, 1);
        assert_eq!(summary.awaiting_interaction_count, 1);
        assert_eq!(summary.errored_count, 1);
        assert_eq!(summary.updated_at.as_deref(), Some("2026-04-06T00:00:03Z"));
    }
}
