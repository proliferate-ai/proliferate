use std::{collections::BTreeMap, fmt};

use proliferate_diagnostics_protocol::v1::{
    limits::{MAX_ARGUMENTS, MAX_SAFE_INTEGER, MAX_STRING_BYTES},
    types::ArgumentValueV1,
};
use tracing::field::{Field, Visit};

use crate::{DiagnosticArgument, DiagnosticCorrelation, DiagnosticPrivacy};

use super::promotions::PromotionCandidates;

const RESERVED_FIELD_SLOTS: usize = 16;
const MAX_CAPTURED_FIELDS: usize = MAX_ARGUMENTS + RESERVED_FIELD_SLOTS;
const TRUNCATION_MARKER: &str = "...[truncated]";
const VISITOR_WORK_BYTES: usize = MAX_STRING_BYTES + 8_192;

#[derive(Clone, Default)]
pub(super) struct CollectedFields {
    values: BTreeMap<String, ArgumentValueV1>,
    promotions: PromotionCandidates,
    dropped: usize,
}

impl CollectedFields {
    pub(super) fn extend(&mut self, other: Self) {
        self.promotions.override_from(&other.promotions);
        self.dropped = self.dropped.saturating_add(other.dropped);
        for (name, value) in other.values {
            self.insert(name, value, true);
        }
    }

    /// Merges a nearest-to-farthest span without cloning an entire ancestor
    /// map or letting a farther span overwrite an explicit nearer field.
    pub(super) fn extend_missing(&mut self, other: &Self) {
        self.promotions.fill_missing_from(&other.promotions);
        self.dropped = self.dropped.saturating_add(other.dropped);
        for (name, value) in &other.values {
            if !self.values.contains_key(name) {
                self.insert(name.clone(), value.clone(), false);
            }
        }
    }

    pub(super) fn is_full(&self) -> bool {
        self.values.len() >= MAX_CAPTURED_FIELDS
    }

    pub(super) fn note_dropped(&mut self) {
        self.dropped = self.dropped.saturating_add(1);
    }

    pub(super) fn take_message(&mut self) -> Option<String> {
        match self.values.remove("message") {
            Some(ArgumentValueV1::String(value)) => Some(value),
            Some(value) => Some(render_value(&value)),
            None => None,
        }
    }

    pub(super) fn take_error_classification(&mut self) -> Option<String> {
        self.promotions.take_error_classification(&mut self.values)
    }

    pub(super) fn take_correlation(&mut self) -> DiagnosticCorrelation {
        self.promotions.take_correlation(&mut self.values)
    }

    pub(super) fn into_arguments(mut self) -> Vec<DiagnosticArgument> {
        if self.dropped > 0 {
            self.values.insert(
                "diagnostics.fields_truncated".to_owned(),
                ArgumentValueV1::Integer(i64::try_from(self.dropped).unwrap_or(i64::MAX)),
            );
        }
        self.values
            .into_iter()
            .map(|(name, value)| DiagnosticArgument {
                privacy: if operational_name(&name) {
                    DiagnosticPrivacy::Operational
                } else {
                    DiagnosticPrivacy::Sensitive
                },
                name: name.into(),
                value,
            })
            .collect()
    }

    fn insert(&mut self, name: String, value: ArgumentValueV1, replace: bool) {
        if self.values.contains_key(&name) {
            if replace {
                self.values.insert(name, value);
            }
        } else if self.values.len() < MAX_CAPTURED_FIELDS {
            self.values.insert(name, value);
        } else {
            self.dropped = self.dropped.saturating_add(1);
        }
    }
}

#[derive(Default)]
pub(super) struct FieldVisitor {
    fields: CollectedFields,
}

impl FieldVisitor {
    pub(super) fn finish(mut self) -> CollectedFields {
        self.fields.refresh_promotions();
        self.fields
    }

    fn insert(&mut self, field: &Field, value: ArgumentValueV1) {
        self.fields.insert(field.name().to_owned(), value, true);
    }
}

impl CollectedFields {
    fn refresh_promotions(&mut self) {
        self.promotions = PromotionCandidates::from_values(&self.values);
    }
}

