use std::io;
use std::sync::atomic::Ordering;

use proliferate_diagnostics_protocol::v1::limits::MAX_MESSAGE_BYTES;
use proliferate_diagnostics_protocol::v1::types::{
    CanonicalLifecycleV1, LifecycleFinalizerV1, LifecyclePhaseV1, RecordClassV1, SeverityV1,
    TerminalOutcomeV1, TypedArgumentV1,
};

use super::{
    LifecycleCorrelation, TauriDiagnosticsProducer, PR3_CLASSIFICATIONS, PR3_LIFECYCLE_NAMES,
};

pub(crate) struct LifecycleOperation {
    producer: TauriDiagnosticsProducer,
    name: &'static str,
    operation_id: String,
    correlation: LifecycleCorrelation,
    arguments: Vec<TypedArgumentV1>,
    classifications: &'static [&'static str],
    terminal: bool,
}

impl LifecycleOperation {
    fn new(
        producer: TauriDiagnosticsProducer,
        name: &'static str,
        operation_id: String,
        correlation: LifecycleCorrelation,
        arguments: Vec<TypedArgumentV1>,
        classifications: &'static [&'static str],
        terminal: bool,
    ) -> Self {
        Self {
            producer,
            name,
            operation_id,
            correlation,
            arguments,
            classifications,
            terminal,
        }
    }

    fn operation_id(&self) -> &str {
        &self.operation_id
    }

    /// Attaches arguments learned after the operation began (e.g. an exit
    /// status observed at terminal time). They ride the terminal record only.
    pub(crate) fn append_arguments(
        &mut self,
        arguments: impl IntoIterator<Item = TypedArgumentV1>,
    ) {
        self.arguments.extend(arguments);
    }
}

impl LifecycleOperation {
    pub(crate) fn terminal(
        mut self,
        outcome: TerminalOutcomeV1,
        classification: Option<&'static str>,
    ) {
        self.emit_terminal(outcome, classification);
    }

    fn emit_terminal(&mut self, outcome: TerminalOutcomeV1, classification: Option<&'static str>) {
        if self.terminal {
            return;
        }
        if self.producer.inner.closed.load(Ordering::Acquire) {
            self.producer.inner.fallback.note_drop(1);
            self.terminal = true;
            return;
        }
        let classification =
            classification.filter(|classification| self.classifications.contains(classification));
        let outcome = if outcome == TerminalOutcomeV1::Failed && classification.is_none() {
            self.producer.inner.fallback.note_drop(1);
            TerminalOutcomeV1::Abandoned
        } else {
            outcome
        };
        let record = self.producer.next_record_with_operation(
            self.name,
            &self.operation_id,
            if matches!(
                outcome,
                TerminalOutcomeV1::Failed | TerminalOutcomeV1::TimedOut
            ) {
                SeverityV1::Error
            } else {
                SeverityV1::Info
            },
            RecordClassV1::Lifecycle,
            classification.map(str::to_owned),
            None,
            &self.correlation,
            self.arguments.clone(),
            Some(CanonicalLifecycleV1 {
                phase: LifecyclePhaseV1::Terminal,
                outcome: Some(outcome),
                finalizer: LifecycleFinalizerV1::Producer,
                model: None,
                plugin: None,
            }),
        );
        if let Some(record) = record {
            self.producer.enqueue(record, true);
        }
        self.terminal = true;
    }
}

impl TauriDiagnosticsProducer {
    pub(crate) fn begin_lifecycle(&self, name: &'static str) -> LifecycleOperation {
        self.begin_lifecycle_with_correlation(name, LifecycleCorrelation::default())
    }

    pub(crate) fn begin_lifecycle_with_arguments(
        &self,
        name: &'static str,
        arguments: Vec<TypedArgumentV1>,
    ) -> LifecycleOperation {
        if !PR3_LIFECYCLE_NAMES.contains(&name) {
            return LifecycleOperation::new(
                self.clone(),
                name,
                uuid::Uuid::new_v4().to_string(),
                LifecycleCorrelation::default(),
                arguments,
                &PR3_CLASSIFICATIONS,
                true,
            );
        }
        self.begin_admitted_lifecycle(
            name,
            LifecycleCorrelation::default(),
            arguments,
            &PR3_CLASSIFICATIONS,
        )
    }

