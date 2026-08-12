//! Precedence-safe extraction of typed tracing promotion fields.

use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::{limits::MAX_ID_BYTES, types::ArgumentValueV1};

use crate::DiagnosticCorrelation;

const CORRELATION_FIELDS: [&str; 11] = [
    "operation_id",
    "parent_operation_id",
    "trace_id",
    "workspace_id",
    "session_id",
    "turn_id",
    "item_id",
    "request_id",
    "target_id",
    "prompt_id",
    "workflow_id",
];

#[derive(Clone)]
struct Candidate {
    source: &'static str,
    value: String,
}

#[derive(Clone, Default)]
pub(super) struct PromotionCandidates {
    correlations: BTreeMap<&'static str, Candidate>,
    error_classification: Option<Candidate>,
}

impl PromotionCandidates {
    pub(super) fn from_values(values: &BTreeMap<String, ArgumentValueV1>) -> Self {
        let mut output = Self::default();
        for logical in CORRELATION_FIELDS {
            let candidate = if logical == "operation_id" {
                valid_id(values, "operation_id")
                    .or_else(|| valid_id(values, "measurement_operation_id"))
            } else {
                valid_id(values, logical)
            };
            if let Some(candidate) = candidate {
                output.correlations.insert(logical, candidate);
            }
        }
        output.error_classification = values
            .get("error_classification")
            .and_then(string_value)
            .filter(|value| {
                crate::producer::record::valid_name(value)
                    && !crate::producer::record::secret_value(value)
            })
            .map(|value| Candidate {
                source: "error_classification",
                value: value.to_owned(),
            });
        output
    }

    /// Nearest-to-farthest merge: the first valid candidate owns a logical
    /// field. Invalid nearer values are absent here and cannot claim it.
    pub(super) fn fill_missing_from(&mut self, other: &Self) {
        for (logical, candidate) in &other.correlations {
            self.correlations
                .entry(*logical)
                .or_insert_with(|| candidate.clone());
        }
        if self.error_classification.is_none() {
            self.error_classification = other.error_classification.clone();
        }
    }

    /// Event/update merge: only a valid candidate overrides a span/prior
    /// candidate. Invalid evidence remains in the ordinary bounded map.
    pub(super) fn override_from(&mut self, other: &Self) {
        self.correlations.extend(
            other
                .correlations
                .iter()
                .map(|(logical, candidate)| (*logical, candidate.clone())),
        );
        if other.error_classification.is_some() {
            self.error_classification = other.error_classification.clone();
        }
    }

    pub(super) fn take_correlation(
        &mut self,
        values: &mut BTreeMap<String, ArgumentValueV1>,
    ) -> DiagnosticCorrelation {
        let mut output = DiagnosticCorrelation::default();
        output.operation_id = self.take_id("operation_id", values);
        output.parent_operation_id = self.take_id("parent_operation_id", values);
        output.trace_id = self.take_id("trace_id", values);
        output.workspace_id = self.take_id("workspace_id", values);
        output.session_id = self.take_id("session_id", values);
        output.turn_id = self.take_id("turn_id", values);
        output.item_id = self.take_id("item_id", values);
        output.request_id = self.take_id("request_id", values);
        output.target_id = self.take_id("target_id", values);
        output.prompt_id = self.take_id("prompt_id", values);
        output.workflow_id = self.take_id("workflow_id", values);
        output
    }

    pub(super) fn take_error_classification(
        &mut self,
        values: &mut BTreeMap<String, ArgumentValueV1>,
    ) -> Option<String> {
        let candidate = self.error_classification.take()?;
        remove_if_matching(values, candidate.source, &candidate.value);
        Some(candidate.value)
    }

    fn take_id(
        &mut self,
        logical: &'static str,
        values: &mut BTreeMap<String, ArgumentValueV1>,
    ) -> Option<String> {
        let candidate = self.correlations.remove(logical)?;
        let aliases: &[&str] = if logical == "operation_id" {
            &["operation_id", "measurement_operation_id"]
        } else {
            &[logical]
        };
        // Valid losing aliases are correlation context, not arguments.
        // Invalid aliases intentionally remain as bounded sensitive evidence.
        for alias in aliases {
            if values
                .get(*alias)
                .and_then(string_value)
                .is_some_and(valid_id_value)
            {
                values.remove(*alias);
            }
        }
        Some(candidate.value)
    }
}

fn valid_id(values: &BTreeMap<String, ArgumentValueV1>, source: &'static str) -> Option<Candidate> {
    values
        .get(source)
        .and_then(string_value)
        .filter(|value| valid_id_value(value))
        .map(|value| Candidate {
            source,
            value: value.to_owned(),
        })
}

fn valid_id_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && !crate::producer::record::secret_value(value)
}

fn string_value(value: &ArgumentValueV1) -> Option<&str> {
    match value {
        ArgumentValueV1::String(value) | ArgumentValueV1::Enum(value) => Some(value),
        _ => None,
    }
}

fn remove_if_matching(
    values: &mut BTreeMap<String, ArgumentValueV1>,
    source: &str,
    expected: &str,
) {
    if values
        .get(source)
        .and_then(string_value)
        .is_some_and(|value| value == expected)
    {
        values.remove(source);
    }
}
