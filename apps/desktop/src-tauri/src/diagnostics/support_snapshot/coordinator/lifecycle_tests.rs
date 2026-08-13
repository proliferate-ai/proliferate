use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, LifecyclePhaseV1, ProducerRecordV1, TerminalOutcomeV1,
};

use super::SupportSnapshotCoordinator;

pub(super) fn assert_lifecycle_pair(
    coordinator: &SupportSnapshotCoordinator,
    name: &str,
    item_id: &str,
    parent_operation_id: Option<&str>,
    outcome: TerminalOutcomeV1,
    classification: Option<&str>,
    attempt: Option<u64>,
) {
    assert_lifecycle_operation(
        coordinator,
        name,
        None,
        item_id,
        parent_operation_id,
        outcome,
        classification,
        attempt,
    );
}

#[allow(clippy::too_many_arguments)]
pub(super) fn assert_lifecycle_operation(
    coordinator: &SupportSnapshotCoordinator,
    name: &str,
    operation_id: Option<&str>,
    item_id: &str,
    parent_operation_id: Option<&str>,
    outcome: TerminalOutcomeV1,
    classification: Option<&str>,
    attempt: Option<u64>,
) {
    let snapshot = coordinator.producer.support_lifecycle_snapshot();
    let records = snapshot
        .iter()
        .filter(|record| {
            record.name == name
                && operation_id.is_none_or(|operation_id| record.operation_id == operation_id)
        })
        .collect::<Vec<_>>();
    assert_eq!(records.len(), 2, "exactly one start and terminal");
    assert_eq!(
        records
            .iter()
            .filter(|record| {
                record.lifecycle.as_ref().map(|lifecycle| lifecycle.phase)
                    == Some(LifecyclePhaseV1::Started)
            })
            .count(),
        1,
        "exactly one start"
    );
    assert_eq!(
        records
            .iter()
            .filter(|record| {
                record.lifecycle.as_ref().map(|lifecycle| lifecycle.phase)
                    == Some(LifecyclePhaseV1::Terminal)
            })
            .count(),
        1,
        "exactly one terminal"
    );
    let start = record_with_phase(&records, LifecyclePhaseV1::Started);
    let terminal = record_with_phase(&records, LifecyclePhaseV1::Terminal);
    assert_eq!(start.operation_id, terminal.operation_id);
    if let Some(operation_id) = operation_id {
        assert_eq!(start.operation_id, operation_id);
    }
    for record in [start, terminal] {
        assert_eq!(record.item_id.as_deref(), Some(item_id));
        assert_eq!(record.parent_operation_id.as_deref(), parent_operation_id);
        match attempt {
            Some(attempt) => {
                assert_eq!(record.arguments.len(), 1);
                assert_eq!(record.arguments[0].name, "attempt");
                assert_eq!(
                    record.arguments[0].value,
                    ArgumentValueV1::Integer(attempt as i64)
                );
            }
            None => assert!(record.arguments.is_empty()),
        }
    }
    assert_eq!(start.error_classification, None);
    assert_eq!(
        start
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        None
    );
    assert_eq!(terminal.error_classification.as_deref(), classification);
    assert_eq!(
        terminal
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(outcome)
    );
}

fn record_with_phase<'a>(
    records: &[&'a ProducerRecordV1],
    phase: LifecyclePhaseV1,
) -> &'a ProducerRecordV1 {
    records
        .iter()
        .copied()
        .find(|record| record.lifecycle.as_ref().map(|lifecycle| lifecycle.phase) == Some(phase))
        .expect("lifecycle phase")
}
