use std::{collections::BTreeMap, fmt};

use proliferate_diagnostics_protocol::v1::{
    limits::{MAX_ID_BYTES, MAX_SAFE_INTEGER, MAX_STRING_BYTES},
    types::ArgumentValueV1,
};
use tracing::field::{Field, Visit};

use crate::{DiagnosticArgument, DiagnosticCorrelation, DiagnosticPrivacy};

#[derive(Clone, Default)]
pub(super) struct CollectedFields {
    values: BTreeMap<String, ArgumentValueV1>,
}

impl CollectedFields {
    pub(super) fn extend(&mut self, other: Self) {
        self.values.extend(other.values);
    }

    pub(super) fn take_message(&mut self) -> Option<String> {
        match self.values.remove("message") {
            Some(ArgumentValueV1::String(value)) => Some(value),
            Some(value) => Some(render_value(&value)),
            None => None,
        }
    }

    pub(super) fn take_error_classification(&mut self) -> Option<String> {
        let value = self.values.remove("error_classification")?;
        let value = match value {
            ArgumentValueV1::String(value) | ArgumentValueV1::Enum(value) => value,
            _ => return None,
        };
        crate::producer::record::valid_name(&value).then_some(value)
    }

    pub(super) fn correlation(&self) -> DiagnosticCorrelation {
        let mut output = DiagnosticCorrelation::default();
        output.operation_id = self
            .id("operation_id")
            .or_else(|| self.id("measurement_operation_id"));
        output.parent_operation_id = self.id("parent_operation_id");
        output.trace_id = self.id("trace_id");
        output.workspace_id = self.id("workspace_id");
        output.session_id = self.id("session_id");
        output.turn_id = self.id("turn_id");
        output.item_id = self.id("item_id");
        output.request_id = self.id("request_id");
        output.target_id = self.id("target_id");
        output.prompt_id = self.id("prompt_id");
        output.workflow_id = self.id("workflow_id");
        output
    }

    pub(super) fn into_arguments(self) -> Vec<DiagnosticArgument> {
        self.values
            .into_iter()
            .filter(|(name, _)| !is_correlation(name))
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

    fn id(&self, name: &str) -> Option<String> {
        match self.values.get(name) {
            Some(ArgumentValueV1::String(value) | ArgumentValueV1::Enum(value))
                if !value.is_empty() && value.len() <= MAX_ID_BYTES =>
            {
                Some(value.clone())
            }
            _ => None,
        }
    }
}

#[derive(Default)]
pub(super) struct FieldVisitor {
    fields: CollectedFields,
}

impl FieldVisitor {
    pub(super) fn finish(self) -> CollectedFields {
        self.fields
    }

    fn insert(&mut self, field: &Field, value: ArgumentValueV1) {
        self.fields.values.insert(field.name().to_owned(), value);
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
        self.insert(
            field,
            ArgumentValueV1::String(bound_string(value.to_owned())),
        );
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.insert(
            field,
            ArgumentValueV1::String(bound_string(value.to_string())),
        );
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.insert(
            field,
            ArgumentValueV1::String(bound_string(format!("{value:?}"))),
        );
    }
}

fn bound_string(mut value: String) -> String {
    if value.len() <= MAX_STRING_BYTES {
        return value;
    }
    let mut boundary = MAX_STRING_BYTES - "...[truncated]".len();
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str("...[truncated]");
    value
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

fn is_correlation(name: &str) -> bool {
    matches!(
        name,
        "operation_id"
            | "measurement_operation_id"
            | "parent_operation_id"
            | "trace_id"
            | "workspace_id"
            | "session_id"
            | "turn_id"
            | "item_id"
            | "request_id"
            | "target_id"
            | "prompt_id"
            | "workflow_id"
    )
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
