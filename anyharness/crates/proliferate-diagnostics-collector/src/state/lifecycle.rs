use proliferate_diagnostics_protocol::v1::types::{
    CanonicalLifecycleV1, ComponentV1, LifecycleFinalizerV1, LifecyclePhaseV1,
    PrivacyClassificationV1, ProducerLivenessV1, ProducerRecordV1, RecordClassV1,
    RedactionClassificationV1, SeverityV1, SourceV1, TerminalOutcomeV1,
};

use super::{CollectorCore, RecordOrigin};

impl CollectorCore {
    pub(crate) fn collector_lifecycle_record(
        &self,
        inner: &mut super::Inner,
        name: &str,
        operation_id: &str,
        outcome: Option<TerminalOutcomeV1>,
        error_classification: Option<String>,
    ) -> ProducerRecordV1 {
        let phase = if outcome.is_some() {
            LifecyclePhaseV1::Terminal
        } else {
            LifecyclePhaseV1::Started
        };
        let sequence = inner.collector_sequence;
        inner.collector_sequence = inner.collector_sequence.saturating_add(1);
        ProducerRecordV1 {
            schema_version: proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION,
            source_timestamp: super::query::timestamp_now(),
            producer_sequence: sequence,
            producer_boot_id: self.boot_id.clone(),
            component: ComponentV1::DiagnosticsCollector,
            source: SourceV1::Collector,
            release: self.release.clone(),
            environment: self.environment.clone(),
            operation_id: operation_id.to_owned(),
            parent_operation_id: None,
            trace_id: None,
            workspace_id: None,
            session_id: None,
            turn_id: None,
            item_id: None,
            request_id: None,
            target_id: None,
            prompt_id: None,
            workflow_id: None,
            name: name.to_owned(),
            severity: if outcome == Some(TerminalOutcomeV1::Failed) {
                SeverityV1::Error
            } else {
                SeverityV1::Info
            },
            arguments: Vec::new(),
            error_classification,
            record_class: RecordClassV1::Lifecycle,
            privacy: PrivacyClassificationV1::Operational,
            redaction: RedactionClassificationV1::None,
            detailed: None,
            lifecycle: Some(CanonicalLifecycleV1 {
                phase,
                outcome,
                finalizer: LifecycleFinalizerV1::Producer,
                model: None,
                plugin: None,
            }),
        }
    }

    /// Accept a record the collector authored itself. Bookkeeping has no
    /// submitter to hand a rejection to, so a record that still cannot be
    /// accepted is counted and dropped rather than surfaced as a caller-visible
    /// failure. The lifecycle table always yields a slot for this origin, so the
    /// counter stays at zero outside genuine corruption.
    pub(crate) fn emit_collector_record_locked(
        &self,
        inner: &mut super::Inner,
        record: ProducerRecordV1,
    ) {
        if self
            .accept_record_locked(inner, record, RecordOrigin::Collector)
            .is_err()
        {
            inner.counters.dropped_collector_records += 1;
        }
    }

    pub(crate) fn record_producer_attach_locked(
        &self,
        inner: &mut super::Inner,
        terminal: TerminalOutcomeV1,
    ) {
        let operation_id = format!("collector-attach-{}", uuid::Uuid::new_v4());
        let started = self.collector_lifecycle_record(
            inner,
            "collector.producer.attach",
            &operation_id,
            None,
            None,
        );
        self.emit_collector_record_locked(inner, started);
        let terminal = self.collector_lifecycle_record(
            inner,
            "collector.producer.attach",
            &operation_id,
            Some(terminal),
            None,
        );
        self.emit_collector_record_locked(inner, terminal);
    }

    pub fn begin_export(&self) -> String {
        let mut inner = self.lock();
        let operation_id = format!("collector-export-{}", uuid::Uuid::new_v4());
        let started = self.collector_lifecycle_record(
            &mut inner,
            "collector.export",
            &operation_id,
            None,
            None,
        );
        self.emit_collector_record_locked(&mut inner, started);
        operation_id
    }

