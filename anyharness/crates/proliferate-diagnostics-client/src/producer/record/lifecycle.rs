//! The lifecycle half of the record factory.
//!
//! Everything a lifecycle record is allowed to carry is decided here and
//! nowhere else: the operation must be in the closed lifecycle table, every
//! argument name must be in that operation's safe-field list, and the error
//! classification must be in that operation's closed list. Keeping the whole
//! decision in one module is what makes the widening of a lifecycle record a
//! visible edit rather than an accident at a call site.

use proliferate_diagnostics_protocol::v1::{
    limits::{CURRENT_SCHEMA_VERSION, MAX_ARGUMENTS, MAX_RECORD_BYTES, MAX_SAFE_INTEGER},
    types::{
        CanonicalLifecycleV1, LifecyclePhaseV1, ModelMetadataV1, PrivacyClassificationV1,
        ProducerRecordV1, RecordClassV1, RedactionClassificationV1, TerminalOutcomeV1,
        TypedArgumentV1,
    },
    validation::validate_producer_record,
};

use super::{
    filter_value, sanitize_correlation, secret_name, secret_value, valid_id, valid_name,
    DiagnosticInput, PreparedRecord, RecordFactory,
};
use crate::lifecycle::{classifications, safe_fields};
use crate::{LifecycleArgument, LifecycleDiagnosticInput};

impl RecordFactory {
    /// Prepares a lifecycle record.
    ///
    /// Three refusals happen here and nowhere else, so a new call site cannot
    /// widen what a lifecycle record can carry:
    /// 1. the operation must be in this producer's closed lifecycle table;
    /// 2. every argument name must be in that operation's safe-field list;
    /// 3. the error classification must be in that operation's closed list.
    pub(super) fn prepare_lifecycle(
        &self,
        mut input: LifecycleDiagnosticInput,
    ) -> Result<PreparedRecord, ()> {
        let Some(allowed) = safe_fields(&input.name) else {
            return Err(());
        };
        if input.arguments.len() > MAX_ARGUMENTS {
            return Err(());
        }
        input.arguments = input
            .arguments
            .into_iter()
            .filter(|argument| {
                allowed.contains(&argument.name)
                    && valid_name(argument.name)
                    && !secret_name(argument.name)
            })
            .filter_map(|argument| {
                filter_value(argument.value, 1).map(|value| LifecycleArgument {
                    name: argument.name,
                    value,
                })
            })
            .collect();
        let permitted = classifications(&input.name).unwrap_or(&[]);
        input.error_classification = input
            .error_classification
            .filter(|classification| permitted.contains(classification));
        // `validation.rs` refuses a `failed` terminal that carries no
        // classification. Degrade to `abandoned` rather than lose the record,
        // matching what the Tauri supervisor producer already does for the
        // same rule.
        if input.outcome == Some(TerminalOutcomeV1::Failed) && input.error_classification.is_none()
        {
            input.outcome = Some(TerminalOutcomeV1::Abandoned);
        }
        if let Some(model) = input.model.as_mut() {
            if !valid_id(Some(&model.model_id)) || secret_value(&model.model_id) {
                input.model = None;
            } else if model
                .provider_kind
                .as_deref()
                .is_some_and(|kind| !valid_name(kind))
            {
                model.provider_kind = None;
            }
        }
        sanitize_correlation(&mut input.correlation);
        let operation_id = input
            .correlation
            .operation_id
            .clone()
            .filter(|value| valid_id(Some(value)))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        input.correlation.operation_id = Some(operation_id.clone());
        let prepared = PreparedRecord {
            input: DiagnosticInput::Lifecycle(input),
            operation_id,
        };
        let probe = self.build(&prepared, 1)?;
        if serde_json::to_vec(&probe).map_err(|_| ())?.len() > MAX_RECORD_BYTES {
            return Err(());
        }
        Ok(prepared)
    }

    /// Builds a lifecycle record. `privacy` is `operational` unconditionally
    /// and there is no `detailed` payload, so the free-text surface a detailed
    /// record owns does not exist on this path at all.
    pub(super) fn build_lifecycle(
        &self,
        input: &LifecycleDiagnosticInput,
        operation_id: &str,
        producer_sequence: u64,
    ) -> Result<ProducerRecordV1, ()> {
        let correlation = &input.correlation;
        let record = ProducerRecordV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            source_timestamp: chrono::Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            producer_sequence,
            producer_boot_id: self.producer_boot_id.clone(),
            component: self.component.protocol_component(),
            source: self.component.protocol_source(),
            release: self.release.clone(),
            environment: self.environment.clone(),
            operation_id: operation_id.to_owned(),
            parent_operation_id: correlation.parent_operation_id.clone(),
            trace_id: correlation.trace_id.clone(),
            workspace_id: correlation.workspace_id.clone(),
            session_id: correlation.session_id.clone(),
            turn_id: correlation.turn_id.clone(),
            item_id: correlation.item_id.clone(),
            request_id: correlation.request_id.clone(),
            target_id: correlation.target_id.clone(),
            prompt_id: correlation.prompt_id.clone(),
            workflow_id: correlation.workflow_id.clone(),
            name: input.name.to_string(),
            severity: input.severity,
            arguments: input
                .arguments
                .iter()
                .map(|argument| TypedArgumentV1 {
                    name: argument.name.to_owned(),
                    privacy: PrivacyClassificationV1::Operational,
                    value: argument.value.clone(),
                })
                .collect(),
            error_classification: input.error_classification.map(ToOwned::to_owned),
            record_class: RecordClassV1::Lifecycle,
            privacy: PrivacyClassificationV1::Operational,
            redaction: RedactionClassificationV1::None,
            detailed: None,
            lifecycle: Some(CanonicalLifecycleV1 {
                phase: input.phase,
                outcome: match input.phase {
                    LifecyclePhaseV1::Started => None,
                    LifecyclePhaseV1::Terminal => {
                        Some(input.outcome.unwrap_or(TerminalOutcomeV1::Abandoned))
                    }
                },
                finalizer: input.finalizer,
                model: input.model.as_ref().map(|model| ModelMetadataV1 {
                    model_id: model.model_id.clone(),
                    provider_kind: model.provider_kind.as_ref().map(ToString::to_string),
                    phase: None,
                    input_tokens: model
                        .input_tokens
                        .filter(|value| *value <= MAX_SAFE_INTEGER),
                    output_tokens: model
                        .output_tokens
                        .filter(|value| *value <= MAX_SAFE_INTEGER),
                    duration_ms: model.duration_ms.filter(|value| *value <= MAX_SAFE_INTEGER),
                }),
                plugin: None,
            }),
        };
        validate_producer_record(&record).map_err(|_| ())?;
        if serde_json::to_vec(&record).map_err(|_| ())?.len() > MAX_RECORD_BYTES {
            return Err(());
        }
        Ok(record)
    }
}
