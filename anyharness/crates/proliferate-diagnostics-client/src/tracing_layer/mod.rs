use std::{cell::Cell, sync::Arc};

use proliferate_diagnostics_protocol::v1::limits::MAX_ARGUMENTS;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, DetailedKindV1, SeverityV1, StandardStreamV1,
};
use tracing::{span, Event, Subscriber};
use tracing_subscriber::{layer::Context, registry::LookupSpan, Layer};

use crate::{
    DetailedDiagnosticInput, DiagnosticArgument, DiagnosticPrivacy, DiagnosticsProducerHandle,
};

mod promotions;
mod visitor;

use visitor::{CollectedFields, FieldVisitor};

const MAX_INHERITED_SPANS: usize = 32;

thread_local! {
    static SUPPRESSED: Cell<bool> = const { Cell::new(false) };
}

tokio::task_local! {
    static TASK_SUPPRESSED: Cell<bool>;
}

struct SuppressionGuard {
    previous: bool,
}

impl SuppressionGuard {
    fn enter() -> Self {
        Self {
            previous: SUPPRESSED.with(|suppressed| suppressed.replace(true)),
        }
    }

    fn enter_callback() -> Option<Self> {
        (!suppressed()).then(Self::enter)
    }
}

impl Drop for SuppressionGuard {
    fn drop(&mut self) {
        SUPPRESSED.with(|suppressed| suppressed.set(self.previous));
    }
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

/// How one tracing target resolves to a record name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolvedRecordName<'a> {
    /// A table entry names this record and carries its kind.
    Mapped {
        name: &'static str,
        kind: DetailedKindV1,
        stream: Option<StandardStreamV1>,
    },
    /// The target is under the pass-through prefix and names itself.
    PassThrough(&'a str),
    /// Neither: the component's anonymous record name.
    Anonymous,
}

#[derive(Clone, Default)]
pub struct TargetMappingConfig {
    mappings: Vec<TargetMapping>,
    passthrough_prefix: Option<&'static str>,
}

impl TargetMappingConfig {
    pub fn new(mappings: Vec<TargetMapping>) -> Self {
        Self {
            mappings,
            passthrough_prefix: None,
        }
    }

    /// Lets any target under `prefix` name its own record, so a new named
    /// event needs a `target:` and no table entry.
    pub fn with_passthrough_prefix(mut self, prefix: &'static str) -> Self {
        self.passthrough_prefix = Some(prefix);
        self
    }

    /// Explicit table entries win; then the pass-through prefix; then the
    /// anonymous name. A target the producer would reject as a record name
    /// (charset or length) falls back to anonymous rather than being dropped
    /// on the floor by record preparation.
    pub fn resolve<'a>(&self, target: &'a str) -> ResolvedRecordName<'a> {
        if let Some(mapping) = self
            .mappings
            .iter()
            .find(|mapping| mapping.target == target)
        {
            return ResolvedRecordName::Mapped {
                name: mapping.name,
                kind: mapping.kind,
                stream: mapping.stream,
            };
        }
        let prefixed = self.passthrough_prefix.is_some_and(|prefix| {
            target.len() > prefix.len() && target.starts_with(prefix)
        });
        if prefixed && crate::producer::record::valid_name(target) {
            return ResolvedRecordName::PassThrough(target);
        }
        ResolvedRecordName::Anonymous
    }
}

#[derive(Clone)]
pub struct DiagnosticsTracingLayer {
    handle: DiagnosticsProducerHandle,
    mappings: Arc<TargetMappingConfig>,
}

#[derive(Default)]
struct SpanFields(CollectedFields);

impl DiagnosticsTracingLayer {
    pub(crate) fn new(handle: DiagnosticsProducerHandle) -> Self {
        Self {
            handle,
            mappings: Arc::new(TargetMappingConfig::default()),
        }
    }

    pub fn with_target_mappings(mut self, config: TargetMappingConfig) -> Self {
        self.mappings = Arc::new(config);
        self
    }

