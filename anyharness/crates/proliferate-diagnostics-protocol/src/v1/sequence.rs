use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::types::{LifecyclePhaseV1, ProducerRecordV1, RejectionReasonV1};
use super::validation::validate_producer_record;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SequenceDispositionV1 {
    AcceptedStart,
    AcceptedTerminal,
    Duplicate,
    OrphanTerminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SequenceDecisionV1 {
    pub disposition: SequenceDispositionV1,
    pub requires_gap_or_health_violation: bool,
}

#[derive(Debug, Clone)]
struct OperationStateV1 {
    start: Option<ProducerRecordV1>,
    terminal: Option<ProducerRecordV1>,
}

#[derive(Debug, Default)]
pub struct LifecycleSequenceValidatorV1 {
    operations: BTreeMap<String, OperationStateV1>,
}

impl LifecycleSequenceValidatorV1 {
    pub fn apply(
        &mut self,
        record: ProducerRecordV1,
    ) -> Result<SequenceDecisionV1, RejectionReasonV1> {
        validate_producer_record(&record)?;
        let lifecycle = record
            .lifecycle
            .as_ref()
            .ok_or(RejectionReasonV1::InvalidShape)?;
        let operation_id = record.operation_id.clone();

        if let Some(state) = self.operations.get_mut(&operation_id) {
            if let Some(terminal) = &state.terminal {
                if terminal == &record {
                    return Ok(SequenceDecisionV1 {
                        disposition: SequenceDispositionV1::Duplicate,
                        requires_gap_or_health_violation: false,
                    });
                }
                return Err(RejectionReasonV1::ConflictingTerminal);
            }

            if lifecycle.phase == LifecyclePhaseV1::Started {
                if state.start.as_ref() == Some(&record) {
                    return Ok(SequenceDecisionV1 {
                        disposition: SequenceDispositionV1::Duplicate,
                        requires_gap_or_health_violation: false,
                    });
                }
                return Err(RejectionReasonV1::InvalidShape);
            }

            let start = state
                .start
                .as_ref()
                .ok_or(RejectionReasonV1::InvalidShape)?;
            if !same_operation_identity(start, &record) {
                return Err(RejectionReasonV1::InvalidShape);
            }
            state.terminal = Some(record);
            return Ok(SequenceDecisionV1 {
                disposition: SequenceDispositionV1::AcceptedTerminal,
                requires_gap_or_health_violation: false,
            });
        }

        let (state, decision) = match lifecycle.phase {
            LifecyclePhaseV1::Started => (
                OperationStateV1 {
                    start: Some(record),
                    terminal: None,
                },
                SequenceDecisionV1 {
                    disposition: SequenceDispositionV1::AcceptedStart,
                    requires_gap_or_health_violation: false,
                },
            ),
            LifecyclePhaseV1::Terminal => (
                OperationStateV1 {
                    start: None,
                    terminal: Some(record),
                },
                SequenceDecisionV1 {
                    disposition: SequenceDispositionV1::OrphanTerminal,
                    requires_gap_or_health_violation: true,
                },
            ),
        };
        self.operations.insert(operation_id, state);
        Ok(decision)
    }
}

fn same_operation_identity(start: &ProducerRecordV1, terminal: &ProducerRecordV1) -> bool {
    start.operation_id == terminal.operation_id
        && start.producer_boot_id == terminal.producer_boot_id
        && start.component == terminal.component
        && start.source == terminal.source
        && start.name == terminal.name
}
