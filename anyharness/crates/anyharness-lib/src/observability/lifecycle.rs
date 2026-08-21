//! Canonical lifecycle records for the runtime's product operations.
//!
//! Everything else the runtime reports is a `tracing` event, which the
//! diagnostics tracing layer turns into a `detailed` record
//! (`proliferate-diagnostics-client/src/tracing_layer/mod.rs`). Detailed
//! records carry free text and never leave a customer machine. The operations
//! here are the other class: closed enums and bounded counters describing
//! whether a product operation began, ended, and how.
//!
//! Adding an operation or a field here changes what leaves a customer machine
//! once the export lands, so both are closed lists. The field list is enforced
//! in the producer (`proliferate-diagnostics-client/src/lifecycle.rs`), not
//! here: a name this module misspells is dropped by the producer rather than
//! shipped.
//!
//! The whole module is inert in a process with no installed diagnostics
//! producer, which is every test and every non-Desktop run.

use proliferate_diagnostics_client::{
    lifecycle::LifecycleOperation, DiagnosticCorrelation, LifecycleArgument,
};
use proliferate_diagnostics_protocol::v1::types::{ArgumentValueV1, TerminalOutcomeV1};

pub use proliferate_diagnostics_client::lifecycle::LifecycleOperation as RuntimeLifecycleOperation;
pub use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1 as LifecycleOutcome;

/// The runtime's session-create use case, from admission to a persisted or
/// refused result.
pub const SESSION_CREATE: &str = "anyharness.session.create";
/// One turn, from prompt admission to the turn's terminal event.
pub const TURN_EXECUTE: &str = "anyharness.turn.execute";
/// One live agent start, from admission to a ready ACP session or a refusal.
pub const AGENT_START: &str = "anyharness.agent.start";

/// The turn's failure classification. Kept deliberately coarse: the agent's own
/// error code is an unbounded provider-shaped string and has no place on an
/// exported record.
pub const TURN_ERROR: &str = "turn_error";
/// Our own defect, not the agent's and not the user's.
pub const INTERNAL_ERROR: &str = "internal_error";

fn enum_value(value: &str) -> ArgumentValueV1 {
    ArgumentValueV1::Enum(value.to_owned())
}

/// Begins `anyharness.session.create`.
///
/// The started record carries only what admission knew. The session id is
/// learned later (it is minted inside the use case) and is attached to the
/// terminal record with [`RuntimeLifecycleOperation::learn_session_id`].
pub fn begin_session_create(
    workspace_id: &str,
    agent_kind: &str,
    preselected_session_id: Option<&str>,
    reuse_existing: bool,
    selected_model: bool,
    selected_control_count: usize,
    origin: &str,
) -> LifecycleOperation {
    LifecycleOperation::begin_with_arguments(
        SESSION_CREATE,
        DiagnosticCorrelation {
            workspace_id: Some(workspace_id.to_owned()),
            session_id: preselected_session_id.map(ToOwned::to_owned),
            ..DiagnosticCorrelation::default()
        },
        vec![
            LifecycleArgument {
                name: "agent_kind",
                value: enum_value(agent_kind),
            },
            LifecycleArgument {
                name: "reuse_existing",
                value: ArgumentValueV1::Boolean(reuse_existing),
            },
            LifecycleArgument {
                name: "preselected_session_id",
                value: ArgumentValueV1::Boolean(preselected_session_id.is_some()),
            },
            LifecycleArgument {
                name: "selected_model",
                value: ArgumentValueV1::Boolean(selected_model),
            },
            LifecycleArgument {
                name: "selected_control_count",
                value: ArgumentValueV1::Integer(i64::try_from(selected_control_count).unwrap_or(0)),
            },
            LifecycleArgument {
                name: "origin",
                value: enum_value(origin),
            },
        ],
    )
}

/// Begins `anyharness.turn.execute`.
pub fn begin_turn_execute(
    session_id: &str,
    turn_id: &str,
    engine_initiated: bool,
) -> LifecycleOperation {
    LifecycleOperation::begin_with_arguments(
        TURN_EXECUTE,
        DiagnosticCorrelation {
            session_id: Some(session_id.to_owned()),
            turn_id: Some(turn_id.to_owned()),
            ..DiagnosticCorrelation::default()
        },
        vec![LifecycleArgument {
            name: "engine_initiated",
            value: ArgumentValueV1::Boolean(engine_initiated),
        }],
    )
}

