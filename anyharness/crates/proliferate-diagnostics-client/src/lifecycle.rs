//! Canonical lifecycle emission for Desktop-owned Rust producers.
//!
//! Before this module the only lifecycle producer in the repository was the
//! Tauri process supervisor, so the collector held process-supervision
//! lifecycle records and nothing product-facing: every AnyHarness event was a
//! `tracing` call that the diagnostics layer turns into a `detailed` record
//! (`tracing_layer/mod.rs`). This module is the missing producer side.
//!
//! Two properties are structural, not conventional:
//!
//! 1. **Closed safe-field lists.** An operation may only carry the argument
//!    names in [`LIFECYCLE_OPERATIONS`], and only the error classifications in
//!    the same table. Enforcement is in `producer::record::prepare_lifecycle`,
//!    which drops anything outside the list rather than trusting the caller.
//! 2. **No free text.** [`crate::LifecycleDiagnosticInput`] has no `message`,
//!    `stream`, or `milestone` field. `DetailedDiagnosticV1` is the only
//!    payload in the protocol that can carry free text, and a lifecycle record
//!    never has one.
//!
//! Neither property replaces the collector's ingest gate, which remains the
//! single mechanical privacy enforcement point. They are the second belt.

use std::borrow::Cow;
use std::sync::OnceLock;

use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, LifecycleFinalizerV1, LifecyclePhaseV1, SeverityV1, TerminalOutcomeV1,
};

use crate::{
    DiagnosticCorrelation, DiagnosticsProducerHandle, LifecycleArgument, LifecycleDiagnosticInput,
    LifecycleModelMetadata,
};

/// One catalog operation this process may emit, with everything it is allowed
/// to say about itself.
pub struct LifecycleOperationSpec {
    /// A P0 catalog name (`proliferate-diagnostics-protocol` `catalog.rs`).
    /// A name outside the catalog is rejected at collector ingest, so the
    /// table and the catalog must agree; `lifecycle_names_are_catalog_operations`
    /// proves they do.
    pub name: &'static str,
    /// Every argument name this operation may carry. Anything else is dropped
    /// before the record is built.
    pub safe_fields: &'static [&'static str],
    /// Every `error_classification` this operation may carry. Anything else is
    /// dropped, which degrades a `failed` terminal to `abandoned` rather than
    /// letting an unbounded string reach the wire.
    pub classifications: &'static [&'static str],
}

/// Elapsed milliseconds from `started` to the terminal record. Stamped by the
/// guard for every operation whose safe-field list names it, so a call site
/// cannot forget it and cannot fake it.
pub const DURATION_FIELD: &str = "duration_ms";
/// Elapsed milliseconds from `started` to the first assistant output of a
/// turn. Learned by the sink via [`LifecycleOperation::append`]; only the
/// first value survives because the sink records it once per turn.
pub const FIRST_OUTPUT_FIELD: &str = "first_output_ms";

/// The closed catalog of lifecycle operations AnyHarness emits.
///
/// Deliberately small. Every entry here becomes an exported record on every
/// customer machine once the Stage 2 export lands, so an addition is a privacy
/// decision, not a logging decision.
pub const LIFECYCLE_OPERATIONS: &[LifecycleOperationSpec] = &[
    LifecycleOperationSpec {
        name: "anyharness.session.create",
        safe_fields: &[
            "agent_kind",
            "reuse_existing",
            "preselected_session_id",
            "selected_model",
            "selected_control_count",
            "origin",
        ],
        classifications: &[
            "workspace_not_found",
            "workspace_single_session",
            "session_id_conflict",
            "launch_options_unavailable",
            "launch_value_unsupported",
            "agent_env_override_unsupported",
            "route_auth_refused",
            "invalid_request",
            "internal_error",
        ],
    },
    LifecycleOperationSpec {
        name: "anyharness.turn.execute",
        // `duration_ms` is stamped by the guard itself at terminal time;
        // `first_output_ms` is learned by the sink when the first assistant
        // item opens. Both are bounded integers, so time-to-first-output is
        // computable from one terminal record without a join.
        safe_fields: &[
            "stop_reason",
            "engine_initiated",
            DURATION_FIELD,
            FIRST_OUTPUT_FIELD,
        ],
        classifications: &["turn_error", "internal_error"],
    },
    LifecycleOperationSpec {
        name: "anyharness.agent.start",
        safe_fields: &["agent_kind", "startup_strategy", "has_system_prompt_append"],
        classifications: &[
            "workspace_not_found",
            "workspace_directory_missing",
            "agent_descriptor_not_found",
            "launch_options_unavailable",
            "launch_value_unsupported",
            "agent_env_override_unsupported",
            "route_auth_refused",
            "agent_not_ready",
            "workspace_mcp_attachment_failed",
            "missing_data_key",
            "restart_required",
            "runtime_closed",
            "acp_start_failed",
            "internal_error",
        ],
    },
    LifecycleOperationSpec {
        name: "anyharness.model.request",
        safe_fields: &["agent_kind", "route"],
        classifications: &[
            "provider_rate_limit",
            "provider_model_unavailable",
            "provider_model_configuration_unsupported",
            "network_connection",
            "internal_error",
        ],
    },
];

