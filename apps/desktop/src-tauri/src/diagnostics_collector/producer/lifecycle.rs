use std::io;
use std::sync::atomic::Ordering;

use proliferate_diagnostics_protocol::v1::limits::MAX_MESSAGE_BYTES;
use proliferate_diagnostics_protocol::v1::types::{
    CanonicalLifecycleV1, LifecycleFinalizerV1, LifecyclePhaseV1, RecordClassV1, SeverityV1,
    TerminalOutcomeV1,
};

use super::{LifecycleCorrelation, TauriDiagnosticsProducer, PR3_CLASSIFICATIONS};

pub(crate) struct LifecycleOperation {
    producer: TauriDiagnosticsProducer,
    name: &'static str,
    operation_id: String,
    correlation: LifecycleCorrelation,
    terminal: bool,
}

impl LifecycleOperation {
    pub(super) fn new(
        producer: TauriDiagnosticsProducer,
        name: &'static str,
        operation_id: String,
        correlation: LifecycleCorrelation,
        terminal: bool,
    ) -> Self {
        Self {
            producer,
            name,
            operation_id,
            correlation,
            terminal,
        }
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
            classification.filter(|classification| PR3_CLASSIFICATIONS.contains(classification));
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
