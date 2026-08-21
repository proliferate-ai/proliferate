//! Producer-side proofs for the canonical lifecycle emit path.
//!
//! The collector's ingest gate is the single mechanical privacy enforcement
//! point and these tests do not replace it. What they prove is the second
//! belt: a lifecycle record built here is operational, has no free-text
//! payload at all, and cannot carry a field or a classification outside the
//! operation's closed list, no matter what a call site passes.

use std::borrow::Cow;

use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, LifecycleFinalizerV1, LifecyclePhaseV1, PrivacyClassificationV1,
    ProducerRecordV1, RecordClassV1, SeverityV1, TerminalOutcomeV1,
};

use super::tests_support::{emit_lifecycle, queued_records, unavailable_producer};
use crate::{
    DiagnosticCorrelation, EmitDisposition, LifecycleArgument, LifecycleDiagnosticInput,
    LifecycleModelMetadata,
};

fn started(name: &'static str) -> LifecycleDiagnosticInput {
    LifecycleDiagnosticInput {
        name: Cow::Borrowed(name),
        severity: SeverityV1::Info,
        phase: LifecyclePhaseV1::Started,
        outcome: None,
        finalizer: LifecycleFinalizerV1::Producer,
        arguments: Vec::new(),
        correlation: DiagnosticCorrelation {
            session_id: Some("session-0001".to_owned()),
            workspace_id: Some("workspace-0001".to_owned()),
            ..DiagnosticCorrelation::default()
        },
        error_classification: None,
        model: None,
    }
}

fn terminal(name: &'static str, outcome: TerminalOutcomeV1) -> LifecycleDiagnosticInput {
    LifecycleDiagnosticInput {
        phase: LifecyclePhaseV1::Terminal,
        outcome: Some(outcome),
        ..started(name)
    }
}

#[test]
fn a_lifecycle_record_is_operational_and_carries_no_detailed_payload() {
    let inner = unavailable_producer();
    assert_eq!(
        emit_lifecycle(&inner, started("anyharness.session.create")),
        EmitDisposition::Admitted
    );

    let records = queued_records(&inner);
    let record = records.first().expect("one record");
    assert_eq!(record.record_class, RecordClassV1::Lifecycle);
    assert_eq!(record.privacy, PrivacyClassificationV1::Operational);
    assert!(record.detailed.is_none());
    assert!(record.lifecycle.is_some());
    assert_eq!(record.session_id.as_deref(), Some("session-0001"));
    assert_eq!(record.workspace_id.as_deref(), Some("workspace-0001"));
}

/// The reason a lifecycle-only export is a privacy control and not merely a
/// volume control: `message`, `stream`, and `milestone` are `DetailedDiagnosticV1`
/// fields, and a lifecycle record has no `DetailedDiagnosticV1` at all. Assert
/// it on the serialized bytes, because that is what would go on the wire.
#[test]
fn a_serialized_lifecycle_record_has_no_free_text_field() {
    let inner = unavailable_producer();
    emit_lifecycle(&inner, started("anyharness.turn.execute"));

    let records = queued_records(&inner);
    let encoded = serde_json::to_string(records.first().expect("one record")).expect("serializes");
    for free_text_field in ["\"detailed\"", "\"message\"", "\"stream\"", "\"milestone\""] {
        assert!(
            !encoded.contains(free_text_field),
            "{free_text_field} reached a lifecycle record: {encoded}"
        );
    }
}

/// A call site cannot widen the exported surface by inventing a field name.
/// The negative control is in the same test: a name that IS on the list
/// survives the same call, so this is the list doing the work rather than the
/// argument being dropped for some unrelated reason.
#[test]
fn an_argument_outside_the_safe_field_list_is_dropped_and_a_listed_one_survives() {
    let inner = unavailable_producer();
    let mut input = started("anyharness.session.create");
    input.arguments = vec![
        LifecycleArgument {
            name: "agent_kind",
            value: ArgumentValueV1::Enum("claude-code".to_owned()),
        },
        LifecycleArgument {
            name: "prompt_text",
            value: ArgumentValueV1::String("the user's actual prompt".to_owned()),
        },
    ];
    emit_lifecycle(&inner, input);

    let records = queued_records(&inner);
    let names: Vec<&str> = records
        .first()
        .expect("one record")
        .arguments
        .iter()
        .map(|argument| argument.name.as_str())
        .collect();
    assert_eq!(names, vec!["agent_kind"]);
}

/// `stop_reason` is safe-listed for `anyharness.turn.execute` and not for
/// `anyharness.session.create`. The list is per operation, not global.
#[test]
fn the_safe_field_list_is_per_operation() {
    let inner = unavailable_producer();
    for (operation, expected) in [
        ("anyharness.turn.execute", vec!["stop_reason"]),
        ("anyharness.session.create", Vec::new()),
    ] {
        let mut input = started(operation);
        input.arguments = vec![LifecycleArgument {
            name: "stop_reason",
            value: ArgumentValueV1::Enum("end_turn".to_owned()),
        }];
        emit_lifecycle(&inner, input);
        let records = queued_records(&inner);
        let names: Vec<&str> = records
            .last()
            .expect("a record")
            .arguments
            .iter()
            .map(|argument| argument.name.as_str())
            .collect();
        assert_eq!(names, expected, "for {operation}");
    }
}

/// An operation this producer does not own is refused outright rather than
/// emitted with an empty argument set, so a typo in an operation name is loud.
#[test]
fn an_operation_outside_the_producers_table_is_refused() {
    let inner = unavailable_producer();
    let disposition = emit_lifecycle(&inner, started("anyharness.tool.invoke"));
    assert!(matches!(disposition, EmitDisposition::Dropped(_)));
    assert!(queued_records(&inner).is_empty());
}