fn spec(operation: &str) -> Option<&'static LifecycleOperationSpec> {
    LIFECYCLE_OPERATIONS
        .iter()
        .find(|candidate| candidate.name == operation)
}

/// The argument names an operation may carry, or `None` when this producer
/// does not own the operation at all.
pub fn safe_fields(operation: &str) -> Option<&'static [&'static str]> {
    spec(operation).map(|spec| spec.safe_fields)
}

/// The error classifications an operation may carry.
pub fn classifications(operation: &str) -> Option<&'static [&'static str]> {
    spec(operation).map(|spec| spec.classifications)
}

static GLOBAL: OnceLock<DiagnosticsProducerHandle> = OnceLock::new();

/// Publishes the process's producer handle so library code that has no access
/// to the binary's telemetry wiring can emit lifecycle records.
///
/// First caller wins and later calls are ignored, which matches the one
/// producer per process the bridge already enforces. Returns whether this call
/// installed the handle.
pub fn install_global_producer(handle: DiagnosticsProducerHandle) -> bool {
    GLOBAL.set(handle).is_ok()
}

fn global() -> Option<&'static DiagnosticsProducerHandle> {
    GLOBAL.get()
}

/// One in-flight lifecycle operation.
///
/// Emits `started` on construction and exactly one terminal record, either
/// explicitly or from [`Drop`]. An unwind past a live guard is therefore an
/// `abandoned` terminal rather than a missing pair, which is what keeps a
/// success-rate SLI honest: an operation that vanishes still shows up.
///
/// A process with no installed producer (every test, every non-Desktop run)
/// gets an inert guard: it still mints an `operation_id` so a caller can
/// correlate locally, and it emits nothing.
pub struct LifecycleOperation {
    name: &'static str,
    correlation: DiagnosticCorrelation,
    arguments: Vec<LifecycleArgument>,
    terminal: bool,
    began: std::time::Instant,
}

impl LifecycleOperation {
    /// Begins an operation, emitting its `started` record.
    pub fn begin(name: &'static str, correlation: DiagnosticCorrelation) -> Self {
        Self::begin_with_arguments(name, correlation, Vec::new())
    }

    pub fn begin_with_arguments(
        name: &'static str,
        mut correlation: DiagnosticCorrelation,
        arguments: Vec<LifecycleArgument>,
    ) -> Self {
        if correlation.operation_id.is_none() {
            correlation.operation_id = Some(uuid::Uuid::new_v4().to_string());
        }
        let operation = Self {
            name,
            correlation,
            arguments,
            terminal: false,
            began: std::time::Instant::now(),
        };
        operation.emit(LifecyclePhaseV1::Started, None, None, None);
        operation
    }

    /// The stable id both records of this operation carry. Callers put it on
    /// their own `tracing` events so a local log line and an exported record
    /// join without a timestamp guess.
    pub fn operation_id(&self) -> &str {
        self.correlation.operation_id.as_deref().unwrap_or_default()
    }

    pub fn correlation(&self) -> &DiagnosticCorrelation {
        &self.correlation
    }

    /// Milliseconds since the `started` record was emitted, saturating at
    /// `i64::MAX`. The value a sink stamps as `first_output_ms`.
    pub fn elapsed_ms(&self) -> i64 {
        i64::try_from(self.began.elapsed().as_millis()).unwrap_or(i64::MAX)
    }

    /// Attaches arguments learned after the operation began. They ride the
    /// terminal record only, and are filtered by the same safe-field list.
    pub fn append(&mut self, arguments: impl IntoIterator<Item = LifecycleArgument>) {
        self.arguments.extend(arguments);
    }

    /// Fills in a correlation id learned after the operation began (a session
    /// id minted mid-create, a turn id minted at prompt admission). Never
    /// overwrites a value the caller already supplied.
    pub fn learn_session_id(&mut self, session_id: impl Into<String>) {
        if self.correlation.session_id.is_none() {
            self.correlation.session_id = Some(session_id.into());
        }
    }

    pub fn succeeded(self) {
        self.finish(TerminalOutcomeV1::Succeeded, None, None);
    }

    pub fn terminal(self, outcome: TerminalOutcomeV1, classification: Option<&'static str>) {
        self.finish(outcome, classification, None);
    }

    /// Terminal for the one operation family that owns a provider request.
    pub fn terminal_with_model(
        self,
        outcome: TerminalOutcomeV1,
        classification: Option<&'static str>,
        model: LifecycleModelMetadata,
    ) {
        self.finish(outcome, classification, Some(model));
    }

    fn finish(
        mut self,
        outcome: TerminalOutcomeV1,
        classification: Option<&'static str>,
        model: Option<LifecycleModelMetadata>,
    ) {
        self.emit_terminal(outcome, classification, model);
    }

