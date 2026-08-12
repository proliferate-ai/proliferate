use std::{cell::Cell, sync::Arc};

use proliferate_diagnostics_protocol::v1::limits::MAX_ARGUMENTS;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, DetailedKindV1, SeverityV1, StandardStreamV1,
};
use tracing::{span, Event, Subscriber};
use tracing_subscriber::{layer::Context, registry::LookupSpan, Layer};

use crate::{
    DetailedDiagnosticInput, DiagnosticArgument, DiagnosticCorrelation, DiagnosticPrivacy,
    DiagnosticsProducerHandle,
};

mod visitor;

use visitor::{CollectedFields, FieldVisitor};

thread_local! {
    static SUPPRESSED: Cell<bool> = const { Cell::new(false) };
}

#[derive(Clone, Copy, Debug)]
pub struct TargetMapping {
    pub target: &'static str,
    pub name: &'static str,
    pub kind: DetailedKindV1,
    pub stream: Option<StandardStreamV1>,
}

impl TargetMapping {
    pub const fn stdio(target: &'static str, name: &'static str, stream: StandardStreamV1) -> Self {
        Self {
            target,
            name,
            kind: DetailedKindV1::Stdio,
            stream: Some(stream),
        }
    }

    pub const fn span_event(target: &'static str, name: &'static str) -> Self {
        Self {
            target,
            name,
            kind: DetailedKindV1::SpanEvent,
            stream: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct TargetMappingConfig {
    mappings: Vec<TargetMapping>,
}

impl TargetMappingConfig {
    pub fn new(mappings: Vec<TargetMapping>) -> Self {
        Self { mappings }
    }
}

#[derive(Clone)]
pub struct DiagnosticsTracingLayer {
    handle: DiagnosticsProducerHandle,
    mappings: Arc<[TargetMapping]>,
}

#[derive(Default)]
struct SpanFields(CollectedFields);

impl DiagnosticsTracingLayer {
    pub(crate) fn new(handle: DiagnosticsProducerHandle) -> Self {
        Self {
            handle,
            mappings: Arc::from([]),
        }
    }

    pub fn with_target_mappings(mut self, config: TargetMappingConfig) -> Self {
        self.mappings = Arc::from(config.mappings);
        self
    }

    fn mapping_for(&self, target: &str) -> Option<TargetMapping> {
        self.mappings
            .iter()
            .copied()
            .find(|mapping| mapping.target == target)
    }
}

impl<S> Layer<S> for DiagnosticsTracingLayer
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    fn on_new_span(
        &self,
        attributes: &span::Attributes<'_>,
        id: &span::Id,
        context: Context<'_, S>,
    ) {
        if suppressed() {
            return;
        }
        let mut visitor = FieldVisitor::default();
        attributes.record(&mut visitor);
        if let Some(span) = context.span(id) {
            span.extensions_mut().insert(SpanFields(visitor.finish()));
        }
    }

    fn on_record(&self, id: &span::Id, values: &span::Record<'_>, context: Context<'_, S>) {
        if suppressed() {
            return;
        }
        let Some(span) = context.span(id) else {
            return;
        };
        let mut visitor = FieldVisitor::default();
        values.record(&mut visitor);
        let update = visitor.finish();
        let mut extensions = span.extensions_mut();
        if let Some(existing) = extensions.get_mut::<SpanFields>() {
            existing.0.extend(update);
        } else {
            extensions.insert(SpanFields(update));
        }
    }

    fn on_event(&self, event: &Event<'_>, context: Context<'_, S>) {
        if suppressed() {
            return;
        }
        let mut merged = CollectedFields::default();
        if let Some(scope) = context.event_scope(event) {
            for span in scope.from_root() {
                if let Some(fields) = span.extensions().get::<SpanFields>() {
                    merged.extend(fields.0.clone());
                }
            }
        }
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);
        merged.extend(visitor.finish());

        let metadata = event.metadata();
        let mapping = self.mapping_for(metadata.target());
        let name = mapping.map_or_else(
            || match self.handle.component() {
                crate::DiagnosticsComponent::AnyHarness => "anyharness.tracing.event",
                crate::DiagnosticsComponent::DesktopWorker => "desktop_worker.tracing.event",
            },
            |mapping| mapping.name,
        );
        let kind = mapping.map_or(DetailedKindV1::Log, |mapping| mapping.kind);
        let stream = mapping.and_then(|mapping| mapping.stream);
        let message = merged.take_message();
        let correlation = merged.correlation();
        let error_classification = merged.take_error_classification();
        let mut arguments = merged.into_arguments();
        push_metadata(&mut arguments, "metadata.target", metadata.target());
        if let Some(module) = metadata.module_path() {
            push_metadata(&mut arguments, "metadata.module", module);
        }
        if let Some(file) = metadata.file() {
            push_metadata(&mut arguments, "metadata.file", file);
        }
        if let Some(line) = metadata.line() {
            arguments.push(DiagnosticArgument {
                name: "metadata.line".into(),
                privacy: DiagnosticPrivacy::Operational,
                value: ArgumentValueV1::Integer(i64::from(line)),
            });
        }
        let arguments = bound_tracing_arguments(arguments);
        let input = DetailedDiagnosticInput {
            name: name.into(),
            severity: map_level(metadata.level()),
            kind,
            privacy: if message.is_some() {
                DiagnosticPrivacy::Sensitive
            } else {
                DiagnosticPrivacy::Operational
            },
            message,
            arguments,
            correlation,
            error_classification: error_classification.map(Into::into),
            stream,
            dropped_count: None,
            milestone: None,
        };
        with_suppression(|| {
            let _ = self.handle.try_emit_detailed(input);
        });
    }
}

fn push_metadata(arguments: &mut Vec<DiagnosticArgument>, name: &'static str, value: &str) {
    arguments.push(DiagnosticArgument {
        name: name.into(),
        privacy: DiagnosticPrivacy::Operational,
        value: ArgumentValueV1::String(value.to_owned()),
    });
}

fn bound_tracing_arguments(mut arguments: Vec<DiagnosticArgument>) -> Vec<DiagnosticArgument> {
    if arguments.len() <= MAX_ARGUMENTS {
        return arguments;
    }
    let dropped = arguments.len().saturating_sub(MAX_ARGUMENTS - 1);
    arguments.truncate(MAX_ARGUMENTS - 1);
    arguments.push(DiagnosticArgument {
        name: "diagnostics.arguments_truncated".into(),
        privacy: DiagnosticPrivacy::Operational,
        value: ArgumentValueV1::Integer(i64::try_from(dropped).unwrap_or(i64::MAX)),
    });
    arguments
}

fn map_level(level: &tracing::Level) -> SeverityV1 {
    match *level {
        tracing::Level::TRACE => SeverityV1::Trace,
        tracing::Level::DEBUG => SeverityV1::Debug,
        tracing::Level::INFO => SeverityV1::Info,
        tracing::Level::WARN => SeverityV1::Warn,
        tracing::Level::ERROR => SeverityV1::Error,
    }
}

pub(crate) fn with_suppression<T>(operation: impl FnOnce() -> T) -> T {
    SUPPRESSED.with(|suppressed| {
        let previous = suppressed.replace(true);
        let result = operation();
        suppressed.set(previous);
        result
    })
}

fn suppressed() -> bool {
    SUPPRESSED.with(Cell::get)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracing_arguments_are_bounded_with_structural_loss_evidence() {
        let arguments = (0..(MAX_ARGUMENTS + 7))
            .map(|index| DiagnosticArgument {
                name: format!("field.{index}").into(),
                privacy: DiagnosticPrivacy::Operational,
                value: ArgumentValueV1::Integer(index as i64),
            })
            .collect();

        let bounded = bound_tracing_arguments(arguments);

        assert_eq!(bounded.len(), MAX_ARGUMENTS);
        let marker = bounded.last().expect("truncation marker");
        assert_eq!(marker.name, "diagnostics.arguments_truncated");
        assert_eq!(marker.value, ArgumentValueV1::Integer(8));
    }
}