    pub(crate) fn begin_lifecycle_with_correlation(
        &self,
        name: &'static str,
        correlation: LifecycleCorrelation,
    ) -> LifecycleOperation {
        if !PR3_LIFECYCLE_NAMES.contains(&name) {
            return LifecycleOperation::new(
                self.clone(),
                name,
                uuid::Uuid::new_v4().to_string(),
                correlation,
                Vec::new(),
                &PR3_CLASSIFICATIONS,
                true,
            );
        }
        self.begin_admitted_lifecycle(name, correlation, Vec::new(), &PR3_CLASSIFICATIONS)
    }

    fn begin_admitted_lifecycle(
        &self,
        name: &'static str,
        correlation: LifecycleCorrelation,
        arguments: Vec<TypedArgumentV1>,
        classifications: &'static [&'static str],
    ) -> LifecycleOperation {
        let operation_id = uuid::Uuid::new_v4().to_string();
        if self.inner.closed.load(Ordering::Acquire) {
            self.inner.fallback.note_drop(1);
            return LifecycleOperation::new(
                self.clone(),
                name,
                operation_id,
                correlation,
                arguments,
                classifications,
                true,
            );
        }
        let record = self.next_record_with_operation(
            name,
            &operation_id,
            SeverityV1::Info,
            RecordClassV1::Lifecycle,
            None,
            None,
            &correlation,
            arguments.clone(),
            Some(CanonicalLifecycleV1 {
                phase: LifecyclePhaseV1::Started,
                outcome: None,
                finalizer: LifecycleFinalizerV1::Producer,
                model: None,
                plugin: None,
            }),
        );
        if let Some(record) = record {
            self.enqueue(record, true);
        }
        LifecycleOperation::new(
            self.clone(),
            name,
            operation_id,
            correlation,
            arguments,
            classifications,
            false,
        )
    }
}

#[path = "support_lifecycle.rs"]
pub(crate) mod support_lifecycle;

impl Drop for LifecycleOperation {
    fn drop(&mut self) {
        if !self.terminal {
            self.emit_terminal(TerminalOutcomeV1::Abandoned, None);
        }
    }
}

#[derive(Clone)]
pub(crate) struct DiagnosticsMakeWriter {
    producer: TauriDiagnosticsProducer,
}

impl DiagnosticsMakeWriter {
    pub(super) fn new(producer: TauriDiagnosticsProducer) -> Self {
        Self { producer }
    }
}

pub(crate) struct DiagnosticsTracingWriter {
    producer: TauriDiagnosticsProducer,
    buffer: Vec<u8>,
    severity: SeverityV1,
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for DiagnosticsMakeWriter {
    type Writer = DiagnosticsTracingWriter;

    fn make_writer(&'a self) -> Self::Writer {
        DiagnosticsTracingWriter {
            producer: self.producer.clone(),
            buffer: Vec::with_capacity(512),
            severity: SeverityV1::Info,
        }
    }

    fn make_writer_for(&'a self, metadata: &tracing::Metadata<'_>) -> Self::Writer {
        let severity = match *metadata.level() {
            tracing::Level::TRACE => SeverityV1::Trace,
            tracing::Level::DEBUG => SeverityV1::Debug,
            tracing::Level::INFO => SeverityV1::Info,
            tracing::Level::WARN => SeverityV1::Warn,
            tracing::Level::ERROR => SeverityV1::Error,
        };
        DiagnosticsTracingWriter {
            producer: self.producer.clone(),
            buffer: Vec::with_capacity(512),
            severity,
        }
    }
}

impl io::Write for DiagnosticsTracingWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let remaining = MAX_MESSAGE_BYTES.saturating_sub(self.buffer.len());
        self.buffer
            .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for DiagnosticsTracingWriter {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let message = String::from_utf8_lossy(&self.buffer);
        self.producer
            .detailed(self.severity, "desktop.tauri.log", message.trim_end());
    }
}
