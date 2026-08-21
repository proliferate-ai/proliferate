//! Lifecycle instrumentation for session create.
//!
//! `anyharness.session.create` is the runtime's session-create SLI, so the
//! observable entry point lives here and the use case itself stays in
//! `create.rs`. The guard is held across the whole call, so an unwind past any
//! `?` still produces a terminal record (`abandoned`) rather than a start with
//! no end.

use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use super::{CreateSessionError, CreateSessionOutcome, SessionService};
use crate::domains::agents::launch_options::{HarnessLaunchOptionStateRow, LaunchSelection};
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::observability::lifecycle;
use crate::origin::{OriginContext, OriginEntrypoint};

impl SessionService {
    /// Runs the common create validation and record assembly, then delegates
    /// the first durable insert to one caller-owned transaction. Subagent
    /// creation uses this seam to make the child row and relationship visible
    /// atomically; ordinary and idempotent creation keep the default store
    /// path above.
    pub(crate) fn create_session_with_persist<F>(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        preselected_session_id: Option<&str>,
        reuse_existing: bool,
        model_id: Option<&str>,
        control_values: &BTreeMap<String, String>,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        system_prompt_append: Option<String>,
        subagents_enabled: bool,
        origin: OriginContext,
        persist_new: F,
    ) -> Result<CreateSessionOutcome, CreateSessionError>
    where
        F: FnOnce(
            &SessionRecord,
            &ResolvedLaunchIntent,
            &dyn Fn() -> String,
            &LaunchSelection,
        ) -> Result<HarnessLaunchOptionStateRow, CreateSessionError>,
    {
        // `anyharness.session.create` is the runtime's session-create SLI. The
        // guard is held across the whole use case, so an unwind past any `?`
        // still produces a terminal record (`abandoned`) rather than a
        // start with no end.
        let mut operation = lifecycle::begin_session_create(
            workspace_id,
            agent_kind,
            preselected_session_id,
            reuse_existing,
            model_id.is_some(),
            control_values.len(),
            origin_label(&origin),
        );
        let result = self.create_session_with_persist_inner(
            workspace_id,
            agent_kind,
            preselected_session_id,
            reuse_existing,
            model_id,
            control_values,
            mcp_bindings_ciphertext,
            mcp_binding_summaries_json,
            mcp_binding_policy,
            system_prompt_append,
            subagents_enabled,
            origin,
            persist_new,
        );
        match &result {
            Ok(CreateSessionOutcome::Created(record) | CreateSessionOutcome::Existing(record)) => {
                operation.learn_session_id(record.id.clone());
                operation.succeeded();
            }
            Err(error) => {
                let (outcome, classification) = create_session_terminal(error);
                operation.terminal(outcome, Some(classification));
            }
        }
        result
    }
}

/// The bounded label for where a create came from. A closed enum, so the
/// exported record can never carry an unbounded caller string.
fn origin_label(origin: &OriginContext) -> &'static str {
    match origin.entrypoint {
        OriginEntrypoint::Desktop => "desktop",
        OriginEntrypoint::Cloud => "cloud",
        OriginEntrypoint::LocalRuntime => "local_runtime",
        OriginEntrypoint::Cowork => "cowork",
    }
}

/// Splits create failures into the two answers a session-create SLI needs:
/// `Rejected` is user-fixable and is not a defect, `Failed` means we broke it.
///
/// The classification strings are the closed list the producer enforces
/// (`proliferate-diagnostics-client/src/lifecycle.rs`); a name outside it is
/// dropped and the terminal degrades to `abandoned`, which the
/// `every_create_error_maps_to_a_permitted_classification` test forbids.
fn create_session_terminal(error: &CreateSessionError) -> (TerminalOutcomeV1, &'static str) {
    match error {
        CreateSessionError::WorkspaceNotFound(_) => {
            (TerminalOutcomeV1::Rejected, "workspace_not_found")
        }
        CreateSessionError::WorkspaceSingleSession { .. } => {
            (TerminalOutcomeV1::Rejected, "workspace_single_session")
        }
        CreateSessionError::SessionIdConflict { .. } => {
            (TerminalOutcomeV1::Rejected, "session_id_conflict")
        }
        CreateSessionError::LaunchOptionsUnavailable { .. } => {
            (TerminalOutcomeV1::Rejected, "launch_options_unavailable")
        }
        CreateSessionError::LaunchValueUnsupported { .. } => {
            (TerminalOutcomeV1::Rejected, "launch_value_unsupported")
        }
        CreateSessionError::AgentEnvOverrideUnsupported { .. } => (
            TerminalOutcomeV1::Rejected,
            "agent_env_override_unsupported",
        ),
        CreateSessionError::RouteAuth(_) => (TerminalOutcomeV1::Rejected, "route_auth_refused"),
        CreateSessionError::Invalid(_) => (TerminalOutcomeV1::Rejected, "invalid_request"),
        CreateSessionError::Internal(_) => (TerminalOutcomeV1::Failed, "internal_error"),
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use proliferate_diagnostics_client::lifecycle::classifications;

    #[test]
    fn every_create_error_maps_to_a_permitted_classification() {
        let permitted = classifications(lifecycle::SESSION_CREATE).expect("operation is owned");
        let errors = [
            CreateSessionError::WorkspaceNotFound(String::new()),
            CreateSessionError::WorkspaceSingleSession {
                workspace_id: String::new(),
                session_id: String::new(),
            },
            CreateSessionError::SessionIdConflict {
                session_id: String::new(),
            },
            CreateSessionError::LaunchOptionsUnavailable {
                agent_kind: String::new(),
                state: None,
            },
            CreateSessionError::AgentEnvOverrideUnsupported {
                agent_kind: String::new(),
                env_var_name: String::new(),
            },
            CreateSessionError::Invalid(String::new()),
            CreateSessionError::Internal(anyhow::anyhow!("boom")),
        ];
        for error in &errors {
            let (_, classification) = create_session_terminal(error);
            assert!(
                permitted.contains(&classification),
                "{classification} is not in the producer's closed list"
            );
        }
    }

    /// Only `Internal` is our defect. Everything else is a refusal the caller
    /// can act on, and counting it as a failure would make the SLI lie.
    #[test]
    fn only_an_internal_error_counts_as_a_failure() {
        assert_eq!(
            create_session_terminal(&CreateSessionError::Internal(anyhow::anyhow!("boom"))).0,
            TerminalOutcomeV1::Failed
        );
        assert_eq!(
            create_session_terminal(&CreateSessionError::Invalid(String::new())).0,
            TerminalOutcomeV1::Rejected
        );
        assert_eq!(
            create_session_terminal(&CreateSessionError::WorkspaceNotFound(String::new())).0,
            TerminalOutcomeV1::Rejected
        );
    }

    #[test]
    fn origin_labels_are_bounded_names() {
        for origin in [
            OriginContext::human_desktop(),
            OriginContext::human_cloud(),
            OriginContext::cowork(),
        ] {
            let label = origin_label(&origin);
            assert!(!label.is_empty());
            assert!(label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_'));
        }
    }
}