impl Visit for FieldVisitor {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.insert(field, ArgumentValueV1::Boolean(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        if value.unsigned_abs() <= MAX_SAFE_INTEGER {
            self.insert(field, ArgumentValueV1::Integer(value));
        }
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        if value <= MAX_SAFE_INTEGER {
            self.insert(field, ArgumentValueV1::Integer(value as i64));
        }
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        if value.is_finite() {
            self.insert(field, ArgumentValueV1::Float(value));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.insert(field, ArgumentValueV1::String(bound_str(value)));
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.insert(field, ArgumentValueV1::String(bound_display(value)));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.insert(field, ArgumentValueV1::String(bound_debug(value)));
    }
}

fn bound_str(value: &str) -> String {
    let mut boundary = value.len().min(VISITOR_WORK_BYTES);
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    crate::producer::record::redact_and_bound(value[..boundary].to_owned(), MAX_STRING_BYTES)
}

fn bound_display(value: &dyn fmt::Display) -> String {
    let mut output = BoundedFormatter::default();
    let _ = fmt::write(&mut output, format_args!("{value}"));
    output.finish()
}

fn bound_debug(value: &dyn fmt::Debug) -> String {
    let mut output = BoundedFormatter::default();
    let _ = fmt::write(&mut output, format_args!("{value:?}"));
    output.finish()
}

#[derive(Default)]
struct BoundedFormatter {
    output: String,
    truncated: bool,
}

impl fmt::Write for BoundedFormatter {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        let content_limit = VISITOR_WORK_BYTES - TRUNCATION_MARKER.len();
        let remaining = content_limit.saturating_sub(self.output.len());
        if value.len() <= remaining {
            self.output.push_str(value);
            return Ok(());
        }
        let mut boundary = remaining;
        while !value.is_char_boundary(boundary) {
            boundary -= 1;
        }
        self.output.push_str(&value[..boundary]);
        self.truncated = true;
        Err(fmt::Error)
    }
}

impl BoundedFormatter {
    fn finish(mut self) -> String {
        if self.truncated {
            self.output.push_str(TRUNCATION_MARKER);
        }
        crate::producer::record::redact_and_bound(self.output, MAX_STRING_BYTES)
    }
}

fn render_value(value: &ArgumentValueV1) -> String {
    match value {
        ArgumentValueV1::String(value) | ArgumentValueV1::Enum(value) => value.clone(),
        ArgumentValueV1::Integer(value) => value.to_string(),
        ArgumentValueV1::Float(value) => value.to_string(),
        ArgumentValueV1::Boolean(value) => value.to_string(),
        ArgumentValueV1::List(_) | ArgumentValueV1::Object(_) => "[structured]".to_owned(),
    }
}

fn operational_name(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    [
        "elapsed",
        "duration",
        "count",
        "attempt",
        "retry",
        "status",
        "state",
        "outcome",
        "phase",
        "port",
        "size",
        "bytes",
        "line",
        "column",
        "method",
        "component",
        "subsystem",
        "enabled",
        "active",
        "ready",
        "success",
    ]
    .iter()
    .any(|allowed| normalized == *allowed || normalized.ends_with(&format!("_{allowed}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proliferate_diagnostics_protocol::v1::limits::MAX_ID_BYTES;

    #[test]
    fn formatter_stops_before_allocating_an_unbounded_rendered_value() {
        struct ManyChunks;

        impl fmt::Debug for ManyChunks {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                for _ in 0..1_000_000 {
                    formatter.write_str("0123456789")?;
                }
                Ok(())
            }
        }

        let rendered = bound_debug(&ManyChunks);
        assert_eq!(rendered.len(), MAX_STRING_BYTES);
        assert!(rendered.ends_with(TRUNCATION_MARKER));
    }

    #[test]
    fn string_debug_and_error_redact_secrets_crossing_the_output_cutoff() {
        #[derive(Debug)]
        struct CanaryDebug(String);
        #[derive(Debug)]
        struct CanaryError(String);
        impl fmt::Display for CanaryError {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }
        impl std::error::Error for CanaryError {}

        let value = format!(
            "{}ghp_abcdefghijklmnopqrstuvwxyz123456",
            "x".repeat(MAX_STRING_BYTES - 8)
        );
        for retained in [
            bound_str(&value),
            bound_debug(&CanaryDebug(value.clone())),
            bound_display(&CanaryError(value)),
        ] {
            assert!(retained.len() <= MAX_STRING_BYTES);
            assert!(!retained.contains("ghp_"));
        }
    }

    #[test]
    fn field_and_ancestor_merges_are_capped_with_structural_evidence() {
        let mut nearest = CollectedFields::default();
        for index in 0..(MAX_CAPTURED_FIELDS + 20) {
            nearest.insert(
                format!("field.{index}"),
                ArgumentValueV1::Integer(index as i64),
                true,
            );
        }
        let mut ancestor = CollectedFields::default();
        ancestor.insert(
            "far.ancestor".to_owned(),
            ArgumentValueV1::Boolean(true),
            true,
        );
        nearest.extend_missing(&ancestor);

        assert!(nearest.is_full());
        let arguments = nearest.into_arguments();
        assert!(arguments
            .iter()
            .any(|argument| argument.name == "diagnostics.fields_truncated"));
        assert!(!arguments
            .iter()
            .any(|argument| argument.name == "far.ancestor"));
    }

    #[test]
    fn exact_full_nearest_map_marks_an_unvisited_farther_ancestor() {
        let mut nearest = CollectedFields::default();
        for index in 0..MAX_CAPTURED_FIELDS {
            nearest.insert(
                format!("a.{index}"),
                ArgumentValueV1::Integer(index as i64),
                true,
            );
        }
        assert_eq!(nearest.dropped, 0);
        nearest.note_dropped();

        let bounded = crate::tracing_layer::bound_tracing_arguments(nearest.into_arguments());
        assert_eq!(bounded.len(), MAX_ARGUMENTS);
        assert!(bounded
            .iter()
            .any(|argument| argument.name == "diagnostics.fields_truncated"));
        assert!(bounded
            .iter()
            .any(|argument| argument.name == "diagnostics.arguments_truncated"));
    }

    #[test]
    fn only_valid_nonsecret_correlation_and_classification_are_promoted() {
        let mut fields = CollectedFields::default();
        fields.insert(
            "operation_id".to_owned(),
            ArgumentValueV1::String("operation-1".to_owned()),
            true,
        );
        fields.insert(
            "trace_id".to_owned(),
            ArgumentValueV1::String("ghp_abcdefghijklmnopqrstuvwxyz123456".to_owned()),
            true,
        );
        fields.insert(
            "session_id".to_owned(),
            ArgumentValueV1::String("x".repeat(MAX_ID_BYTES + 1)),
            true,
        );
        fields.insert(
            "error_classification".to_owned(),
            ArgumentValueV1::String("Invalid Classification".to_owned()),
            true,
        );
        fields.refresh_promotions();

        let correlation = fields.take_correlation();
        assert_eq!(correlation.operation_id.as_deref(), Some("operation-1"));
        assert!(correlation.trace_id.is_none());
        assert!(correlation.session_id.is_none());
        assert!(fields.take_error_classification().is_none());
        let arguments = fields.into_arguments();
        assert!(arguments.iter().any(|argument| argument.name == "trace_id"));
        assert!(arguments
            .iter()
            .any(|argument| argument.name == "session_id"));
        assert!(arguments
            .iter()
            .any(|argument| argument.name == "error_classification"));
    }

    #[test]
    fn aliases_use_event_then_nearest_valid_precedence() {
        let mut farther = CollectedFields::default();
        farther.insert(
            "operation_id".to_owned(),
            ArgumentValueV1::String("farther-operation".to_owned()),
            true,
        );
        farther.insert(
            "error_classification".to_owned(),
            ArgumentValueV1::String("farther.failure".to_owned()),
            true,
        );
        farther.refresh_promotions();

        let mut nearest = CollectedFields::default();
        nearest.insert(
            "measurement_operation_id".to_owned(),
            ArgumentValueV1::String("nearest-measurement".to_owned()),
            true,
        );
        nearest.insert(
            "error_classification".to_owned(),
            ArgumentValueV1::String("nearest.failure".to_owned()),
            true,
        );
        nearest.refresh_promotions();
        nearest.extend_missing(&farther);
        let mut before_event = nearest.clone();
        assert_eq!(
            before_event.take_correlation().operation_id.as_deref(),
            Some("nearest-measurement")
        );
        assert_eq!(
            before_event.take_error_classification().as_deref(),
            Some("nearest.failure")
        );

        let mut event = CollectedFields::default();
        event.insert(
            "measurement_operation_id".to_owned(),
            ArgumentValueV1::String("event-operation".to_owned()),
            true,
        );
        event.insert(
            "error_classification".to_owned(),
            ArgumentValueV1::String("event.failure".to_owned()),
            true,
        );
        event.refresh_promotions();
        nearest.extend(event);
        assert_eq!(
            nearest.take_correlation().operation_id.as_deref(),
            Some("event-operation")
        );
        assert_eq!(
            nearest.take_error_classification().as_deref(),
            Some("event.failure")
        );
    }

    #[test]
    fn invalid_nearer_candidates_remain_arguments_without_blocking_farther_valid_values() {
        let mut farther = CollectedFields::default();
        farther.insert(
            "operation_id".to_owned(),
            ArgumentValueV1::String("farther-operation".to_owned()),
            true,
        );
        farther.insert(
            "error_classification".to_owned(),
            ArgumentValueV1::String("farther.failure".to_owned()),
            true,
        );
        farther.refresh_promotions();

        let mut nearest = CollectedFields::default();
        nearest.insert(
            "measurement_operation_id".to_owned(),
            ArgumentValueV1::String("ghp_abcdefghijklmnopqrstuvwxyz123456".to_owned()),
            true,
        );
        nearest.insert(
            "error_classification".to_owned(),
            ArgumentValueV1::String("Invalid Classification".to_owned()),
            true,
        );
        nearest.refresh_promotions();
        nearest.extend_missing(&farther);

        assert_eq!(
            nearest.take_correlation().operation_id.as_deref(),
            Some("farther-operation")
        );
        assert_eq!(
            nearest.take_error_classification().as_deref(),
            Some("farther.failure")
        );
        let arguments = nearest.into_arguments();
        assert!(arguments
            .iter()
            .any(|argument| argument.name == "measurement_operation_id"));
        assert!(arguments
            .iter()
            .any(|argument| argument.name == "error_classification"));
    }
}