/// A classification outside the closed list cannot ride out, and because
/// `validation.rs` refuses a `failed` terminal with no classification, the
/// outcome degrades to `abandoned` instead of the record being lost.
#[test]
fn an_unlisted_classification_is_dropped_and_degrades_the_outcome() {
    let inner = unavailable_producer();
    let mut input = terminal("anyharness.session.create", TerminalOutcomeV1::Failed);
    input.error_classification = Some("sqlite: unable to open /Users/someone/db");
    emit_lifecycle(&inner, input);

    let records = queued_records(&inner);
    let record = records.first().expect("one record");
    assert!(record.error_classification.is_none());
    assert_eq!(
        record.lifecycle.as_ref().expect("lifecycle").outcome,
        Some(TerminalOutcomeV1::Abandoned)
    );
}

#[test]
fn a_listed_classification_survives_and_keeps_the_failed_outcome() {
    let inner = unavailable_producer();
    let mut input = terminal("anyharness.session.create", TerminalOutcomeV1::Failed);
    input.error_classification = Some("internal_error");
    emit_lifecycle(&inner, input);

    let records = queued_records(&inner);
    let record = records.first().expect("one record");
    assert_eq!(
        record.error_classification.as_deref(),
        Some("internal_error")
    );
    assert_eq!(
        record.lifecycle.as_ref().expect("lifecycle").outcome,
        Some(TerminalOutcomeV1::Failed)
    );
}

/// Model metadata is legal only on the operation that owns a provider request.
/// `validation.rs` rejects it anywhere else as `ProhibitedMetadata`, so the
/// record never gets built.
#[test]
fn model_metadata_is_refused_on_an_operation_that_does_not_own_a_provider_request() {
    let inner = unavailable_producer();
    let mut input = terminal("anyharness.session.create", TerminalOutcomeV1::Succeeded);
    input.model = Some(LifecycleModelMetadata {
        model_id: "claude-opus-4-7".to_owned(),
        ..LifecycleModelMetadata::default()
    });
    let disposition = emit_lifecycle(&inner, input);
    assert!(matches!(disposition, EmitDisposition::Dropped(_)));
    assert!(queued_records(&inner).is_empty());
}

#[test]
fn model_metadata_is_accepted_on_the_model_request_operation() {
    let inner = unavailable_producer();
    let mut input = terminal("anyharness.model.request", TerminalOutcomeV1::Succeeded);
    input.model = Some(LifecycleModelMetadata {
        model_id: "claude-opus-4-7".to_owned(),
        provider_kind: Some(Cow::Borrowed("anthropic")),
        input_tokens: Some(1_024),
        output_tokens: Some(256),
        duration_ms: Some(1_500),
    });
    assert_eq!(emit_lifecycle(&inner, input), EmitDisposition::Admitted);

    let records = queued_records(&inner);
    let model = records
        .first()
        .expect("one record")
        .lifecycle
        .as_ref()
        .expect("lifecycle")
        .model
        .as_ref()
        .expect("model metadata");
    assert_eq!(model.model_id, "claude-opus-4-7");
    assert_eq!(model.input_tokens, Some(1_024));
}

/// A secret-looking correlation value is scrubbed by the same sanitizer the
/// detailed path uses, so the lifecycle path inherits the protection rather
/// than opening a second, unguarded door into the wire format.
#[test]
fn a_secret_shaped_correlation_value_is_scrubbed_on_the_lifecycle_path() {
    let inner = unavailable_producer();
    let mut input = started("anyharness.session.create");
    input.correlation.request_id = Some("ghp_0123456789abcdefghijklmnopqrstuvwxyzAB".to_owned());
    emit_lifecycle(&inner, input);

    let records = queued_records(&inner);
    assert!(records.first().expect("one record").request_id.is_none());
}

/// Every record the producer builds is validated with the shared protocol
/// validator before admission, so a lifecycle record that reaches the queue is
/// already ingest-legal.
#[test]
fn every_admitted_lifecycle_record_passes_the_shared_validator() {
    let inner = unavailable_producer();
    emit_lifecycle(&inner, started("anyharness.session.create"));
    emit_lifecycle(
        &inner,
        terminal("anyharness.session.create", TerminalOutcomeV1::Succeeded),
    );
    let records: Vec<ProducerRecordV1> = queued_records(&inner);
    assert_eq!(records.len(), 2);
    for record in &records {
        proliferate_diagnostics_protocol::v1::validation::validate_producer_record(record)
            .expect("record is ingest-legal");
    }
}

/// A started record must not carry an outcome and a terminal record must carry
/// one; `validation.rs` enforces the pairing and the builder honors it.
#[test]
fn phase_and_outcome_stay_paired() {
    let inner = unavailable_producer();
    emit_lifecycle(&inner, started("anyharness.agent.start"));
    emit_lifecycle(
        &inner,
        terminal("anyharness.agent.start", TerminalOutcomeV1::Cancelled),
    );

    let records = queued_records(&inner);
    let first = records[0].lifecycle.as_ref().expect("lifecycle");
    assert_eq!(first.phase, LifecyclePhaseV1::Started);
    assert!(first.outcome.is_none());
    let second = records[1].lifecycle.as_ref().expect("lifecycle");
    assert_eq!(second.phase, LifecyclePhaseV1::Terminal);
    assert_eq!(second.outcome, Some(TerminalOutcomeV1::Cancelled));
}