    fn anonymous_name(&self) -> &'static str {
        match self.handle.component() {
            crate::DiagnosticsComponent::AnyHarness => "anyharness.tracing.event",
            crate::DiagnosticsComponent::DesktopWorker => "desktop_worker.tracing.event",
        }
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
        let Some(_suppression) = SuppressionGuard::enter_callback() else {
            return;
        };
        let mut visitor = FieldVisitor::default();
        attributes.record(&mut visitor);
        if let Some(span) = context.span(id) {
            span.extensions_mut().insert(SpanFields(visitor.finish()));
        }
    }

    fn on_record(&self, id: &span::Id, values: &span::Record<'_>, context: Context<'_, S>) {
        let Some(_suppression) = SuppressionGuard::enter_callback() else {
            return;
        };
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
        let Some(_suppression) = SuppressionGuard::enter_callback() else {
            return;
        };
        let mut merged = CollectedFields::default();
        if let Some(scope) = context.event_scope(event) {
            // `Scope` is nearest-to-farthest and does not allocate. Nearest
            // explicit span context wins; once the bounded map is full,
            // deeper ancestors cannot contribute an accepted argument.
            let mut scope = scope;
            let mut inheritance_closed = false;
            for _ in 0..MAX_INHERITED_SPANS {
                let Some(span) = scope.next() else {
                    inheritance_closed = true;
                    break;
                };
                let extensions = span.extensions();
                if let Some(fields) = extensions.get::<SpanFields>() {
                    merged.extend_missing(&fields.0);
                    if merged.is_full() {
                        if scope.next().is_some() {
                            merged.note_dropped();
                        }
                        inheritance_closed = true;
                        break;
                    }
                }
            }
            if !inheritance_closed && scope.next().is_some() {
                merged.note_dropped();
            }
        }
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);
        merged.extend(visitor.finish());

        let metadata = event.metadata();
        let (name, kind, stream): (std::borrow::Cow<'static, str>, _, _) =
            match self.mappings.resolve(metadata.target()) {
                ResolvedRecordName::Mapped { name, kind, stream } => {
                    (std::borrow::Cow::Borrowed(name), kind, stream)
                }
                ResolvedRecordName::PassThrough(target) => (
                    std::borrow::Cow::Owned(target.to_owned()),
                    DetailedKindV1::Log,
                    None,
                ),
                ResolvedRecordName::Anonymous => (
                    std::borrow::Cow::Borrowed(self.anonymous_name()),
                    DetailedKindV1::Log,
                    None,
                ),
            };
        let message = merged.take_message();
        let correlation = merged.take_correlation();
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
            name,
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
        let _ = self.handle.try_emit_detailed(input);
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
    let field_marker = arguments
        .iter()
        .position(|argument| argument.name == "diagnostics.fields_truncated")
        .map(|index| arguments.remove(index));
    let reserved = 1 + usize::from(field_marker.is_some());
    let dropped = arguments.len().saturating_sub(MAX_ARGUMENTS - reserved);
    arguments.truncate(MAX_ARGUMENTS - reserved);
    if let Some(marker) = field_marker {
        arguments.push(marker);
    }
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
    let _suppression = SuppressionGuard::enter();
    operation()
}

pub(crate) async fn with_task_suppression<T>(future: impl std::future::Future<Output = T>) -> T {
    TASK_SUPPRESSED.scope(Cell::new(true), future).await
}

fn suppressed() -> bool {
    TASK_SUPPRESSED.try_with(Cell::get).unwrap_or(false) || SUPPRESSED.with(Cell::get)
}

#[cfg(test)]
mod tests {
    use proliferate_diagnostics_protocol::v1::limits::MAX_NAME_BYTES;

    use super::*;

    fn passthrough_config() -> TargetMappingConfig {
        TargetMappingConfig::new(vec![
            TargetMapping::stdio(
                "anyharness.agent_stderr",
                "anyharness.agent.stderr",
                StandardStreamV1::Stderr,
            ),
            TargetMapping::span_event("anyharness.runtime_incident", "anyharness.runtime.incident"),
        ])
        .with_passthrough_prefix("anyharness.")
    }

    #[test]
    fn explicit_mappings_keep_their_name_kind_and_stream_under_pass_through() {
        let config = passthrough_config();

        assert_eq!(
            config.resolve("anyharness.agent_stderr"),
            ResolvedRecordName::Mapped {
                name: "anyharness.agent.stderr",
                kind: DetailedKindV1::Stdio,
                stream: Some(StandardStreamV1::Stderr),
            }
        );
        assert_eq!(
            config.resolve("anyharness.runtime_incident"),
            ResolvedRecordName::Mapped {
                name: "anyharness.runtime.incident",
                kind: DetailedKindV1::SpanEvent,
                stream: None,
            }
        );
    }

    #[test]
    fn pass_through_refuses_targets_the_producer_would_reject_as_a_name() {
        let config = passthrough_config();
        let overlong = format!("anyharness.{}", "x".repeat(MAX_NAME_BYTES));

        for target in [
            "anyharness.",
            "anyharness.Turn.Finished",
            "anyharness.turn finished",
            overlong.as_str(),
        ] {
            assert_eq!(
                config.resolve(target),
                ResolvedRecordName::Anonymous,
                "target must not name a record: {target}"
            );
        }
    }

    #[test]
    fn a_config_without_a_prefix_never_passes_a_target_through() {
        let config = TargetMappingConfig::new(Vec::new());

        assert_eq!(
            config.resolve("anyharness.turn.finished"),
            ResolvedRecordName::Anonymous
        );
    }

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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn task_suppression_survives_async_yields_and_nested_thread_guard() {
        with_task_suppression(async {
            for _ in 0..32 {
                tokio::task::yield_now().await;
                assert!(suppressed());
            }
            with_suppression(|| assert!(suppressed()));
            assert!(suppressed());
        })
        .await;
        assert!(!suppressed());
    }

    #[test]
    fn suppression_restores_prior_state_after_a_panic() {
        let result = std::panic::catch_unwind(|| {
            with_suppression(|| panic!("suppression proof"));
        });
        assert!(result.is_err());
        assert!(!suppressed());
    }
}