    pub fn finish_export(
        &self,
        operation_id: &str,
        outcome: TerminalOutcomeV1,
        error_classification: Option<&str>,
    ) {
        let mut inner = self.lock();
        let terminal = self.collector_lifecycle_record(
            &mut inner,
            "collector.export",
            operation_id,
            Some(outcome),
            error_classification.map(str::to_owned),
        );
        self.emit_collector_record_locked(&mut inner, terminal);
    }

    pub fn begin_shutdown(&self) {
        let mut inner = self.lock();
        if inner.shutdown_operation_id.is_some() {
            return;
        }
        inner.status = proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Stopping;
        let operation_id = format!("collector-shutdown-{}", uuid::Uuid::new_v4());
        let started = self.collector_lifecycle_record(
            &mut inner,
            "collector.shutdown",
            &operation_id,
            None,
            None,
        );
        self.emit_collector_record_locked(&mut inner, started);
        inner.shutdown_operation_id = Some(operation_id);
    }

    pub fn finish_shutdown(&self, outcome: TerminalOutcomeV1) {
        let mut inner = self.lock();
        if inner.shutdown_finished {
            return;
        }
        let Some(operation_id) = inner.shutdown_operation_id.clone() else {
            return;
        };
        let error =
            (outcome == TerminalOutcomeV1::Failed).then(|| "collector_shutdown_failed".to_owned());
        let terminal = self.collector_lifecycle_record(
            &mut inner,
            "collector.shutdown",
            &operation_id,
            Some(outcome),
            error,
        );
        self.emit_collector_record_locked(&mut inner, terminal);
        inner.shutdown_finished = true;
    }

    pub fn mark_producer_dead(&self, producer_boot_id: &str) -> usize {
        let mut inner = self.lock();
        for producer in inner.producers.values_mut() {
            if producer.health.producer_boot_id == producer_boot_id {
                producer.health.liveness = ProducerLivenessV1::Dead;
            }
        }
        let starts: Vec<ProducerRecordV1> = inner
            .lifecycle
            .values()
            .filter(|tracker| tracker.open && tracker.producer_boot_id == producer_boot_id)
            .filter_map(|tracker| tracker.start_record.clone())
            .collect();
        let mut abandoned = 0;
        for start in starts {
            let mut terminal = start.clone();
            terminal.source_timestamp = super::query::timestamp_now();
            terminal.severity = SeverityV1::Warn;
            terminal.error_classification = None;
            terminal.lifecycle = Some(CanonicalLifecycleV1 {
                phase: LifecyclePhaseV1::Terminal,
                outcome: Some(TerminalOutcomeV1::Abandoned),
                finalizer: LifecycleFinalizerV1::Collector,
                model: start
                    .lifecycle
                    .as_ref()
                    .and_then(|value| value.model.clone()),
                plugin: start
                    .lifecycle
                    .as_ref()
                    .and_then(|value| value.plugin.clone()),
            });
            self.emit_collector_record_locked(&mut inner, terminal);
            abandoned += 1;
        }
        abandoned
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

    use crate::config::CollectorConfig;

    use super::CollectorCore;

    #[test]
    fn timeout_shutdown_terminal_is_idempotent_and_collector_names_are_closed() {
        let core = CollectorCore::new(&CollectorConfig::standalone("lifecycle-test-capability"))
            .expect("collector core");
        core.mark_ready();
        core.begin_shutdown();
        core.finish_shutdown(TerminalOutcomeV1::TimedOut);
        core.finish_shutdown(TerminalOutcomeV1::TimedOut);

        let inner = core.lock();
        let records = inner
            .records
            .iter()
            .map(|record| record.decode().expect("collector record"))
            .collect::<Vec<_>>();
        let names = records
            .iter()
            .map(|record| record.record.name.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            names,
            BTreeSet::from(["collector.boot", "collector.shutdown"])
        );
        let shutdown = records
            .iter()
            .filter(|record| record.record.name == "collector.shutdown")
            .collect::<Vec<_>>();
        assert_eq!(shutdown.len(), 2);
        assert_eq!(
            shutdown[1]
                .record
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.outcome),
            Some(TerminalOutcomeV1::TimedOut)
        );
    }
}