/// Begins `anyharness.agent.start`.
pub fn begin_agent_start(
    workspace_id: &str,
    session_id: &str,
    agent_kind: &str,
    startup_strategy: &'static str,
    has_system_prompt_append: bool,
) -> LifecycleOperation {
    LifecycleOperation::begin_with_arguments(
        AGENT_START,
        DiagnosticCorrelation {
            workspace_id: Some(workspace_id.to_owned()),
            session_id: Some(session_id.to_owned()),
            ..DiagnosticCorrelation::default()
        },
        vec![
            LifecycleArgument {
                name: "agent_kind",
                value: enum_value(agent_kind),
            },
            LifecycleArgument {
                name: "startup_strategy",
                value: enum_value(startup_strategy),
            },
            LifecycleArgument {
                name: "has_system_prompt_append",
                value: ArgumentValueV1::Boolean(has_system_prompt_append),
            },
        ],
    )
}

/// The stop reason a turn ended with, as a terminal outcome.
///
/// `refusal` is the model declining, which is a legitimate finished turn from
/// the runtime's point of view but not a success, so it is `rejected` rather
/// than `succeeded`. That split is the difference between "we broke it" and
/// "the user or the model said no", which is the whole point of separating
/// `Failed` from `Rejected` in the outcome enum.
pub fn turn_outcome(stop_reason: &str) -> TerminalOutcomeV1 {
    match stop_reason {
        "cancelled" => TerminalOutcomeV1::Cancelled,
        "refusal" => TerminalOutcomeV1::Rejected,
        _ => TerminalOutcomeV1::Succeeded,
    }
}

/// Attaches the stop reason to a turn's terminal record.
pub fn turn_stop_reason(stop_reason: &str) -> LifecycleArgument {
    LifecycleArgument {
        name: "stop_reason",
        value: enum_value(stop_reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proliferate_diagnostics_client::lifecycle::safe_fields;

    /// Every argument this module can produce must be in the producer's closed
    /// safe-field list for its operation, or the producer silently drops it and
    /// the SLI loses a dimension without anyone noticing.
    #[test]
    fn every_emitted_field_is_in_the_producers_safe_list() {
        let session_create = safe_fields(SESSION_CREATE).expect("operation is owned");
        for field in [
            "agent_kind",
            "reuse_existing",
            "preselected_session_id",
            "selected_model",
            "selected_control_count",
            "origin",
        ] {
            assert!(
                session_create.contains(&field),
                "{field} is not safe-listed"
            );
        }

        let turn_execute = safe_fields(TURN_EXECUTE).expect("operation is owned");
        for field in ["stop_reason", "engine_initiated"] {
            assert!(turn_execute.contains(&field), "{field} is not safe-listed");
        }

        let agent_start = safe_fields(AGENT_START).expect("operation is owned");
        for field in ["agent_kind", "startup_strategy", "has_system_prompt_append"] {
            assert!(agent_start.contains(&field), "{field} is not safe-listed");
        }
    }

    #[test]
    fn a_cancelled_turn_is_not_a_success_and_a_refusal_is_not_a_failure() {
        assert_eq!(turn_outcome("end_turn"), TerminalOutcomeV1::Succeeded);
        assert_eq!(turn_outcome("max_tokens"), TerminalOutcomeV1::Succeeded);
        assert_eq!(
            turn_outcome("max_turn_requests"),
            TerminalOutcomeV1::Succeeded
        );
        assert_eq!(turn_outcome("cancelled"), TerminalOutcomeV1::Cancelled);
        assert_eq!(turn_outcome("refusal"), TerminalOutcomeV1::Rejected);
    }

    #[test]
    fn an_operation_without_an_installed_producer_is_inert() {
        let operation =
            begin_session_create("workspace", "claude-code", None, false, true, 2, "ui");
        assert!(!operation.operation_id().is_empty());
        operation.succeeded();
    }
}
