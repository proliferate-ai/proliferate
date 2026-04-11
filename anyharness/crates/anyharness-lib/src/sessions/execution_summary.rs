use anyharness_contract::v1::{
    SessionExecutionPhase, SessionExecutionSummary, WorkspaceExecutionPhase,
    WorkspaceExecutionSummary,
};

use super::model::SessionRecord;
use crate::acp::session_actor::LiveSessionExecutionSnapshot;

pub fn summarize_session_record(
    record: &SessionRecord,
    live_snapshot: Option<&LiveSessionExecutionSnapshot>,
) -> SessionExecutionSummary {
    match record.status.as_str() {
        "closed" => SessionExecutionSummary {
            phase: SessionExecutionPhase::Closed,
            has_live_handle: false,
            pending_approval: None,
            updated_at: record.updated_at.clone(),
        },
        "errored" => SessionExecutionSummary {
            phase: SessionExecutionPhase::Errored,
            has_live_handle: false,
            pending_approval: None,
            updated_at: record.updated_at.clone(),
        },
        _ => live_snapshot
            .map(|snapshot| snapshot.to_contract_summary(true))
            .unwrap_or_else(|| SessionExecutionSummary {
                phase: SessionExecutionPhase::Idle,
                has_live_handle: false,
                pending_approval: None,
                updated_at: record.updated_at.clone(),
            }),
    }
}

pub fn summarize_workspace_sessions<'a>(
    summaries: impl IntoIterator<Item = &'a SessionExecutionSummary>,
) -> WorkspaceExecutionSummary {
    let mut total_session_count = 0usize;
    let mut live_session_count = 0usize;
    let mut running_count = 0usize;
    let mut awaiting_permission_count = 0usize;
    let mut idle_count = 0usize;
    let mut errored_count = 0usize;
    let mut phase = WorkspaceExecutionPhase::Idle;

    for summary in summaries {
        total_session_count += 1;
        if summary.has_live_handle {
            live_session_count += 1;
        }

        match summary.phase {
            SessionExecutionPhase::AwaitingPermission => {
                awaiting_permission_count += 1;
                phase = WorkspaceExecutionPhase::AwaitingPermission;
            }
            SessionExecutionPhase::Starting | SessionExecutionPhase::Running => {
                running_count += 1;
                if !matches!(phase, WorkspaceExecutionPhase::AwaitingPermission) {
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
        awaiting_permission_count,
        idle_count,
        errored_count,
    }
}

pub fn idle_workspace_execution_summary() -> WorkspaceExecutionSummary {
    WorkspaceExecutionSummary {
        phase: WorkspaceExecutionPhase::Idle,
        total_session_count: 0,
        live_session_count: 0,
        running_count: 0,
        awaiting_permission_count: 0,
        idle_count: 0,
        errored_count: 0,
    }
}

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{PendingApprovalSummary, SessionExecutionPhase};

    use super::*;

    fn session_record(status: &str, updated_at: &str) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: status.to_string(),
            mode_locked: false,
            permission_policy: crate::sessions::model::SessionPermissionPolicy::Interactive,
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
        }
    }

    #[test]
    fn summarize_session_prefers_live_snapshot_for_nonterminal_records() {
        let record = session_record("running", "2026-04-06T00:00:00Z");
        let snapshot = LiveSessionExecutionSnapshot {
            phase: SessionExecutionPhase::AwaitingPermission,
            pending_approval: Some(PendingApprovalSummary {
                request_id: "request-1".to_string(),
                title: "Approve".to_string(),
                tool_call_id: Some("tool-1".to_string()),
                tool_kind: Some("exec".to_string()),
            }),
            updated_at: "2026-04-06T00:00:01Z".to_string(),
        };

        let summary = summarize_session_record(&record, Some(&snapshot));

        assert_eq!(summary.phase, SessionExecutionPhase::AwaitingPermission);
        assert!(summary.has_live_handle);
        assert_eq!(
            summary
                .pending_approval
                .as_ref()
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
        assert!(summary.pending_approval.is_none());
        assert_eq!(summary.updated_at, "2026-04-06T00:00:00Z");
    }

    #[test]
    fn workspace_summary_uses_expected_precedence() {
        let running = SessionExecutionSummary {
            phase: SessionExecutionPhase::Running,
            has_live_handle: true,
            pending_approval: None,
            updated_at: "2026-04-06T00:00:00Z".to_string(),
        };
        let awaiting = SessionExecutionSummary {
            phase: SessionExecutionPhase::AwaitingPermission,
            has_live_handle: true,
            pending_approval: Some(PendingApprovalSummary {
                request_id: "request-1".to_string(),
                title: "Approve".to_string(),
                tool_call_id: None,
                tool_kind: None,
            }),
            updated_at: "2026-04-06T00:00:01Z".to_string(),
        };
        let errored = SessionExecutionSummary {
            phase: SessionExecutionPhase::Errored,
            has_live_handle: false,
            pending_approval: None,
            updated_at: "2026-04-06T00:00:02Z".to_string(),
        };
        let closed = SessionExecutionSummary {
            phase: SessionExecutionPhase::Closed,
            has_live_handle: false,
            pending_approval: None,
            updated_at: "2026-04-06T00:00:03Z".to_string(),
        };

        let summary = summarize_workspace_sessions([&running, &awaiting, &errored, &closed]);

        assert_eq!(summary.phase, WorkspaceExecutionPhase::AwaitingPermission);
        assert_eq!(summary.total_session_count, 4);
        assert_eq!(summary.live_session_count, 2);
        assert_eq!(summary.running_count, 1);
        assert_eq!(summary.awaiting_permission_count, 1);
        assert_eq!(summary.errored_count, 1);
    }
}