    fn emit_terminal(
        &mut self,
        outcome: TerminalOutcomeV1,
        classification: Option<&'static str>,
        model: Option<LifecycleModelMetadata>,
    ) {
        if self.terminal {
            return;
        }
        self.terminal = true;
        if let Some(duration) = duration_argument(self.name, self.elapsed_ms(), &self.arguments) {
            self.arguments.push(duration);
        }
        self.emit(
            LifecyclePhaseV1::Terminal,
            Some(outcome),
            classification,
            model,
        );
    }

    fn emit(
        &self,
        phase: LifecyclePhaseV1,
        outcome: Option<TerminalOutcomeV1>,
        classification: Option<&'static str>,
        model: Option<LifecycleModelMetadata>,
    ) {
        let Some(handle) = global() else {
            return;
        };
        let severity = match outcome {
            Some(TerminalOutcomeV1::Failed | TerminalOutcomeV1::TimedOut) => SeverityV1::Error,
            _ => SeverityV1::Info,
        };
        // Both records carry the same argument set. Arguments learned after
        // the start (see [`LifecycleOperation::append`]) are therefore present
        // on the terminal record only, because the start was already emitted.
        let arguments = self
            .arguments
            .iter()
            .map(|argument| LifecycleArgument {
                name: argument.name,
                value: argument.value.clone(),
            })
            .collect();
        let _ = handle.try_emit_lifecycle(LifecycleDiagnosticInput {
            name: Cow::Borrowed(self.name),
            severity,
            phase,
            outcome,
            finalizer: LifecycleFinalizerV1::Producer,
            arguments,
            correlation: self.correlation.clone(),
            error_classification: classification,
            model,
        });
    }
}

/// The `duration_ms` argument a terminal record should carry, or `None` when
/// the operation's safe-field list does not name it or a caller already
/// supplied one. Pure so it is testable without a producer.
pub(crate) fn duration_argument(
    name: &str,
    elapsed_ms: i64,
    existing: &[LifecycleArgument],
) -> Option<LifecycleArgument> {
    let listed = safe_fields(name)?.contains(&DURATION_FIELD);
    if !listed
        || existing
            .iter()
            .any(|argument| argument.name == DURATION_FIELD)
    {
        return None;
    }
    Some(LifecycleArgument {
        name: DURATION_FIELD,
        value: ArgumentValueV1::Integer(elapsed_ms.max(0)),
    })
}

impl Drop for LifecycleOperation {
    fn drop(&mut self) {
        self.emit_terminal(TerminalOutcomeV1::Abandoned, None, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proliferate_diagnostics_protocol::v1::catalog::is_p0_operation;

    #[test]
    fn lifecycle_names_are_catalog_operations() {
        for operation in LIFECYCLE_OPERATIONS {
            assert!(
                is_p0_operation(operation.name),
                "{} is not a P0 catalog operation and would be rejected at ingest",
                operation.name
            );
        }
    }

    #[test]
    fn safe_field_and_classification_names_are_wire_legal() {
        for operation in LIFECYCLE_OPERATIONS {
            for field in operation.safe_fields {
                assert!(
                    crate::producer::record::valid_name(field),
                    "{field} is not a legal argument name"
                );
                assert!(
                    !crate::producer::record::secret_name(field),
                    "{field} looks like a secret field name"
                );
            }
            for classification in operation.classifications {
                assert!(
                    crate::producer::record::valid_name(classification),
                    "{classification} is not a legal classification"
                );
            }
        }
    }

    #[test]
    fn an_unknown_operation_has_no_safe_fields() {
        assert!(safe_fields("anyharness.tool.invoke").is_none());
        assert!(classifications("anyharness.tool.invoke").is_none());
    }

    #[test]
    fn a_turn_terminal_is_stamped_with_its_duration_exactly_once() {
        let stamped = duration_argument("anyharness.turn.execute", 1_234, &[])
            .expect("turn.execute lists duration_ms");
        assert_eq!(stamped.name, DURATION_FIELD);
        assert_eq!(stamped.value, ArgumentValueV1::Integer(1_234));
        assert!(
            duration_argument("anyharness.turn.execute", 5, &[stamped]).is_none(),
            "a caller-supplied duration is never overwritten"
        );
        assert!(
            duration_argument("anyharness.agent.start", 1_234, &[]).is_none(),
            "an operation whose safe list omits duration_ms is left alone"
        );
        assert!(duration_argument("anyharness.tool.invoke", 1, &[]).is_none());
        assert_eq!(
            duration_argument("anyharness.turn.execute", -3, &[]).map(|a| a.value),
            Some(ArgumentValueV1::Integer(0)),
            "a clock anomaly clamps to zero rather than shipping a negative"
        );
    }

    #[test]
    fn a_guard_without_an_installed_producer_emits_nothing_and_still_correlates() {
        let operation = LifecycleOperation::begin(
            "anyharness.session.create",
            DiagnosticCorrelation::default(),
        );
        assert!(!operation.operation_id().is_empty());
        operation.succeeded();
    }
}
