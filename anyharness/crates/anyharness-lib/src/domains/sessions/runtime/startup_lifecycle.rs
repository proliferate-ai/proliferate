//! Lifecycle instrumentation for live agent start.
//!
//! `anyharness.agent.start` is the launch-selection-validity SLI, so the
//! observable start lives here and the mechanics stay in `startup.rs`. The
//! guard wraps the whole inner start: a cancelled future or an unwind still
//! produces a terminal record (`abandoned`) instead of a start with no end.

use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use crate::domains::sessions::model::SessionRecord;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::SessionStartupStrategy;
use crate::observability::lifecycle;

use super::{SessionRuntime, StartSessionError};

impl SessionRuntime {
    pub(super) async fn start_live_session(
        &self,
        record: &SessionRecord,
        startup_strategy: SessionStartupStrategy,
        system_prompt_append: Option<String>,
    ) -> Result<(Arc<LiveSessionHandle>, String), StartSessionError> {
        // `anyharness.agent.start` is the launch-selection-validity SLI. The
        // guard covers the whole start, so a cancelled future or an unwind
        // produces an `abandoned` terminal rather than a start with no end.
        let operation = lifecycle::begin_agent_start(
            &record.workspace_id,
            &record.id,
            &record.agent_kind,
            startup_strategy.as_str(),
            system_prompt_append.is_some(),
        );
        let result = self
            .start_live_session_inner(record, startup_strategy, system_prompt_append)
            .await;
        match &result {
            Ok(_) => operation.succeeded(),
            Err(error) => {
                let (outcome, classification) = agent_start_terminal(error);
                operation.terminal(outcome, Some(classification));
            }
        }
        result
    }
}

/// Splits live-start failures into user-fixable refusals and our own defects,
/// with the closed classification list the producer enforces
/// (`proliferate-diagnostics-client/src/lifecycle.rs`).
///
/// `AcpStart` is deliberately `Failed`: the selection was legal and the agent
/// was ready, so a spawn that still did not come up is ours to explain.
fn agent_start_terminal(error: &StartSessionError) -> (TerminalOutcomeV1, &'static str) {
    match error {
        StartSessionError::WorkspaceNotFound => {
            (TerminalOutcomeV1::Rejected, "workspace_not_found")
        }
        StartSessionError::WorkspaceDirectoryMissing { .. } => {
            (TerminalOutcomeV1::Rejected, "workspace_directory_missing")
        }
        StartSessionError::AgentDescriptorNotFound(_) => {
            (TerminalOutcomeV1::Rejected, "agent_descriptor_not_found")
        }
        StartSessionError::LaunchOptionsUnavailable { .. } => {
            (TerminalOutcomeV1::Rejected, "launch_options_unavailable")
        }
        StartSessionError::LaunchValueUnsupported { .. } => {
            (TerminalOutcomeV1::Rejected, "launch_value_unsupported")
        }
        StartSessionError::AgentEnvOverrideUnsupported { .. } => (
            TerminalOutcomeV1::Rejected,
            "agent_env_override_unsupported",
        ),
        StartSessionError::RouteAuth(_) => (TerminalOutcomeV1::Rejected, "route_auth_refused"),
        StartSessionError::AgentNotReady { .. } => (TerminalOutcomeV1::Rejected, "agent_not_ready"),
        StartSessionError::WorkspaceMcpAttachmentFailed(_) => {
            (TerminalOutcomeV1::Failed, "workspace_mcp_attachment_failed")
        }
        StartSessionError::MissingDataKey => (TerminalOutcomeV1::Failed, "missing_data_key"),
        StartSessionError::RestartRequired(_) => (TerminalOutcomeV1::Failed, "restart_required"),
        // The runtime is shutting down. Not a defect and not the caller's
        // fault, so it is neither `failed` nor `rejected`.
        StartSessionError::Closed => (TerminalOutcomeV1::Cancelled, "runtime_closed"),
        StartSessionError::AcpStart(_) => (TerminalOutcomeV1::Failed, "acp_start_failed"),
        StartSessionError::Internal(_) => (TerminalOutcomeV1::Failed, "internal_error"),
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use proliferate_diagnostics_client::lifecycle::classifications;

    #[test]
    fn every_start_error_maps_to_a_permitted_classification() {
        let permitted = classifications(lifecycle::AGENT_START).expect("operation is owned");
        let errors = [
            StartSessionError::WorkspaceNotFound,
            StartSessionError::WorkspaceDirectoryMissing {
                path: String::new(),
            },
            StartSessionError::AgentDescriptorNotFound(String::new()),
            StartSessionError::LaunchOptionsUnavailable {
                agent_kind: String::new(),
                state: None,
            },
            StartSessionError::AgentEnvOverrideUnsupported {
                agent_kind: String::new(),
                env_var_name: String::new(),
            },
            StartSessionError::Closed,
            StartSessionError::MissingDataKey,
            StartSessionError::RestartRequired(String::new()),
            StartSessionError::Internal(anyhow::anyhow!("boom")),
            StartSessionError::AcpStart(anyhow::anyhow!("boom")),
        ];
        for error in &errors {
            let (_, classification) = agent_start_terminal(error);
            assert!(
                permitted.contains(&classification),
                "{classification} is not in the producer's closed list"
            );
        }
    }

    /// A refused selection is the user's to fix; a spawn that failed anyway is
    /// ours. Collapsing the two would make the launch-selection SLI useless.
    #[test]
    fn a_refused_selection_is_not_counted_as_our_failure() {
        assert_eq!(
            agent_start_terminal(&StartSessionError::AgentDescriptorNotFound(String::new())).0,
            TerminalOutcomeV1::Rejected
        );
        assert_eq!(
            agent_start_terminal(&StartSessionError::AcpStart(anyhow::anyhow!("boom"))).0,
            TerminalOutcomeV1::Failed
        );
        assert_eq!(
            agent_start_terminal(&StartSessionError::Closed).0,
            TerminalOutcomeV1::Cancelled
        );
    }
}
